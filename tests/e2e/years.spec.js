// De gedeelde lijst met jaartallen op de server: wat één host bij MusicBrainz
// opzocht (of zelf verbeterde), hoeft een andere host niet opnieuw op te
// zoeken. Spotify en MusicBrainz zijn nagebootst; de spelserver is echt.
//
// Ook tegen de echte server (MT_LIVE=1) herhaalbaar: de verzonnen nummers
// krijgen per run nieuwe ID's (fakeIds), en de andere nummers komen uit de
// nagekeken lijst van de site, die nooit naar de gedeelde lijst gaat. Een run
// laat zo 3 rijen achter in de gedeelde lijst; de server ruimt ze na een uur
// zelf op (testrijen: zie isTestId in server/src/yearlist.js en cleanup.spec.js).

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { NO_SUCH_ROOM } from './helpers.js';
import { CORS, fakeIds, fakeMusicBrainz, fakeSpotify, hostAndLogin, playlistItem as item, watchYears } from './fake-spotify.js';

const SITE_TRACKS = JSON.parse(readFileSync(new URL('../../web/public/tracks.json', import.meta.url), 'utf8'));

const ANSWERS = {
  'Gedeeld Een': { artist: 'Band G', date: '1984-02-02' },
  'Gedeeld Drie': { artist: 'Band G', date: '1979' },
};

/** Een playlist met 8 nummers van de site en 3 verzonnen nummers met nieuwe ID's. */
function makePlaylist() {
  const id = fakeIds();
  const site = SITE_TRACKS.slice(0, 8);
  const items = [
    ...site.map((t) => item(t.id, t.title, t.artist.split(', ')[0], '2019-01-01')),
    item(id('G1'), 'Gedeeld Een', 'Band G', '1990-01-01'), // MusicBrainz 1984: twijfel
    item(id('G2'), 'Gedeeld Twee', 'Band G', '2003-03-03'), // niet bij MusicBrainz: twijfel
    item(id('G3'), 'Gedeeld Drie', 'Band G', '1979-05-05'), // beide gelijk
  ];
  return { id, site, items, fake: new Set(['G1', 'G2', 'G3'].map(id)) };
}

/** Een host op een eigen toestel (browsercontext), met een eigen spel en Spotify. */
async function newHost(browser, items) {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  await context.addInitScript(() => {
    window.__mtLookupInterval = 0; // de pauze tussen opzoekingen is hier niet nodig
  });
  const mb = await fakeMusicBrainz(context, ANSWERS);
  spotify.playlists = [{ id: 'PLG', name: 'Gedeeld', owner: { id: 'user-1' }, collaborative: false, items: { total: items.length } }];
  spotify.playlistItems.PLG = items;
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const decks = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/deck')) decks.push(JSON.parse(req.postData()));
  });
  const years = watchYears(page);
  const code = await hostAndLogin(page);
  await page.getByTestId('device-dev-1').click();
  return { context, page, mb, decks, years, code };
}

async function choosePlaylist(page) {
  await page.getByTestId('deck-open').click();
  await page.getByTestId('playlist-PLG').click();
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Gedeeld» · 11 nummers', { timeout: 20_000 });
  await expect(page.getByTestId('deck-error')).toHaveCount(0);
}

const yearsOf = (deck) => Object.fromEntries(deck.tracks.map((t) => [t.id, t.year]));

/** Een POST naar de spelserver vanuit de pagina (zelfde herkomst als de site). */
function postFrom(page, url, body) {
  return page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { url, body },
  );
}

test('gedeelde jaartallen: een tweede host zoekt niets opnieuw op en krijgt de verbeteringen', async ({ browser }) => {
  const { id, site, items, fake } = makePlaylist();

  // --- host A zoekt op ---
  const a = await newHost(browser, items);
  await choosePlaylist(a.page);
  expect(a.mb.queries.length, 'host A zoekt de nieuwe nummers op').toBeGreaterThan(0);
  expect(a.mb.queries.filter((q) => q.includes('"Gedeeld Een"'))).toHaveLength(1);
  const yearsA = yearsOf(a.decks[0]);
  expect(yearsA[id('G1')]).toBe(1984);
  expect(yearsA[id('G2')]).toBe(2003);
  expect(yearsA[id('G3')]).toBe(1979);
  for (const t of site) expect(yearsA[t.id]).toBe(t.year);

  // Gevraagd en gedeeld worden alleen de verzonnen nummers, nooit die van de site.
  expect(a.years.lookups.length).toBeGreaterThan(0);
  for (const l of a.years.lookups) {
    expect(l.status).toBe(200);
    expect(l.body.ids.every((x) => fake.has(x))).toBe(true);
  }
  await expect.poll(() => a.years.writes.length).toBe(1);
  expect(a.years.writes[0].status).toBe(200);
  expect(a.years.writes[0].body.entries.map((e) => e.id).sort()).toEqual([...fake].sort());
  expect(a.years.writes[0].response).toMatchObject({ ok: true, saved: 3 });

  // --- host A verbetert een jaartal ---
  const doubtsA = a.page.getByTestId('deck-doubts');
  await expect(doubtsA).toContainText('2 jaartallen om na te kijken');
  await doubtsA.locator('summary').click();
  await a.page.getByTestId(`doubt-${id('G1')}`).fill('1983');
  await a.page.getByTestId(`doubt-${id('G1')}`).blur();
  await expect.poll(() => a.years.writes.length).toBe(2);
  expect(a.years.writes[1].status).toBe(200);
  // Met titel en artiest (om de lijst te kunnen nakijken).
  expect(a.years.writes[1].body.entries).toEqual([{ id: id('G1'), y: 1983, s: 'handmatig', d: [], title: 'Gedeeld Een', artist: 'Band G' }]);

  // --- host B: ander toestel, ander spel, dezelfde playlist ---
  const b = await newHost(browser, items);
  expect(b.code).not.toBe(a.code);
  await choosePlaylist(b.page);
  expect(b.mb.queries, 'host B doet geen enkel verzoek naar MusicBrainz').toHaveLength(0);
  expect(yearsOf(b.decks[0])).toEqual({ ...yearsA, [id('G1')]: 1983 });
  // De verbetering staat apart gemarkeerd op de server (met wat de bronnen toen zeiden;
  // Wikidata is hier niet bereikbaar).
  expect(b.years.lookups[0].response.years[id('G1')]).toEqual({ y: 1983, s: 'handmatig', d: [], b: { sp: 1990, mb: 1984 }, named: true });
  // De twijfel bij het niet gevonden nummer komt mee van de server en wordt getoond.
  const doubtsB = b.page.getByTestId('deck-doubts');
  await expect(doubtsB).toContainText('1 jaartal om na te kijken');
  await doubtsB.locator('summary').click();
  await expect(doubtsB).toContainText('Gedeeld Twee');
  await expect(doubtsB).toContainText('niet gevonden bij MusicBrainz');
  // Er was niets nieuws om te delen.
  expect(b.years.writes).toHaveLength(0);

  // --- wie geen host is, kan de lijst niet lezen of aanvullen ---
  const lookupUrl = a.years.lookups[0].url;
  const base = lookupUrl.replace(/\/api\/rooms\/.*$/, '');
  const guest = await (await browser.newContext()).newPage();
  await guest.goto('./');
  await guest.getByTestId('code-input').fill(a.code);
  await guest.getByTestId('name-input').fill('Bob');
  await guest.getByTestId('enter-button').click();
  await expect(guest.getByTestId('waiting')).toBeVisible();
  const guestToken = await guest.evaluate(() => JSON.parse(localStorage.getItem('mt.session')).token);
  const hostToken = a.years.lookups[0].body.token;

  const ids = [...fake];
  const forged = [{ id: id('G2'), y: 1950, s: 'handmatig', d: [] }];
  const asGuest = [
    await postFrom(guest, `${base}/api/rooms/${a.code}/years/lookup`, { token: guestToken, ids }),
    await postFrom(guest, `${base}/api/rooms/${a.code}/years`, { token: guestToken, entries: forged }),
  ];
  for (const res of asGuest) {
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'HOST_ONLY', message: 'Alleen de host kan dit doen.' });
    expect(res.body).not.toHaveProperty('years');
  }
  // Een spel dat niet bestaat, of de sleutel van een ander spel.
  for (const path of ['years/lookup', 'years']) {
    const body = { token: hostToken, ids, entries: forged };
    const none = await postFrom(guest, `${base}/api/rooms/${NO_SUCH_ROOM}/${path}`, body);
    expect(none.status).toBe(404);
    expect(none.body).toMatchObject({ error: 'NO_ROOM' });
    const other = await postFrom(guest, `${base}/api/rooms/${b.code}/${path}`, body);
    expect(other.status).toBe(400);
    expect(other.body).toMatchObject({ error: 'BAD_TOKEN' });
  }
  // Niets van dat alles kwam in de lijst.
  const check = await postFrom(a.page, `${base}/api/rooms/${a.code}/years/lookup`, { token: hostToken, ids });
  expect(check.status).toBe(200);
  expect(check.body.years[id('G2')]).toMatchObject({ y: 2003, s: 'spotify' });
  expect(check.body.years[id('G1')]).toEqual({ y: 1983, s: 'handmatig', d: [], b: { sp: 1990, mb: 1984 }, named: true });

  // Ongeldige inhoud van de host zelf wordt geweigerd of overgeslagen.
  const bad = await postFrom(a.page, `${base}/api/rooms/${a.code}/years`, {
    token: hostToken,
    entries: [
      { id: id('G3'), y: 1500, s: 'musicbrainz', d: [] },
      { id: id('G3'), y: 1980, s: 'lijst', d: [] },
      { id: 'spotify:track:x', y: 1980, s: 'musicbrainz', d: [] },
      { id: id('G3'), y: 1980, s: 'spotify', d: ['MusicBrainz was niet bereikbaar; jaar van het Spotify-album'] },
    ],
  });
  expect(bad).toMatchObject({ status: 200, body: { ok: true, saved: 0, skipped: 4 } });
  const tooMany = await postFrom(a.page, `${base}/api/rooms/${a.code}/years/lookup`, {
    token: hostToken,
    ids: Array.from({ length: 501 }, (_, i) => `x${i}`),
  });
  expect(tooMany.status).toBe(400);
  expect(tooMany.body).toMatchObject({ error: 'TOO_MANY' });

  await guest.context().close();
  await a.context.close();
  await b.context.close();
});

test('gedeelde jaartallen: zonder die routes op de server werkt een playlist zoals vroeger', async ({ browser }) => {
  const { id, items } = makePlaylist();
  const a = await newHost(browser, items);
  // Een oudere server kent de routes niet (404); daarna is hij onbereikbaar.
  let mode = 'oud';
  const tried = [];
  await a.context.route(/\/api\/rooms\/[A-Za-z]{4}\/years(\/lookup)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' },
      });
    }
    tried.push({ mode, url: req.url() });
    if (mode === 'oud') return route.fulfill({ status: 404, headers: CORS, json: { error: 'NOT_FOUND', message: 'Niet gevonden.' } });
    return route.abort('connectionrefused');
  });

  await choosePlaylist(a.page);
  expect(tried.filter((t) => t.mode === 'oud' && t.url.endsWith('/lookup')).length).toBeGreaterThan(0);
  // Na een mislukte opvraging probeert de app ook niet te schrijven.
  expect(tried.some((t) => !t.url.endsWith('/lookup'))).toBe(false);
  expect(a.mb.queries.length).toBeGreaterThan(0);
  expect(yearsOf(a.decks[0])).toMatchObject({ [id('G1')]: 1984, [id('G2')]: 2003, [id('G3')]: 1979 });

  // Verbeteren werkt ook, zonder foutmelding.
  const doubts = a.page.getByTestId('deck-doubts');
  await doubts.locator('summary').click();
  await a.page.getByTestId(`doubt-${id('G1')}`).fill('1983');
  await a.page.getByTestId(`doubt-${id('G1')}`).blur();
  await expect.poll(() => a.decks.length).toBe(2);
  expect(yearsOf(a.decks[1])[id('G1')]).toBe(1983);
  await expect(a.page.getByTestId('deck-error')).toHaveCount(0);

  // Server onbereikbaar: de lokale cache en de eigen verbetering doen het werk.
  mode = 'weg';
  const before = a.mb.queries.length;
  await a.page.getByRole('button', { name: 'Terug naar de standaardlijst' }).click();
  await expect(a.page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');
  await choosePlaylist(a.page);
  expect(a.mb.queries.length).toBe(before);
  expect(yearsOf(a.decks.at(-1))[id('G1')]).toBe(1983);
  expect(tried.some((t) => t.mode === 'weg')).toBe(true);
  await a.context.close();
});
