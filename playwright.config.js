import { defineConfig } from '@playwright/test';

// De tests draaien tegen de echte spelserver (Node) en de gebouwde site, met
// een nagebootste Spotify-laag (?mock=1) en een vaste lijst testnummers.
// MT_PORT_OFFSET schuift alle poorten op (standaard 0), zodat twee testruns
// naast elkaar kunnen draaien zonder elkaars servers te gebruiken.
const OFFSET = Number(process.env.MT_PORT_OFFSET || 0);
const SERVER_PORT = 8787 + OFFSET;
const WEB_PORT = 4173 + OFFSET;
const TRACKS_PORT = 4174 + OFFSET;
const INSPECTOR_PORT = 9229 + OFFSET; // debugpoort van wrangler dev
// Zo lang (ms) moet de host weg zijn voor een ander host kan worden: in de
// tests korter dan de 30 s van een echt spel (tests/e2e/host.spec.js).
export const HOST_GRACE_MS = 5000;

// MT_LIVE=1 test de echte site op GitHub Pages met de echte spelserver. Er
// start dan niets lokaal; Spotify blijft nagebootst. Achter een proxy
// (HTTPS_PROXY) gaat de browser daarlangs.
const LIVE = process.env.MT_LIVE === '1';
const LIVE_URL = process.env.MT_LIVE_URL || 'https://baaswietse.github.io/muziek-tijdlijn/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: LIVE ? LIVE_URL : `http://127.0.0.1:${WEB_PORT}/muziek-tijdlijn/`,
    viewport: { width: 390, height: 844 },
    trace: 'off',
    ...(LIVE && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  },
  webServer: LIVE ? [] : [
    // MT_SERVER=cloudflare test dezelfde spelregels in de Cloudflare-variant
    // (lokaal via wrangler); standaard draait de Node-server.
    process.env.MT_SERVER === 'cloudflare'
      ? {
          command:
            `npx wrangler dev --port ${SERVER_PORT} --ip 127.0.0.1 --inspector-port ${INSPECTOR_PORT} ` +
            `--var ALLOWED_ORIGINS:* --var TRACKS_URL:http://127.0.0.1:${TRACKS_PORT}/tracks.json ` +
            `--var HOST_GRACE_MS:${HOST_GRACE_MS}`,
          env: { WRANGLER_SEND_METRICS: 'false' },
          url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        }
      : {
          command: 'node server/node/server.js',
          env: {
            PORT: String(SERVER_PORT),
            HOST: '127.0.0.1',
            TRACKS_FILE: 'tests/fixtures/tracks.json',
            HOST_GRACE_MS: String(HOST_GRACE_MS),
          },
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
      // De poort via de CLI: vite.config.js zet strictPort, dus een bezette poort faalt meteen.
      command: `npm run build && npm run preview -- --port ${WEB_PORT}`,
      env: { VITE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}/muziek-tijdlijn/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
