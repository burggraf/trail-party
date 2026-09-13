import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RETURN_TO_EXPIRY_KEY,
  RETURN_TO_STORAGE_KEY,
  RETURN_TO_TTL_MS,
  consumeReturnTo,
  storeReturnTo,
  validateReturnTo,
  type StorageLike,
} from '../../src/lib/return-to-origin.ts';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('return-to-origin', () => {
  const storage = new MemoryStorage();
  const now = 1_000_000;
  const validIntents = [
    '/host',
    '/lobby',
    '/join?code=ABC123',
    '/game/ABC123',
    '/game/AAAAAAAAAAAAAAAAAAAAAA==',
    '/controller/018f47d1-8b42-7abc-9def-0123456789ab',
  ];

  for (const intent of validIntents) {
    assert.equal(validateReturnTo(intent), intent, `valid intent was rejected: ${intent}`);
    assert.equal(storeReturnTo(intent, { storage, now: () => now }), intent,
      `valid intent was not stored: ${intent}`);
    assert.equal(consumeReturnTo({ storage, now: () => now }), intent,
      `valid intent was not consumed: ${intent}`);
    assert.equal(consumeReturnTo({ storage, now: () => now }), '/lobby',
      `intent was not consumed once: ${intent}`);
  }

  const rawStored = storage.getItem(RETURN_TO_STORAGE_KEY);
  assert.equal(rawStored, null, 'consuming an intent must remove its storage record');
  assert.equal(storage.getItem(RETURN_TO_EXPIRY_KEY), null, 'consuming an intent must remove its expiry record');

  const invalidIntents = [
    'https://allowed.example/host',
    'https://allowed@evil.example/host',
    '//evil.example/host',
    '/\\evil.example/host',
    '/%2F%2Fevil.example/host',
    '/%252F%252Fevil.example/host',
    '/host#fragment',
    '/host?returnTo=/evil',
    '/host?x=1',
    '/join?code=abc123',
    '/join?code=ABC123&nested=/host',
    '/join?code=ABC123&code=DEF456',
    '/join?code=ABC12',
    '/join?code=ABC123#fragment',
    '/game/foo/bar',
    '/game/',
    '/controller/foo/bar',
    '/game/%2F',
    '/host%23fragment',
    '/host\u0000',
    '/%00',
  ];

  for (const intent of invalidIntents) {
    assert.equal(validateReturnTo(intent), null, `invalid intent was accepted: ${intent}`);
    assert.equal(storeReturnTo(intent, { storage, now: () => now }), null,
      `invalid intent was stored: ${intent}`);
    assert.equal(consumeReturnTo({ storage, now: () => now }), '/lobby',
      `invalid intent did not use the safe fallback: ${intent}`);
  }

  assert.equal(storeReturnTo('/join?code=ABC123', { storage, now: () => now }), '/join?code=ABC123');
  const stored = storage.getItem(RETURN_TO_STORAGE_KEY);
  assert.equal(stored, '/join?code=ABC123',
    'sessionStorage record does not contain only the validated relative path');
  assert.equal(storage.getItem(RETURN_TO_EXPIRY_KEY), String(now + RETURN_TO_TTL_MS),
    'sessionStorage expiry record is missing');
  assert.equal(consumeReturnTo({ storage, now: () => now + RETURN_TO_TTL_MS }), '/lobby',
    'expired intent was consumed');
  assert.equal(consumeReturnTo({ storage, now: () => now + RETURN_TO_TTL_MS }), '/lobby',
    'expired intent was not removed');

  storage.setItem(RETURN_TO_STORAGE_KEY, 'https://allowed@evil.example/host');
  storage.setItem(RETURN_TO_EXPIRY_KEY, String(now + RETURN_TO_TTL_MS));
  assert.equal(consumeReturnTo({ storage, now: () => now }), '/lobby',
    'tampered storage value was followed');
});
