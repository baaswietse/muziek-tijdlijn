// Een eigen playlist: de host hoeft niet te wachten tot alle jaartallen
// opgezocht zijn. Wat gekend is, is er meteen; de rest wordt op de
// achtergrond opgezocht (ook tijdens het spel en na een herlaad) en doet mee
// vanaf het volgende spel. Spotify en MusicBrainz zijn nagebootst, MusicBrainz
// antwoordt hier bewust traag; de spelserver is echt.
//
// Ook tegen de echte server (MT_LIVE=1) herhaalbaar: de verzonnen nummers
// krijgen per run nieuwe ID's (fakeIds), de andere komen uit de nagekeken
// lijst van de site, die nooit naar de gedeelde lijst gaat. De test met meer
// dan 500 nummers vangt de gedeelde lijst zelf op. Een run laat zo hoogstens
// 51 rijen achter in de gedeelde lijst (8 + 8 + 8 + 2 + 2 + 3 + 8 + 12), die
// de server na een uur zelf opruimt (zie isTestId in server/src/yearlist.js).

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fakeIds, fakeMusicBrainz, fakeSpotify, hostAndLogin, playlistItem as item, watchYears } from './fake-spotify.js';
import { openMenu, setTarget } from './helpers.js';

const SITE_TRACKS = JSON.parse(readFileSync(new URL('../../web/public/tracks.json', import.meta.url), 'utf8'));
const SITE = SITE_TRACKS.slice(0, 10); // 10 gekende nummers: genoeg om meteen te kunnen starten

/**
 * Een playlist: de 10 nummers van de site en `n` verzonnen nummers
 * ("<naam> 1", ...) met nieuwe ID's, die MusicBrainz wel kent.
 */
function makePlaylist(name, n, id = fakeIds()) {
  const fake = Array.from({ length: n }, (_, i) => ({ id: id(`${name[0]}${i}`), title: `${name} ${i + 1}`, year: 1970 + i }));
  const items = [
    ...SITE.map((t) => item(t.id, t.title, t.artist.split(', ')[0], '2019-01-01')),
    ...fake.map((t) => item(t.id, t.title, 'Band Z', `${t.year}-01-01`)),
  ];
  // Elk ID één keer: de site laat een dubbel ID weg, en dan klopt de telling niet meer.
  const ids = new Set([...SITE.map((t) => t.id), ...fake.map((t) => t.id)]);
  if (ids.size !== SITE.length + n) throw new Error(`playlist ${name}: dubbele track-ID's`);
  const answers = Object.fromEntries(fake.map((t) => [t.title, { artist: 'Band Z', date: String(t.year) }]));
  return { name, items, fake, answers };
}

/** Een host met nagebootste Spotify en een trage MusicBrainz. */
async function newHost(browser, lists, { delay = 600 } = {}) {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  await context.addInitScript(() => {
    window.__mtLookupInterval = 0; // de nagebootste MusicBrainz is zelf al traag genoeg
  });
  const answers = Object.assign({}, ...lists.map((l) => l.answers));
  const mb = await fakeMusicBrainz(context, answers, { delay });
  spotify.playlists = lists.map((l) => ({ id: `PL${l.name}`, name: l.name, owner: { id: 'user-1' }, collaborative: false, items: { total: l.items.length } }));
  for (const l of lists) spotify.playlistItems[`PL${l.name}`] = l.items;
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  // Elke lijst die naar de server gaat, met het antwoord van de server.
  const decks = [];
  page.on('requestfinished', async (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith('/deck')) return;
    const res = await req.response();
    decks.push({ body: JSON.parse(req.postData()), status: res.status() });
  });
  const years = watchYears(page);
  const code = await hostAndLogin(page);
  await page.getByTestId('device-dev-1').click();
  return { context, spotify, mb, page, decks, years, code };
}

async function choose(page, name) {
  await page.getByTestId('deck-open').click();
  await page.getByTestId(`playlist-PL${name}`).click();
}

/** Zoekopdrachten naar de verzonnen nummers, in de volgorde waarin ze gebeurden. */
const asked = (mb, list) =>
  mb.queries.map((q) => q.match(/recording:"([^"]*)"/)?.[1]).filter((t) => list.fake.some((f) => f.title === t));

test('starten terwijl er nog opgezocht wordt; wat erbij komt, doet mee vanaf het volgende spel', async ({ browser }) => {
  const list = makePlaylist('Achter', 8);
  const host = await newHost(browser, [list]);
  const { page, mb, decks, years } = host;

  await choose(page, 'Achter');
  // Meteen te starten met wat gekend is, terwijl de rest nog opgezocht wordt.
  await expect(page.getByTestId('deck-can-start')).toBeVisible();
  await expect(page.getByTestId('deck-progress')).toContainText(/\d+ nummers klaar, nog [1-9]\d* op te zoeken \(ongeveer 1 min\)/);
  await expect(page.getByTestId('start-game')).toBeEnabled();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();

  // Vlak voor de start ging de lijst met wat klaar was naar de server.
  await expect.poll(() => decks.length).toBe(1);
  expect(decks[0].status).toBe(200);
  const first = decks[0].body.tracks.length;
  expect(first).toBeGreaterThanOrEqual(10);
  expect(first).toBeLessThan(18);
  for (const t of SITE) expect(decks[0].body.tracks.find((x) => x.id === t.id)?.year).toBe(t.year);

  // Tijdens het spel loopt het opzoeken door, zonder de lijst van dit spel te wijzigen.
  await expect(page.getByTestId('deck-background')).toContainText('doet mee vanaf het volgende spel');
  await expect(page.getByTestId('deck-background')).toHaveCount(0, { timeout: 20_000 });
  expect(decks, 'tijdens het spel gaat er geen lijst naar de server').toHaveLength(1);
  await expect(page.getByTestId('turn-banner')).toBeVisible();

  // Elk nieuw nummer één keer opgezocht, in willekeurige volgorde.
  const order = asked(mb, list);
  expect([...order].sort()).toEqual(list.fake.map((f) => f.title).sort());
  expect(order).not.toEqual(list.fake.map((f) => f.title));
  // En gedeeld met de server, zoals altijd.
  await expect.poll(() => years.writes.flatMap((w) => w.body.entries.map((e) => e.id)).sort()).toEqual(list.fake.map((f) => f.id).sort());

  // Terug naar de wachtkamer: nu gaat de volledige lijst naar de server.
  await openMenu(page);
  await page.getByRole('button', { name: 'Stop dit spel' }).click();
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Achter» · 18 nummers');
  await expect.poll(() => decks.length).toBe(2);
  expect(decks[1].status).toBe(200);
  const all = Object.fromEntries(decks[1].body.tracks.map((t) => [t.id, t.year]));
  for (const f of list.fake) expect(all[f.id]).toBe(f.year);

  // Het volgende spel speelt met alle nummers.
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  expect(decks).toHaveLength(2);
  const playing = host.spotify.plays().at(-1).body.uris[0].replace('spotify:track:', '');
  expect(Object.keys(all)).toContain(playing);
  await host.context.close();
});

test('herladen midden in het opzoeken: het gaat verder waar het was', async ({ browser }) => {
  const list = makePlaylist('Herlaad', 8);
  const host = await newHost(browser, [list], { delay: 800 });
  const { page, mb, spotify, decks } = host;

  await choose(page, 'Herlaad');
  await expect.poll(() => asked(mb, list).length).toBeGreaterThanOrEqual(3);
  await page.reload();
  // Na de herlaad: zonder Spotify opnieuw te lezen, verder met wat nog ontbreekt.
  await expect(page.getByTestId('deck-job')).toBeVisible();
  await expect(page.getByTestId('deck-progress')).toContainText(/nog [1-8] op te zoeken/);
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Herlaad» · 18 nummers', { timeout: 20_000 });
  await expect(page.getByTestId('deck-job')).toHaveCount(0);

  const reads = spotify.calls.filter((c) => c.path === '/playlists/PLHerlaad/items');
  expect(reads, 'de playlist is maar één keer gelezen').toHaveLength(1);
  // Wat voor de herlaad al opgezocht was, niet opnieuw (alleen het nummer dat net bezig was, kan twee keer).
  const order = asked(mb, list);
  expect(new Set(order).size).toBe(8);
  expect(order.length).toBeLessThanOrEqual(9);
  const last = decks.at(-1);
  expect(last.status).toBe(200);
  expect(last.body.tracks).toHaveLength(18);
  expect(await page.evaluate(() => localStorage.getItem('mt.deckJob'))).toBeNull();
  await host.context.close();
});

test('een playlist met meer dan 500 nummers: een willekeurige greep van 500', async ({ browser }) => {
  const id = fakeIds();
  const items = [];
  const answers = {};
  for (let i = 0; i < 600; i++) {
    items.push(item(id(`T${String(i).padStart(3, '0')}`), `Groot ${i}`, 'Band G', '2005-01-01'));
    answers[`Groot ${i}`] = { artist: 'Band G', date: '2001' };
  }
  const unknown = new Set(items.filter((_, i) => i % 60 === 1).map((x) => x.item.id));
  const list = { name: 'Groot', items, answers, fake: [] };
  const host = await newHost(browser, [list], { delay: 0 });
  const { page, mb, decks } = host;

  // De gedeelde lijst van de server kent bijna alles (nagebootst, zodat deze
  // test niets achterlaat); één op de zestig nummers moet opgezocht worden.
  const lookups = [];
  const writes = [];
  await host.context.route(/\/api\/rooms\/[A-Za-z]{4}\/years(\/lookup)?$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = JSON.parse(req.postData());
    if (req.url().endsWith('/lookup')) {
      lookups.push(body.ids);
      const years = {};
      for (const x of body.ids) if (!unknown.has(x)) years[x] = { y: 1990, s: 'musicbrainz', d: [] };
      return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { years } });
    }
    writes.push(body.entries);
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, saved: body.entries.length, skipped: 0 } });
  });

  await choose(page, 'Groot');
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Groot» · 500 nummers', { timeout: 30_000 });
  await expect(page.getByTestId('deck-sample')).toContainText('Deze playlist heeft 600 nummers; het spel koos er willekeurig 500 uit');
  const chosen = lookups.flat();
  expect(chosen).toHaveLength(500);
  expect(new Set(chosen).size).toBe(500);
  expect(new Set(decks.at(-1).body.tracks.map((t) => t.id))).toEqual(new Set(chosen));
  // Alleen van de greep wordt het jaar opgezocht.
  const titles = new Set(items.filter((x) => chosen.includes(x.item.id)).map((x) => x.item.name));
  expect(mb.queries.length).toBeGreaterThan(0);
  for (const q of mb.queries) expect(titles.has(q.match(/recording:"([^"]*)"/)?.[1])).toBe(true);
  expect(writes.flat().length).toBe(mb.queries.length);

  // Een volgende keer: een andere greep.
  await choose(page, 'Groot');
  await expect.poll(() => lookups.length).toBe(2);
  await expect(page.getByTestId('deck-job')).toHaveCount(0, { timeout: 30_000 });
  expect(lookups[1]).toHaveLength(500);
  expect(new Set(lookups[1])).not.toEqual(new Set(chosen));
  await host.context.close();
});

test('opzoeken stoppen, een andere playlist kiezen of terug naar de standaardlijst', async ({ browser }) => {
  const id = fakeIds();
  const a = makePlaylist('Eerste', 8, id);
  const b = makePlaylist('Tweede', 2, id);
  const c = makePlaylist('Derde', 6, id);
  const host = await newHost(browser, [a, b, c], { delay: 700 });
  const { page, mb, decks } = host;

  // --- stoppen: wat klaar is, blijft; er wordt niets meer opgezocht ---
  await choose(page, 'Eerste');
  await expect.poll(() => asked(mb, a).length).toBeGreaterThanOrEqual(2);
  await page.getByTestId('deck-stop').click();
  await expect(page.getByTestId('deck-job')).toHaveCount(0);
  await expect(page.getByTestId('deck-panel')).toContainText('Opzoeken gestopt');
  await expect(page.getByTestId('deck-current')).toContainText('Playlist «Eerste»');
  const stoppedAt = asked(mb, a).length;
  await page.waitForTimeout(1500);
  expect(asked(mb, a).length).toBe(stoppedAt);
  // Na een herlaad gaat een gestopte opzoeking niet vanzelf verder.
  await page.reload();
  await expect(page.getByTestId('deck-panel')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('deck-job')).toHaveCount(0);
  expect(asked(mb, a).length).toBe(stoppedAt);

  // --- opnieuw kiezen: alleen wat nog ontbreekt, en midden daarin een andere playlist ---
  await choose(page, 'Eerste');
  await expect(page.getByTestId('deck-job')).toBeVisible();
  await expect.poll(() => asked(mb, a).length).toBeGreaterThan(stoppedAt);
  await page.getByTestId('deck-open').click();
  await expect(page.getByTestId('deck-open')).toHaveText('Kies een andere playlist');
  await page.getByTestId('playlist-PLTweede').click();
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Tweede» · 12 nummers', { timeout: 20_000 });
  const fromA = asked(mb, a);
  // Wat voor het stoppen klaar was, niet opnieuw; alleen het nummer dat net bezig was, kan twee keer.
  expect(fromA.length - new Set(fromA).size).toBeLessThanOrEqual(1);
  await page.waitForTimeout(1500);
  expect(asked(mb, a)).toEqual(fromA);
  expect(decks.every((d) => d.status === 200)).toBe(true);
  expect(decks.at(-1).body.name).toBe('Tweede');

  // --- tijdens het opzoeken terug naar de standaardlijst ---
  await choose(page, 'Derde');
  await expect(page.getByTestId('deck-job')).toBeVisible();
  await page.getByTestId('deck-default').click();
  await expect(page.getByTestId('deck-job')).toHaveCount(0);
  await expect(page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');
  const atDefault = mb.queries.length;
  await page.waitForTimeout(6000); // langer dan de eerste tussentijdse upload
  expect(mb.queries.length).toBeLessThanOrEqual(atDefault + 1);
  await expect(page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');
  await host.context.close();
});

test('een upload die nog onderweg is, zet de playlist niet terug na «Terug naar de standaardlijst»', async ({ browser }) => {
  const id = fakeIds();
  // Twee nummers die MusicBrainz niet kent: die staan bij de jaartallen om na te kijken.
  const list = { ...makePlaylist('Traag', 2, id), answers: {} };
  const other = makePlaylist('Ander', 1, id);
  const host = await newHost(browser, [list, other], { delay: 0 });
  const { page, context } = host;
  // De server krijgt de lijst pas na een tijd, zoals bij een trage verbinding.
  let slow = 0;
  const sent = [];
  await context.route(/\/api\/rooms\/[A-Za-z]{4}\/deck$/, async (route) => {
    if (route.request().method() === 'POST' && slow) {
      sent.push(JSON.parse(route.request().postData()).name);
      await new Promise((resolve) => setTimeout(resolve, slow));
    }
    await route.continue().catch(() => {});
  });
  const fix = async (track, year) => {
    const doubts = page.getByTestId('deck-doubts');
    if (!(await doubts.evaluate((d) => d.open))) await doubts.locator('summary').click();
    await page.getByTestId(`doubt-${track.id}`).fill(String(year));
    await page.getByTestId(`doubt-${track.id}`).blur();
  };

  // --- een verbetering (upload onderweg), meteen terug naar de standaardlijst ---
  await choose(page, 'Traag');
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Traag» · 12 nummers');
  slow = 2000;
  await fix(list.fake[0], 1999);
  await expect.poll(() => sent.length).toBe(1);
  await page.getByTestId('deck-default').click();
  await page.waitForTimeout(3000); // tot ruim na de vertraagde upload
  await expect(page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');

  // --- een verbetering (upload onderweg), meteen een andere playlist ---
  slow = 0;
  await choose(page, 'Traag');
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Traag» · 12 nummers');
  slow = 2000;
  await fix(list.fake[1], 1998);
  await expect.poll(() => sent.length).toBe(2);
  await choose(page, 'Ander');
  await page.waitForTimeout(5000);
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Ander» · 11 nummers');
  await context.close();
});

test('opzoeken klaar tijdens het spel, daarna herladen: het volgende spel krijgt toch de volledige lijst', async ({ browser }) => {
  const list = makePlaylist('Na', 8);
  const host = await newHost(browser, [list]);
  const { page, decks } = host;
  await choose(page, 'Na');
  await expect(page.getByTestId('deck-can-start')).toBeVisible();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => decks.length).toBe(1);
  expect(decks[0].body.tracks.length).toBeLessThan(18);
  // Het opzoeken raakt klaar tijdens het spel; de lijst kan dan nog niet naar de server.
  await expect(page.getByTestId('deck-background')).toHaveCount(0, { timeout: 20_000 });
  // De gsm van de host herlaadt (bv. de browser haalde het tabblad op de achtergrond weg).
  await page.reload();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  // Vroeger was de volledige lijst dan vergeten, en speelde het volgende spel
  // weer met de kleine lijst van het eerste: dezelfde nummers opnieuw.
  await openMenu(page);
  await page.getByRole('button', { name: 'Stop dit spel' }).click();
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Na» · 18 nummers', { timeout: 20_000 });
  // Het verzoek wordt hier pas genoteerd als het helemaal binnen is; de stand
  // via de WebSocket kan er net voor aankomen.
  await expect.poll(() => decks.at(-1).body.tracks.length).toBe(18);
  expect(decks.at(-1).status).toBe(200);
  expect(await page.evaluate(() => localStorage.getItem('mt.deckJob'))).toBeNull();
  await host.context.close();
});

test('vroeg starten: de gekende nummers trekken de greep niet scheef', async ({ browser }) => {
  // 10 nummers die de site al kent (rock en metal uit de standaardlijst) en
  // 12 die opgezocht moeten worden. Een spel tot 3 kaarten met één speler
  // heeft genoeg aan 10 nummers.
  const list = makePlaylist('Mix', 12);
  const host = await newHost(browser, [list], { delay: 700 });
  const { page, mb, decks } = host;
  await setTarget(page, 3);
  await choose(page, 'Mix');
  // Meteen te starten, maar met vooral gekende nummers: dat zegt het scherm.
  await expect(page.getByTestId('deck-unbalanced')).toBeVisible();
  await expect.poll(() => asked(mb, list).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  const sent = decks.at(-1).body.tracks;
  const site = new Set(SITE.map((t) => t.id));
  const known = sent.filter((t) => site.has(t.id)).length;
  const looked = sent.length - known;
  expect(sent.length).toBeGreaterThanOrEqual(10);
  // Van de gekende gaan er evenveel procent mee als er van de rest opgezocht
  // is, of net genoeg om aan 10 te komen; vroeger gingen ze alle 10 mee.
  // Dat geldt hoeveel er bij de start ook al opgezocht waren (dat hangt af van
  // de snelheid van het netwerk; tegen de echte server zijn het er vaak meer).
  const rest = list.fake.length;
  expect(known).toBeLessThanOrEqual(Math.max(Math.ceil((SITE.length * looked) / rest), 10 - looked));
  expect(known).toBeLessThan(10);
  await host.context.close();
});
