import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { setTimeout as pollDelay } from 'node:timers/promises';
import { initClient } from 'trailbase';

const root = resolve('.local/test-runs');
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, RUST_LOG: 'info' };

export async function removeOwnedDepot(depot: string, marker: string) {
  const actual = await realpath(depot);
  assert.ok(actual.startsWith(`${await realpath(root)}${sep}`), 'Refusing depot outside test root');
  assert.equal(await readFile(join(actual, '.owner'), 'utf8'), marker, 'Refusing unowned depot');
  await rm(actual, { recursive: true });
}

async function freePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((ok, fail) => reservation.once('error', fail).listen(0, '127.0.0.1', ok));
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((ok, fail) => reservation.close(error => error ? fail(error) : ok()));
  return address.port;
}

export async function startStack() {
  const version = spawnSync('trail', ['--version'], { encoding: 'utf8', env });
  assert.equal(version.status, 0, 'trail executable is required');
  assert.match(version.stdout, /v0\.33\.14-0-g3f965de7.*\nsqlite: 3\.53\.2/);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const depot = await mkdtemp(join(root, 'capabilities-'));
  const marker = randomUUID();
  await writeFile(join(depot, '.owner'), marker, { mode: 0o600 });
  const logs = resolve('.artifacts/p01-t2', marker);
  await mkdir(logs, { recursive: true, mode: 0o700 });
  const logPath = join(logs, 'trail.log');
  const apiName = `items_${marker.replaceAll('-', '')}`;
  const auditName = `audit_${marker.replaceAll('-', '')}`;
  const readyName = `ready_${marker.replaceAll('-', '')}`;
  const accounts = [0, 1].map(n => ({ email: `probe-${n}-${marker}@example.invalid`, password: randomBytes(24).toString('base64url') }));
  let child: ChildProcess | undefined;
  let log: WriteStream | undefined;
  let exit: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  function cli(args: string[]) {
    const result = spawnSync('trail', ['--depot', depot, '--public-url', base, ...args], { env, encoding: 'utf8' });
    // CLI output can contain initial admin credentials. Never print it to the test reporter.
    if (result.status !== 0) {
      void appendFile(logPath, `${result.stdout}\n${result.stderr}`);
      throw new Error(`TrailBase CLI failed; private diagnostics: ${logs}`);
    }
    return result.stdout;
  }

  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const owned = child;
      const kill = setTimeout(() => owned.kill('SIGKILL'), 5000);
      owned.kill('SIGTERM');
      try { await exit; } finally { clearTimeout(kill); }
    }
    if (log) await new Promise<void>(ok => log!.end(ok));
    child = undefined;
    log = undefined;
  }

  async function start() {
    log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    child = spawn('trail', ['--depot', depot, '--public-url', base, 'run', '--address', `127.0.0.1:${port}`, '--runtime-threads', '1', '--stderr-logging'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.pipe(log, { end: false });
    child.stderr!.pipe(log, { end: false });
    let launchError: Error | undefined;
    child.once('error', error => { launchError = error; });
    exit = new Promise(ok => child!.once('close', () => ok()));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (launchError || child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(`${base}/api/healthcheck`, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          // The per-run API name proves this is our depot before any auth mutation.
          const ready = await fetch(`${base}/api/records/v1/${readyName}/1`, { signal: AbortSignal.timeout(500) });
          assert.ok(ready.ok);
          assert.equal((await ready.json()).id, 1);
          return;
        }
      } catch (error) {
        await appendFile(logPath, `Readiness condition: ${String(error)}\n`);
      }
      // Bounded health+auth+schema condition polling, not a readiness sleep.
      await pollDelay(50);
    }
    throw new Error(`Owned TrailBase did not become ready within 20s; private diagnostics: ${logs}`);
  }

  function close(): Promise<void> {
    closing ??= (async () => {
      await stop();
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      await removeOwnedDepot(depot, marker);
    })();
    return closing;
  }
  function onSignal() { void close().finally(() => process.exit(1)); }
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  try {
    const config = (await readFile('tests/backend/fixture/config.textproto', 'utf8'))
      .replace('__ITEM_API__', apiName).replace('__AUDIT_API__', auditName).replace('__READY_API__', readyName);
    await writeFile(join(depot, 'config.textproto'), config, { mode: 0o600 });
    await cp('tests/backend/fixture/migrations', join(depot, 'migrations'), { recursive: true });
    await mkdir(join(depot, 'wasm'), { recursive: true });
    await cp('.artifacts/p01-t2/component/probe.wasm', join(depot, 'wasm', 'probe.wasm'));
    await start();
    // v0.33.14 user-add SQL references the removed verified column. Use the supported
    // admin API for synthetic baseline accounts; never parse/log bootstrap passwords.
    const bootstrap = initClient(base);
    await bootstrap.loginAnonymously();
    const hex = Buffer.from(bootstrap.user()!.id, 'base64url').toString('hex');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    cli(['admin', 'promote', uuid]);
    await bootstrap.refreshAuthToken({ force: true });
    for (const account of accounts) {
      await bootstrap.fetch('/api/_admin/user', {
        method: 'POST', body: JSON.stringify({ ...account, verified: true, admin: false }),
      });
    }
    await bootstrap.logout();
  } catch (error) {
    await close();
    throw error;
  }
  console.log(`Real backend: ${version.stdout.trim().replaceAll('\n', '; ')}; owned loopback port ${port}`);
  return {
    base, apiName, auditName, accounts, close,
    restart: async () => { await stop(); await start(); },
    schema: (mode: string) => JSON.parse(cli(['schema', apiName, '--mode', mode])),
  };
}
