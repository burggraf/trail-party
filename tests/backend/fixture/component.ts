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

export const { initEndpoint, incomingHandler, sqliteFunctionEndpoint } = defineConfig({
  httpHandlers: [HttpHandler.post('/__capabilities/increment', increment)],
});
