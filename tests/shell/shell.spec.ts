import { expect, test } from '@playwright/test';

test.beforeAll(async ({ browser }) => {
  console.log(`Shell browser: Chrome ${browser.version()} (Playwright chrome channel)`);
});

// F01/F28, P01.C1: shell only; no auth/gameplay parity claim.
test('entry navigation and persisted light/dark/system theme at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trail Party', exact: true })).toBeVisible();
  const theme = page.getByRole('combobox', { name: 'Theme' });
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await theme.selectOption('system');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await theme.selectOption('light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const host = page.getByRole('link', { name: 'Host a game' });
  const box = await host.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await host.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/auth\?role=host$/);
  await expect(page.getByRole('heading', { name: 'Host sign in' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Join a game' }).click();
  await expect(page).toHaveURL(/\/auth\?role=player$/);
  await expect(page.getByRole('heading', { name: 'Player sign in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('seven browser contexts isolate preferences (not yet authenticated users)', async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 7 }, () => browser.newContext({ colorScheme: 'light' })));
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all(pages.map(page => page.goto(`${baseURL}/`)));
    await pages[0].getByRole('combobox', { name: 'Theme' }).selectOption('dark');
    await expect(pages[0].locator('html')).toHaveClass(/dark/);
    for (const page of pages.slice(1)) {
      await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('system');
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
    const sameUserTab = await contexts[0].newPage();
    await sameUserTab.goto(`${baseURL}/`);
    await expect(sameUserTab.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('auth and display deep links reload without native globals or browser errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/auth?role=host');
  await expect(page.getByRole('heading', { name: 'Host sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Host sign in' })).toBeVisible();
  await page.goto('/display');
  await expect(page.getByRole('heading', { name: 'Trail Party Display' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Trail Party Display' })).toBeVisible();
  expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window)).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('display.png'), fullPage: true });
});
