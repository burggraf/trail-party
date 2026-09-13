import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { initClient } from 'trailbase';

const repository = resolve(import.meta.dirname, '..');
const testRoot = resolve(repository, '.local/test-runs');
const artifactRoot = resolve(repository, '.artifacts/e2e');
const trailCommand = process.env.TRAILBASE_BIN?.trim() || 'trail';
const mailpitCommand = process.env.MAILPIT_BIN?.trim() || 'mailpit';
const expectedTrail = /v0\.33\.14-0-g3f965de7.*\nsqlite: 3\.53\.2/s;
const expectedMailpit = /(?:^|\s)mailpit v1\.31\.0(?:\s|$)/i;

function env() {
  return { ...process.env, PATH: process.env.PATH, RUST_LOG: 'info' };
}

function fail(message) {
  throw new Error(message);
}

const RESERVED_EXTERNAL_PORTS = new Set(['1025', '8025']);

export function assertSafeTestUrl(value, label = 'target') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Refusing ${label}: URL is invalid or not loopback-owned`);
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || RESERVED_EXTERNAL_PORTS.has(parsed.port)) {
    fail(`Refusing ${label}: only owned 127.0.0.1 HTTP targets are permitted`);
  }
  return parsed;
}

function checkVersion() {
  const trail = spawnSync(trailCommand, ['--version'], { encoding: 'utf8', env: env() });
  if (trail.status !== 0 || !expectedTrail.test(trail.stdout)) {
    fail('Pinned TrailBase v0.33.14 / SQLite 3.53.2 is required on PATH');
  }
  const mailpit = spawnSync(mailpitCommand, ['version', '--no-release-check'], { encoding: 'utf8', env: env() });
  if (mailpit.status !== 0 || !expectedMailpit.test(`${mailpit.stdout}\n${mailpit.stderr}`)) {
    fail('Pinned Mailpit v1.31.0 is required on PATH');
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  await new Promise(resolvePromise => server.close(resolvePromise));
  if (!address || typeof address === 'string') fail('Could not allocate an owned loopback port');
  return address.port;
}

async function portFree(port) {
  const server = createServer();
  try {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolvePromise);
    });
  } catch {
    throw new Error(`Required loopback port ${port} is occupied; existing listener left untouched`);
  }
  await new Promise(resolvePromise => server.close(resolvePromise));
}

async function portIsFree(port) {
  try {
    await portFree(port);
    return true;
  } catch {
    return false;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

export async function waitForOwnedResourcesToStop(pids, ports, logPath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processesStopped = pids.every(pid => !processAlive(pid));
    const portsFree = (await Promise.all(ports.map(portIsFree))).every(Boolean);
    if (processesStopped && portsFree) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  const livePids = pids.filter(processAlive);
  const busyPorts = [];
  for (const port of ports) if (!(await portIsFree(port))) busyPorts.push(port);
  fail(`Owned E2E resources did not stop; private diagnostics: ${logPath}; live pids: ${livePids.join(',') || 'none'}; busy ports: ${busyPorts.join(',') || 'none'}`);
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (error) { if (error?.code !== 'ESRCH') throw error; }
}

async function stopProcess(child, closed) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) signalGroup(child.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  if (child.exitCode === null && child.signalCode === null) signalGroup(child.pid, 'SIGKILL');
  if (!closed) return;
  let timer;
  await Promise.race([
    closed,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Owned child ${child.pid} did not close`)), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function cleanupOwnedStack({ stopChildren, stopMailpit, waitForResources, closeLogs, removeDepot }) {
  let firstError;
  const attempt = async action => {
    try {
      await action();
    } catch (error) {
      firstError ??= error;
    }
  };

  for (const stopChild of stopChildren) await attempt(stopChild);
  await attempt(stopMailpit);
  let resourcesStopped = false;
  try {
    await waitForResources();
    resourcesStopped = true;
  } catch (error) {
    firstError ??= error;
  }
  await attempt(closeLogs);
  if (resourcesStopped) await attempt(removeDepot);
  if (firstError) throw firstError;
}

export async function removeOwnedDepot(depot, owner) {
  const root = await realpath(testRoot);
  const actual = await realpath(depot);
  if (!actual.startsWith(`${root}${sep}`)) fail('Refusing cleanup outside the owned test root');
  if ((await readFile(join(actual, '.owner'), 'utf8')) !== owner) fail('Refusing cleanup of an unowned test depot');
  await rm(actual, { recursive: true });
}

function runSqlite(dbPath, script, args) {
  return spawnSync('python3', ['-c', script, dbPath, ...(args ?? [])], { encoding: 'utf8', env: env() });
}

const seedDatabase = String.raw`
import json, os, sqlite3, sys, time

def is_uuid(value):
    try: return len(bytes(value)) == 16
    except Exception: return 0

def is_uuid_v7(value):
    try:
        raw = bytes(value)
        return len(raw) == 16 and (raw[6] >> 4) == 7 and (raw[8] & 0xc0) == 0x80
    except Exception: return 0

def jsonschema_matches(schema, value):
    try:
        json.loads(value)
        return 1
    except Exception: return 0

def uuid_v7():
    value = bytearray(os.urandom(16))
    timestamp = int(time.time() * 1000)
    value[:6] = timestamp.to_bytes(6, 'big')
    value[6] = (value[6] & 0x0f) | 0x70
    value[8] = (value[8] & 0x3f) | 0x80
    return bytes(value)

def as_bytes(value): return bytes.fromhex(value)

db = sqlite3.connect(sys.argv[1], timeout=5)
db.execute('PRAGMA foreign_keys = ON')
db.create_function('is_uuid', 1, is_uuid)
db.create_function('is_uuid_v7', 1, is_uuid_v7)
db.create_function('jsonschema_matches', 2, jsonschema_matches)
users = [as_bytes(value) for value in sys.argv[2:8]]
now = int(time.time())
game_id, team_a, team_b = uuid_v7(), uuid_v7(), uuid_v7()
player_ids = [uuid_v7() for _ in users]
try:
    db.execute('BEGIN')
    db.executemany(
        'INSERT INTO profiles (id, display_name) VALUES (?, ?)',
        [(users[0], 'Host'), (users[1], 'Alpha one'), (users[2], 'Alpha two'),
         (users[3], 'Beta one'), (users[4], 'Beta two'), (users[5], 'Outsider')],
    )
    questions = [
        (1, 'e2e-q-1', 'General', 'Basics', 'easy', 'What is one?', 'One', 'Two', 'Three', 'Four'),
        (2, 'e2e-q-2', 'General', 'Basics', 'medium', 'What is two?', 'One', 'Two', 'Three', 'Four'),
        (3, 'e2e-q-3', 'Unicode', 'Long', 'hard', 'Which symbol is snow?', '☀️', '❄️', '🌧️', '🌈'),
    ]
    db.executemany(
        'INSERT INTO questions (id, source_id, category, subcategory, difficulty, question, answer_a, answer_b, answer_c, answer_d) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        questions,
    )
    db.execute(
        'INSERT INTO games (id, host_id, join_code, title, lifecycle, starts_at) VALUES (?, ?, ?, ?, ?, ?)',
        (game_id, users[0], 'E2E123', 'Harness fixture', 'ready', now),
    )
    db.executemany('INSERT INTO game_teams (id, game_id, name) VALUES (?, ?, ?)', [(team_a, game_id, 'Alpha'), (team_b, game_id, 'Beta')])
    db.executemany(
        'INSERT INTO game_players (id, game_id, user_id, team_id) VALUES (?, ?, ?, ?)',
        [(player_ids[0], game_id, users[0], team_a), (player_ids[1], game_id, users[1], team_a),
         (player_ids[2], game_id, users[2], team_a), (player_ids[3], game_id, users[3], team_b),
         (player_ids[4], game_id, users[4], team_b)],
    )
    db.commit()
except Exception:
    db.rollback()
    raise
finally:
    db.close()
`;

async function waitFor(url, check, label, logPath) {
  const deadline = Date.now() + 20_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (await check(response)) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error).slice(0, 160);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  fail(`${label} readiness failed; private diagnostics: ${logPath}; last condition: ${lastError}`);
}

async function waitForAuthenticated(backend, account, label, logPath) {
  const deadline = Date.now() + 20_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const client = initClient(backend);
      await client.login(account.email, account.password);
      await client.records('profiles_public').list({ pagination: { limit: 1 } });
      return;
    } catch (error) {
      lastError = String(error).slice(0, 160);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  fail(`${label} readiness failed; private diagnostics: ${logPath}; last condition: ${lastError}`);
}

function accountRecord(name, marker) {
  return {
    email: `e2e-${name.toLowerCase()}-${marker}@example.invalid`,
    password: randomBytes(24).toString('base64url'),
  };
}

async function provisionAccounts(backend, accounts, marker, depot, logPath) {
  const bootstrap = initClient(backend);
  await bootstrap.loginAnonymously();
  const raw = Buffer.from(bootstrap.user().id, 'base64url').toString('hex');
  const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  const promoted = spawnSync(trailCommand, ['--depot', depot, '--public-url', backend, 'admin', 'promote', uuid], { encoding: 'utf8', env: env() });
  if (promoted.status !== 0) {
    await writeFile(logPath, `${promoted.stdout}\n${promoted.stderr}`, { flag: 'a' });
    fail(`Owned TrailBase admin bootstrap failed; private diagnostics: ${logPath}`);
  }
  for (const account of Object.values(accounts)) {
    const response = await bootstrap.fetch('/api/_admin/user', {
      method: 'POST',
      body: JSON.stringify({ ...account, verified: true, admin: false }),
      throwOnError: false,
    });
    if (!response.ok) fail(`Owned baseline account provisioning failed; private diagnostics: ${logPath}`);
  }
  const identities = {};
  for (const [name, account] of Object.entries(accounts)) {
    const client = initClient(backend);
    await client.login(account.email, account.password);
    identities[name] = client.user().id;
    await client.logout();
  }
  await bootstrap.logout();
  return identities;
}

export async function startTestStack() {
  checkVersion();
  await mkdir(testRoot, { recursive: true, mode: 0o700 });
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  await portFree(4173);
  const depot = await mkdtemp(join(testRoot, 'e2e-'));
  const marker = randomUUID();
  const owner = `trail-party-e2e-v1\n${repository}\n${marker}\n`;
  await writeFile(join(depot, '.owner'), owner, { mode: 0o600 });
  const logDir = join(artifactRoot, marker);
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  const trailLogPath = join(logDir, 'trail.log');
  const viteLogPath = join(logDir, 'vite.log');
  const mailpitLogPath = join(logDir, 'mailpit.log');
  const stackFile = join(depot, 'stack.json');
  const backendPort = await freePort();
  const smtpPort = await freePort();
  const mailpitPort = await freePort();
  const backend = `http://127.0.0.1:${backendPort}`;
  const frontend = 'http://127.0.0.1:4173';
  const mailpit = `http://127.0.0.1:${mailpitPort}`;
  assertSafeTestUrl(backend, 'TrailBase');
  assertSafeTestUrl(frontend, 'Vite');
  assertSafeTestUrl(mailpit, 'Mailpit');
  const readyApi = `e2e_ready_${marker.replaceAll('-', '')}`;
  const accounts = Object.fromEntries(['H', 'A1', 'A2', 'B1', 'B2', 'X'].map(name => [name, accountRecord(name, marker)]));
  const signup = { email: `signup-${marker}@example.invalid`, password: randomBytes(24).toString('base64url') };
  let trail;
  let trailClosed;
  let vite;
  let viteClosed;
  let mailpitChild;
  let mailpitClosed;
  let mailpitLog;
  let trailLog;
  let viteLog;
  let stopPromise;
  let depotRemoved = false;
  const stop = async () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const pids = [vite?.pid, trail?.pid, mailpitChild?.pid].filter(pid => Number.isInteger(pid));
      await cleanupOwnedStack({
        stopChildren: [
          () => stopProcess(vite, viteClosed),
          () => stopProcess(trail, trailClosed),
        ],
        stopMailpit: async () => {
          if (mailpitChild && mailpitChild.exitCode === null && mailpitChild.signalCode === null) mailpitChild.kill('SIGTERM');
          if (mailpitClosed) await mailpitClosed;
        },
        waitForResources: () => waitForOwnedResourcesToStop(pids, [4173, backendPort, mailpitPort, smtpPort], trailLogPath),
        closeLogs: async () => {
          let firstError;
          for (const stream of [viteLog, trailLog, mailpitLog]) {
            try {
              if (stream && !stream.destroyed) await new Promise(resolvePromise => stream.end(resolvePromise));
            } catch (error) {
              firstError ??= error;
            }
          }
          if (firstError) throw firstError;
        },
        removeDepot: async () => {
          if (!depotRemoved) {
            await removeOwnedDepot(depot, owner);
            depotRemoved = true;
          }
        },
      });
    })();
    stopPromise = stopPromise.catch(error => {
      stopPromise = undefined;
      throw error;
    });
    return stopPromise;
  };
  try {
    const baseConfig = await readFile(join(repository, 'backend/config/development.textproto'), 'utf8');
    const config = baseConfig
      .replace('__READY_API__', readyApi)
      .replace(/email\s*\{\s*\}/u, `email {\n  smtp_host: "127.0.0.1"\n  smtp_port: ${smtpPort}\n  smtp_encryption: SMTP_ENCRYPTION_NONE\n  sender_name: "Trail Party E2E"\n  sender_address: "trail-party-e2e@example.invalid"\n}`)
      .replace(/server\s*\{\s*application_name:\s*"Trail Party development"\s*\}/u, `server { application_name: "Trail Party E2E" site_url: "${backend}" }`);
    await writeFile(join(depot, 'config.textproto'), config, { mode: 0o600 });
    await cp(join(repository, 'backend/migrations'), join(depot, 'migrations'), { recursive: true });
    await mkdir(join(depot, 'wasm'), { recursive: true, mode: 0o700 });
    await cp(join(repository, '.artifacts/p02-t2/application/profile.wasm'), join(depot, 'wasm/profile.wasm'));

    mailpitLog = createWriteStream(mailpitLogPath, { flags: 'a', mode: 0o600 });
    mailpitChild = spawn(mailpitCommand, [
      '--database', join(depot, 'mailpit.db'), '--listen', `127.0.0.1:${mailpitPort}`,
      '--smtp', `127.0.0.1:${smtpPort}`, '--disable-version-check', '--quiet',
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: env() });
    mailpitChild.stdout.pipe(mailpitLog, { end: false });
    mailpitChild.stderr.pipe(mailpitLog, { end: false });
    mailpitClosed = new Promise(resolvePromise => mailpitChild.once('close', resolvePromise));
    await waitFor(`${mailpit}/readyz`, response => response.ok, 'Mailpit', mailpitLogPath);

    trailLog = createWriteStream(trailLogPath, { flags: 'a', mode: 0o600 });
    trail = spawn(trailCommand, [
      '--depot', depot, '--public-url', backend, 'run', '--address', `127.0.0.1:${backendPort}`,
      '--runtime-threads', '1', '--stderr-logging',
    ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: env() });
    trail.stdout.pipe(trailLog, { end: false });
    trail.stderr.pipe(trailLog, { end: false });
    trailClosed = new Promise(resolvePromise => trail.once('close', resolvePromise));
    await waitFor(`${backend}/api/healthcheck`, async response => {
      if (!response.ok) return false;
      const ready = await fetch(`${backend}/api/records/v1/${readyApi}/1`);
      return ready.ok && (await ready.json()).id === 1;
    }, 'TrailBase', trailLogPath);

    const identities = await provisionAccounts(backend, accounts, marker, depot, trailLogPath);
    await stopProcess(trail, trailClosed);
    trail = undefined;
    trailClosed = undefined;
    const seed = runSqlite(join(depot, 'data/main.db'), seedDatabase, Object.values(identities).map(id => Buffer.from(id, 'base64url').toString('hex')));
    if (seed.status !== 0) {
      await writeFile(trailLogPath, `${seed.stdout}\n${seed.stderr}`, { flag: 'a' });
      fail(`Deterministic E2E fixture seed failed; private diagnostics: ${trailLogPath}`);
    }
    trail = spawn(trailCommand, [
      '--depot', depot, '--public-url', backend, 'run', '--address', `127.0.0.1:${backendPort}`,
      '--runtime-threads', '1', '--stderr-logging',
    ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: env() });
    trail.stdout.pipe(trailLog, { end: false });
    trail.stderr.pipe(trailLog, { end: false });
    trailClosed = new Promise(resolvePromise => trail.once('close', resolvePromise));
    await waitFor(`${backend}/api/healthcheck`, async response => {
      if (!response.ok) return false;
      const ready = await fetch(`${backend}/api/records/v1/${readyApi}/1`);
      return ready.ok && (await ready.json()).id === 1;
    }, 'TrailBase restart', trailLogPath);
    await waitForAuthenticated(backend, accounts.H, 'TrailBase authenticated restart', trailLogPath);

    vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
      cwd: repository,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env(), TRAILBASE_PORT: String(backendPort), VITE_PORT: '4173' },
    });
    viteLog = createWriteStream(viteLogPath, { flags: 'a', mode: 0o600 });
    vite.stdout.pipe(viteLog, { end: false });
    vite.stderr.pipe(viteLog, { end: false });
    viteClosed = new Promise(resolvePromise => vite.once('close', resolvePromise));
    await waitFor(`${frontend}/auth`, async response => response.ok && (await response.text()).includes('__sveltekit'), 'Vite', viteLogPath);

    const info = {
      frontend, backend, mailpit, stackFile, depot, runId: marker,
      accounts: Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, { ...account, id: identities[name] }])),
      signup,
    };
    await writeFile(stackFile, JSON.stringify(info, null, 2), { mode: 0o600 });
    return { ...info, close: stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      const original = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`${original}; owned stack cleanup failed: ${cleanup}`, { cause: cleanupError });
    }
    throw error;
  }
}
