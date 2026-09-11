import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.artifacts/p01-t2/component',
    lib: { entry: 'tests/backend/fixture/component.ts', formats: ['es'], fileName: () => 'index.mjs' },
    rollupOptions: { preserveEntrySignatures: 'strict', external: /^(wasi|trailbase):/ },
  },
});
