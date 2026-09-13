export const RETURN_TO_STORAGE_KEY = 'trail-party:return-to';
export const RETURN_TO_EXPIRY_KEY = `${RETURN_TO_STORAGE_KEY}:expires`;
export const RETURN_TO_TTL_MS = 30 * 60 * 1000;
export const RETURN_TO_FALLBACK = '/lobby';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Clock = () => number;

type ReturnToOptions = {
  storage?: StorageLike;
  now?: Clock;
};

function sessionStorage(): StorageLike | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function safeStorage(options: ReturnToOptions): StorageLike | undefined {
  return options.storage ?? sessionStorage();
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function safeRemove(storage: StorageLike | undefined): void {
  try {
    storage?.removeItem(RETURN_TO_STORAGE_KEY);
    storage?.removeItem(RETURN_TO_EXPIRY_KEY);
  } catch {
    // Storage can be unavailable or quota-limited; callers use the safe fallback.
  }
}

/** Return the canonical same-origin route, or null for an untrusted target. */
export function validateReturnTo(input: string | null | undefined): string | null {
  if (typeof input !== 'string' || input.length === 0 || hasControlCharacters(input)) {
    return null;
  }
  // Do not let URL parsing reinterpret encoded separators, controls, or a second
  // encoded URL. Approved IDs and join codes do not need percent encoding.
  if (input.includes('\\') || input.includes('%') || !input.startsWith('/') || input.startsWith('//')) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(input, 'https://trail-party.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://trail-party.invalid' || url.username || url.password || url.hash) {
    return null;
  }

  if (url.pathname === '/host' || url.pathname === '/lobby') {
    return url.search === '' && input === url.pathname ? url.pathname : null;
  }
  if (url.pathname === '/join') {
    const entries = [...url.searchParams.entries()];
    const code = entries.length === 1 && entries[0]?.[0] === 'code' ? entries[0][1] : undefined;
    const path = code && /^[A-Z0-9]{6}$/u.test(code) ? `/join?code=${code}` : null;
    return path && input === path ? path : null;
  }

  const match = url.pathname.match(/^\/(game|controller)\/([A-Za-z0-9_-]+={0,2})$/u);
  const path = match ? `/${match[1]}/${match[2]}` : null;
  return path && input === path ? path : null;
}

export function storeReturnTo(input: string | null | undefined, options: ReturnToOptions = {}): string | null {
  const path = validateReturnTo(input);
  const storage = safeStorage(options);
  if (path === null) {
    safeRemove(storage);
    return null;
  }
  if (!storage) return null;

  const now = options.now ?? Date.now;
  const expiresAt = now() + RETURN_TO_TTL_MS;
  try {
    storage.setItem(RETURN_TO_STORAGE_KEY, path);
    storage.setItem(RETURN_TO_EXPIRY_KEY, String(expiresAt));
    return path;
  } catch {
    safeRemove(storage);
    return null;
  }
}

export function consumeReturnTo(options: ReturnToOptions = {}): string {
  const storage = safeStorage(options);
  if (!storage) return RETURN_TO_FALLBACK;

  let rawPath: string | null;
  let rawExpiry: string | null;
  try {
    rawPath = storage.getItem(RETURN_TO_STORAGE_KEY);
    rawExpiry = storage.getItem(RETURN_TO_EXPIRY_KEY);
  } catch {
    safeRemove(storage);
    return RETURN_TO_FALLBACK;
  }
  // Consumption is one-shot even when the stored value is malformed or expired.
  safeRemove(storage);
  if (rawPath === null || rawExpiry === null) return RETURN_TO_FALLBACK;

  const expiresAt = Number(rawExpiry);
  const now = options.now ?? Date.now;
  if (!Number.isFinite(expiresAt) || expiresAt <= now()) return RETURN_TO_FALLBACK;
  return validateReturnTo(rawPath) ?? RETURN_TO_FALLBACK;
}
