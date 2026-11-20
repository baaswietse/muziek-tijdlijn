// De server ruimt oude testrijen in de gedeelde lijst met jaartallen zelf op
// (server/src/yearlist.js, isTestId en TestRowCleaner): een verzonnen ID van
// een test (begint met 'zz') verdwijnt zodra het ouder is dan de grens; een
// echt nummer, een fragment en een verse testrij blijven.
//
// Gewoon is die grens een uur. Deze test start daarom een eigen spelserver
// (Node, of met MT_SERVER=cloudflare de Cloudflare-variant via wrangler) met
// een grens van enkele seconden, naast de server van de andere tests, die de
// gewone grens houdt. Niet tegen de echte server (MT_LIVE=1): daar kan de
// grens niet korter.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeIds } from './fake-spotify.js';

const OFFSET = Number(process.env.MT_PORT_OFFSET || 0);
const PORT = 8787 + OFFSET + 20;
const INSPECTOR_PORT = 9229 + OFFSET + 20;
const BASE = `http://127.0.0.1:${PORT}`;
const CLOUDFLARE = process.env.MT_SERVER === 'cloudflare';
const MAX_AGE = 4000; // ms: zo lang blijft een testrij op deze server staan

const REAL = '4uLU6hMCjMI75M1A2tKUQC'; // vorm van een echt Spotify-ID
const FRAGMENT = 'dz-3135556'; // een fragment van Deezer

test.skip(process.env.MT_LIVE === '1', 'start een eigen server; niet tegen de echte');

let server = null;
let dataDir = null;

async function waitForHealth(timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`server gestopt (code ${server.exitCode}):\n${server.log}`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // nog niet bereikbaar
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server niet bereikbaar op ${BASE}:\n${server.log}`);
}

test.beforeAll(async () => {
  test.setTimeout(150_000);
  const env = { ...process.env, YEARS_TEST_MAX_AGE_MS: String(MAX_AGE), YEARS_PURGE_EVERY_MS: '0' };
  if (CLOUDFLARE) {
    // Een eigen map voor de opslag, zodat deze server niets deelt met die van de andere tests.
    dataDir = mkdtempSync(join(tmpdir(), 'mt-cleanup-'));
    server = spawn(
      'npx',
      [
        'wrangler', 'dev',
        '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(INSPECTOR_PORT),
        '--persist-to', dataDir,
        '--var', 'ALLOWED_ORIGINS:*',
        '--var', `YEARS_TEST_MAX_AGE_MS:${MAX_AGE}`,
        '--var', 'YEARS_PURGE_EVERY_MS:0',
      ],
      { env: { ...env, WRANGLER_SEND_METRICS: 'false' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } else {
    server = spawn('node', ['server/node/server.js'], {
      env: { ...env, PORT: String(PORT), HOST: '127.0.0.1', TRACKS_FILE: 'tests/fixtures/tracks.json', DATA_FILE: '' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  server.log = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => (server.log += chunk));
  await waitForHealth(120_000);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    try {
      process.kill(-server.pid, 'SIGTERM'); // de hele groep: npx, wrangler en workerd
    } catch {
      // al weg
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // al weg
    }
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

/** De hele lijst via de export voor de host: id -> item. */
async function exportAll(code, token) {
  const all = {};
  let after = '';
  for (let i = 0; i < 100; i++) {
    const res = await post(`/api/rooms/${code}/years/export`, { token, after });
    expect(res.status).toBe(200);
    for (const e of res.body.entries) all[e.id] = e;
    if (!res.body.next) return all;
    after = res.body.next;
  }
  throw new Error('export eindigt niet');
}

const entry = (id, y, title) => ({ id, y, s: 'musicbrainz', d: [], r: 3, title, artist: 'Band Q' });

test('oude testrijen verdwijnen vanzelf; echte nummers, fragmenten en verse testrijen blijven', async () => {
  const created = await post('/api/rooms', { name: 'Hanne' });
  expect(created.status).toBe(200);
  const { code, token } = created.body;
  const id = fakeIds();
  const OLD = id('OUD');
  const FRESH = id('VERS');
  // Een oudere vorm van verzonnen ID's (zonder de lengte van het label) staat nog op de echte server.
  const OLDER_FORM = `zz${id('X').slice(2, 17)}OUD`.padEnd(22, '0');

  const first = await post(`/api/rooms/${code}/years`, {
    token,
    entries: [entry(OLD, 1981, 'Oud'), entry(OLDER_FORM, 1982, 'Oudere vorm'), entry(REAL, 1983, 'Echt'), entry(FRAGMENT, 1984, 'Fragment')],
  });
  expect(first).toMatchObject({ status: 200, body: { ok: true, saved: 4 } });
  // Meteen teruglezen (zoals een testrun doet): alles staat er.
  const soon = await post(`/api/rooms/${code}/years/lookup`, { token, ids: [OLD, OLDER_FORM, REAL, FRAGMENT] });
  expect(Object.keys(soon.body.years).sort()).toEqual([OLD, OLDER_FORM, REAL, FRAGMENT].sort());

  // Wachten tot ze ouder zijn dan de grens; dan een verse testrij schrijven.
  await new Promise((resolve) => setTimeout(resolve, MAX_AGE + 1000));
  const second = await post(`/api/rooms/${code}/years`, { token, entries: [entry(FRESH, 1985, 'Vers')] });
  expect(second).toMatchObject({ status: 200, body: { ok: true, saved: 1 } });

  const all = await exportAll(code, token);
  expect(all[OLD], 'oude testrij').toBeUndefined();
  expect(all[OLDER_FORM], 'oude testrij in de oudere vorm').toBeUndefined();
  expect(all[REAL], 'echt nummer, even oud').toMatchObject({ y: 1983, s: 'musicbrainz', title: 'Echt' });
  expect(all[FRAGMENT], 'fragment, even oud').toMatchObject({ y: 1984, title: 'Fragment' });
  expect(all[FRESH], 'verse testrij').toMatchObject({ y: 1985, title: 'Vers' });

  const after = await post(`/api/rooms/${code}/years/lookup`, { token, ids: [OLD, OLDER_FORM, REAL, FRAGMENT, FRESH] });
  expect(Object.keys(after.body.years).sort()).toEqual([REAL, FRAGMENT, FRESH].sort());

  // Een opgeruimde testrij kan gewoon opnieuw geschreven worden.
  const again = await post(`/api/rooms/${code}/years`, { token, entries: [entry(OLD, 1981, 'Oud')] });
  expect(again).toMatchObject({ status: 200, body: { ok: true, saved: 1 } });
});
