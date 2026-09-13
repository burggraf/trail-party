import assert from 'node:assert/strict';
import test from 'node:test';
import { FetchError, initClient } from 'trailbase';
import { startStack } from './stack.ts';

const SAFE_PROJECTIONS: Record<string, string[]> = {
  profiles_public: ['avatar_mime', 'avatar_revision', 'display_name', 'id', 'updated_at', 'version'],
  games_public: ['duration_minutes', 'id', 'lifecycle', 'location', 'roster_locked_at', 'roster_version', 'starts_at', 'title', 'updated_at', 'version'],
  games_host: ['auto_reveal', 'duration_minutes', 'host_id', 'id', 'join_code', 'lifecycle', 'location', 'roster_locked_at', 'roster_version', 'starts_at', 'timers', 'title', 'updated_at', 'version'],
  game_teams: ['game_id', 'id', 'name', 'updated_at', 'version'],
  game_players: ['game_id', 'id', 'left_at', 'team_id', 'updated_at', 'user_id', 'version'],
  game_state_public: ['all_answered_at', 'assignment_id', 'choices', 'created_at', 'deadline_at', 'id', 'paused_remaining_seconds', 'phase', 'question_ordinal', 'question_text', 'revealed', 'round_id', 'round_ordinal', 'round_title', 'updated_at', 'version'],
  displays_public: ['claim_version', 'game_id', 'host_id', 'id', 'settings', 'updated_at', 'version'],
  online: ['game_id', 'id', 'last_seen_at', 'version', 'visibility'],
};

const PRIVATE_APIS = [
  'profiles', 'questions', 'rounds', 'games', 'game_questions', 'assignment_private',
  'game_answers', 'answer_grades_private', 'used_question_history', 'displays', 'audit_events', 'pairing_limits',
];
const DENIED_STATUSES = [400, 401, 403, 404, 405];

type Row = Record<string, unknown>;

function isDenied(error: unknown): boolean {
  return error instanceof FetchError && DENIED_STATUSES.includes(error.status);
}

function assertSafeRow(row: unknown, fields: string[], label: string): asserts row is Row {
  assert.ok(row && typeof row === 'object' && !Array.isArray(row), `${label}: response row is not an object`);
  assert.deepEqual(Object.keys(row as Row).sort(), [...fields].sort(), `${label}: private field escaped projection`);
}

async function assertDenied(operation: () => Promise<unknown>, label: string) {
  await assert.rejects(operation, error => isDenied(error), `${label}: unauthorized operation succeeded`);
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: no result within 2s`)), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
}

test('authority-forgery', { timeout: 120000 }, async t => {
  const stack = await startStack({ source: 'backend' });
  t.after(() => stack.close());
  const host = initClient(stack.base);
  const member = initClient(stack.base);
  const foreignHost = initClient(stack.base);
  const anonymous = initClient(stack.base);
  await host.login(stack.accounts[0].email, stack.accounts[0].password);
  await member.login(stack.accounts[1].email, stack.accounts[1].password);
  await foreignHost.login(stack.accounts[2].email, stack.accounts[2].password);

  const safeEventTables: Record<string, string[]> = {
    profiles_public_events: SAFE_PROJECTIONS.profiles_public,
    games_public_events: SAFE_PROJECTIONS.games_public,
    games_host_events: SAFE_PROJECTIONS.games_host,
    game_teams_public_events: SAFE_PROJECTIONS.game_teams,
    game_players_public_events: SAFE_PROJECTIONS.game_players,
    game_state_public: SAFE_PROJECTIONS.game_state_public,
    displays_public: SAFE_PROJECTIONS.displays_public,
    online: SAFE_PROJECTIONS.online,
  };
  const objects = stack.schemaSnapshot() as Array<{ name?: string; columns?: unknown[] }>;
  for (const [table, fields] of Object.entries(safeEventTables)) {
    const object = objects.find(candidate => candidate.name === table);
    assert.ok(object, `authority-forgery ${table}: safe event table is missing`);
    const columns = (object.columns ?? []).map(column => Array.isArray(column) ? String(column[1]) : '');
    assert.deepEqual(columns.sort(), [...fields].sort(), `authority-forgery ${table}: unsafe event column escaped`);
  }

  const hostRows = new Map<string, Row>();
  for (const [apiName, fields] of Object.entries(SAFE_PROJECTIONS)) {
    const api = host.records(apiName);
    const listed = await api.list({ pagination: { limit: 100 }, count: true, order: ['id'] });
    assert.ok(listed.records.length > 0, `authority-forgery ${apiName}: host has no scoped fixture row`);
    for (const row of listed.records) assertSafeRow(row, fields, `authority-forgery ${apiName} host list`);
    const row = listed.records[0] as Row;
    assert.ok(typeof row.id === 'string', `authority-forgery ${apiName}: row has no ID`);
    hostRows.set(apiName, row);
    assertSafeRow(await api.read(row.id as string), fields, `authority-forgery ${apiName} host read`);
    assert.equal(JSON.stringify(row).includes('PRIVATE_'), false,
      `authority-forgery ${apiName}: private sentinel escaped public response`);

    const memberApi = member.records(apiName);
    const memberList = await memberApi.list({ pagination: { limit: 100 }, count: true, order: ['id'] });
    const memberCanRead = !['games_host', 'displays_public'].includes(apiName);
    if (memberCanRead) {
      assert.ok(memberList.records.length > 0, `authority-forgery ${apiName}: member lost permitted scope`);
      for (const value of memberList.records) assertSafeRow(value, fields, `authority-forgery ${apiName} member list`);
    } else {
      assert.equal(memberList.total_count, 0, `authority-forgery ${apiName}: member saw host/device-only row`);
      assert.equal(memberList.records.length, 0, `authority-forgery ${apiName}: member received host/device-only row`);
    }

    await assertDenied(() => anonymous.records(apiName).list(), `authority-forgery ${apiName} anonymous list`);

    try {
      const expanded = await api.list({ expand: ['private', '_user', 'game', 'question', 'grade'] });
      for (const value of expanded.records) assertSafeRow(value, fields, `authority-forgery ${apiName} expand`);
    } catch (error) {
      assert.ok(isDenied(error), `authority-forgery ${apiName}: unexpected expand error`);
    }

    await assertDenied(
      () => anonymous.records(apiName).subscribeAll({
        filters: [{ column: 'id', op: 'equal' as const, value: row.id as string }],
      }),
      `authority-forgery ${apiName} anonymous SSE`,
    );
    const stream = await bounded(api.subscribeAll({
      filters: [{ column: 'id', op: 'equal' as const, value: row.id as string }],
    }), `authority-forgery ${apiName} host SSE`);
    const reader = stream.getReader();
    await bounded(reader.cancel(), `authority-forgery ${apiName} host SSE cancellation`);
    reader.releaseLock();
    await assertDenied(
      () => foreignHost.records(apiName).subscribe(row.id as string),
      `authority-forgery ${apiName} foreign SSE`,
    );
  }

  const targetGameId = hostRows.get('games_public')!.id as string;
  const targetHostGame = await host.records('games_public').read(targetGameId);
  assert.equal(targetHostGame.id, targetGameId, 'authority-forgery: host lost own game');
  const foreignGames = await foreignHost.records('games_public').list({ pagination: { limit: 100 }, count: true });
  assert.equal(foreignGames.records.length, 1, 'authority-forgery: unrelated host game scope is not isolated');
  assert.notEqual(foreignGames.records[0].id, targetGameId, 'authority-forgery: unrelated host saw target game');
  const foreignHostGames = await foreignHost.records('games_host').list({ pagination: { limit: 100 }, count: true });
  assert.equal(foreignHostGames.records.length, 1, 'authority-forgery: unrelated host lost own host scope');
  assert.notEqual(foreignHostGames.records[0].id, targetGameId, 'authority-forgery: unrelated host saw target host row');
  await assertDenied(
    () => foreignHost.records('games_public').read(targetGameId),
    'authority-forgery cross-game game read',
  );
  await assertDenied(
    () => foreignHost.records('games_host').read(targetGameId),
    'authority-forgery cross-game host read',
  );
  await assertDenied(
    () => member.records('games_host').read(targetGameId),
    'authority-forgery member host read',
  );

  const hostProfile = hostRows.get('profiles_public')!.id as string;
  const foreignProfiles = await foreignHost.records('profiles_public').list({ pagination: { limit: 100 }, count: true });
  assert.equal(foreignProfiles.records.length, 1, 'authority-forgery: unrelated host profile scope is not isolated');
  assert.equal(foreignProfiles.records[0].id, foreignHost.user()?.id, 'authority-forgery: profile self scope is missing');
  await assertDenied(
    () => foreignHost.records('profiles_public').read(hostProfile),
    'authority-forgery cross-game profile read',
  );

  const privateIds: Record<string, string> = {
    profiles: hostRows.get('profiles_public')!.id as string,
    questions: '991001',
    games: targetGameId,
    displays: hostRows.get('displays_public')!.id as string,
  };
  for (const privateApi of PRIVATE_APIS) {
    const privateId = privateIds[privateApi] ?? '1';
    const read = await fetch(`${stack.base}/api/records/v1/${privateApi}/${privateId}`, {
      headers: host.headers(), signal: AbortSignal.timeout(2000),
    });
    assert.notEqual(read.status, 200, `authority-forgery ${privateApi}: private row escaped API boundary`);
    const list = await fetch(`${stack.base}/api/records/v1/${privateApi}?count=true`, {
      headers: host.headers(), signal: AbortSignal.timeout(2000),
    });
    assert.notEqual(list.status, 200, `authority-forgery ${privateApi}: private list escaped API boundary`);
  }

  for (const [apiName, row] of hostRows) {
    for (const [method, body] of [
      ['POST', JSON.stringify({ id: row.id, host_id: foreignHost.user()?.id, role: 'admin' })],
      ['PATCH', JSON.stringify({ version: 999, host_id: foreignHost.user()?.id, score: 100, correct_label: 'D' })],
      ['DELETE', undefined],
    ] as const) {
      const headers = new Headers(host.headers());
      if (body) headers.set('content-type', 'application/json');
      const response = await fetch(`${stack.base}/api/records/v1/${apiName}/${method === 'POST' ? '' : row.id}`, {
        method, body, headers, signal: AbortSignal.timeout(2000),
      });
      assert.ok(DENIED_STATUSES.includes(response.status),
        `authority-forgery ${apiName} ${method}: forged mutation returned ${response.status}`);
    }
  }

  const unchanged = await host.records('games_host').read(targetGameId);
  assert.equal(unchanged.host_id, host.user()?.id, 'authority-forgery: host identity was changed by forged update');
  assert.equal(unchanged.id, targetGameId, 'authority-forgery: game identity was changed by forged update');

  const state = hostRows.get('game_state_public')!;
  for (const secret of ['correct_label', 'source_label', 'grade', 'points', 'answer_key', 'score', 'source_id']) {
    assert.equal(secret in state, false, `authority-forgery: public state contains ${secret}`);
  }
});
