import { defineConfig } from 'vite';

// Serve only adapter-static's output, without Kit's SSR preview middleware.
export default defineConfig({ build: { outDir: 'build' } });
