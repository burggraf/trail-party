import { test, expect, extractMailLink, mailBody, signIn, signOut, waitForMail } from './fixtures';

const AUTH_PATH = '/api/auth/v1';

test('isolates six real browser actors and their native identities', async ({ actors }) => {
  const identities = new Set<string>();
  const tokens = new Set<string>();
  const cookieMarkers = new Set<string>();
  for (const [name, actor] of Object.entries(actors)) {
    await signIn(actor.page, actor.account);
    await actor.context.addCookies([{ name: 'e2e-actor-marker', value: name, url: 'http://127.0.0.1:4173' }]);
    await actor.page.evaluate(value => localStorage.setItem('e2e-actor-marker', value), name);
    identities.add(await actor.page.getByTestId('authenticated-user-id').textContent() ?? '');
    tokens.add(await actor.page.evaluate(() => sessionStorage.getItem('trail-party:auth-tokens') ?? ''));
    cookieMarkers.add((await actor.context.cookies()).find(cookie => cookie.name === 'e2e-actor-marker')?.value ?? '');
    expect(await actor.page.evaluate(() => localStorage.getItem('trail-party:auth-tokens'))).toBeNull();
    expect(await actor.page.evaluate(() => localStorage.getItem('e2e-actor-marker'))).toBe(name);
  }
  expect(identities.size).toBe(6);
  expect(identities).not.toContain('');
  expect(tokens.size).toBe(6);
  expect(cookieMarkers).toEqual(new Set(['H', 'A1', 'A2', 'B1', 'B2', 'X']));

  await signOut(actors.H.page);
  await expect(actors.H.page.getByLabel('Email')).toHaveValue('');
  await expect(actors.A1.page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
});

test('completes signup, local verification, browser reset, replacement login and logout', async ({ page, stack }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(stack.signup.email);
  await page.getByLabel('Password', { exact: true }).fill(stack.signup.password);
  await page.getByLabel('Password confirmation', { exact: true }).fill(stack.signup.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Verification pending' })).toBeVisible();

  const verificationMessage = await waitForMail(stack, stack.signup.email);
  const verificationBody = await mailBody(stack, verificationMessage[0].ID);
  const verificationLink = extractMailLink(verificationBody, `${stack.backend}${AUTH_PATH}/verify_email/confirm/`);
  await page.goto(verificationLink);
  await expect(page.getByText('email verified')).toBeVisible();

  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await page.getByLabel('Email').fill(stack.signup.email);
  await page.getByLabel('Password').fill(stack.signup.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Create your profile' })).toBeVisible();
  await page.getByLabel('Display name').fill('Browser signup');
  await page.getByRole('button', { name: 'Create profile' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await signOut(page);

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(stack.signup.email);
  await page.getByRole('button', { name: 'Request reset email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const resetMessage = await waitForMail(stack, stack.signup.email, 2);
  const resetPrefix = `${stack.backend}/_/auth/reset_password/update/`;
  let resetLink = '';
  for (const message of resetMessage) {
    try {
      resetLink = extractMailLink(await mailBody(stack, message.ID), resetPrefix);
      break;
    } catch {
      // The local inbox may return the earlier verification message first.
    }
  }
  expect(resetLink).not.toBe('');
  const replacement = `${stack.signup.password}-replacement`;
  const resetToken = resetLink.slice(resetLink.lastIndexOf('/') + 1);
  await page.goto(`/auth/reset?token=${encodeURIComponent(resetToken)}`);
  await expect(page.getByRole('heading', { name: 'Update password' })).toBeVisible();
  await page.getByPlaceholder('Password', { exact: true }).fill(replacement);
  await page.getByPlaceholder('Password Confirm', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Update Password' }).click();
  await expect(page.getByText('Password reset')).toBeVisible();

  await signIn(page, { ...stack.signup, password: replacement });
  await signOut(page);
});
