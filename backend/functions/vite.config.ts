import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.artifacts/p02-t2/application',
    lib: { entry: 'backend/functions/profile.ts', formats: ['es'], fileName: () => 'index.mjs' },
    rollupOptions: { preserveEntrySignatures: 'strict', external: /^(wasi|trailbase):/ },
  },
});
