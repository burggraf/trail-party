import { defineConfig } from 'trailbase-wasm';
import { Transaction } from 'trailbase-wasm/db';
import { HttpError, HttpHandler, HttpResponse, type HttpRequest } from 'trailbase-wasm/http';

const MAX_BODY_BYTES = 2048;
const MAX_PROFILE_AGE_SECONDS = 24 * 60 * 60;
const MAX_PROFILE_FUTURE_SECONDS = 60;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROFILE_FIELDS = ['display_name', 'operation_id', 'issued_at'];
const encoder = new TextEncoder();

function invalidCommand(): never {
  throw new HttpError(400, 'Invalid profile command');
}

function parseCommand(req: HttpRequest): { displayName: string; operationId: string; issuedAt: number } {
  const body = req.body();
  if (!body || body.byteLength > MAX_BODY_BYTES) invalidCommand();

  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    invalidCommand();
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidCommand();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== PROFILE_FIELDS.length
      || PROFILE_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(value, field))) {
    invalidCommand();
  }

  const displayName = value.display_name;
  const operationId = value.operation_id;
  const issuedAt = value.issued_at;
  if (typeof displayName !== 'string' || typeof operationId !== 'string'
      || typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt < 0
      || hasControlCharacters(displayName)) {
    invalidCommand();
  }
  const normalizedName = displayName.trim();
  if (Array.from(normalizedName).length < 1 || Array.from(normalizedName).length > 80) invalidCommand();
  if (!UUID_V7.test(operationId)) invalidCommand();

  const timestampMilliseconds = Number.parseInt(`${operationId.slice(0, 8)}${operationId.slice(9, 13)}`, 16);
  const operationSeconds = Math.floor(timestampMilliseconds / 1000);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (operationSeconds !== issuedAt
      || issuedAt < nowSeconds - MAX_PROFILE_AGE_SECONDS
      || issuedAt > nowSeconds + MAX_PROFILE_FUTURE_SECONDS) {
    invalidCommand();
  }
  return { displayName: normalizedName, operationId, issuedAt };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

// SHA-256 is kept local so the audit request hash is deterministic across
// component invocations and does not depend on a Node-only crypto import.
function sha256(input: Uint8Array): Uint8Array {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = Math.floor(bitLength / 2 ** (index * 8)) & 0xff;
  }

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (padded[position] << 24) | (padded[position + 1] << 16)
        | (padded[position + 2] << 8) | padded[position + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + s1 + choose + constants[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => {
    digest[index * 4] = value >>> 24;
    digest[index * 4 + 1] = value >>> 16;
    digest[index * 4 + 2] = value >>> 8;
    digest[index * 4 + 3] = value;
  });
  return digest;
}

function concatenate(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function hmacSha256(key: Uint8Array, input: Uint8Array): Uint8Array {
  const normalizedKey = key.length > 64 ? sha256(key) : key;
  const innerPad = new Uint8Array(64);
  const outerPad = new Uint8Array(64);
  innerPad.fill(0x36);
  outerPad.fill(0x5c);
  for (let index = 0; index < normalizedKey.length; index += 1) {
    innerPad[index] ^= normalizedKey[index];
    outerPad[index] ^= normalizedKey[index];
  }
  return sha256(concatenate(outerPad, sha256(concatenate(innerPad, input))));
}

function auditHmacKey(tx: Transaction): Uint8Array {
  const name = 'trail-party/audit/request-hmac/v1';
  let rows = tx.query('SELECT value FROM server_secrets WHERE name = ?1', [name]);
  if (rows.length === 0) {
    const key = new Uint8Array(32);
    const random = globalThis.crypto?.getRandomValues;
    if (!random) throw new Error('Secure randomness is unavailable');
    random.call(globalThis.crypto, key);
    tx.execute('INSERT OR IGNORE INTO server_secrets (name, value) VALUES (?1, ?2)', [name, key]);
    rows = tx.query('SELECT value FROM server_secrets WHERE name = ?1', [name]);
  }
  const value = rows[0]?.[0];
  if (!value || typeof value !== 'object' || typeof (value as { length?: unknown }).length !== 'number') {
    throw new Error('Invalid audit HMAC key');
  }
  const key = Uint8Array.from(value as ArrayLike<number>);
  if (key.length !== 32) throw new Error('Invalid audit HMAC key');
  return key;
}

function requestHash(tx: Transaction, userId: string, displayName: string, operationId: string, issuedAt: number): Uint8Array {
  const canonical = encoder.encode(`trail-party/profile/create\u0000${userId}\u0000${displayName}\u0000${operationId}\u0000${issuedAt}`);
  return hmacSha256(auditHmacKey(tx), canonical);
}

function safeInteger(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid profile projection');
  return number;
}

type Profile = {
  id: string;
  display_name: string;
  avatar_mime: string | null;
  avatar_revision: number;
  version: number;
  updated_at: number;
};

function profileFromRow(row: unknown[], id: string): Profile {
  if (row.length !== 6 || typeof row[1] !== 'string'
      || (row[2] !== null && typeof row[2] !== 'string')) {
    throw new Error('Invalid profile projection');
  }
  return {
    id,
    display_name: row[1],
    avatar_mime: row[2],
    avatar_revision: safeInteger(row[3]),
    version: safeInteger(row[4]),
    updated_at: safeInteger(row[5]),
  };
}

function readOwnProfile(tx: Transaction, userId: string): Profile | null {
  const rows = tx.query(
    'SELECT id, display_name, avatar_mime, avatar_revision, version, updated_at FROM profiles_public WHERE id = base64_url_safe(?1)',
    [userId],
  );
  const row = rows[0];
  return row ? profileFromRow(row, userId) : null;
}

function createProfile(req: HttpRequest): HttpResponse {
  const user = req.user();
  if (!user) throw new HttpError(401, 'Authentication required');
  const command = parseCommand(req);
  const tx = new Transaction();
  let committed = false;
  try {
    const hash = requestHash(tx, user.id, command.displayName, command.operationId, command.issuedAt);
    const verified = tx.query(
      'SELECT id FROM _user WHERE id = base64_url_safe(?1) AND email IS NOT NULL AND unverified_email IS NULL',
      [user.id],
    );
    if (verified.length !== 1) throw new HttpError(401, 'Verified authentication required');

    const prior = tx.query(
      'SELECT request_hash = ?3, entity_type, entity_id, action, outcome FROM audit_events WHERE actor_user_id = base64_url_safe(?1) AND operation_id = ?2',
      [user.id, command.operationId, hash],
    )[0];
    if (prior) {
      if (Number(prior[0]) === 1
          && prior[1] === 'profile' && prior[2] === user.id && prior[3] === 'create' && prior[4] === 'success') {
        const existing = readOwnProfile(tx, user.id);
        if (!existing) throw new HttpError(409, 'Profile command cannot be replayed');
        tx.rollback();
        return HttpResponse.json(existing);
      }
      throw new HttpError(409, 'Profile operation conflict');
    }

    if (readOwnProfile(tx, user.id)) throw new HttpError(409, 'Profile already exists');
    if (tx.execute(
      'INSERT INTO profiles (id, display_name) VALUES (base64_url_safe(?1), ?2)',
      [user.id, command.displayName],
    ) !== 1) throw new Error('Profile insert was not applied');
    if (tx.execute(
      'INSERT INTO audit_events (actor_user_id, operation_id, entity_type, entity_id, action, request_hash, after_version, outcome) VALUES (base64_url_safe(?1), ?2, ?3, ?4, ?5, ?6, 0, ?7)',
      [user.id, command.operationId, 'profile', user.id, 'create', hash, 'success'],
    ) !== 1) throw new Error('Profile audit was not applied');
    const profile = readOwnProfile(tx, user.id);
    if (!profile) throw new Error('Profile insert was not readable');
    tx.commit();
    committed = true;
    return HttpResponse.json(profile);
  } catch (error) {
    if (!committed) tx.rollback();
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, 'Profile command rejected');
  }
}

export const { initEndpoint, incomingHandler, sqliteFunctionEndpoint } = defineConfig({
  httpHandlers: [HttpHandler.post('/api/trail-party/profile', createProfile)],
});
