import { defineConfig } from '@playwright/test';

// De tests draaien tegen de echte spelserver (Node) en de gebouwde site, met
// een nagebootste Spotify-laag (?mock=1) en een vaste lijst testnummers.
const SERVER_PORT = 8787;
const WEB_PORT = 4173;
const TRACKS_PORT = 4174;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}/muziek-tijdlijn/`,
    viewport: { width: 390, height: 844 },
    trace: 'off',
  },
  webServer: [
    // MT_SERVER=cloudflare test dezelfde spelregels in de Cloudflare-variant
    // (lokaal via wrangler); standaard draait de Node-server.
    process.env.MT_SERVER === 'cloudflare'
      ? {
          command:
            `npx wrangler dev --config server/wrangler.jsonc --port ${SERVER_PORT} --ip 127.0.0.1 ` +
            `--var ALLOWED_ORIGINS:* --var TRACKS_URL:http://127.0.0.1:${TRACKS_PORT}/tracks.json`,
          env: { WRANGLER_SEND_METRICS: 'false' },
          url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        }
      : {
          command: 'node server/node/server.js',
          env: { PORT: String(SERVER_PORT), HOST: '127.0.0.1', TRACKS_FILE: 'tests/fixtures/tracks.json' },
          url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
          reuseExistingServer: !process.env.CI,
        },
    {
      // De Cloudflare-variant haalt de testnummers hier op.
      command: `node tests/fixtures/serve.js ${TRACKS_PORT}`,
      url: `http://127.0.0.1:${TRACKS_PORT}/tracks.json`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && npm run preview',
      env: { VITE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}/muziek-tijdlijn/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
