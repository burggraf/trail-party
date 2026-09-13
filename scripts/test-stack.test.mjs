import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertSafeTestUrl, cleanupOwnedStack, removeOwnedDepot, stopDirectProcess, waitForOwnedResourcesToStop } from './test-stack.mjs';

test('test-stack refuses foreign depot cleanup and permits only its marker owner', async () => {
  const root = resolve('.local/test-runs');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const depot = await mkdtemp(join(root, 'safety-'));
  const owner = 'owner-a';
  await writeFile(join(depot, '.owner'), owner, { mode: 0o600 });
  await assert.rejects(
    removeOwnedDepot(depot, 'owner-b'),
    /unowned test depot/u,
  );
  assert.equal(await readFile(join(depot, '.owner'), 'utf8'), owner);
  await removeOwnedDepot(depot, owner);
  await assert.rejects(() => readFile(depot), /ENOENT/u);
  await rm(depot, { recursive: true, force: true });
});

test('test-stack cleanup attempts every sibling and can be retried after one stop fails', async () => {
  const calls = [];
  let failFirstChild = true;
  const cleanup = () => cleanupOwnedStack({
    stopChildren: [
      async () => {
        calls.push('first-child');
        if (failFirstChild) {
          failFirstChild = false;
          throw new Error('first child stop failed');
        }
      },
      async () => { calls.push('second-child'); },
    ],
    stopMailpit: async () => { calls.push('mailpit'); },
    waitForResources: async () => { calls.push('resources'); },
    closeLogs: async () => { calls.push('logs'); },
    removeDepot: async () => { calls.push('depot'); },
  });

  await assert.rejects(cleanup(), /first child stop failed/u);
  assert.deepEqual(calls, ['first-child', 'second-child', 'mailpit', 'resources', 'logs', 'depot']);
  calls.length = 0;
  await cleanup();
  assert.deepEqual(calls, ['first-child', 'second-child', 'mailpit', 'resources', 'logs', 'depot']);
});

test('test-stack escalates a direct child that ignores SIGTERM', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let closed;
  try {
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('direct-child safety process did not start')), 2000);
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('ready')) {
          clearTimeout(timer);
          resolvePromise();
        }
      });
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    closed = new Promise(resolvePromise => child.once('close', resolvePromise));
    await stopDirectProcess(child, closed, 25);
    assert.equal(child.signalCode, 'SIGKILL');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      if (!closed) closed = new Promise(resolvePromise => child.once('close', resolvePromise));
      await closed;
    }
  }
});

test('test-stack rejects production and external Mailpit targets', () => {
  assert.throws(
    () => assertSafeTestUrl('https://trivia.azabab.com/', 'production'),
    /only owned 127\.0\.0\.1 HTTP targets/u,
  );
  assert.throws(
    () => assertSafeTestUrl('http://127.0.0.1:8025/', 'external Mailpit'),
    /only owned 127\.0\.0\.1 HTTP targets/u,
  );
});

test('test-stack detects a live orphan and verifies cleanup can be retried', async () => {
  const child = spawn(process.execPath, ['-e', [
    "const net = require('node:net');",
    "const server = net.createServer();",
    "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
  ].join('')], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolvePromise, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('orphan safety child did not report its port')), 2000);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/(\d+)\n/u);
        if (match) {
          clearTimeout(timer);
          resolvePromise(Number(match[1]));
        }
      });
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await assert.rejects(
      waitForOwnedResourcesToStop([child.pid], [port], 'safety-live', 25),
      /did not stop/u,
    );
    const closed = new Promise(resolvePromise => child.once('close', resolvePromise));
    child.kill('SIGTERM');
    await closed;
    await waitForOwnedResourcesToStop([child.pid], [port], 'safety-test');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolvePromise => child.once('close', resolvePromise));
    }
  }
});
