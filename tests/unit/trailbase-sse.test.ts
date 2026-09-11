import { expect, test } from 'vitest';
import { initClient } from 'trailbase';

// Parser-only unit input. Real backend acceptance is tests/backend/capabilities.test.ts.
test('SDK onLoss retains sequence state across stream chunks', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"Insert":{"id":1},"seq":1}\n\n'));
      controller.enqueue(encoder.encode('data: {"Insert":{"id":2},"seq":3}\n\n'));
      controller.close();
    },
  });
  const client = initClient('http://127.0.0.1:1', {
    transport: { fetch: async () => new Response(body) },
  });
  let losses = 0;
  const reader = (await client.records('unit').subscribeAll({ onLoss: () => losses++ })).getReader();
  expect((await reader.read()).value).toEqual({ Insert: { id: 1 }, seq: 1 });
  expect((await reader.read()).value).toEqual({ Insert: { id: 2 }, seq: 3 });
  expect((await reader.read()).done).toBe(true);
  reader.releaseLock();
  expect(losses).toBe(1);
});
