import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '$env/dynamic/public': resolve('tests/unit/public-env.ts') } },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
