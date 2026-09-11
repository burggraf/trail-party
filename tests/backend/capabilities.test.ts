import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { FetchError, initClient, type Event } from 'trailbase';

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: no result within 2s`)), 2000); }),
  ]).finally(() => clearTimeout(timer));
}

// P01.T2 / C2-C3; F02/F21/F29 foundation. Only synthetic fixtures, real auth/API/SSE.
test('pinned TrailBase capabilities', { timeout: 60000 }, async t => {
  assert.ok(existsSync('tests/backend/fixture/config.textproto'), 'P01 probe configuration missing');
  const { startStack } = await import('./stack.ts');
  const stack = await startStack();
  t.after(() => stack.close());
  const a = initClient(stack.base);
  const b = initClient(stack.base);
  const guest = initClient(stack.base);
  await a.login(stack.accounts[0].email, stack.accounts[0].password);
  await b.login(stack.accounts[1].email, stack.accounts[1].password);
  assert.ok(a.user()?.id && b.user()?.id);
  assert.notEqual(a.user()?.id, b.user()?.id);
  const api = a.records(stack.apiName);
  const other = b.records(stack.apiName);
  const denied = (error: unknown) => error instanceof FetchError && [401, 403, 404].includes(error.status);

  await t.test('fresh migrations, UUID/JSON/timestamp serialization, CRUD and schema', async () => {
    assert.deepEqual((await api.list()).records, []);
    const payload = { unicode: '雪 🧭', nested: [null, true, 3] };
    await assert.rejects(api.create({ bucket: 'crud', text: 'Bad JSON', payload: 'not-an-object' }),
      (error: unknown) => error instanceof FetchError && error.status === 400);
    const id = await api.create({ bucket: 'crud', text: 'Original', payload });
    assert.equal(typeof id, 'string', 'create returns a record ID, not a record');
    assert.match(String(id), /^[A-Za-z0-9_-]{22}==$/);
    const uuid = Buffer.from(String(id), 'base64url');
    assert.equal(uuid.length, 16);
    assert.equal(uuid[6] >> 4, 7);
    const row = await api.read(id);
    assert.equal(row.id, id);
    assert.deepEqual(row.payload, payload);
    assert.equal(typeof row.created, 'number');
    assert.ok(Number(row.created) > 0 && Number(row.created) <= Date.now() / 1000);
    assert.equal(await api.update(id, { text: 'Updated' }), undefined);
    assert.equal((await api.read(id)).text, 'Updated');
    assert.equal(await api.delete(id), undefined);
    await assert.rejects(api.read(id), denied);
    for (const mode of ['insert', 'select', 'update']) {
      const schema = stack.schema(mode);
      assert.ok(schema.properties.id);
      assert.ok(schema.properties.payload);
      assert.ok(schema.properties.created);
    }
    await stack.restart();
    assert.deepEqual((await api.list()).records, [], 'migrations restart without reseeding');
  });

  await t.test('server ACL denies unauthenticated, cross-owner and forged ownership/version requests', async () => {
    const id = await api.create({ bucket: 'acl', text: 'Private', payload: {} });
    await assert.rejects(guest.records(stack.apiName).list(), denied);
    await assert.rejects(other.read(id), denied);
    await assert.rejects(other.update(id, { text: 'Spoofed' }), denied);
    await assert.rejects(other.delete(id), denied);
    await assert.rejects(guest.records(stack.apiName).subscribeAll(), denied);
    await assert.rejects(api.update(id, { owner: b.user()?.id }), denied);
    await assert.rejects(api.update(id, { version: 100 }), denied);
    await assert.rejects(api.create({ owner: b.user()?.id, bucket: 'acl', text: 'Forged', payload: {} }), denied);
    await assert.rejects(api.create({ version: 100, bucket: 'acl', text: 'Forged version', payload: {} }), denied);
    await assert.rejects(other.subscribe(id), denied);
    assert.equal((await api.read(id)).text, 'Private');
    await api.delete(id);
  });

  await t.test('filtered real SSE delivers authorized insert/update/delete, cancellation and resubscription', async () => {
    const filters = [{ column: 'bucket', op: 'equal' as const, value: 'events' }];
    const stream = await api.subscribeAll({ filters });
    const reader = stream.getReader();
    try {
      const hidden = await other.create({ bucket: 'events', text: 'Other owner', payload: {} });
      const excluded = await api.create({ bucket: 'excluded', text: 'Wrong filter', payload: {} });
      const id = await api.create({ bucket: 'events', text: '雪 🧭 =?&', payload: {} });
      const first = await bounded(reader.read(), 'SSE insert');
      assert.equal((first.value as { Insert: { id: string } }).Insert.id, id);
      await api.update(id, { text: 'Updated 🧭' });
      assert.equal(((await bounded(reader.read(), 'SSE update')).value as { Update: { text: string } }).Update.text, 'Updated 🧭');
      await api.delete(id);
      assert.equal(((await bounded(reader.read(), 'SSE delete')).value as { Delete: { id: string } }).Delete.id, id);
      await api.delete(excluded);
      await other.delete(hidden);
    } finally {
      await bounded(reader.cancel(), 'SSE cancellation');
      reader.releaseLock();
    }
    const fresh = (await api.subscribeAll({ filters })).getReader();
    try {
      const id = await api.create({ bucket: 'events', text: 'Reconnected', payload: {} });
      const event: Event | undefined = (await bounded(fresh.read(), 'SSE resubscription')).value;
      assert.ok(event && 'Insert' in event);
      assert.equal((event.Insert as { id: string }).id, id);
      await api.delete(id);
    } finally {
      await bounded(fresh.cancel(), 'SSE recancellation');
      fresh.releaseLock();
    }
  });

  await t.test('real SSE remains valid when transport splits every UTF-8 byte', async () => {
    const fragmented = initClient(stack.base, {
      tokens: a.tokens(),
      transport: {
        async fetch(path, options) {
          const response = await fetch(new URL(path, stack.base), options);
          if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) return response;
          // Real backend bytes only: change transport chunk boundaries, never invent API/SSE data.
          const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              for (const byte of chunk) controller.enqueue(Uint8Array.of(byte));
            },
          }));
          return new Response(body, { status: response.status, headers: response.headers });
        },
      },
    });
    const reader = (await fragmented.records(stack.apiName).subscribeAll()).getReader();
    try {
      const id = await api.create({ bucket: 'fragmented', text: 'Line one\n雪 🧭', payload: {} });
      const event = (await bounded(reader.read(), 'fragmented UTF-8 SSE')).value;
      assert.ok(event && 'Insert' in event);
      assert.equal((event.Insert as { text: string }).text, 'Line one\n雪 🧭');
      await api.delete(id);
    } finally {
      await bounded(reader.cancel(), 'fragmented SSE cancellation');
      reader.releaseLock();
    }
  });

  await t.test('authenticated WASM identity, concurrent CAS and rollback of two writes', async () => {
    const id = await api.create({ bucket: 'wasm', text: 'committed', payload: {} });
    const command = (client: typeof a, version: number, recordId = id) => client.fetch('/__capabilities/increment', {
      method: 'POST', body: JSON.stringify({ id: recordId, version }),
    });
    await assert.rejects(command(a, -1), (error: unknown) => error instanceof FetchError && error.status === 400);
    await assert.rejects(command(guest, 0), denied);
    await assert.rejects(command(b, 0), denied);
    const results = await Promise.allSettled([command(a, 0), command(a, 0)]);
    const winners = results.filter(result => result.status === 'fulfilled');
    assert.equal(winners.length, 1);
    assert.deepEqual(await winners[0].value.json(), { version: 1 });
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
    assert.equal((await api.read(id)).version, 1);
    const audit = a.records(stack.auditName);
    assert.equal((await audit.list()).records.length, 1);
    const rollback = await api.create({ bucket: 'wasm', text: 'rollback-probe', payload: {} });
    await assert.rejects(command(a, 0, rollback), (error: unknown) => error instanceof FetchError && error.status === 409);
    assert.equal((await api.read(rollback)).version, 0, 'first write rolls back if second write violates constraint');
    assert.equal((await audit.list()).records.length, 1);
  });

  await t.test('real auth refresh/logout and anonymous identity (not signup/mail acceptance)', async () => {
    assert.equal(await a.refreshAuthToken({ force: true }), true);
    const tokens = a.tokens();
    assert.ok(tokens?.refresh_token);
    assert.equal(await a.logout(), true);
    assert.equal(a.user(), undefined);
    await assert.rejects(a.records(stack.apiName).list(), denied);
    const stale = initClient(stack.base, { tokens });
    await stale.refreshAuthToken({ force: true });
    assert.equal(stale.user(), undefined, 'logged-out refresh token cannot mint a session');
    await guest.loginAnonymously();
    const anonymousId = guest.user()?.id;
    assert.ok(anonymousId);
    assert.equal(await guest.refreshAuthToken({ force: true }), true);
    assert.equal(guest.user()?.id, anonymousId);
    await guest.logout();
    await b.logout();
  });
});
