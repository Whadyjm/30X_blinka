import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Frontend-only config.
 *
 * When the Worker (Hono + @cloudflare/vite-plugin) is merged into this project,
 * add `cloudflare()` to `plugins` and REMOVE the `server.proxy` block — the
 * plugin serves /api from the same origin and nothing in `src/` changes.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@oli/mascot': fileURLToPath(new URL('./src/components/Oli.tsx', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // `wrangler dev` listens on 8787 by default.
        '/api': {
          target: env.OLI_API_PROXY || 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    },
  };
});
