import { defineConfig } from 'trailbase-wasm';
import { Transaction } from 'trailbase-wasm/db';
import { HttpError, HttpHandler, HttpResponse, type HttpRequest } from 'trailbase-wasm/http';

// This endpoint and its constraint-failure sentinel exist only in the owned probe depot.
function increment(req: HttpRequest): HttpResponse {
  const user = req.user();
  if (!user) throw new HttpError(401, 'Authentication required');
  const body = req.body();
  if (!body || body.byteLength > 1024) throw new HttpError(400, 'Invalid body');
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid command');
  const { id, version } = input as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || typeof id !== 'string' || !/^[A-Za-z0-9_-]{22}==$/.test(id)
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new HttpError(400, 'Invalid command');
  }
  const tx = new Transaction();
  try {
    const rows = tx.query('SELECT text FROM probe_items WHERE id = base64_url_safe(?1) AND owner = base64_url_safe(?2)', [id, user.id]);
    if (rows.length !== 1) throw new HttpError(403, 'Not your record');
    const changed = tx.execute('UPDATE probe_items SET version = version + 1 WHERE id = base64_url_safe(?1) AND version = ?2', [id, version]);
    if (changed !== 1) throw new HttpError(409, 'Version conflict');
    tx.execute('INSERT INTO probe_audit(item, version, label) VALUES (base64_url_safe(?1), ?2, ?3)', [id, version + 1, rows[0][0]]);
    tx.commit();
    return HttpResponse.json({ version: version + 1 });
  } catch (error) {
    tx.rollback();
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, 'Transaction rejected');
  }
}

// This endpoint is loaded only into an owned backend test depot. It is a trusted
// fixture mutation for proving safe Record SSE update/delete bytes; it is not an
// application/game handler.
function authorizationFixture(req: HttpRequest): HttpResponse {
  const user = req.user();
  if (!user) throw new HttpError(401, 'Authentication required');
  const body = req.body();
  if (!body || body.byteLength > 1024) throw new HttpError(400, 'Invalid body');
  let input: unknown;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid command');
  const value = input as Record<string, unknown>;
  const validActions = ['update', 'delete', 'member-update', 'member-revoke', 'display-update', 'display-revoke', 'display-complete', 'display-delete'];
  if (Object.keys(value).length !== 3 || typeof value.action !== 'string' || !validActions.includes(value.action)
      || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{22}==$/.test(value.id)
      || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0) {
    throw new HttpError(400, 'Invalid command');
  }
  const id = value.id;
  const version = value.version;
  const action = value.action;
  const memberAction = action === 'member-update' || action === 'member-revoke';
  const displayAction = action.startsWith('display-');
  const tx = new Transaction();
  let committed = false;
  try {
    const rows = memberAction
      ? tx.query(
        'SELECT gp.version FROM game_players AS gp JOIN games AS g ON g.id = gp.game_id WHERE gp.id = base64_url_safe(?1) AND g.host_id = base64_url_safe(?2) AND g.deleted_at IS NULL',
        [id, user.id],
      )
      : displayAction
        ? tx.query(
          'SELECT d.version FROM displays AS d JOIN games AS g ON g.id = d.game_id WHERE d.id = base64_url_safe(?1) AND d.host_id = base64_url_safe(?2) AND g.deleted_at IS NULL',
          [id, user.id],
        )
        : tx.query(
          'SELECT o.version FROM online AS o JOIN games AS g ON g.id = o.game_id WHERE o.id = base64_url_safe(?1) AND g.host_id = base64_url_safe(?2) AND g.deleted_at IS NULL',
          [id, user.id],
        );
    if (rows.length !== 1) throw new HttpError(403, 'Fixture mutation denied');
    if (Number(rows[0][0]) !== version) throw new HttpError(409, 'Version conflict');
    const changed = action === 'update'
      ? tx.execute("UPDATE online SET visibility = CASE visibility WHEN 'visible' THEN 'hidden' ELSE 'visible' END, last_seen_at = last_seen_at + 1, version = version + 1 WHERE id = base64_url_safe(?1) AND version = ?2", [id, version])
      : action === 'delete'
        ? tx.execute('DELETE FROM online WHERE id = base64_url_safe(?1) AND version = ?2', [id, version])
        : action === 'member-revoke'
          ? tx.execute('UPDATE game_players SET left_at = unixepoch(), updated_at = updated_at + 1, version = version + 1 WHERE id = base64_url_safe(?1) AND version = ?2', [id, version])
          : action === 'member-update'
            ? tx.execute('UPDATE game_players SET updated_at = updated_at + 1, version = version + 1 WHERE id = base64_url_safe(?1) AND version = ?2', [id, version])
            : action === 'display-revoke'
              ? tx.execute('UPDATE displays SET revoked_at = unixepoch(), updated_at = updated_at + 1, version = version + 1 WHERE id = base64_url_safe(?1) AND version = ?2', [id, version])
              : action === 'display-update'
                ? tx.execute('UPDATE displays SET last_seen_at = last_seen_at + 1, updated_at = updated_at + 1, version = version + 1 WHERE id = base64_url_safe(?1) AND version = ?2', [id, version])
                : action === 'display-complete'
                  ? tx.execute("UPDATE games SET lifecycle = 'completed', roster_locked_at = COALESCE(roster_locked_at, unixepoch()), completed_at = COALESCE(completed_at, unixepoch()), roster_version = roster_version + 1, version = version + 1, updated_at = updated_at + 1 WHERE id = (SELECT game_id FROM displays WHERE id = base64_url_safe(?1)) AND host_id = base64_url_safe(?2) AND deleted_at IS NULL", [id, user.id])
                  : tx.execute('UPDATE games SET deleted_at = unixepoch(), version = version + 1, updated_at = updated_at + 1 WHERE id = (SELECT game_id FROM displays WHERE id = base64_url_safe(?1)) AND host_id = base64_url_safe(?2) AND deleted_at IS NULL', [id, user.id]);
    if (changed !== 1) throw new HttpError(409, 'Version conflict');
    tx.commit();
    committed = true;
    return HttpResponse.json({
      action,
      version: ['update', 'member-update', 'member-revoke', 'display-update', 'display-revoke'].includes(action)
        ? version + 1
        : version,
    });
  } catch (error) {
    if (!committed) tx.rollback();
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, 'Fixture mutation rejected');
  }
}

// This endpoint is loaded only into an owned backend test depot. It probes the
// pinned embedded SQLite connection; it is not an application/game handler.
function deferredPartnerProbe(req: HttpRequest): HttpResponse {
  const user = req.user();
  if (!user) throw new HttpError(401, 'Authentication required');
  const body = req.body();
  if (!body || body.byteLength > 4096) throw new HttpError(400, 'Invalid body');
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid command');
  const value = input as Record<string, unknown>;
  const fields = ['incomplete_game_id', 'incomplete_round_id', 'incomplete_assignment_id', 'complete_game_id', 'complete_round_id', 'complete_assignment_id', 'incomplete_history_id', 'complete_history_id'];
  if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => typeof value[key] !== 'string' && !key.endsWith('history_id'))
      || fields.filter(key => key.endsWith('history_id')).some(key => typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || Number(value[key]) <= 0)) {
    throw new HttpError(400, 'Invalid command');
  }
  const id = (key: string) => value[key] as string;
  const history = (key: string) => Number(value[key]);
  const foreignKeyProbe = new Transaction();
  let foreignKeysEnforced = false;
  try {
    foreignKeyProbe.execute('INSERT INTO games (host_id, join_code, title) VALUES (base64_url_safe(?1), ?2, ?3)', ['AAAAAAAAAAAAAAAAAAAAAA==', 'FKPRB1', 'Foreign-key probe']);
  } catch {
    foreignKeysEnforced = true;
  } finally {
    foreignKeyProbe.rollback();
  }
  const result: Record<string, unknown> = {
    foreign_keys: foreignKeysEnforced ? 1 : 0,
  };
  const run = (prefix: 'incomplete' | 'complete', questionId: number, code: string, historyId: number, includePartners: boolean) => {
    const tx = new Transaction();
    const current: Record<string, unknown> = { stage: null, committed: false, error: '' };
    try {
      current.stage = 'game-insert';
      tx.execute('INSERT INTO games (id, host_id, join_code, title) VALUES (base64_url_safe(?1), base64_url_safe(?2), ?3, ?4)', [id(`${prefix}_game_id`), user.id, code, 'Pinned deferred probe']);
      current.stage = 'round-insert';
      tx.execute('INSERT INTO rounds (id, game_id, ordinal, title) VALUES (base64_url_safe(?1), base64_url_safe(?2), 1, ?3)', [id(`${prefix}_round_id`), id(`${prefix}_game_id`), 'Probe round']);
      current.stage = 'question-insert';
      tx.execute('INSERT INTO questions (id, source_id, category, subcategory, difficulty, question, answer_a, answer_b, answer_c, answer_d) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)', [questionId, `pinned-deferred-${code}`, 'category', 'subcategory', 'easy', 'question', 'answer a', 'answer b', 'answer c', 'answer d']);
      current.stage = 'game-question';
      tx.execute('INSERT INTO game_questions (id, game_id, round_id, ordinal, question_text, choices) VALUES (base64_url_safe(?1), base64_url_safe(?2), base64_url_safe(?3), 1, ?4, ?5)', [id(`${prefix}_assignment_id`), id(`${prefix}_game_id`), id(`${prefix}_round_id`), 'Probe question', '{"A":"one","B":"two","C":"three","D":"four"}']);
      if (includePartners) {
        current.stage = 'partner-insert';
        tx.execute('INSERT INTO assignment_private (assignment_id, question_id, permutation, correct_label) VALUES (base64_url_safe(?1), ?2, ?3, ?4)', [id(`${prefix}_assignment_id`), questionId, '[0,1,2,3]', 'A']);
        tx.execute('INSERT INTO used_question_history (id, host_id, question_id, game_id, assignment_id, operation_id) VALUES (?1, base64_url_safe(?2), ?3, base64_url_safe(?4), base64_url_safe(?5), ?6)', [historyId, user.id, questionId, id(`${prefix}_game_id`), id(`${prefix}_assignment_id`), `018f47d1-8b42-7abc-9def-${String(historyId).padStart(12, '0')}`]);
      }
      current.stage = 'commit';
      tx.commit();
      current.committed = true;
    } catch (error) {
      const detail = error as { message?: unknown; payload?: unknown };
      current.error = JSON.stringify({ message: detail.message ?? String(error), payload: detail.payload ?? null });
      if (current.stage === null) current.stage = 'parent-insert';
      tx.rollback();
    }
    result[prefix] = current;
  };
  run('incomplete', 913, 'PIN01A', history('incomplete_history_id'), false);
  run('complete', 914, 'PIN02A', history('complete_history_id'), true);
  return HttpResponse.json(result);
}

export const { initEndpoint, incomingHandler, sqliteFunctionEndpoint } = defineConfig({
  httpHandlers: [
    HttpHandler.post('/__capabilities/increment', increment),
    HttpHandler.post('/__p02/authorization-fixture', authorizationFixture),
    HttpHandler.post('/__p02/deferred-partner-probe', deferredPartnerProbe),
  ],
});
