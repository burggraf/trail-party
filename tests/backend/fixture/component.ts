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
    HttpHandler.post('/__p02/deferred-partner-probe', deferredPartnerProbe),
  ],
});
