import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { headersForPath } from './scripts/headers-policy.mjs';

// The preview server (used by the e2e suite) sends the same response headers the host will, from
// the same file and with the same path matching, so the browser tests run under them.
const hostHeaders = {
  name: 'host-headers',
  configurePreviewServer(server: { middlewares: { use: (fn: HeaderMiddleware) => void } }) {
    const file = readFileSync('public/_headers', 'utf8');
    server.middlewares.use((req, res, next) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      for (const [name, value] of Object.entries(headersForPath(file, pathname))) {
        res.setHeader(name, value);
      }
      next();
    });
  },
};

type HeaderMiddleware = (
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void,
) => void;

export default defineConfig({
  plugins: [svelte(), hostHeaders],
  build: {
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup/fake-indexeddb.ts'],
  },
});
