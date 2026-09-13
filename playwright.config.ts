import { defineConfig } from '@playwright/test';

const chromeExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE?.trim();
const chromiumUse = chromeExecutable
  ? { launchOptions: { executablePath: chromeExecutable } }
  : { channel: 'chrome' as const };

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.artifacts/e2e/test-results',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  forbidOnly: true,
  fullyParallel: false,
  reporter: [['line'], ['json', { outputFile: '.artifacts/e2e/results.json' }]],
  globalSetup: './scripts/e2e-global-setup.mjs',
  use: {
    ...chromiumUse,
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.PLAYWRIGHT_VIDEO === '1' ? 'retain-on-failure' : 'off',
  },
  projects: [{ name: 'chromium', use: {} }],
});
