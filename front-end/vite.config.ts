import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';

// ----------------------------------------------------------------------

const PORT = 8080;

/** Orthodox Metrics backend (Express) on this host. */
const OM_BACKEND = 'http://127.0.0.1:3001';

/**
 * Production asset prefix.
 *
 * orthodoxmetrics.com still serves the legacy OM SPA from `front-end/dist`, whose
 * bundles are also at `/assets/index-*.js` with public images under
 * `/assets/images/`. Served at one origin those paths are ambiguous and one app
 * receives the other's bundles. Prefixing ours keeps them separable in nginx.
 *
 * Build-only: `base` also relocates the dev server, so setting it globally moves
 * the whole app under the prefix and leaves `/` blank. Dev has no collision.
 */
const ASSET_BASE = '/om-platform/';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? ASSET_BASE : '/',
  plugins: [
    react(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint "./src/**/*.{js,jsx,ts,tsx}"',
      },
      overlay: {
        position: 'tl',
        initialIsOpen: false,
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^src(.+)/,
        replacement: path.resolve(process.cwd(), 'src/$1'),
      },
    ],
  },
  server: {
    port: PORT,
    host: true,
    proxy: {
      '/api': {
        target: OM_BACKEND,
        changeOrigin: true,
        secure: false,
        /**
         * The backend's CORS allowlist does not include this dev origin and rejects
         * unknown ones with a 500, but it permits requests that carry no `Origin`
         * at all (`if (!origin) return callback(null, true)`) — which is how curl
         * and server-to-server calls reach it. Dropping the forwarded header puts
         * the proxy in that category, rather than editing OM production config for
         * a local convenience.
         */
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      },
    },
  },
  preview: {
    port: PORT,
    host: true,
    proxy: { '/api': { target: OM_BACKEND, changeOrigin: true, secure: false } },
  },
}));
