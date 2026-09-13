import { test, expect, signIn } from './fixtures';

test('authorized profile update crosses independent contexts through real SSE', async ({ actors }) => {
  await signIn(actors.H.page, actors.H.account);
  await signIn(actors.A1.page, actors.A1.account);
  await actors.A1.page.goto('/auth');
  await expect(actors.A1.page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await actors.H.page.goto('/lobby');
  await expect(actors.H.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveText('Alpha one');

  await actors.A1.page.getByRole('button', { name: 'Edit profile' }).click();
  await actors.A1.page.getByLabel('Display name').fill('Alpha one live');
  await actors.A1.page.getByRole('button', { name: 'Save profile' }).click();
  await expect(actors.A1.page.getByRole('heading', { name: 'Alpha one live' })).toBeVisible();
  await expect(actors.H.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveText('Alpha one live');

  await actors.X.page.goto('/auth');
  const unauthenticatedMutation = await actors.X.page.evaluate(async () => {
    const response = await fetch('/api/trail-party/profile/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'forged', operation_id: '00000000-0000-7000-8000-000000000000', issued_at: 0, expected_version: 0 }),
    });
    return response.status;
  });
  expect(unauthenticatedMutation).toBe(401);
  await expect(actors.H.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveText('Alpha one live');
});

test('display actor remains a separate context and does not inherit browser auth', async ({ browser, stack }) => {
  const display = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const page = await display.newPage();
  try {
    await page.goto('/display');
    await expect(page.getByRole('heading', { name: 'Trail Party Display' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('trail-party:auth-tokens'))).toBeNull();
    expect(stack.backend).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  } finally {
    await display.close();
  }
});
