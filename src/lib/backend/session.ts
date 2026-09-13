import { env } from '$env/dynamic/public';
import { FetchError, initClient, type Client, type Tokens, type User } from 'trailbase';

export const AUTH_TOKENS_STORAGE_KEY = 'trail-party:auth-tokens';
export const AUTH_STATUS_PATH = '/api/auth/v1/status';
export const AUTH_LOGOUT_PATH = '/api/auth/v1/logout';

export type SessionValidation =
  | { kind: 'anonymous'; client: Client }
  | { kind: 'authenticated'; client: Client; user: User }
  | { kind: 'invalid'; client: Client; status?: number }
  | { kind: 'unavailable'; client: Client; error: unknown; status?: number };

export type LogoutResult = {
  serverConfirmed: boolean;
  status?: number;
  error?: unknown;
};

function getSessionStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function isTokenPart(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Accept only the native TrailBase token object; never persist arbitrary JSON. */
export function parseNativeTokens(value: unknown): Tokens | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'auth_token,csrf_token,refresh_token') return undefined;
  if (!isTokenPart(record.auth_token)) return undefined;
  if (record.refresh_token !== null && !isTokenPart(record.refresh_token)) return undefined;
  if (record.csrf_token !== null && !isTokenPart(record.csrf_token)) return undefined;
  return {
    auth_token: record.auth_token,
    refresh_token: record.refresh_token,
    csrf_token: record.csrf_token,
  };
}

function readNativeTokens(): Tokens | undefined {
  const storage = getSessionStorage();
  if (!storage) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(AUTH_TOKENS_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const tokens = parseNativeTokens(JSON.parse(raw));
    if (tokens) return tokens;
  } catch {
    // A malformed browser value is not a session.
  }
  clearNativeTokens();
  return undefined;
}

export function clearNativeTokens(): void {
  try {
    getSessionStorage()?.removeItem(AUTH_TOKENS_STORAGE_KEY);
  } catch {
    // Storage can be unavailable or quota-limited.
  }
}

export function persistNativeTokens(tokens: Tokens | undefined): boolean {
  const parsed = parseNativeTokens(tokens);
  if (!parsed) {
    clearNativeTokens();
    return false;
  }
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(AUTH_TOKENS_STORAGE_KEY, JSON.stringify(parsed));
    return true;
  } catch {
    clearNativeTokens();
    return false;
  }
}

function backendUrl(): string {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const configured = env.PUBLIC_TRAILBASE_URL?.trim();
  if (!configured) return origin;
  try {
    return new URL(configured, origin).toString();
  } catch {
    return origin;
  }
}

function createAuthChangeHandler() {
  return (changed: Client): void => {
    const tokens = changed.tokens();
    if (tokens) persistNativeTokens(tokens);
    else clearNativeTokens();
  };
}

export function createBrowserClient(): Client {
  const onAuthChange = createAuthChangeHandler();
  const tokens = readNativeTokens();
  if (tokens) {
    try {
      return initClient(backendUrl(), { tokens, onAuthChange });
    } catch {
      // initClient decodes the native JWT. A structurally valid but undecodable
      // value is still not a usable session, so discard it before retrying.
      clearNativeTokens();
    }
  }
  return initClient(backendUrl(), { onAuthChange });
}

function definitiveStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function clearInvalidClient(client: Client): Promise<void> {
  clearNativeTokens();
  // The SDK clears its in-memory state even when the native logout request is
  // unavailable; its boolean result is intentionally not used as proof here.
  await client.logout();
  clearNativeTokens();
}

/** Validate native status before any protected profile request. */
export async function validateBrowserSession(client: Client): Promise<SessionValidation> {
  if (!client.tokens()) return { kind: 'anonymous', client };
  try {
    const response = await client.fetch(AUTH_STATUS_PATH, {
      method: 'GET',
      throwOnError: false,
    });
    if (!response.ok) {
      if (definitiveStatus(response.status)) {
        await clearInvalidClient(client);
        return { kind: 'invalid', client, status: response.status };
      }
      return { kind: 'unavailable', client, status: response.status, error: response.statusText };
    }

    let status: unknown;
    try {
      status = await response.json();
    } catch (error) {
      return { kind: 'unavailable', client, error, status: response.status };
    }
    const statusRecord = status && typeof status === 'object' && !Array.isArray(status)
      ? status as Record<string, unknown>
      : undefined;
    if (!statusRecord || !isTokenPart(statusRecord.auth_token) || !client.tokens() || !client.user()) {
      await clearInvalidClient(client);
      return { kind: 'invalid', client, status: response.status };
    }
    persistNativeTokens(client.tokens());
    return { kind: 'authenticated', client, user: client.user()! };
  } catch (error) {
    if (error instanceof FetchError && definitiveStatus(error.status)) {
      await clearInvalidClient(client);
      return { kind: 'invalid', client, status: error.status };
    }
    return {
      kind: 'unavailable',
      client,
      error,
      status: error instanceof FetchError ? error.status : undefined,
    };
  }
}

/** Clear local state regardless of transport outcome, while reporting the native result. */
export async function logoutBrowserSession(client: Client): Promise<LogoutResult> {
  let serverConfirmed = false;
  let status: number | undefined;
  let error: unknown;
  try {
    const tokens = client.tokens();
    const response = await client.fetch(AUTH_LOGOUT_PATH, tokens?.refresh_token
      ? {
        method: 'POST',
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
        throwOnError: false,
      }
      : { method: 'GET', throwOnError: false });
    status = response.status;
    serverConfirmed = response.ok;
  } catch (caught) {
    error = caught;
    status = caught instanceof FetchError ? caught.status : undefined;
  }
  await client.logout();
  clearNativeTokens();
  return { serverConfirmed, status, error };
}
