import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { FetchError, initClient, type Client } from 'trailbase';
import { startStack } from './stack.ts';

const AUTH_PATH = '/api/auth/v1';
const SAFE_PROFILE_FIELDS = ['avatar_mime', 'avatar_revision', 'display_name', 'id', 'updated_at', 'version'];
const DENIED_STATUSES = [400, 401, 403, 404, 405];

type Check = () => Promise<void>;

function describeFailure(error: unknown): string {
  if (error instanceof FetchError) return `HTTP ${error.status}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function runNamedCheck(
  name: string,
  check: Check,
  failures: string[],
) {
  try {
    await check();
  } catch (error) {
    failures.push(`${name}: ${describeFailure(error)}`);
  }
}

function uuidV7(): string {
  const value = randomBytes(16);
  const timestamp = BigInt(Date.now());
  value[0] = Number(timestamp >> 40n) & 0xff;
  value[1] = Number(timestamp >> 32n) & 0xff;
  value[2] = Number(timestamp >> 24n) & 0xff;
  value[3] = Number(timestamp >> 16n) & 0xff;
  value[4] = Number(timestamp >> 8n) & 0xff;
  value[5] = Number(timestamp) & 0xff;
  value[6] = (value[6] & 0x0f) | 0x70;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function responseBody(response: Response): Promise<string> {
  return (await response.text()).trim();
}

async function expectStatus(response: Response, expected: number, label: string) {
  assert.equal(response.status, expected, `${label}: unexpected HTTP status`);
}

async function expectDenied(operation: () => Promise<unknown>, expected: number, label: string) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof FetchError, `${label}: expected native FetchError`);
  assert.equal(error.status, expected, `${label}: unexpected HTTP status`);
}

async function nativeRequest(
  client: Client,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return client.fetch(path, { ...init, throwOnError: false });
}

function extractLink(body: string, prefix: string, label: string): string {
  const start = body.indexOf(prefix);
  assert.ok(start >= 0, `${label}: real local message does not contain the measured link`);
  const token = body.slice(start + prefix.length).match(/^[A-Za-z0-9._~-]+/)?.[0];
  assert.ok(token, `${label}: measured link has no token`);
  return `${prefix}${token}`;
}

function assertSafeProfile(value: unknown, label: string) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: result is not an object`);
  const result = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(result).sort(), [...SAFE_PROFILE_FIELDS].sort(),
    `${label}: result exposes a private or unexpected field`);
}

test('auth-local-mail', { timeout: 120000 }, async t => {
  const stack = await startStack({ source: 'auth' });
  t.after(() => stack.close());
  assert.ok(stack.mailpit, 'auth-local-mail: owned Mailpit is unavailable');

  const mailpit = stack.mailpit;
  const email = `auth-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const replacementPassword = randomBytes(24).toString('base64url');
  const pending = initClient(stack.base);
  const failures: string[] = [];
  let pendingVerificationLink = '';
  let verifiedClient: Client | undefined;
  let refreshToken = '';
  let refreshedTokens: NonNullable<ReturnType<Client['tokens']>> | undefined;

  await runNamedCheck('register-pending-no-session', async () => {
    await pending.register({ email, password, passwordRepeat: password });
    assert.equal(pending.user(), undefined, 'register-pending-no-session: registration created an auth user session');
    assert.equal(pending.tokens(), undefined, 'register-pending-no-session: registration returned native tokens');
    const status = await nativeRequest(pending, `${AUTH_PATH}/status`, { method: 'GET' });
    await expectStatus(status, 200, 'register-pending-no-session status');
    const statusBody = await status.json() as { auth_token?: unknown; refresh_token?: unknown; csrf_token?: unknown };
    assert.equal(statusBody.auth_token, null, 'register-pending-no-session status returned an auth token');
    assert.equal(statusBody.refresh_token, null, 'register-pending-no-session status returned a refresh token');
    await expectDenied(
      () => pending.records('profiles_public').list(),
      403,
      'register-pending-no-session protected access',
    );
    const messages = await mailpit.waitForMessages(email, 1);
    assert.equal(messages.length, 1, 'register-pending-no-session: registration must deliver exactly one local message');
    const message = messages[0];
    assert.ok(message?.ID, 'register-pending-no-session: local message has no ID');
    const detail = await mailpit.message(message.ID);
    const body = detail.HTML ?? detail.Text ?? '';
    assert.match(body, new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'register-pending-no-session: local message recipient is missing');
    pendingVerificationLink = extractLink(body, `${stack.base}${AUTH_PATH}/verify_email/confirm/`,
      'register-pending-no-session');
  }, failures);

  await runNamedCheck('login-verified-only', async () => {
    await expectDenied(
      () => initClient(stack.base).login(email, password),
      401,
      'login-verified-only',
    );
  }, failures);

  await runNamedCheck('resend-delivers-local-link', async () => {
    // v0.33.14's trigger resolves only the verified `email` column; the pending
    // registration keeps its original token and intentionally receives no resend.
    const verifiedAccount = stack.accounts[0];
    assert.ok(verifiedAccount, 'resend-delivers-local-link: synthetic verified account is unavailable');
    await mailpit.clearMessages();
    const resend = await nativeRequest(pending,
      `${AUTH_PATH}/verify_email/trigger?email=${encodeURIComponent(verifiedAccount.email)}`,
      { method: 'GET' });
    await expectStatus(resend, 200, 'resend-delivers-local-link');
    assert.equal(await responseBody(resend), 'Verification email sent',
      'resend-delivers-local-link: native success message changed');
    const messages = await mailpit.waitForMessages(verifiedAccount.email, 1);
    assert.equal(messages.length, 1, 'resend-delivers-local-link: resend must deliver exactly one new local message');
    const message = messages[0];
    assert.ok(message?.ID, 'resend-delivers-local-link: local message has no ID');
    const detail = await mailpit.message(message.ID);
    const body = detail.HTML ?? detail.Text ?? '';
    assert.match(body, new RegExp(verifiedAccount.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'resend-delivers-local-link: local message recipient is missing');
    const resendLink = extractLink(
      body,
      `${stack.base}${AUTH_PATH}/verify_email/confirm/`,
      'resend-delivers-local-link',
    );
    assert.ok(resendLink, 'resend-delivers-local-link: no real verification link was extracted');
  }, failures);

  await runNamedCheck('verify-reused-link', async () => {
    assert.ok(pendingVerificationLink, 'verify-reused-link: no real link was extracted from Mailpit');
    const first = await fetch(pendingVerificationLink, { redirect: 'manual' });
    await expectStatus(first, 200, 'verify-reused-link first consume');
    assert.equal(await responseBody(first), 'email verified', 'verify-reused-link first consume message changed');
    const reused = await fetch(pendingVerificationLink, { redirect: 'manual' });
    assert.ok(DENIED_STATUSES.includes(reused.status),
      `verify-reused-link: reused native link was not rejected (HTTP ${reused.status})`);
    verifiedClient = initClient(stack.base);
    const challenge = await verifiedClient.login(email, password);
    assert.equal(challenge, undefined, 'verify-reused-link: verified login returned an MFA challenge');
    const identity = verifiedClient.user()?.id;
    assert.ok(identity, 'verify-reused-link: verified login returned no native identity');
    assert.ok(!stack.profileIds.includes(identity), 'verify-reused-link: signup identity reused a fixture actor');
  }, failures);

  await runNamedCheck('status-gates-restored-session', async () => {
    assert.ok(verifiedClient, 'status-gates-restored-session: verified client is unavailable');
    const tokens = verifiedClient.tokens();
    assert.ok(tokens?.refresh_token, 'status-gates-restored-session: verified client has no refresh token');
    const restored = initClient(stack.base, { tokens });
    const status = await nativeRequest(restored, `${AUTH_PATH}/status`, { method: 'GET' });
    await expectStatus(status, 200, 'status-gates-restored-session');
    assert.equal(restored.user()?.id, verifiedClient.user()?.id,
      'status-gates-restored-session: restored identity changed');
  }, failures);

  await runNamedCheck('reset-local-link-single-use', async () => {
    assert.ok(verifiedClient, 'reset-local-link-single-use: verified client is unavailable');
    await mailpit.clearMessages();
    const request = await nativeRequest(verifiedClient, `${AUTH_PATH}/reset_password/request`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    await expectStatus(request, 200, 'reset-local-link-single-use request');
    assert.equal(await responseBody(request), 'Password reset email sent',
      'reset-local-link-single-use: native request success message changed');
    const messages = await mailpit.waitForMessages(email, 1);
    assert.equal(messages.length, 1, 'reset-local-link-single-use: reset must deliver exactly one local message');
    const message = messages[0];
    assert.ok(message?.ID, 'reset-local-link-single-use: local message has no ID');
    const detail = await mailpit.message(message.ID);
    const resetLink = extractLink(
      detail.HTML ?? detail.Text ?? '',
      `${stack.base}/_/auth/reset_password/update/`,
      'reset-local-link-single-use',
    );
    const resetToken = resetLink.slice(`${stack.base}/_/auth/reset_password/update/`.length);
    const updateBody = JSON.stringify({
      password: replacementPassword,
      password_repeat: replacementPassword,
      password_reset_token: resetToken,
    });
    const update = await nativeRequest(verifiedClient, `${AUTH_PATH}/reset_password/update`, {
      method: 'POST',
      body: updateBody,
    });
    await expectStatus(update, 200, 'reset-local-link-single-use update');
    assert.equal(await responseBody(update), 'Password reset',
      'reset-local-link-single-use: native update success message changed');
    await expectDenied(
      () => initClient(stack.base).login(email, password),
      401,
      'reset-local-link-single-use old login',
    );
    const replacement = initClient(stack.base);
    await replacement.login(email, replacementPassword);
    assert.equal(replacement.user()?.id, verifiedClient.user()?.id,
      'reset-local-link-single-use: password reset changed native identity');
    const reused = await nativeRequest(replacement, `${AUTH_PATH}/reset_password/update`, {
      method: 'POST',
      body: updateBody,
    });
    assert.ok(DENIED_STATUSES.includes(reused.status),
      `reset-local-link-single-use: reused native reset link was not rejected (HTTP ${reused.status})`);
    await replacement.logout();
  }, failures);

  await runNamedCheck('profile-command-present', async () => {
    assert.ok(verifiedClient, 'profile-command-present: verified client is unavailable');
    const issuedAt = Math.floor(Date.now() / 1000);
    const operationId = uuidV7();
    const body = { display_name: 'red-check profile', operation_id: operationId, issued_at: issuedAt };
    assert.deepEqual(Object.keys(body).sort(), ['display_name', 'issued_at', 'operation_id'],
      'profile-command-present: request includes caller-controlled identity');
    const response = await nativeRequest(verifiedClient, '/api/trail-party/profile', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await expectStatus(response, 200, 'profile-command-present');
    const result = await response.json() as unknown;
    assertSafeProfile(result, 'profile-command-present');
  }, failures);

  await runNamedCheck('refresh-retains-identity', async () => {
    assert.ok(verifiedClient, 'refresh-retains-identity: verified client is unavailable');
    const identity = verifiedClient.user()?.id;
    const before = verifiedClient.tokens();
    assert.ok(identity && before?.refresh_token, 'refresh-retains-identity: session identity or refresh token missing');
    refreshToken = before.refresh_token;
    assert.equal(await verifiedClient.refreshAuthToken({ force: true }), true,
      'refresh-retains-identity: native refresh did not succeed');
    assert.equal(verifiedClient.user()?.id, identity,
      'refresh-retains-identity: forced native refresh changed identity');
    refreshedTokens = verifiedClient.tokens();
    assert.ok(refreshedTokens?.refresh_token, 'refresh-retains-identity: refreshed session lost refresh token');
  }, failures);

  await runNamedCheck('logout-revokes-refresh', async () => {
    assert.ok(verifiedClient && refreshToken && refreshedTokens,
      'logout-revokes-refresh: refresh state is unavailable');
    const logout = await nativeRequest(verifiedClient, `${AUTH_PATH}/logout`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    await expectStatus(logout, 200, 'logout-revokes-refresh native logout');
    const rejectedRefresh = await fetch(`${stack.base}${AUTH_PATH}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.ok(DENIED_STATUSES.includes(rejectedRefresh.status),
      `logout-revokes-refresh: revoked refresh token was accepted (HTTP ${rejectedRefresh.status})`);
    await verifiedClient.logout();
  }, failures);

  assert.deepEqual(failures, [], `auth-local-mail named assertion failures:\n${failures.join('\n')}`);
});
