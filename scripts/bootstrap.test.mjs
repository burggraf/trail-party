import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as poll } from 'node:timers/promises';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '..');
const devRoot = join(repo, '.local/dev');
const marker = `trail-party-dev-v1\n${repo}\n`;
const launcher = join(repo, 'scripts/dev.mjs');
const fault = join(repo, 'scripts/fixtures/bootstrap-child.mjs');
const cleanup = new Map();

async function until(predicate, message, budget = 20000) {
  const end = Date.now() + budget;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    await poll(25);
  }
  assert.fail(message);
}
async function listener() {
  const server = createServer((req, res) => res.end('foreign listener survives'));
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  return { server, port: server.address().port, close: () => new Promise(ok => server.close(ok)) };
}
async function ports() {
  const a = await listener(), b = await listener();
  const result = [a.port, b.port];
  await a.close(); await b.close();
  return result;
}
async function workspace(t) {
  await mkdir(devRoot, { recursive: true });
  const path = join(devRoot, `bootstrap-${randomUUID()}`);
  // Only this test's unique synthetic path is ever removed, never the human dev depot.
  t.after(async () => {
    for (const stop of cleanup.get(path) ?? []) await stop();
    cleanup.delete(path);
    await rm(path, { recursive: true, force: true });
  });
  return path;
}
async function launch(t, depot, extra = {}, script = launcher, { ipc = false } = {}) {
  const [backend, frontend] = await ports();
  const child = spawn(process.execPath, [script], {
    cwd: repo, detached: true,
    env: { ...process.env, TRAIL_PARTY_DEPOT: depot, TRAILBASE_PORT: String(backend), VITE_PORT: String(frontend), ...extra },
    stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])],
  });
  let output = '', code;
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const closed = new Promise(ok => child.once('close', (c, signal) => { code = c ?? signal; ok(); }));
  async function stop(signal = 'SIGTERM') {
    if (code === undefined) child.kill(signal);
    await until(() => code !== undefined, 'launcher did not clean up within 8s', 8000);
    await closed;
  }
  cleanup.set(depot, [...(cleanup.get(depot) ?? []), stop]);
  t.after(() => stop().finally(() => {
    // Recovery only for our test-created process group, including the defective old launcher.
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }));
  return {
    child, backend, frontend, stop, output: () => output, code: () => code,
    async refused(pattern) {
      await until(() => code !== undefined, 'expected refusal, not a running stack');
      assert.equal(code, 1);
      assert.ok(pattern.test(output), `missing sanitized refusal: ${pattern}`);
      assert.ok(!output.includes('Ready:'), 'must never announce ready on failure');
    },
    async ready() {
      await until(() => output.includes('Ready:') || code !== undefined, 'stack never became ready');
      assert.equal(code, undefined, 'stack failed before ready; see private diagnostics');
      const line = output.split('\n').find(line => line.startsWith('Ready:'));
      assert.ok(line, 'no ready announcement');
      return JSON.parse(line.slice(6));
    },
  };
}
async function assertFree(...ports) {
  for (const port of ports) {
    const server = createServer();
    await new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', ok));
    await new Promise(ok => server.close(ok));
  }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } }
function killOwnedLauncher(t, run) {
  t.after(async () => {
    if (run.code() !== undefined) return;
    try { process.kill(-run.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await until(() => run.code() !== undefined, 'fault launcher cleanup did not finish', 2000);
  });
}

async function cleanupOwnershipCase(t, mode) {
  const depot = await workspace(t);
  const run = await launch(t, depot, { BOOTSTRAP_FAULT: mode }, fault, { ipc: true });
  const messages = [];
  run.child.on('message', message => messages.push(message));
  let backendPid;
  t.after(async () => {
    if (backendPid) {
      if (run.child.connected) run.child.send({ type: 'release-backend' });
      try { await until(() => !alive(backendPid), 'cleanup fixture backend did not terminate', 6000); }
      catch {
        try { process.kill(-backendPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await until(() => !alive(backendPid), 'cleanup fixture backend group survived fallback', 2000);
      }
    }
    if (run.code() === undefined) await run.stop();
  });
  const message = type => until(() => messages.find(item => item.type === type), `missing cleanup fixture message: ${type}`, 3000);
  const backend = await message('backend-ready');
  backendPid = backend.pid;
  await message('http-listening');
  assert.equal(run.code(), undefined, 'negative fixture must be held before SIGINT');
  process.kill(run.child.pid, 'SIGINT');
  await message('frontend-close-invoked');
  await message('backend-term-entered');
  assert.equal(run.code(), undefined, 'launcher must await held backend cleanup');
  await stat(`${depot}.lock`);
  run.child.send({ type: 'release-backend' });
  await message('backend-closed');
  await until(() => run.code() !== undefined, 'launcher did not settle after backend release', 8000);
  const logClosed = await message('log-fd-closed');
  assert.equal(logClosed.closed, true, 'launcher must close its owned log descriptor');
  const result = await message('launcher-result');
  assert.equal(result.code, 1, 'injected cleanup failure must remain nonzero');
  assert.equal(messages.find(item => item.type === 'backend-closed').pid, backend.pid);
  assert.ok(messages.findIndex(item => item.type === 'backend-closed') < messages.findIndex(item => item.type === 'launcher-result'), 'backend close must precede launcher completion');
  assert.ok(!run.output().includes('SYNTHETIC-'), 'synthetic fixture errors must stay private');
  assert.ok(!run.output().includes('Ready:'), 'negative fixture must never announce ready');
  const log = run.output().match(/private diagnostics: (.+trail\.log)/)?.[1];
  assert.ok(log, 'private diagnostics path missing');
  const diagnostic = JSON.parse(await readFile(`${log}.cleanup.json`, 'utf8'));
  assert.equal((await stat(`${log}.cleanup.json`)).mode & 0o777, 0o600);
  assert.deepEqual(diagnostic.operations.map(item => item.operation), ['frontend', 'http', 'backend', 'log.close', 'lock.remove']);
  assert.ok(diagnostic.operations.slice(1).every(item => item.settlement === 'fulfilled'));
  const frontendDiagnostic = diagnostic.operations[0];
  assert.equal(frontendDiagnostic.invocation, mode.endsWith('-sync') ? 'sync' : 'async');
  assert.equal(frontendDiagnostic.settlement, 'rejected');
  if (mode.endsWith('-sync')) assert.equal(frontendDiagnostic.error.message, 'SYNTHETIC-SYNC-CLEANUP');
  else assert.equal(frontendDiagnostic.error.value, 'SYNTHETIC-ASYNC-CLEANUP');
  await assertFree(run.backend, run.frontend);
  await assert.rejects(stat(`${depot}.lock`), { code: 'ENOENT' });
  assert.ok(!alive(backend.pid), 'owned backend group must terminate');
}

// These assertions precede the launcher repair. Real success is never replaced by a fault child.
test('cleanup ownership survives synchronous frontend close failure', { concurrency: false }, async t => {
  await cleanupOwnershipCase(t, 'cleanup-ownership-sync');
});

test('cleanup ownership survives asynchronous frontend close rejection', { concurrency: false }, async t => {
  await cleanupOwnershipCase(t, 'cleanup-ownership-async');
});

async function cleanupProbeCase(t, mode) {
  const depot = await workspace(t);
  const run = await launch(t, depot, { BOOTSTRAP_FAULT: mode }, fault, { ipc: true });
  const messages = [];
  run.child.on('message', message => messages.push(message));
  let backendPid;
  t.after(async () => {
    if (backendPid) {
      try { process.kill(-backendPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await until(() => !alive(backendPid), 'probe fixture backend group survived fallback', 2000);
    }
    if (run.code() === undefined) await run.stop();
    await rm(`${depot}.lock`, { recursive: true, force: true });
  });
  const message = type => until(() => messages.find(item => item.type === type), `missing probe fixture message: ${type}`, 8000);
  backendPid = (await message('backend-ready')).pid;
  await message('http-listening');
  process.kill(run.child.pid, 'SIGINT');
  await message(mode === 'cleanup-signal-denied' ? 'signal-send-denied' : 'signal-zero-denied');
  if (mode === 'cleanup-probe-transient') {
    await message('backend-term-entered');
    assert.equal(messages.some(item => item.type === 'launcher-result'), false, 'transient probe denial must not finish cleanup');
    await stat(`${depot}.lock`);
    if (run.child.connected) run.child.send({ type: 'release-backend' });
    await message('backend-closed');
    await until(() => run.code() !== undefined, 'transient probe launcher did not settle', 8000);
    assert.equal(run.code(), 0, 'transient probe denial must not become cleanup failure');
    assert.ok(!alive(backendPid), 'native probe must verify backend disappearance');
    await assert.rejects(stat(`${depot}.lock`), { code: 'ENOENT' });
  } else {
    const result = await message('launcher-result');
    assert.equal(result.code, 1, 'denied cleanup must remain nonzero');
    await stat(`${depot}.lock`);
    if (mode === 'cleanup-signal-denied') assert.equal(messages.some(item => item.type === 'backend-term-entered'), false);
    try { process.kill(-backendPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await until(() => !alive(backendPid), 'denied probe backend group survived exact cleanup', 2000);
    await until(() => run.code() !== undefined, 'denied cleanup launcher did not close', 2000);
    await until(() => run.output().includes('private diagnostics'), 'denied cleanup diagnostics output missing', 2000);
    const log = run.output().match(/private diagnostics: (.+trail\.log)/)?.[1];
    assert.ok(log, 'denied cleanup diagnostics path missing');
    const diagnostic = JSON.parse(await readFile(`${log}.cleanup.json`, 'utf8'));
    const backendError = diagnostic.operations.find(item => item.operation === 'backend').error;
    assert.ok(backendError.code === 'EPERM' || backendError.message === 'Owned process group did not stop');
  }
  await assertFree(run.backend, run.frontend);
}

test('cleanup ownership treats transient signal-zero EPERM as present until native disappearance', { concurrency: false }, async t => {
  await cleanupProbeCase(t, 'cleanup-probe-transient');
});

test('cleanup ownership retains lock for persistent signal-zero probe denial', { concurrency: false }, async t => {
  await cleanupProbeCase(t, 'cleanup-probe-persistent');
});

test('cleanup ownership retains lock for real signal-send denial', { concurrency: false }, async t => {
  await cleanupProbeCase(t, 'cleanup-signal-denied');
});

test('real stack proves schema/instance + /display, private logs, persistent SQLite restart and normal stop', async t => {
  const depot = await workspace(t);
  const first = await launch(t, depot);
  const ready = await first.ready();
  assert.equal((await fetch(`${ready.backend}/api/healthcheck`)).status, 200);
  const row = await (await fetch(`${ready.backend}/api/records/v1/${ready.api}/1`)).json();
  assert.deepEqual(row, { id: 1, schema_version: 1 });
  assert.equal((await fetch(`${ready.frontend}/display`)).status, 200);
  assert.equal(await readFile(join(depot, '.owner'), 'utf8'), marker);
  assert.equal((await stat(ready.log)).mode & 0o777, 0o600);
  for (const path of [`/@fs${ready.log}`, ready.log.slice(repo.length), `/.local/dev/${depot.split('/').at(-1)}/config.textproto`]) {
    const response = await fetch(`${ready.frontend}${path}`);
    assert.equal(response.status, 403, 'private runtime files must not be served by Vite');
  }
  assert.ok(!/password|admin@|initial credentials/i.test(first.output()));
  await first.stop();
  assert.equal(first.code(), 0);
  assert.ok(!alive(ready.pid));
  await assertFree(first.backend, first.frontend);
  const db = join(depot, 'data/main.db');
  const before = await readFile(db);
  assert.equal(before.subarray(0, 16).toString(), 'SQLite format 3\0');
  // Insert synthetic data only into our stopped test depot, never a gameplay or auth table.
  const sqlite = new DatabaseSync(db);
  sqlite.exec('CREATE TABLE test_persistence (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const persisted = `synthetic-${randomUUID()}-héllo`;
  sqlite.prepare('INSERT INTO test_persistence VALUES (1, ?)').run(persisted);
  sqlite.close();
  const inode = (await stat(db)).ino;
  const second = await launch(t, depot);
  const restarted = await second.ready();
  assert.notEqual(restarted.api, ready.api, 'per-start nonce must change');
  assert.equal((await fetch(`${restarted.backend}/api/records/v1/${ready.api}/1`)).status, 405);
  assert.deepEqual(await (await fetch(`${restarted.backend}/api/records/v1/${restarted.api}/1`)).json(), row);
  await second.stop();
  assert.equal((await stat(db)).ino, inode);
  const restored = new DatabaseSync(db, { readOnly: true });
  try { assert.equal(restored.prepare('SELECT value FROM test_persistence WHERE id=1').get().value, persisted); } finally { restored.close(); }
  await assertFree(second.backend, second.frontend);
});

test('unmarked and wrong-owner existing depots are refused without adoption or file changes', async t => {
  for (const owner of [null, 'someone else']) {
    const depot = await workspace(t); await mkdir(depot);
    await writeFile(join(depot, 'keep'), 'foreign data');
    if (owner) await writeFile(join(depot, '.owner'), owner);
    const run = await launch(t, depot);
    await run.refused(/unmarked|owner/);
    assert.equal(await readFile(join(depot, 'keep'), 'utf8'), 'foreign data');
    assert.deepEqual((await readdir(depot)).sort(), owner ? ['.owner', 'keep'] : ['keep']);
  }
});

test('external existing/nonexistent depots and depot/marker symlinks cannot escape containment', async t => {
  const outside = await mkdtemp(join(tmpdir(), 'trail-party-foreign-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'keep'), 'untouched');
  for (const target of [outside, join(outside, 'absent')]) {
    const run = await launch(t, target); await run.refused(/outside|direct child/);
  }
  const depot = await workspace(t); await symlink(outside, depot);
  await (await launch(t, depot)).refused(/symlink/);
  const marked = await workspace(t); await mkdir(marked);
  await writeFile(join(outside, 'owner'), marker);
  await symlink(join(outside, 'owner'), join(marked, '.owner'));
  await (await launch(t, marked)).refused(/symlink/);
  assert.deepEqual((await readdir(outside)).sort(), ['keep', 'owner']);
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'untouched');
});

test('root symlinks and symlinks inside an owned depot are refused', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'trail-party-roots-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const { safeDirectory } = await import('./local-paths.mjs');
  await mkdir(join(sandbox, 'outside'));
  await symlink(join(sandbox, 'outside'), join(sandbox, '.local'));
  await assert.rejects(safeDirectory(sandbox, '.local/dev'), /symlink/);
  assert.deepEqual(await readdir(join(sandbox, 'outside')), []);
  const depot = await workspace(t); await mkdir(depot);
  await writeFile(join(depot, '.owner'), marker);
  await symlink(join(sandbox, 'outside'), join(depot, 'data'));
  await (await launch(t, depot)).refused(/symlink/);
  assert.deepEqual(await readdir(join(sandbox, 'outside')), []);
});

test('invalid ports and non-loopback hosts fail before depot creation', async t => {
  for (const extra of [{ TRAILBASE_PORT: '0' }, { VITE_PORT: '12x' }, { TRAILBASE_PORT: '65536' }, { VITE_PORT: '-2' }, { TRAILBASE_HOST: '0.0.0.0' }, { VITE_HOST: 'example.org' }]) {
    const depot = await workspace(t);
    await (await launch(t, depot, extra)).refused(/port|loopback/);
    await assert.rejects(stat(depot), { code: 'ENOENT' });
  }
});

test('occupied frontend/backend listeners are never signaled and foreign files survive', async t => {
  const foreign = await listener(); t.after(foreign.close);
  for (const key of ['VITE_PORT', 'TRAILBASE_PORT']) {
    const depot = await workspace(t);
    await (await launch(t, depot, { [key]: String(foreign.port) })).refused(/occupied/);
    assert.equal(await (await fetch(`http://127.0.0.1:${foreign.port}`)).text(), 'foreign listener survives');
    await assert.rejects(stat(depot), { code: 'ENOENT' });
  }
});

test('exact installed version/source/SQLite is checked before spawning; missing binary is visible', async t => {
  const bin = await mkdtemp(join(tmpdir(), 'trail-party-version-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  for (const version of ['trail v0.33.13-0-g3f965de7 (2026-09-10)\nsqlite: 3.53.2', 'trail v0.33.14-0-gdeadbeef (2026-09-10)\nsqlite: 3.53.2', 'trail v0.33.14-0-g3f965de7 (2026-09-10)\nsqlite: 3.52.0', null]) {
    const path = join(bin, 'trail');
    if (version) await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 });
    else await rm(path);
    const depot = await workspace(t);
    await (await launch(t, depot, { PATH: bin })).refused(/required|version|SQLite/);
    await assert.rejects(stat(depot), { code: 'ENOENT' });
  }
});

async function stubbornVersion(bin) {
  const path = join(bin, 'trail');
  await writeFile(path, `#!${process.execPath}
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const dir = dirname(process.argv[1]);
writeFileSync(join(dir, 'probe.pid'), String(process.pid), { flag: 'wx', mode: 0o600 });
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`, { mode: 0o700 });
}

async function assertProbeStopped(run, pid, message) {
  await until(() => run.code() !== undefined, message, 8000);
  assert.ok(!alive(pid), 'version probe must be reaped before launcher exit');
  assert.ok(!run.output().includes('Ready:'), 'preflight cancellation must not announce ready');
}

test('stubborn version timeout is bounded and reaps only its own probe before any depot write', async t => {
  const bin = await mkdtemp(join(tmpdir(), 'trail-party-stubborn-version-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  await stubbornVersion(bin);
  const depot = await workspace(t);
  const run = await launch(t, depot, { PATH: bin });
  killOwnedLauncher(t, run);
  const pid = await until(async () => {
    try { return Number(await readFile(join(bin, 'probe.pid'), 'utf8')); } catch { return false; }
  }, 'stubborn version probe did not signal started', 2000);
  assert.ok(alive(pid));
  await assertProbeStopped(run, pid, 'stubborn version timeout did not finish within the fixed bound');
  assert.equal(run.code(), 1);
  await assert.rejects(stat(depot), { code: 'ENOENT' });
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`${signal} during version preflight cancels and reaps the probe before any depot write`, async t => {
    const bin = await mkdtemp(join(tmpdir(), `trail-party-${signal.toLowerCase()}-version-`));
    t.after(() => rm(bin, { recursive: true, force: true }));
    await stubbornVersion(bin);
    const depot = await workspace(t);
    const run = await launch(t, depot, { PATH: bin });
    killOwnedLauncher(t, run);
    const pid = await until(async () => {
      try { return Number(await readFile(join(bin, 'probe.pid'), 'utf8')); } catch { return false; }
    }, 'stubborn version probe did not signal started', 2000);
    assert.ok(alive(pid));
    process.kill(run.child.pid, signal);
    await assertProbeStopped(run, pid, `${signal} did not cancel version preflight within the fixed bound`);
    assert.equal(run.code(), 0);
    await assert.rejects(stat(depot), { code: 'ENOENT' });
  });
}

test('simultaneous launchers sharing a depot yield one owner, loser does not stop winner', async t => {
  const depot = await workspace(t);
  const [a, b] = await Promise.all([launch(t, depot), launch(t, depot)]);
  await until(() => a.code() !== undefined || b.code() !== undefined, 'neither launcher refused concurrent ownership');
  const loser = a.code() !== undefined ? a : b, winner = loser === a ? b : a;
  await loser.refused(/locked/);
  const ready = await winner.ready();
  assert.equal((await fetch(`${ready.backend}/api/healthcheck`)).status, 200);
  await winner.stop();
  assert.ok(!alive(ready.pid));
  await assertFree(a.backend, a.frontend, b.backend, b.frontend);
});

test('health-only/wrong-instance endpoints, spawn errors, early clean/failing children and frontend failures fail closed', async t => {
  for (const mode of ['wrong-schema', 'wrong-instance', 'spawn-error', 'clean-exit', 'failed-exit', 'frontend-failure']) {
    const depot = await workspace(t);
    const run = await launch(t, depot, { BOOTSTRAP_FAULT: mode }, fault);
    await run.refused(mode.startsWith('wrong-') ? /backend startup\/readiness failed/ : mode === 'spawn-error' ? /Backend spawn failed/ : mode === 'frontend-failure' ? /frontend startup\/readiness failed/ : /Backend exited unexpectedly/);
    await assertFree(run.backend, run.frontend);
    if (!['spawn-error', 'frontend-failure'].includes(mode)) {
      assert.ok(!alive(Number(await readFile(join(depot, 'fault.pid'), 'utf8'))));
      const log = run.output().match(/private diagnostics: (.+trail\.log)/)?.[1];
      assert.ok(log, 'sanitized diagnostics path missing');
      assert.equal((await stat(log)).mode & 0o777, 0o600);
      assert.ok((await readFile(log, 'utf8')).includes('SYNTHETIC-SECRET'));
    }
    if (mode.startsWith('wrong-')) {
      assert.equal(await readFile(join(depot, 'fault.health'), 'utf8'), '/api/healthcheck');
      assert.match(await readFile(join(depot, 'fault.schema'), 'utf8'), /^\/api\/records\/v1\/bootstrap_[a-f0-9]{32}\/1$/);
    }
    assert.ok(!run.output().includes('SYNTHETIC-SECRET'));
  }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`${signal} closes real frontend and backend before exit, preserving depot`, async t => {
    const depot = await workspace(t);
    const run = await launch(t, depot);
    const ready = await run.ready();
    await run.stop(signal);
    assert.equal(run.code(), 0, run.output());
    assert.ok(!alive(ready.pid));
    await assertFree(run.backend, run.frontend);
    assert.equal(await readFile(join(depot, '.owner'), 'utf8'), marker);
    await assert.rejects(stat(`${depot}.lock`), { code: 'ENOENT' });
  });
}

test('backend exit after readiness closes frontend; signal during readiness escalates only the owned group', async t => {
  const depot = await workspace(t);
  const run = await launch(t, depot);
  const ready = await run.ready();
  process.kill(ready.pid, 'SIGTERM');
  await until(() => run.code() !== undefined, 'backend exit did not close stack', 8000);
  assert.equal(run.code(), 1);
  await assertFree(run.backend, run.frontend);
  const stuckDepot = await workspace(t);
  const stuck = await launch(t, stuckDepot, { BOOTSTRAP_FAULT: 'stubborn-group' }, fault);
  let pids;
  await until(async () => { try { pids = JSON.parse(await readFile(join(stuckDepot, 'fault.pids'), 'utf8')); return true; } catch { return false; } }, 'fault process barrier absent');
  await stuck.stop('SIGHUP');
  assert.ok(!alive(pids.parent));
  await until(() => !alive(pids.child), 'owned descendant survived escalation', 3000);
  await assertFree(stuck.backend, stuck.frontend);
});

test('six approved decisions are durable, source-cited and parity/phase mapped; release pins and CI share setup', async () => {
  const architecture = await readFile(join(repo, 'docs/ARCHITECTURE.md'), 'utf8');
  const parity = await readFile(join(repo, 'docs/PARITY.md'), 'utf8');
  for (let n = 1; n <= 6; n++) {
    assert.match(architecture, new RegExp(`P01-D${n}`));
    assert.match(parity, new RegExp(`P01-D${n}.*F\\d+.*P\\d+`));
  }
  for (const text of ['verification-pending', 'first valid', 'unrecoverable', 'no offline catch-up', 'never unlocks', 'contextual predecessor']) assert.ok(architecture.includes(text), text);
  const manifest = JSON.parse(await readFile(join(repo, 'scripts/trailbase-releases.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, '3f965de7ea516c43a54ca70a495e97f0c6d991ab');
  assert.equal(manifest.sqlite, '3.53.2');
  for (const target of ['darwin-arm64', 'linux-x64']) {
    assert.match(manifest.artifacts[target].url, /^https:\/\/github\.com\/trailbaseio\/trailbase\/releases\/download\/v0\.33\.14\/trailbase_v0\.33\.14_/);
    assert.match(manifest.artifacts[target].sha256, /^[a-f0-9]{64}$/);
  }
  const ci = await readFile(join(repo, '.github/workflows/trailbase.yml'), 'utf8');
  assert.match(ci, /node scripts\/setup-trailbase.mjs/);
  assert.match(ci, /frozen-lockfile/);
  assert.match(ci, /test:bootstrap/);
  assert.ok(!ci.includes('releases/download'), 'CI must not duplicate manifest URLs');
});

test('release setup refuses unknown targets, external or substituted destinations before download', async t => {
  const setup = join(repo, 'scripts/setup-trailbase.mjs');
  for (const args of [['--target', 'unknown'], ['--destination', '/tmp/unsafe']]) {
    const run = spawn(process.execPath, [setup, ...args], { cwd: repo, stdio: 'pipe' });
    let stderr = ''; run.stderr.on('data', b => { stderr += b; });
    const code = await new Promise(ok => run.once('close', ok));
    assert.equal(code, 1);
    assert.match(stderr, /Unsupported target|Usage/);
  }
  const { verifyArchive, installRelease } = await import('./setup-trailbase.mjs');
  assert.throws(() => verifyArchive(Buffer.from('bad bytes'), { sha256: '0'.repeat(64), size: 9 }), /digest|size/);
  const root = await mkdtemp(join(tmpdir(), 'trail-party-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.local'));
  const external = await mkdtemp(join(tmpdir(), 'trail-party-cache-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, '.local/tools'));
  await assert.rejects(installRelease({ root }), /symlink/);
  assert.deepEqual(await readdir(external), []);
  await rm(join(root, '.local/tools'));
  const dest = join(root, '.local/tools', `trailbase-v0.33.14-${process.platform}-${process.arch}`);
  await mkdir(dest, { recursive: true }); await writeFile(join(dest, 'keep'), 'foreign');
  await assert.rejects(installRelease({ root }), /exist|destination/);
  assert.deepEqual(await readdir(dest), ['keep']);
});
