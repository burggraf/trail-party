import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { initClient } from 'trailbase';
import {
  clearNativeTokens,
  logoutBrowserSession,
  parseNativeTokens,
  persistNativeTokens,
  validateBrowserSession,
} from '../../src/lib/backend/session';

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  return values;
}

describe('native browser session storage boundary', () => {
  it('accepts only the exact native token shape', () => {
    expect(parseNativeTokens({
      auth_token: 'access',
      refresh_token: 'refresh',
      csrf_token: null,
    })).toEqual({ auth_token: 'access', refresh_token: 'refresh', csrf_token: null });
    expect(parseNativeTokens({
      auth_token: 'access',
      refresh_token: 'refresh',
      csrf_token: null,
      role: 'host',
    })).toBeUndefined();
    expect(parseNativeTokens({ auth_token: '', refresh_token: 'refresh', csrf_token: null })).toBeUndefined();
    expect(parseNativeTokens({ auth_token: 'access', refresh_token: 42, csrf_token: null })).toBeUndefined();
    expect(parseNativeTokens({ auth_token: null, refresh_token: 'refresh', csrf_token: null })).toBeUndefined();
  });

  it('persists only native tokens and clears malformed state', () => {
    const values = installStorage();
    expect(persistNativeTokens({ auth_token: 'access', refresh_token: null, csrf_token: null })).toBe(true);
    expect(JSON.parse(values.get('trail-party:auth-tokens') ?? '')).toEqual({
      auth_token: 'access', refresh_token: null, csrf_token: null,
    });
    expect(persistNativeTokens({ auth_token: 'access', refresh_token: 42, csrf_token: null } as never)).toBe(false);
    expect(values.has('trail-party:auth-tokens')).toBe(false);
    clearNativeTokens();
    expect(values.has('trail-party:auth-tokens')).toBe(false);
  });

  it('distinguishes definitive status failure from a retryable backend failure', async () => {
    let status = 401;
    const values = installStorage();
    const nativeTokens = {
      auth_token: 'e30.eyJzdWIiOiJ1c2VyIiwiaWF0IjoxLCJleHAiOjk5OTk5OTk5OTl9.sig',
      refresh_token: null,
      csrf_token: null,
    };
    const server = createServer((_request, response) => {
      response.statusCode = status;
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    try {
      persistNativeTokens(nativeTokens);
      const client = initClient(`http://127.0.0.1:${address.port}`, {
        tokens: { ...nativeTokens, refresh_token: undefined } as never,
      });
      expect((await validateBrowserSession(client)).kind).toBe('invalid');
      expect(client.tokens()).toBeUndefined();
      expect(values.has('trail-party:auth-tokens')).toBe(false);

      status = 503;
      persistNativeTokens(nativeTokens);
      const retryable = initClient(`http://127.0.0.1:${address.port}`, {
        tokens: { ...nativeTokens, refresh_token: undefined } as never,
      });
      expect((await validateBrowserSession(retryable)).kind).toBe('unavailable');
      expect(retryable.tokens()).toBeDefined();
      expect(values.has('trail-party:auth-tokens')).toBe(true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('clears local session state when logout transport fails', async () => {
    const values = installStorage();
    const nativeTokens = {
      auth_token: 'e30.eyJzdWIiOiJ1c2VyIiwiaWF0IjoxLCJleHAiOjk5OTk5OTk5OTl9.sig',
      refresh_token: null,
      csrf_token: null,
    };
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      persistNativeTokens(nativeTokens);
      const client = initClient(`http://127.0.0.1:${address.port}`, {
        tokens: { ...nativeTokens, refresh_token: undefined } as never,
      });
      const result = await logoutBrowserSession(client);
      expect(result.serverConfirmed).toBe(false);
      expect(result.error).toBeTruthy();
      expect(client.tokens()).toBeUndefined();
      expect(values.has('trail-party:auth-tokens')).toBe(false);
    } finally {
      clearNativeTokens();
    }
  });
});
