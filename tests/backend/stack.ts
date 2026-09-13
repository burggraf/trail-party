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
const trailCommand = process.env.TRAILBASE_BIN?.trim() || 'trail';
const mailpitCommand = process.env.MAILPIT_BIN?.trim() || 'mailpit';
const env = { ...process.env, RUST_LOG: 'info' };

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

function runSqlite(dbPath: string, script: string, args: string[] = []) {
  return spawnSync('python3', ['-c', script, dbPath, ...args], { encoding: 'utf8', env });
}

function verifyMailpitVersion() {
  const result = spawnSync(mailpitCommand, ['version', '--no-release-check'], { encoding: 'utf8', env });
  assert.equal(result.status, 0,
    `Mailpit v1.31.0 is required and could not be executed (${mailpitCommand})`);
  assert.match(`${result.stdout}\n${result.stderr}`, /(?:^|\s)mailpit v1\.31\.0(?:\s|$)/i,
    `Mailpit v1.31.0 is required (${mailpitCommand})`);
  return `${result.stdout}`.trim().split('\n')[0];
}

const seedApplicationFixtures = String.raw`
import json, sqlite3, sys, time

def as_bytes(value):
    return bytes.fromhex(value)

def is_uuid(value):
    try:
        return len(bytes(value)) == 16
    except Exception:
        return 0

def is_uuid_v7(value):
    try:
        raw = bytes(value)
        return len(raw) == 16 and (raw[6] >> 4) == 7 and (raw[8] & 0xc0) == 0x80
    except Exception:
        return 0

def type_matches(value, expected):
    if isinstance(expected, list):
        return any(type_matches(value, item) for item in expected)
    if expected == 'object':
        return isinstance(value, dict)
    if expected == 'array':
        return isinstance(value, list)
    if expected == 'string':
        return isinstance(value, str)
    if expected == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == 'number':
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == 'null':
        return value is None
    if expected == 'boolean':
        return isinstance(value, bool)
    return True

def valid_schema(schema, value):
    if 'type' in schema and not type_matches(value, schema['type']):
        return False
    if 'enum' in schema and value not in schema['enum']:
        return False
    if isinstance(value, dict):
        if any(key not in value for key in schema.get('required', [])):
            return False
        if schema.get('additionalProperties') is False and any(key not in schema.get('properties', {}) for key in value):
            return False
        return all(valid_schema(schema.get('properties', {}).get(key, {}), item) for key, item in value.items())
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', len(value)):
            return False
        if schema.get('uniqueItems') and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
            return False
        return all(valid_schema(schema.get('items', {}), item) for item in value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value >= schema.get('minimum', value) and value <= schema.get('maximum', value)
    return True

def jsonschema_matches(schema_text, value_text):
    try:
        return int(valid_schema(json.loads(schema_text), json.loads(value_text)))
    except Exception:
        return 0

db = sqlite3.connect(sys.argv[1], timeout=5)
db.execute('PRAGMA foreign_keys = ON')
db.create_function('is_uuid', 1, is_uuid)
db.create_function('is_uuid_v7', 1, is_uuid_v7)
db.create_function('jsonschema_matches', 2, jsonschema_matches)
user_ids = [as_bytes(value) for value in sys.argv[2:7]]
game_id, round_id, team_id, player_a_id, player_b_id, opponent_team_id, opponent_player_id, unverified_player_id, display_id, display2_id, device_user_id, device2_user_id, second_game_id, display3_id, device3_user_id, third_game_id = [as_bytes(value) for value in sys.argv[7:23]]
now = int(time.time())
try:
    db.execute('BEGIN')
    db.executemany(
        'INSERT INTO profiles (id, display_name, avatar_file, avatar_mime, avatar_bytes) VALUES (?, ?, ?, ?, ?)',
        [(user_ids[0], 'red-check', 'private-avatar-sentinel', 'image/png', 1),
         (user_ids[1], 'red-check-secondary', None, None, None),
         (user_ids[2], 'foreign-account', None, None, None),
         (user_ids[3], 'opponent-account', None, None, None),
         (user_ids[4], 'unverified-account', None, None, None)],
    )
    db.execute(
        "INSERT INTO questions (id, source_id, external_id, category, subcategory, difficulty, question, answer_a, answer_b, answer_c, answer_d, metadata) VALUES (991001, 'p02-private-bank-sentinel', 'private-sentinel', 'private', 'private', 'hard', 'PRIVATE_BANK_SENTINEL', 'PRIVATE_A', 'PRIVATE_B', 'PRIVATE_C', 'PRIVATE_D', '{\"source\":\"PRIVATE_METADATA_SENTINEL\"}')",
    )
    db.execute(
        "INSERT INTO games (id, host_id, join_code, title, location, starts_at, lifecycle) VALUES (?, ?, 'ABC123', 'Projection fixture', 'Lab', ?, 'ready')",
        (game_id, user_ids[0], now),
    )
    db.execute(
        "INSERT INTO games (id, host_id, join_code, title, lifecycle) VALUES (?, ?, 'XYZ789', 'Foreign host fixture', 'ready')",
        (second_game_id, user_ids[2]),
    )
    db.execute(
        "INSERT INTO games (id, host_id, join_code, title, lifecycle) VALUES (?, ?, 'LMN456', 'Deletion display fixture', 'ready')",
        (third_game_id, user_ids[3]),
    )
    db.execute("INSERT INTO rounds (id, game_id, ordinal, title) VALUES (?, ?, 1, 'Round one')", (round_id, game_id))
    db.execute("INSERT INTO game_teams (id, game_id, name) VALUES (?, ?, 'Alpha')", (team_id, game_id))
    db.execute("INSERT INTO game_teams (id, game_id, name) VALUES (?, ?, 'Beta')", (opponent_team_id, game_id))
    db.executemany(
        'INSERT INTO game_players (id, game_id, user_id, team_id) VALUES (?, ?, ?, ?)',
        [(player_a_id, game_id, user_ids[0], team_id), (player_b_id, game_id, user_ids[1], team_id),
         (opponent_player_id, game_id, user_ids[3], opponent_team_id),
         (unverified_player_id, game_id, user_ids[4], opponent_team_id)],
    )
    db.execute('INSERT INTO game_state_public (id) VALUES (?)', (game_id,))
    db.execute(
        'INSERT INTO displays (id, device_user_id, host_id, game_id, claimed_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
        (display_id, device_user_id, user_ids[0], game_id, now, now),
    )
    db.execute(
        'INSERT INTO displays (id, device_user_id, host_id, game_id, claimed_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
        (display2_id, device2_user_id, user_ids[2], second_game_id, now, now),
    )
    db.execute(
        'INSERT INTO displays (id, device_user_id, host_id, game_id, claimed_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
        (display3_id, device3_user_id, user_ids[3], third_game_id, now, now),
    )
    db.execute('INSERT INTO online (id, game_id) VALUES (?, ?)', (player_b_id, game_id))
    db.commit()
except Exception:
    db.rollback()
    raise
finally:
    db.close()
`;

type SqliteResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export async function startStack({ source = 'capabilities' }: { source?: 'capabilities' | 'backend' | 'auth' } = {}) {
  const version = spawnSync(trailCommand, ['--version'], { encoding: 'utf8', env });
  assert.equal(version.status, 0, `pinned TrailBase executable is required on PATH (${trailCommand})`);
  assert.match(version.stdout, /v0\.33\.14-0-g3f965de7.*\nsqlite: 3\.53\.2/);
  // Verify the required mail sink before creating any owned depot that a failed probe could leak.
  const mailEnabled = source !== 'capabilities';
  const mailpitVersion = mailEnabled ? verifyMailpitVersion() : undefined;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const depot = await mkdtemp(join(root, `${source}-`));
  const marker = randomUUID();
  await writeFile(join(depot, '.owner'), marker, { mode: 0o600 });
  const logs = resolve('.artifacts/p02', marker);
  await mkdir(logs, { recursive: true, mode: 0o700 });
  const logPath = join(logs, 'trail.log');
  const apiName = `items_${marker.replaceAll('-', '')}`;
  const auditName = `audit_${marker.replaceAll('-', '')}`;
  const readyName = `ready_${marker.replaceAll('-', '')}`;
  const accountCount = source === 'capabilities' ? 2 : source === 'backend' ? 4 : 3;
  const accounts = Array.from({ length: accountCount }, (_, n) => ({
    email: `probe-${n}-${marker}@example.invalid`,
    password: randomBytes(24).toString('base64url'),
  }));
  let child: ChildProcess | undefined;
  let log: WriteStream | undefined;
  let exit: Promise<void> | undefined;
  let mailpitChild: ChildProcess | undefined;
  let mailpitLog: WriteStream | undefined;
  let mailpitExit: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const smtpPort = mailEnabled ? await freePort() : undefined;
  const mailpitHttpPort = mailEnabled ? await freePort() : undefined;
  const mailpitBase = mailpitHttpPort === undefined ? undefined : `http://127.0.0.1:${mailpitHttpPort}`;
  const mailpitDatabase = mailEnabled ? join(depot, 'mailpit', 'mailpit.db') : undefined;
  const mailpitLogPath = mailEnabled ? join(depot, 'mailpit', 'mailpit.log') : undefined;
  if (mailpitHttpPort === 8025) throw new Error('Owned Mailpit must not use the external Trailhead port 8025');

  function cli(args: string[]) {
    const result = spawnSync(trailCommand, ['--depot', depot, '--public-url', base, ...args], { env, encoding: 'utf8' });
    // CLI output can contain initial admin credentials. Never print it to the test reporter.
    if (result.status !== 0) {
      void appendFile(logPath, `${result.stdout}\n${result.stderr}`);
      throw new Error(`TrailBase CLI failed; private diagnostics: ${logs}`);
    }
    return result.stdout;
  }

  async function stopMailpit() {
    if (mailpitChild && mailpitChild.exitCode === null && mailpitChild.signalCode === null) {
      const owned = mailpitChild;
      const kill = setTimeout(() => owned.kill('SIGKILL'), 5000);
      owned.kill('SIGTERM');
      try { await mailpitExit; } finally { clearTimeout(kill); }
    }
    if (mailpitLog) await new Promise<void>(ok => mailpitLog!.end(ok));
    mailpitChild = undefined;
    mailpitLog = undefined;
    mailpitExit = undefined;
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
    exit = undefined;
  }

  async function startMailpit() {
    assert.ok(mailpitBase && mailpitDatabase && mailpitLogPath && smtpPort,
      'auth stack Mailpit settings are incomplete');
    await mkdir(join(depot, 'mailpit'), { recursive: true, mode: 0o700 });
    mailpitLog = createWriteStream(mailpitLogPath, { flags: 'a', mode: 0o600 });
    mailpitChild = spawn(mailpitCommand, [
      '--database', mailpitDatabase,
      '--listen', `127.0.0.1:${mailpitHttpPort}`,
      '--smtp', `127.0.0.1:${smtpPort}`,
      '--disable-version-check',
      '--quiet',
    ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    mailpitChild.stdout!.pipe(mailpitLog, { end: false });
    mailpitChild.stderr!.pipe(mailpitLog, { end: false });
    let launchError: Error | undefined;
    mailpitChild.once('error', error => { launchError = error; });
    mailpitExit = new Promise(ok => mailpitChild!.once('close', () => ok()));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (launchError || mailpitChild.exitCode !== null || mailpitChild.signalCode !== null) break;
      try {
        const ready = await fetch(`${mailpitBase}/readyz`, { signal: AbortSignal.timeout(500) });
        const info = await fetch(`${mailpitBase}/api/v1/info`, { signal: AbortSignal.timeout(500) });
        if (ready.ok && info.ok) return;
      } catch (error) {
        await appendFile(mailpitLogPath, `Readiness condition: ${String(error)}\n`);
      }
      await pollDelay(50);
    }
    throw new Error(`Owned Mailpit did not become ready within 20s; private depot: ${depot}`);
  }

  async function start() {
    log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    child = spawn(trailCommand, ['--depot', depot, '--public-url', base, 'run', '--address', `127.0.0.1:${port}`, '--runtime-threads', '1', '--stderr-logging'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      // Bounded health+schema condition polling, not a readiness sleep.
      await pollDelay(50);
    }
    throw new Error(`Owned TrailBase did not become ready within 20s; private diagnostics: ${logs}`);
  }

  function schemaSnapshot() {
    const probe = runSqlite(join(depot, 'data', 'main.db'), [
      'import json, sqlite3, sys',
      'db = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)',
      'objects = db.execute("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB \'sqlite_*\' AND name NOT GLOB \'_*\' ORDER BY type, name").fetchall()',
      'result = [{"type": kind, "name": name, "table": table, "sql": " ".join((sql or "").split()), **({"columns": db.execute("PRAGMA table_info(\\\'" + name.replace("\\\'", "\\\'\\\'") + "\\\')").fetchall(), "foreign_keys": db.execute("PRAGMA foreign_key_list(\\\'" + name.replace("\\\'", "\\\'\\\'") + "\\\')").fetchall(), "indexes": [(index, db.execute("PRAGMA index_xinfo(\\\'" + index[1].replace("\\\'", "\\\'\\\'") + "\\\')").fetchall()) for index in db.execute("PRAGMA index_list(\\\'" + name.replace("\\\'", "\\\'\\\'") + "\\\')").fetchall()]} if kind in ("table", "view") else {})} for kind, name, table, sql in objects]',
      'print(json.dumps(result, sort_keys=True))',
      'db.close()',
    ].join('; '));
    assert.equal(probe.status, 0, `schema snapshot failed: ${probe.stderr}`);
    return JSON.parse(probe.stdout);
  }

  async function offlineSqlite(script: string, args: string[] = []): Promise<SqliteResult> {
    await stop();
    try {
      const result = runSqlite(join(depot, 'data', 'main.db'), script, args);
      if (result.status !== 0) void appendFile(logPath, `${result.stdout}\n${result.stderr}`);
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    } finally {
      await start();
    }
  }

  async function listMailpitMessages(recipient: string): Promise<Array<{ ID?: string; To?: Array<{ Address?: string }> }>> {
    assert.ok(mailpitBase, 'auth stack Mailpit HTTP endpoint is unavailable');
    const response = await fetch(`${mailpitBase}/api/v1/messages?start=0&limit=100`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200, 'auth stack Mailpit message API is unavailable');
    const payload = await response.json() as { messages?: Array<{ ID?: string; To?: Array<{ Address?: string }> }> };
    return (payload.messages ?? []).filter(message =>
      message.To?.some(address => address.Address === recipient));
  }

  async function mailpitMessage(id: string): Promise<{ HTML?: string; Text?: string }> {
    assert.ok(mailpitBase, 'auth stack Mailpit HTTP endpoint is unavailable');
    const response = await fetch(`${mailpitBase}/api/v1/message/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200, 'auth stack Mailpit message detail API is unavailable');
    return await response.json() as { HTML?: string; Text?: string };
  }

  async function clearMailpitMessages() {
    assert.ok(mailpitBase, 'auth stack Mailpit HTTP endpoint is unavailable');
    const response = await fetch(`${mailpitBase}/api/v1/messages`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200, 'auth stack Mailpit clear API is unavailable');
  }

  async function waitForMailpitMessages(recipient: string, expected: number) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const messages = await listMailpitMessages(recipient);
      if (messages.length >= expected) return messages;
      await pollDelay(50);
    }
    const messages = await listMailpitMessages(recipient);
    throw new Error(`auth stack Mailpit did not receive ${expected} message(s); observed ${messages.length}`);
  }

  function close(): Promise<void> {
    closing ??= (async () => {
      await stop();
      await stopMailpit();
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      process.off('SIGHUP', onSignal);
      await removeOwnedDepot(depot, marker);
    })();
    return closing;
  }
  function onSignal() { void close().finally(() => process.exit(1)); }
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  process.once('SIGHUP', onSignal);
  let deviceUserId: string | undefined;
  let displayClient: ReturnType<typeof initClient> | undefined;
  let secondDisplayClient: ReturnType<typeof initClient> | undefined;
  let thirdDisplayClient: ReturnType<typeof initClient> | undefined;
  let unverifiedClient: ReturnType<typeof initClient> | undefined;
  let unverifiedUserId: string | undefined;
  const accountIds: string[] = [];
  const profileIds: string[] = [];
  try {
    const configPath = source === 'capabilities' ? 'tests/backend/fixture/config.textproto' : 'backend/config/development.textproto';
    const migrationPath = source === 'capabilities' ? 'tests/backend/fixture/migrations' : 'backend/migrations';
    let config = (await readFile(configPath, 'utf8'))
      .replace('__ITEM_API__', apiName).replace('__AUDIT_API__', auditName).replace('__READY_API__', readyName);
    if (mailEnabled) {
      config = config
        .replace(/email\s*\{\s*\}/, `email {\n  smtp_host: "127.0.0.1"\n  smtp_port: ${smtpPort}\n  smtp_encryption: SMTP_ENCRYPTION_NONE\n  sender_name: "Trail Party test"\n  sender_address: "trail-party-test@example.invalid"\n}`)
        .replace(/server\s*\{\s*application_name:\s*"Trail Party development"\s*\}/,
          `server { application_name: "Trail Party test" site_url: "${base}" }`);
    }
    await writeFile(join(depot, 'config.textproto'), config, { mode: 0o600 });
    await cp(migrationPath, join(depot, 'migrations'), { recursive: true });
    await mkdir(join(depot, 'wasm'), { recursive: true });
    await cp('.artifacts/p01-t2/component/probe.wasm', join(depot, 'wasm', 'probe.wasm'));
    if (source === 'auth') {
      await cp('.artifacts/p02-t2/application/profile.wasm', join(depot, 'wasm', 'profile.wasm'));
    }
    if (mailEnabled) await startMailpit();
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
    for (const account of accounts) {
      const ordinary = initClient(base);
      await ordinary.login(account.email, account.password);
      const id = ordinary.user()?.id;
      assert.ok(id, 'synthetic ordinary account has no native id');
      accountIds.push(id);
      if (source !== 'backend' || profileIds.length < 3) profileIds.push(id);
      await ordinary.logout();
    }
    if (source === 'backend') {
      const device = initClient(base);
      await device.loginAnonymously();
      displayClient = device;
      deviceUserId = device.user()?.id;
      assert.ok(deviceUserId, 'synthetic anonymous display has no native id');
      const secondDevice = initClient(base);
      await secondDevice.loginAnonymously();
      secondDisplayClient = secondDevice;
      const device2UserId = secondDevice.user()?.id;
      assert.ok(device2UserId, 'synthetic second anonymous display has no native id');
      const thirdDevice = initClient(base);
      await thirdDevice.loginAnonymously();
      thirdDisplayClient = thirdDevice;
      const device3UserId = thirdDevice.user()?.id;
      assert.ok(device3UserId, 'synthetic third anonymous display has no native id');
      const unverified = initClient(base);
      await unverified.loginAnonymously();
      const unverifiedEmail = `unverified-${marker}@example.invalid`;
      const unverifiedPassword = randomBytes(24).toString('base64url');
      const promotion = await unverified.fetch('/api/auth/v1/promote_anonymous', {
        method: 'POST',
        body: JSON.stringify({
          new_email: unverifiedEmail,
          new_password: unverifiedPassword,
          new_password_repeat: unverifiedPassword,
        }),
        throwOnError: false,
      });
      let promotionDetail = '';
      if (promotion.status !== 200) {
        promotionDetail = (await promotion.text())
          .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/gu, '<email>')
          .replace(/(password|token|secret)[^\s,;:]*/giu, '<redacted>')
          .slice(0, 400);
      }
      assert.equal(
        promotion.status,
        200,
        `synthetic authenticated-unverified promotion failed (HTTP ${promotion.status}; ${promotionDetail || 'no response body'})`,
      );
      unverifiedClient = unverified;
      unverifiedUserId = unverified.user()?.id;
      assert.ok(unverifiedUserId, 'synthetic authenticated-unverified user has no native id');
      await stop();
      const ids = [...accountIds, unverifiedUserId].map(id => Buffer.from(id, 'base64url').toString('hex'));
      const makeV7 = () => {
        const value = randomBytes(16);
        const timestamp = BigInt(Date.now());
        value[0] = Number(timestamp >> 40n) & 0xff;
        value[1] = Number(timestamp >> 32n) & 0xff;
        value[2] = Number(timestamp >> 24n) & 0xff;
        value[3] = Number(timestamp >> 16n) & 0xff;
        value[4] = Number(timestamp >> 8n) & 0xff;
        value[5] = Number(timestamp) & 0xff;
        value[6] = (value[6] & 0x0f) | 0x70;
        value[8] = (value[8] & 0x3f) | 0x80;
        return value.toString('hex');
      };
      const fixtureIds = [
        makeV7(), makeV7(), makeV7(), makeV7(), makeV7(), makeV7(), makeV7(), makeV7(),
        makeV7(), makeV7(), Buffer.from(deviceUserId!, 'base64url').toString('hex'),
        Buffer.from(secondDisplayClient!.user()!.id, 'base64url').toString('hex'), makeV7(),
        makeV7(), Buffer.from(thirdDisplayClient!.user()!.id, 'base64url').toString('hex'), makeV7(),
      ];
      const seed = runSqlite(join(depot, 'data', 'main.db'), seedApplicationFixtures, [...ids, ...fixtureIds]);
      assert.equal(seed.status, 0, `fixture application seed failed; private diagnostics: ${logs}`);
      await start();
      await bootstrap.logout();
    } else {
      await bootstrap.logout();
    }
  } catch (error) {
    await close();
    throw error;
  }
  console.log(`Real backend: ${version.stdout.trim().replaceAll('\n', '; ')}; owned loopback port ${port}`);
  return {
    base,
    apiName,
    auditName,
    readyName,
    accounts,
    profileIds,
    unverifiedClient,
    displayClient,
    secondDisplayClient,
    thirdDisplayClient,
    mailpit: source === 'auth' ? {
      base: mailpitBase!,
      smtpPort: smtpPort!,
      httpPort: mailpitHttpPort!,
      database: mailpitDatabase!,
      logPath: mailpitLogPath!,
      listMessages: listMailpitMessages,
      waitForMessages: waitForMailpitMessages,
      message: mailpitMessage,
      clearMessages: clearMailpitMessages,
      version: mailpitVersion!,
    } : undefined,
    deviceUserId,
    close,
    restart: async () => { await stop(); await start(); },
    offlineSqlite,
    schema: (apiOrMode: string, maybeMode?: string) => {
      const api = maybeMode === undefined ? apiName : apiOrMode;
      const mode = maybeMode === undefined ? apiOrMode : maybeMode;
      return JSON.parse(cli(['schema', api, '--mode', mode]));
    },
    schemaSnapshot,
  };
}
