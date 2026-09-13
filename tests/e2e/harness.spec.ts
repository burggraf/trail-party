import { test, expect, signIn } from './fixtures';

test('authorized profile update crosses independent contexts through real SSE', async ({ actors, stack }) => {
  await signIn(actors.H.page, actors.H.account);
  await signIn(actors.A1.page, actors.A1.account);
  await signIn(actors.X.page, actors.X.account);
  await actors.A1.page.goto('/auth');
  await expect(actors.A1.page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await actors.X.page.goto('/auth');
  await expect(actors.X.page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await actors.H.page.goto('/lobby');
  await actors.X.page.goto('/lobby');
  await expect(actors.H.page.getByTestId('profile-sse-ready')).toHaveText('ready');
  await expect(actors.X.page.getByTestId('profile-sse-ready')).toHaveText('ready');
  await expect(actors.H.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveText('Alpha one');
  await expect(actors.X.page.getByTestId(`profile-${actors.H.account.id}`)).toHaveCount(0);
  await expect(actors.X.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveCount(0);

  await actors.X.page.goto('/auth');
  const outsiderUpdateRequest = actors.X.page.waitForRequest(request =>
    request.url().includes('/api/trail-party/profile/update') && request.method() === 'POST');
  await actors.X.page.getByRole('button', { name: 'Edit profile' }).click();
  await actors.X.page.getByLabel('Display name').fill('Outsider live');
  await actors.X.page.getByRole('button', { name: 'Save profile' }).click();
  const outsiderRequest = await outsiderUpdateRequest;
  const outsiderAuthorization = outsiderRequest.headers().authorization ?? '';
  expect(outsiderAuthorization).toMatch(/^Bearer /u);
  await expect(actors.X.page.getByRole('heading', { name: 'Outsider live' })).toBeVisible();

  // The private base collection is a valid protected mutation target, but is never exposed by the public API.
  const forbiddenRead = await actors.X.page.request.get(
    `${stack.frontend}/api/records/v1/profiles/${actors.H.account.id}`,
    { headers: { authorization: outsiderAuthorization } },
  );
  expect(forbiddenRead.status()).toBe(405);
  const forbiddenUpdate = await actors.X.page.request.patch(
    `${stack.frontend}/api/records/v1/profiles/${actors.H.account.id}`,
    {
      headers: { authorization: outsiderAuthorization, 'content-type': 'application/json' },
      data: { display_name: 'forged outsider write' },
    },
  );
  expect(forbiddenUpdate.status()).toBe(405);

  await actors.X.page.goto('/lobby');
  await expect(actors.X.page.getByTestId(`profile-${actors.H.account.id}`)).toHaveCount(0);
  await expect(actors.X.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveCount(0);

  const authorizedUpdateRequest = actors.A1.page.waitForRequest(request =>
    request.url().includes('/api/trail-party/profile/update') && request.method() === 'POST');
  await actors.A1.page.getByRole('button', { name: 'Edit profile' }).click();
  await actors.A1.page.getByLabel('Display name').fill('Alpha one live');
  await actors.A1.page.getByRole('button', { name: 'Save profile' }).click();
  await authorizedUpdateRequest;
  await expect(actors.A1.page.getByRole('heading', { name: 'Alpha one live' })).toBeVisible();
  await expect(actors.H.page.getByTestId('profile-sse-event')).toHaveText(actors.A1.account.id);
  await expect(actors.H.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveText('Alpha one live');
  await expect(actors.X.page.getByTestId(`profile-${actors.A1.account.id}`)).toHaveCount(0);
  await expect(actors.X.page.getByTestId('profile-sse-event')).toHaveText('');
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
