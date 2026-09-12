// Negative-only injected children. Successful lifecycle tests always use installed TrailBase + Vite.
import { spawn } from 'node:child_process';
import { fstatSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { runDev } from '../dev.mjs';

const mode = process.env.BOOTSTRAP_FAULT;
const send = message => process.send?.(message);
let ownedBackend;
let ownedLogFd;
if (process.argv[2] === 'child') {
  const depot = process.env.TRAIL_PARTY_DEPOT;
  writeFileSync(join(depot, 'fault.pid'), String(process.pid));
  console.log('SYNTHETIC-SECRET');
  if (mode.startsWith('cleanup-')) {
    let released = false;
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/healthcheck') return res.end('{}');
      if (/^\/api\/records\/v1\/[^/]+\/1$/.test(req.url)) return res.end('{"id":1,"schema_version":1}');
      res.statusCode = 404; res.end('{}');
    });
    const release = () => {
      if (released) return;
      released = true;
      server.close(() => { send({ type: 'backend-closed', pid: process.pid, group: process.pid }); process.disconnect?.(); process.exit(0); });
    };
    process.on('SIGTERM', () => { writeFileSync(join(depot, 'fault.term-entered'), '1'); send({ type: 'backend-term-entered', pid: process.pid, group: process.pid }); });
    process.on('message', message => { if (message?.type === 'release-backend') release(); });
    server.listen(Number(process.env.TRAILBASE_PORT), '127.0.0.1', () => {
      send({ type: 'backend-ready', pid: process.pid, group: process.pid });
    });
  } else if (mode === 'clean-exit') process.exit(0);
  else if (mode === 'failed-exit') process.exit(3);
  else if (mode === 'stubborn-group') {
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},1000)"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('message', () => writeFileSync(join(depot, 'fault.pids'), JSON.stringify({ parent: process.pid, child: child.pid })));
    setInterval(() => {}, 1000);
  } else {
    createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      writeFileSync(join(depot, req.url === '/api/healthcheck' ? 'fault.health' : 'fault.schema'), req.url);
      if (req.url === '/api/healthcheck') res.end('{}');
      else if (mode === 'wrong-instance') res.end('{"id":1,"schema_version":999}');
      else { res.statusCode = 404; res.end('{}'); }
    }).listen(Number(process.env.TRAILBASE_PORT), '127.0.0.1');
  }
} else {
  if (mode.startsWith('cleanup-')) {
    process.on('message', message => { if (message?.type === 'release-backend') ownedBackend?.send(message); });
  }
  const probeMode = ['cleanup-probe-transient', 'cleanup-probe-persistent', 'cleanup-signal-denied'].includes(mode);
  const originalKill = process.kill;
  if (probeMode) {
    let probeDenials = 0;
    process.kill = (pid, signal) => {
      const exactGroup = ownedBackend?.pid && pid === -ownedBackend.pid;
      const transientDenial = mode === 'cleanup-probe-transient' && signal === 0 && probeDenials++ === 0;
      const persistentDenial = mode === 'cleanup-probe-persistent' && signal === 0;
      const denied = exactGroup && (transientDenial || persistentDenial || (signal === 'SIGTERM' && mode === 'cleanup-signal-denied'));
      if (denied) {
        send({ type: signal === 0 ? 'signal-zero-denied' : 'signal-send-denied', pid: ownedBackend.pid, signal });
        const error = new Error(`synthetic ${signal} EPERM`); error.code = 'EPERM'; throw error;
      }
      return originalKill.call(process, pid, signal);
    };
  }
  let code;
  try { code = await runDev({
    spawnBackend: mode === 'frontend-failure' ? spawn : (_command, _args, options) => {
      ownedLogFd = options.stdio[1];
      const stdio = mode.startsWith('cleanup-') ? [...options.stdio, 'ipc'] : options.stdio;
      ownedBackend = spawn(mode === 'spawn-error' ? '/nonexistent/trail-party-test-binary' : process.execPath, [import.meta.filename, 'child'], { ...options, stdio, env: { ...options.env, BOOTSTRAP_FAULT: mode, TRAIL_PARTY_DEPOT: process.env.TRAIL_PARTY_DEPOT, TRAILBASE_PORT: process.env.TRAILBASE_PORT } });
      ownedBackend.on('message', send);
      return ownedBackend;
    },
    ...(mode === 'frontend-failure' ? { createFrontend: async () => { throw new Error('SYNTHETIC-SECRET'); } } : {}),
    ...((mode.startsWith('cleanup-ownership-')) ? {
      createFrontend: async config => {
        config.server.middlewareMode.server.once('listening', () => send({ type: 'http-listening' }));
        return {
          middlewares: (_request, response) => { response.statusCode = 503; response.end('negative cleanup fixture'); },
          close: () => {
            send({ type: 'frontend-close-invoked' });
            if (mode === 'cleanup-ownership-sync') throw Object.freeze(new Error('SYNTHETIC-SYNC-CLEANUP'));
            return Promise.reject('SYNTHETIC-ASYNC-CLEANUP');
          },
        };
      },
    } : (probeMode ? {
      createFrontend: async config => {
        config.server.middlewareMode.server.once('listening', () => send({ type: 'http-listening' }));
        return { middlewares: (_request, response) => { response.statusCode = 503; response.end('negative probe fixture'); }, close: () => {} };
      },
    } : {})),
  }); } finally { process.kill = originalKill; }
  if (ownedLogFd !== undefined) {
    let closed = false;
    try { fstatSync(ownedLogFd); } catch { closed = true; }
    send({ type: 'log-fd-closed', closed });
  }
  send({ type: 'launcher-result', code });
  if (process.connected) process.disconnect();
  process.exitCode = code;
}
