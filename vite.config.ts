import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // The home tab is a standalone extension page (no popup). Declare it as a
  // build input so CRXJS/Rollup emits it and rewrites its asset paths.
  build: {
    rollupOptions: {
      input: { home: 'home.html' },
    },
  },
  // CRXJS needs a stable port for HMR in the extension context.
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
