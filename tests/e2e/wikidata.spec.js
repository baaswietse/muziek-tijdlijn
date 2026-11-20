// Wikidata als derde bron, de herbeoordeling van oude jaartallen, titels in de
// gedeelde lijst en de export voor de host. Spotify, MusicBrainz en Wikidata
// zijn nagebootst (het echte MusicBrainz en Wikidata worden nooit aangesproken);
// de spelserver is echt.
//
// Ook tegen de echte server (MT_LIVE=1) herhaalbaar: de verzonnen nummers
// krijgen per run nieuwe ID's (fakeIds). Een run laat zo 16 rijen achter in de
// gedeelde lijst (4 per host: 4 + 8 + 4), die de server na een uur zelf
// opruimt (testrijen: zie isTestId in server/src/yearlist.js).

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { NO_SUCH_ROOM } from './helpers.js';
import { fakeIds, fakeMusicBrainz, fakeSpotify, fakeWikidata, hostAndLogin, playlistItem as item, watchYears } from './fake-spotify.js';

const SITE_TRACKS = JSON.parse(readFileSync(new URL('../../web/public/tracks.json', import.meta.url), 'utf8'));
const SITE = SITE_TRACKS.slice(0, 8);

/** Een host met nagebootste Spotify, MusicBrainz en Wikidata, en een playlist «Wiki». */
async function newHost(browser, items, mbAnswers, wdAnswers, { wdMode = 'ok' } = {}) {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  await context.addInitScript(() => {
    window.__mtLookupInterval = 0;
  });
  const mb = await fakeMusicBrainz(context, mbAnswers);
  const wd = await fakeWikidata(context, wdAnswers, { mode: wdMode });
  spotify.playlists = [{ id: 'PLW', name: 'Wiki', owner: { id: 'user-1' }, collaborative: false, items: { total: items.length } }];
  spotify.playlistItems.PLW = items;
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const decks = [];
  let base = null;
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    const url = req.url();
    if (!base && /\/api\/rooms$/.test(url)) base = url.replace(/\/api\/rooms$/, '');
    if (url.endsWith('/deck')) decks.push(JSON.parse(req.postData()));
  });
  const years = watchYears(page);
  const code = await hostAndLogin(page);
  await page.getByTestId('device-dev-1').click();
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('mt.session')).token);
  return { context, page, mb, wd, decks, years, code, token, base: () => base };
}

async function choosePlaylist(page, count) {
  await page.getByTestId('deck-open').click();
  await page.getByTestId('playlist-PLW').click();
  await expect(page.getByTestId('deck-current')).toHaveText(`Playlist «Wiki» · ${count} nummers`, { timeout: 20_000 });
  await expect(page.getByTestId('deck-error')).toHaveCount(0);
}

const yearsOf = (deck) => Object.fromEntries(deck.tracks.map((t) => [t.id, t.year]));
const written = (years) => Object.fromEntries(years.writes.flatMap((w) => w.body.entries).map((e) => [e.id, e]));
/** Hoeveel zoekopdrachten naar MusicBrainz over deze titel gingen. */
const asked = (mb, title) => mb.queries.filter((q) => q.includes(`"${title}"`)).length;

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

/** Vier verzonnen nummers met wat elke bron zegt. */
function threeSources() {
  const id = fakeIds();
  const items = [
    ...SITE.map((t) => item(t.id, t.title, t.artist.split(', ')[0], '2019-01-01')),
    item(id('W1'), 'Wiki Een', 'Band W', '2009-03-03'), // MusicBrainz 2000 (verzamelaar fout gedateerd), Wikidata 2009
    item(id('W2'), 'Wiki Twee', 'Band W', '1990-01-01'), // MusicBrainz 1984, Wikidata kent het niet
    item(id('W3'), 'Wiki Drie', 'Band W', '1979-05-05'), // iedereen eens
    item(id('W4'), 'Wiki Vier', 'Band W', '2015-01-01'), // heruitgave; MusicBrainz en Wikidata 1975
  ];
  const mb = {
    'Wiki Een': { artist: 'Band W', date: '2000' },
    'Wiki Twee': { artist: 'Band W', date: '1984' },
    'Wiki Drie': { artist: 'Band W', date: '1979' },
    'Wiki Vier': { artist: 'Band W', date: '1975' },
  };
  const wd = {
    'wiki een': { artist: 'Band W', date: '2009' },
    'wiki drie': { artist: 'Band W', date: '1979' },
    'wiki vier': [{ artist: 'Band W', date: '1975' }, { artist: 'Andere Band', date: '1960' }],
  };
  return { id, items, mb, wd };
}

test('drie bronnen: wie het eens is, wint; alleen echte twijfels blijven over', async ({ browser }) => {
  const { id, items, mb, wd } = threeSources();
  const a = await newHost(browser, items, mb, wd);
  await choosePlaylist(a.page, 12);

  // Wikidata kreeg alle verzonnen titels in één verzoek (de nummers van de site worden niet opgezocht).
  expect(a.wd.queries.flat().sort()).toEqual(['wiki drie', 'wiki een', 'wiki twee', 'wiki vier']);
  expect(a.wd.queries).toHaveLength(1);

  const years = yearsOf(a.decks.at(-1));
  expect(years[id('W1')]).toBe(2009); // Spotify en Wikidata eens: de verzamelaar bij MusicBrainz was fout
  expect(years[id('W2')]).toBe(1984); // geen beslissing: het vroegste, met twijfel
  expect(years[id('W3')]).toBe(1979);
  expect(years[id('W4')]).toBe(1975); // MusicBrainz en Wikidata eens (een coverversie van een andere band telt niet)
  for (const t of SITE) expect(years[t.id]).toBe(t.year);

  // Alleen de echte twijfel staat in de lijst om na te kijken, met wat elke bron zegt.
  const doubts = a.page.getByTestId('deck-doubts');
  await expect(doubts).toContainText('1 jaartal om na te kijken');
  await doubts.locator('summary').click();
  await expect(a.page.getByTestId(`doubt-why-${id('W2')}`)).toHaveText(' — Spotify 1990 · MusicBrainz 1984 · Wikidata –');

  // Gedeeld: met regelversie, de jaren per bron, titel en artiest.
  await expect.poll(() => Object.keys(written(a.years)).length).toBe(4);
  const w = written(a.years);
  expect(w[id('W1')]).toEqual({ id: id('W1'), y: 2009, s: 'spotify', d: [], r: 3, b: { sp: 2009, mb: 2000, wd: 2009 }, title: 'Wiki Een', artist: 'Band W' });
  expect(w[id('W2')]).toMatchObject({ y: 1984, s: 'musicbrainz', r: 3, b: { sp: 1990, mb: 1984, wd: null }, d: ['Spotify zegt 1990, MusicBrainz 1984, Wikidata niets'] });
  expect(w[id('W4')]).toMatchObject({ y: 1975, s: 'musicbrainz', d: [], b: { sp: 2015, mb: 1975, wd: 1975 } });
  await a.context.close();
});

test('Wikidata onbereikbaar of te druk: alles werkt zoals met twee bronnen', async ({ browser }) => {
  for (const wdMode of ['down', 'busy']) {
    const { id, items, mb, wd } = threeSources();
    const a = await newHost(browser, items, mb, wd, { wdMode });
    await choosePlaylist(a.page, 12);
    expect(a.wd.queries.length).toBeGreaterThan(0);
    const years = yearsOf(a.decks.at(-1));
    expect([years[id('W1')], years[id('W2')], years[id('W3')], years[id('W4')]]).toEqual([2000, 1984, 1979, 1975]);
    // Zoals vroeger: Spotify en MusicBrainz oneens, dus twijfel (W4: MusicBrainz heeft maar één uitgave).
    const doubts = a.page.getByTestId('deck-doubts');
    await expect(doubts).toContainText('3 jaartallen om na te kijken');
    await doubts.locator('summary').click();
    await expect(a.page.getByTestId(`doubt-why-${id('W1')}`)).toHaveText(' — Spotify 2009 · MusicBrainz 2000');
    await expect.poll(() => Object.keys(written(a.years)).length).toBe(4);
    expect(written(a.years)[id('W1')]).toMatchObject({ y: 2000, r: 3, b: { sp: 2009, mb: 2000 } });
    expect('wd' in written(a.years)[id('W1')].b).toBe(false);
    await a.context.close();
  }
});

test('oude jaartallen: twijfels opnieuw beoordeeld, de rest en handmatige verbeteringen blijven; titels aangevuld; export voor de host', async ({ browser }) => {
  const id = fakeIds();
  const items = [
    ...SITE.map((t) => item(t.id, t.title, t.artist.split(', ')[0], '2019-01-01')),
    item(id('O1'), 'Oud Een', 'Band O', '1990-01-01'), // oud: twijfel Spotify 1990 / MusicBrainz 1984; Wikidata 1990
    item(id('O2'), 'Oud Twee', 'Band O', '1979-01-01'), // oud, zonder twijfel: blijft
    item(id('O3'), 'Oud Drie', 'Band O', '1999-01-01'), // handmatig 1983: blijft, ook al zegt Wikidata iets anders
    item(id('O4'), 'Oud Vier', 'Band O', '2010-01-01'), // oud: twijfel; Wikidata kent het niet: opnieuw bij MusicBrainz
  ];
  const mb = {
    'Oud Een': { artist: 'Band O', date: '1984' },
    'Oud Twee': { artist: 'Band O', date: '1979' },
    'Oud Drie': { artist: 'Band O', date: '1999' },
    'Oud Vier': { artist: 'Band O', date: '2009' },
  };
  const wd = { 'oud een': { artist: 'Band O', date: '1990' }, 'oud drie': { artist: 'Band O', date: '1999' } };
  const a = await newHost(browser, items, mb, wd);
  const base = a.base();
  expect(base).toBeTruthy();

  // Wat een oudere versie van de app deelde: zonder jaren per bron, titel of artiest.
  const old = [
    { id: id('O1'), y: 1984, s: 'musicbrainz', d: ['Spotify zegt 1990, MusicBrainz 1984'], r: 2 },
    { id: id('O2'), y: 1979, s: 'musicbrainz', d: [], r: 2 },
    { id: id('O3'), y: 1983, s: 'handmatig', d: [] },
    { id: id('O4'), y: 2006, s: 'musicbrainz', d: ['Spotify zegt 2010, MusicBrainz 2006'] },
  ];
  const seeded = await postFrom(a.page, `${base}/api/rooms/${a.code}/years`, { token: a.token, entries: old });
  expect(seeded).toMatchObject({ status: 200, body: { ok: true, saved: 4 } });
  await expect.poll(() => a.years.writes.length).toBe(1);
  const seedWrites = a.years.writes.length;

  await choosePlaylist(a.page, 12);
  const years = yearsOf(a.decks.at(-1));
  expect(years[id('O1')]).toBe(1990); // Spotify en Wikidata eens
  expect(years[id('O2')]).toBe(1979);
  expect(years[id('O3')]).toBe(1983);
  expect(years[id('O4')]).toBe(2009); // Spotify 2010 en MusicBrainz 2009 (nu) zijn het eens
  // O1 is opnieuw beoordeeld zonder een nieuw verzoek naar MusicBrainz; O2 en O3 niet opgezocht; O4 wel.
  expect(asked(a.mb, 'Oud Een')).toBe(0);
  expect(asked(a.mb, 'Oud Twee')).toBe(0);
  expect(asked(a.mb, 'Oud Drie')).toBe(0);
  expect(asked(a.mb, 'Oud Vier')).toBeGreaterThan(0);
  await expect(a.page.getByTestId('deck-doubts')).toHaveCount(0);

  // De nieuwe beoordelingen gaan naar de server; O2 en O3 krijgen alleen titel en artiest.
  const appWrites = () => a.years.writes.slice(seedWrites);
  await expect.poll(() => appWrites().flatMap((w) => w.body.entries).length).toBe(4);
  const sent = appWrites().flatMap((w) => w.body.entries);
  expect(sent.find((e) => e.id === id('O1'))).toMatchObject({ y: 1990, s: 'spotify', r: 3, b: { sp: 1990, mb: 1984, wd: 1990 }, title: 'Oud Een' });
  expect(sent.find((e) => e.id === id('O2'))).toEqual({ id: id('O2'), title: 'Oud Twee', artist: 'Band O' });
  expect(sent.find((e) => e.id === id('O3'))).toEqual({ id: id('O3'), title: 'Oud Drie', artist: 'Band O' });
  for (const w of a.years.writes) expect(w.status).toBe(200);

  // --- export: alleen de host, in pagina's ---
  // De verzonnen ID's beginnen allemaal met dezelfde voorloop: vanaf daar staan ze achter elkaar.
  const prefix = id('O1').slice(0, 18);
  const got = [];
  let after = prefix;
  for (let i = 0; i < 4; i++) {
    const res = await postFrom(a.page, `${base}/api/rooms/${a.code}/years/export`, { token: a.token, after, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(2);
    got.push(...res.body.entries.filter((e) => e.id.startsWith(prefix)));
    if (!res.body.next || !res.body.entries.every((e) => e.id.startsWith(prefix))) break;
    expect(res.body.next).toBe(res.body.entries.at(-1).id);
    after = res.body.next;
  }
  const byId = Object.fromEntries(got.map((e) => [e.id, e]));
  expect(Object.keys(byId).sort()).toEqual([id('O1'), id('O2'), id('O3'), id('O4')].sort());
  expect(byId[id('O1')]).toMatchObject({ y: 1990, s: 'spotify', d: [], r: 3, b: { sp: 1990, mb: 1984, wd: 1990 }, title: 'Oud Een', artist: 'Band O' });
  expect(byId[id('O2')]).toMatchObject({ y: 1979, s: 'musicbrainz', d: [], r: 2, title: 'Oud Twee', artist: 'Band O' });
  expect(byId[id('O3')]).toMatchObject({ y: 1983, s: 'handmatig', d: [], title: 'Oud Drie', artist: 'Band O' });
  for (const e of got) expect(typeof e.at).toBe('number');

  // Een gast, een onbestaand spel of de sleutel van een ander spel: geweigerd.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto('./');
  await guest.getByTestId('code-input').fill(a.code);
  await guest.getByTestId('name-input').fill('Bob');
  await guest.getByTestId('enter-button').click();
  await expect(guest.getByTestId('waiting')).toBeVisible();
  const guestToken = await guest.evaluate(() => JSON.parse(localStorage.getItem('mt.session')).token);
  const asGuest = await postFrom(guest, `${base}/api/rooms/${a.code}/years/export`, { token: guestToken });
  expect(asGuest.status).toBe(400);
  expect(asGuest.body).toMatchObject({ error: 'HOST_ONLY' });
  expect(asGuest.body).not.toHaveProperty('entries');
  const none = await postFrom(guest, `${base}/api/rooms/${NO_SUCH_ROOM}/years/export`, { token: a.token });
  expect(none.status).toBe(404);
  const bad = await postFrom(a.page, `${base}/api/rooms/${a.code}/years/export`, { token: a.token, after: 'fout!' });
  expect(bad).toMatchObject({ status: 400, body: { error: 'BAD_REQUEST' } });
  await guest.context().close();
  await a.context.close();
});
