import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as poll } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { assertBackendVersion } from './setup-trailbase.mjs';
import { inspectTree, safeDirectory } from './local-paths.mjs';

const repository = resolve(import.meta.dirname, '..');
const owner = `trail-party-dev-v1\n${repository}\n`;
function port(value) {
  if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Invalid port: use an integer from 1 to 65535');
  return Number(value);
}
async function portFree(port) {
  const server = createServer();
  try { await new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', ok)); }
  catch { throw new Error('Requested loopback port is occupied or unavailable; existing listener left untouched'); }
  await new Promise(ok => server.close(ok));
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
}
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (e) {
    if (e.code === 'ESRCH') return false;
    if (e.code === 'EPERM') return true;
    throw e;
  }
}
function diagnosticError(error) {
  if (error instanceof Error) {
    const result = { type: 'Error' };
    for (const key of ['name', 'message', 'stack', 'code']) {
      try { if (error[key] !== undefined) result[key] = String(error[key]).slice(0, 4000); } catch { /* inaccessible property */ }
    }
    return result;
  }
  if (error && typeof error === 'object') {
    const fields = {};
    for (const key of Object.keys(error).slice(0, 8)) {
      try { fields[key] = String(error[key]).slice(0, 500); } catch { fields[key] = '<unreadable>'; }
    }
    return { type: 'object', fields };
  }
  return { type: typeof error, value: String(error).slice(0, 4000) };
}
async function stopBackend(child, closed) {
  if (!child?.pid) { await closed; return; }
  // detached:true created exactly this group; never discover targets by port or executable name.
  signalGroup(child.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (groupAlive(child.pid) && Date.now() < deadline) await poll(25);
  if (groupAlive(child.pid)) signalGroup(child.pid, 'SIGKILL');
  await closed;
  const reaped = Date.now() + 1000;
  while (groupAlive(child.pid) && Date.now() < reaped) await poll(25);
  if (groupAlive(child.pid)) throw new Error('Owned process group did not stop');
}

// Dependency injection is confined to negative acceptance fixtures, not CLI environment switches.
export async function runDev({ spawnBackend = spawn, createFrontend = async config => (await import('vite')).createServer(config) } = {}) {
  const abort = new AbortController();
  const stopped = Promise.withResolvers();
  let stopping = false, code = 0, stage = 'preflight', logPath;
  let lock, log, child, closed, frontend, http;
  const requestStop = failure => {
    if (stopping) return;
    stopping = true; code = failure;
    abort.abort(); stopped.resolve();
  };
  const onSignal = () => requestStop(0);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, onSignal);
  const running = () => { if (stopping) throw new Error('Startup cancelled'); };
  async function ready(check, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      running();
      try { if (await check()) { running(); return; } } catch { running(); }
      await poll(50, undefined, { signal: abort.signal }).catch(() => {});
    }
    throw new Error(`${label} readiness failed`);
  }
  const get = url => fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(500)]) });
  try {
    const backendPort = port(process.env.TRAILBASE_PORT ?? '8090');
    const frontendPort = port(process.env.VITE_PORT ?? '5173');
    if (backendPort === frontendPort) throw new Error('Backend and frontend ports must differ');
    if ((process.env.TRAILBASE_HOST ?? '127.0.0.1') !== '127.0.0.1' || (process.env.VITE_HOST ?? '127.0.0.1') !== '127.0.0.1') throw new Error('Only loopback 127.0.0.1 targets are allowed');
    const devRoot = join(repository, '.local/dev');
    const depot = resolve(process.env.TRAIL_PARTY_DEPOT ?? join(devRoot, 'depot'));
    if (dirname(depot) !== devRoot || !/^[a-zA-Z0-9_-]+$/.test(basename(depot))) throw new Error('Depot must be a direct child of .local/dev; outside targets refused');
    if (await realpath(repository) !== repository) throw new Error('Unsafe repository root symlink');
    await assertBackendVersion('trail', { signal: abort.signal }); running();
    await portFree(backendPort); await portFree(frontendPort); running();
    await safeDirectory(repository, '.local/dev'); running();
    // A sibling exclusive lock also protects initial directory/marker creation. Never steal stale locks.
    const lockPath = `${depot}.lock`;
    try { await mkdir(lockPath, { mode: 0o700 }); } catch { throw new Error('Depot locked; another launcher or stale lock requires inspection'); }
    lock = lockPath;
    let existing = true;
    try { await lstat(depot); } catch (e) { if (e.code !== 'ENOENT') throw e; existing = false; }
    if (existing) {
      await inspectTree(depot);
      let marker;
      try { marker = await readFile(join(depot, '.owner'), 'utf8'); } catch { throw new Error('Existing depot is unmarked; refusing adoption'); }
      if (marker !== owner) throw new Error('Depot owner mismatch; refusing adoption');
    } else {
      await mkdir(depot, { mode: 0o700 });
      await writeFile(join(depot, '.owner'), owner, { flag: 'wx', mode: 0o600 });
    }
    running();
    const logs = await safeDirectory(repository, '.artifacts/p01-t3/dev');
    const runLogs = await mkdtemp(join(logs, 'run-'));
    logPath = join(runLogs, 'trail.log');
    log = await open(logPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const api = `bootstrap_${randomUUID().replaceAll('-', '')}`;
    const config = (await readFile(join(repository, 'backend/config/development.textproto'), 'utf8')).replace('__READY_API__', api);
    const configTemp = join(depot, `.config-${randomUUID()}`);
    await writeFile(configTemp, config, { flag: 'wx', mode: 0o600 });
    await rename(configTemp, join(depot, 'config.textproto'));
    await cp(join(repository, 'backend/migrations'), join(depot, 'migrations'), { recursive: true });
    running(); stage = 'backend';
    const backend = `http://127.0.0.1:${backendPort}`;
    const front = `http://127.0.0.1:${frontendPort}`;
    child = spawnBackend('trail', ['--depot', depot, '--public-url', backend, 'run', '--address', `127.0.0.1:${backendPort}`, '--runtime-threads', '1', '--stderr-logging'], {
      detached: true, stdio: ['ignore', log.fd, log.fd],
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, RUST_LOG: 'info' },
    });
    closed = new Promise(ok => child.once('close', ok));
    child.once('error', () => { console.error(`Backend spawn failed; private diagnostics: ${logPath}`); requestStop(1); });
    child.once('exit', () => {
      if (!stopping) { console.error(`Backend exited unexpectedly; private diagnostics: ${logPath}`); requestStop(1); }
    });
    await ready(async () => {
      if (!(await get(`${backend}/api/healthcheck`)).ok) return false;
      const response = await get(`${backend}/api/records/v1/${api}/1`);
      if (!response.ok) return false;
      const row = await response.json();
      return row.id === 1 && row.schema_version === 1 && Object.keys(row).length === 2;
    }, 'Backend');
    stage = 'frontend';
    // Vite's standalone API installs SIGTERM -> process.exit(). Middleware mode leaves
    // exit/HTTP ownership here so backend cleanup is actually awaited, including Tauri stop.
    http = createHttpServer();
    frontend = await createFrontend({ root: repository, clearScreen: false, logLevel: 'silent', server: { host: '127.0.0.1', port: frontendPort, strictPort: true, middlewareMode: { server: http }, hmr: { server: http } } });
    running();
    http.on('request', frontend.middlewares);
    http.once('close', () => {
      if (!stopping) { console.error('Frontend closed unexpectedly'); requestStop(1); }
    });
    http.on('error', () => { console.error('Frontend listener failed'); requestStop(1); });
    await new Promise((ok, fail) => http.once('error', fail).listen(frontendPort, '127.0.0.1', ok));
    await ready(async () => {
      const response = await get(`${front}/display`);
      return response.ok && (response.headers.get('content-type') ?? '').includes('text/html') && (await response.text()).includes('__sveltekit_dev');
    }, 'Frontend');
    running();
    console.log(`Ready: ${JSON.stringify({ backend, frontend: front, api, pid: child.pid, log: logPath })}`);
    await stopped.promise;
  } catch (error) {
    if (!stopping) {
      // Preflight uses our fixed messages; backend/Vite errors never expose raw subprocess output.
      console.error(stage === 'preflight' ? (error.code ? 'Local setup refused: unsafe or inaccessible path' : error.message) : `${stage} startup/readiness failed; private diagnostics: ${logPath}`);
      requestStop(1);
    }
  } finally {
    requestStop(code);
    const diagnostics = [];
    const cleanupStep = (operation, invoke, available = true) => {
      const observation = { operation, invocation: available ? 'pending' : 'skipped', settlement: available ? 'pending' : 'skipped' };
      diagnostics.push(observation);
      if (!available) return Promise.resolve(null);
      let task;
      try {
        task = invoke();
        observation.invocation = task && typeof task.then === 'function' ? 'async' : 'sync';
        return Promise.resolve(task).then(result => {
          observation.settlement = 'fulfilled';
          if (result !== undefined) observation.result = result;
          return null;
        }, error => {
          observation.settlement = 'rejected';
          observation.error = diagnosticError(error);
          return error;
        });
      } catch (error) {
        observation.invocation = 'sync';
        observation.settlement = 'rejected';
        observation.error = diagnosticError(error);
        return Promise.resolve(error);
      }
    };
    const closeHttp = () => new Promise((resolveClose, rejectClose) => {
      const partial = error => error?.code === 'ERR_SERVER_NOT_RUNNING';
      const settle = error => error
        ? (partial(error) ? resolveClose({ outcome: 'not-listening', error: diagnosticError(error) }) : rejectClose(error))
        : resolveClose({ outcome: 'closed' });
      try {
        http.close(settle);
        http.closeAllConnections();
      } catch (error) { settle(error); }
    });
    const runCleanup = async () => {
      // Each invocation is protected separately: eager argument evaluation must not skip siblings.
      const [frontendFailure, httpFailure, backendFailure] = await Promise.all([
        cleanupStep('frontend', () => frontend?.close(), Boolean(frontend)),
        cleanupStep('http', closeHttp, Boolean(http)),
        cleanupStep('backend', () => stopBackend(child, closed), Boolean(child || closed)),
      ]);
      const logFailure = await cleanupStep('log.close', () => log.close(), Boolean(log));
      const lockFailure = backendFailure
        ? await cleanupStep('lock.remove', () => undefined, false)
        : await cleanupStep('lock.remove', () => rm(lock, { recursive: true }), Boolean(lock));
      const failures = [frontendFailure, httpFailure, backendFailure, logFailure, lockFailure].filter(Boolean);
      if (failures.length) code = 1;
      if (failures.length && logPath) {
        const payload = JSON.stringify({ operations: diagnostics }, null, 2);
        await writeFile(`${logPath}.cleanup.json`, payload, { flag: 'wx', mode: 0o600 }).catch(() => {});
        console.error(`Owned stack cleanup failed; inspect private diagnostics: ${logPath}`);
      }
    };
    try { await runCleanup(); }
    catch {
      // Serialization or an unexpected diagnostic-path failure cannot erase failure state.
      code = 1;
      console.error(`Owned stack cleanup failed; inspect private diagnostics: ${logPath ?? 'not created'}`);
    }
    for (const signal of signals) process.off(signal, onSignal);
  }
  return code;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runDev();
