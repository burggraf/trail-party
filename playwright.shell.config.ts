import { defineConfig } from '@playwright/test';

// Static, backend-free shell smoke only. P04 owns real multi-user fixtures.
export default defineConfig({
  testDir: './tests/shell',
  outputDir: '.artifacts/shell',
  retries: 0,
  workers: 1,
  forbidOnly: true,
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite preview --config tests/shell/static.config.ts --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
