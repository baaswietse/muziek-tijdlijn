// Spelen met fragmenten van Deezer (30 seconden, zonder account), tegen een
// nagebootste Deezer (fake-deezer.js). De host logt nergens in: hij kiest de
// bron, zet met één tik het geluid aan en kiest een van de ingebouwde lijsten.

import { test, expect } from '@playwright/test';
import {
  openPhone,
  hostGame,
  joinGame,
  myId,
  openMenu,
  closePanel,
  hostAction,
  activeYears,
  correctSlot,
  placeCard,
  passWaiting,
  othersHaveTokens,
  setTarget,
  expectFullyVisible,
} from './helpers.js';
import { FRAGMENTS, FRAGMENT_SECONDS, audioState, countLoops, fakeDeezer, fragmentOf } from './fake-deezer.js';

/** Host met fragmenten: bron kiezen, geluid aanzetten, lijst kiezen. */
async function hostWithFragments(browser, fake = {}) {
  const host = await openPhone(browser);
  const deezer = await fakeDeezer(host.context(), fake);
  // Alles wat de host-browser opvraagt, om te zien dat hij Spotify niet nodig heeft.
  host.requests_ = [];
  host.on('request', (r) => host.requests_.push(r.url()));
  const code = await hostGame(host, 'Hanne');
  await host.getByTestId('source-fragment').click();
  await expect(host.getByTestId('music-panel')).toHaveAttribute('data-source', 'fragment');
  // Geen login en geen toestel: alleen één tik om het geluid aan te zetten.
  await expect(host.getByTestId('music-login')).toHaveCount(0);
  await expect(host.getByTestId('music-status')).toHaveAttribute('data-ready', 'no');
  await expect(host.getByTestId('start-game')).toBeDisabled();
  await host.getByTestId('fragment-unlock').click();
  await expect(host.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
  return { host, code, deezer };
}

/**
 * De keuze bij «Nummers» heeft `total` nummers, heet `name`, en de server heeft
 * ze (zo zien de anderen het ook).
 */
async function expectSynced(host, name, total) {
  const box = host.getByTestId('deck-total');
  await expect(box).toHaveAttribute('data-total', String(total));
  await expect(host.getByTestId('deck-name')).toHaveText(name);
  await expect(box).toHaveAttribute('data-synced', 'yes');
}

/** Wacht tot de host een fragment speelt (niet gepauzeerd, herhalend) en geeft het ID. */
async function playing(host, not = null) {
  await expect
    .poll(async () => {
      const s = await audioState(host);
      return s && !s.paused && s.loop && s.id && s.id !== not ? s.id : null;
    })
    .not.toBeNull();
  return (await audioState(host)).id;
}

/** Geen titel, artiest, jaar of ID van dit nummer in wat de server naar `page` stuurde. */
function leaked(page, trackId) {
  const t = fragmentOf(trackId);
  return page.frames_.some(
    (f) =>
      f.includes(`"${trackId}"`) ||
      new RegExp(`(^|[^0-9a-f])${t.deezer}([^0-9a-f]|$)`).test(f) ||
      f.includes(`"title":"${t.title}"`) ||
      f.includes(`"artist":"${t.artist}"`) ||
      f.includes(`"year":${t.year}`),
  );
}

test('volledig spel met fragmenten: lijst kiezen, afspelen, herhalen, ander nummer, onthulling, zonder lek', async ({ browser }) => {
  const { host, code, deezer } = await hostWithFragments(browser);

  // De lijsten van het spel, met hun aantal; een lege lijst staat er niet bij.
  // Standaard speelt het met de lijst met alles, en die gaat meteen naar de server.
  await expect(host.getByTestId('list-alles')).toContainText('90 nummers');
  await expect(host.getByTestId('list-oud')).toContainText('64 nummers');
  await expect(host.getByTestId('list-leeg')).toHaveCount(0);
  await expect(host.getByTestId('list-alles')).toHaveAttribute('aria-checked', 'true');
  await expectSynced(host, 'Alle testfragmenten', 90);
  await host.getByTestId('list-oud').click();
  await expect(host.getByTestId('list-alles')).toHaveAttribute('aria-checked', 'false');
  await expectSynced(host, 'Oude testfragmenten', 64);
  await expect(host.getByTestId('start-game')).toBeEnabled();

  const bob = await openPhone(browser);
  bob.requests_ = [];
  bob.on('request', (r) => bob.requests_.push(r.url()));
  await joinGame(bob, code, 'Bob');
  await expect(bob.getByTestId('lobby-playlist')).toHaveText('Nummers: Oude testfragmenten · 64 nummers');

  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  const oud = new Set(FRAGMENTS.tracks.filter((t) => t.lists.includes('oud')).map((t) => `dz-${t.deezer}`));
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();

  // Het fragment van de beurt speelt, uit de gekozen lijst, en het adres werd
  // vlak voor het afspelen opgevraagd (JSONP).
  let trackId = await playing(host);
  expect(oud.has(trackId)).toBe(true);
  expect(deezer.api.at(-1)).toMatchObject({ id: trackId.slice(3), output: 'jsonp' });
  await expect(host.getByTestId('host-music-error')).toHaveCount(0);

  // Herhalen: het testfragment duurt 1,5 s en begint vanzelf opnieuw.
  await countLoops(host);
  await expect.poll(async () => (await audioState(host)).seeks, { timeout: 8000 }).toBeGreaterThan(0);
  expect((await audioState(host)).paused).toBe(false);
  expect((await audioState(host)).id).toBe(trackId);
  await host.waitForTimeout(FRAGMENT_SECONDS * 1000);
  expect((await audioState(host)).paused).toBe(false);

  // Ook de host ziet titel en artiest niet; het spelscherm toont ze nergens.
  const t = fragmentOf(trackId);
  expect(await host.locator('body').innerText()).not.toContain(t.title);
  expect(await host.locator('body').innerText()).not.toContain(t.artist);

  // Pauze en verder spelen.
  await openMenu(host);
  await host.getByRole('button', { name: 'Pauze' }).click();
  await expect.poll(async () => (await audioState(host)).paused).toBe(true);
  await host.getByRole('button', { name: 'Verder spelen' }).click();
  await expect.poll(async () => (await audioState(host)).paused).toBe(false);

  // Opnieuw afspelen: hetzelfde fragment, met een vers opgevraagd adres.
  const calls = deezer.api.length;
  await host.getByTestId('replay').click();
  await expect.poll(() => deezer.api.length).toBe(calls + 1);
  expect(await playing(host)).toBe(trackId);
  await closePanel(host);

  // Ander nummer: een nieuw fragment voor dezelfde speler.
  const before = trackId;
  await hostAction(host, 'skip-track');
  trackId = await playing(host, before);
  expect(trackId).not.toBe(before);
  expect(oud.has(trackId)).toBe(true);

  // De speler aan beurt legt het nummer juist; daarna de onthulling.
  const activeId = await host.getByTestId('turn-banner').getAttribute('data-active');
  const active = pages[ids.indexOf(activeId)];
  const card = fragmentOf(trackId);
  await placeCard(active, correctSlot(await activeYears(active), card.year));
  // Tot de onthulling krijgt de gast niets van het lopende nummer: geen ID
  // (ook niet het Deezer-ID), titel, artiest of jaar; en zijn browser vraagt
  // niets aan Deezer en haalt de lijsten niet op.
  expect(leaked(bob, trackId), 'antwoord lekte naar de gast').toBe(false);
  expect(leaked(bob, before), 'het overgeslagen nummer lekte naar de gast').toBe(false);
  const challenge = await othersHaveTokens(host, activeId);
  await active.getByTestId('confirm-place').click();
  if (challenge) {
    await passWaiting(pages, active);
    expect(leaked(bob, trackId), 'antwoord lekte in de tussenfase').toBe(false);
    await active.getByTestId('reveal-now').click();
  }
  for (const p of pages) {
    const reveal = p.getByTestId('reveal');
    await expect(reveal).toHaveAttribute('data-track', trackId);
    await expect(reveal).toHaveAttribute('data-correct', 'yes');
    await expect(reveal).toContainText(card.title);
    await expect(reveal).toContainText(card.artist);
    await expect(reveal).toContainText(String(card.year));
    // Na de onthulling: een link naar het nummer bij Deezer, niet naar Spotify.
    await expect(p.getByTestId('reveal-link')).toHaveText('Open in Deezer');
    await expect(p.getByTestId('reveal-link')).toHaveAttribute('href', `https://www.deezer.com/track/${card.deezer}`);
  }
  // Tijdens de onthulling blijft het fragment gewoon herhalen.
  expect((await audioState(host)).id).toBe(trackId);
  expect((await audioState(host)).paused).toBe(false);

  // Volgende beurt: een nieuw fragment.
  await active.getByTestId('next-turn').click();
  const next = await playing(host, trackId);
  expect(oud.has(next)).toBe(true);
  expect(leaked(bob, next)).toBe(false);

  // De gast sprak Deezer nooit aan en haalde de lijsten niet op; de host
  // sprak Spotify nooit aan.
  expect(bob.requests_.filter((u) => /deezer\.com|dzcdn\.net|fragmenten\.json/.test(u))).toEqual([]);
  expect(host.requests_.filter((u) => /spotify\.com|scdn\.co/.test(u))).toEqual([]);
  expect(host.requests_.some((u) => /fragmenten\.json/.test(u))).toBe(true);

  // Het menu zegt waar het geluid uit komt.
  await openMenu(host);
  await expect(host.getByTestId('host-music-status')).toHaveText('Speelt op «Dit toestel»');
});

test('fragmenten: een fragment dat niet bestaat, een verlopen adres, en geluid dat de browser weigert', async ({ browser }) => {
  // Eerst bestaat geen enkel fragment.
  const all = FRAGMENTS.tracks.map((t) => t.deezer);
  const { host, code, deezer } = await hostWithFragments(browser, { missing: all });
  await expectSynced(host, 'Alle testfragmenten', 90);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  await host.getByTestId('start-game').click();

  // Een duidelijke melding op het spelscherm, met «Ander nummer».
  const alert = host.getByTestId('host-music-error');
  await expect(alert).toContainText('bestaat niet (meer)');
  await expect(host.getByTestId('alert-skip')).toHaveText('Ander nummer');
  /** Tik op «Ander nummer» en wacht tot het nieuwe fragment opgevraagd is. */
  const skip = async () => {
    const calls = deezer.api.length;
    const shown = deezer.api.at(-1).id;
    await host.getByTestId('alert-skip').click();
    await expect.poll(() => deezer.api.length).toBeGreaterThan(calls);
    expect(deezer.api.at(-1).id).not.toBe(shown);
  };
  await skip();
  await expect(alert).toContainText('bestaat niet (meer)');
  await expect(host.getByTestId('alert-skip')).toBeVisible();

  // Een fragment zonder adres (preview leeg) telt ook als «bestaat niet».
  deezer.missing.clear();
  for (const id of all) deezer.noPreview.add(String(id));
  await skip();
  await expect(alert).toContainText('bestaat niet (meer)');
  await expect(host.getByTestId('alert-skip')).toBeVisible();

  // Nu bestaan ze wel, maar het eerste adres is verlopen (403): het spel
  // vraagt zelf één keer een nieuw adres en speelt dan.
  deezer.noPreview.clear();
  for (const id of all) deezer.expired.add(String(id));
  await skip();
  const trackId = await playing(host);
  await expect(alert).toHaveCount(0);
  const id = trackId.slice(3);
  expect(deezer.media.filter((m) => m.id === id).map((m) => [m.version, m.status])).toEqual(
    expect.arrayContaining([
      [1, 403],
      [2, 200],
    ]),
  );

  // De browser weigert het geluid (zoals na een tijd zonder aanraking): de
  // host krijgt één knop om het weer aan te zetten.
  await host.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    window.__refuse = 1;
    HTMLMediaElement.prototype.play = function () {
      if (window.__refuse > 0) {
        window.__refuse -= 1;
        this.pause();
        return Promise.reject(new DOMException('geweigerd', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
  await hostAction(host, 'replay');
  await closePanel(host);
  const off = host.getByTestId('browser-off');
  await expect(off).toContainText('liet het geluid niet toe');
  await off.getByTestId('device-browser').click();
  expect(await playing(host)).toBe(trackId);
  await expect(off).toHaveCount(0);

  // Na een herlaad is het geluid weer vergrendeld: één tik zet het aan, en het
  // fragment van deze beurt begint opnieuw.
  await host.reload();
  await expect(host.getByTestId('turn-banner')).toBeVisible();
  await expect(host.getByTestId('browser-off')).toContainText('staat nog uit');
  await host.getByTestId('browser-off').getByTestId('device-browser').click();
  expect(await playing(host)).toBe(trackId);
});

test('fragmenten en Spotify: wisselen van bron past de lijst aan', async ({ browser }) => {
  const { host } = await hostWithFragments(browser);
  await expectSynced(host, 'Alle testfragmenten', 90);
  // Terug naar Spotify: de fragmentenlijst past daar niet, dus de standaardlijst.
  await host.getByTestId('source-spotify').click();
  await expect(host.getByTestId('music-login')).toBeVisible();
  await expect(host.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');
  // En weer naar fragmenten: de bewaarde keuze gaat meteen opnieuw naar de server.
  await host.getByTestId('source-fragment').click();
  await expectSynced(host, 'Alle testfragmenten', 90);
  await expect(host.getByTestId('start-game')).toBeEnabled();
  // De keuze blijft bewaard na een herlaad.
  await host.reload();
  await expect(host.getByTestId('music-panel')).toHaveAttribute('data-source', 'fragment');
});

/** De stapels die de host naar de server stuurde (POST /deck), in volgorde. */
function watchDecks(page) {
  const decks = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/rooms\/[A-Z]+\/deck$/.test(r.url())) decks.push(JSON.parse(r.postData()));
  });
  return decks;
}

const inLists = (ids) => new Set(FRAGMENTS.tracks.filter((t) => t.lists.some((l) => ids.includes(l))).map((t) => `dz-${t.deezer}`));
const BOTH = 'Oude testfragmenten + Nieuwe testfragmenten';

test('lijstkeuze: twee lijsten samen en een periode; het totaal is wat naar de server gaat, ook na een herlaad', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  const decks = watchDecks(host);
  await expectSynced(host, 'Alle testfragmenten', 90);
  await expect(host.getByTestId('count-nieuw')).toHaveText('31 nummers');

  // Een andere lijst aanvinken zet «Alle testfragmenten» uit; twee lijsten samen, zonder dubbels.
  await host.getByTestId('list-nieuw').click();
  await expect(host.getByTestId('list-alles')).toHaveAttribute('aria-checked', 'false');
  await host.getByTestId('list-oud').click();
  for (const id of ['oud', 'nieuw']) await expect(host.getByTestId(`list-${id}`)).toHaveAttribute('aria-checked', 'true');
  await expectSynced(host, BOTH, 85);

  // Een periode: van 1980 tot en met 2000. De aantallen per lijst volgen mee.
  await host.getByTestId('period-from').selectOption('1980');
  await host.getByTestId('period-to').selectOption('2000');
  await expect(host.getByTestId('count-oud')).toHaveText('15 nummers');
  await expect(host.getByTestId('count-nieuw')).toHaveText('16 nummers');
  await expect(host.getByTestId('count-alles')).toHaveText('21 nummers');
  await expect(host.getByTestId('count-period')).toHaveText('Aantallen per lijst binnen de periode 1980–2000.');
  await expectSynced(host, `${BOTH}, 1980–2000`, 21);

  // Wat naar de server ging, is precies dat: 21 nummers uit die lijsten en jaren, zonder lijsten erbij.
  const last = decks.at(-1);
  expect(last.name).toBe(`${BOTH}, 1980–2000`);
  expect(last.tracks).toHaveLength(21);
  expect(new Set(last.tracks.map((t) => t.id)).size).toBe(21);
  const allowed = inLists(['oud', 'nieuw']);
  for (const t of last.tracks) {
    expect(allowed.has(t.id)).toBe(true);
    expect(t.year).toBeGreaterThanOrEqual(1980);
    expect(t.year).toBeLessThanOrEqual(2000);
    expect(Object.keys(t).sort()).toEqual(['artist', 'id', 'title', 'year']);
  }

  // Alleen: genoeg (1 speler naar 10 kaarten: 20 nodig). Met een gast: 40 nodig, dus te weinig.
  await expect(host.getByTestId('start-game')).toBeEnabled();
  const bob = await openPhone(browser);
  bob.requests_ = [];
  bob.on('request', (r) => bob.requests_.push(r.url()));
  await joinGame(bob, code, 'Bob');
  await expect(host.getByTestId('deck-short')).toContainText('voor 2 spelers naar 10 kaarten zijn er minstens 40 nodig');
  await expect(host.getByTestId('start-game')).toBeDisabled();
  // De gast ziet waarmee gespeeld wordt, zonder één nummer.
  await expect(bob.getByTestId('lobby-playlist')).toHaveText(`Nummers: ${BOTH}, 1980–2000 · 21 nummers`);
  expect(await bob.locator('body').innerText()).not.toContain('Fragmentlied');
  expect(bob.frames_.some((f) => f.includes('Fragmentlied') || f.includes('Fragmentgroep') || f.includes('dz-'))).toBe(false);
  expect(bob.requests_.filter((u) => /deezer\.com|dzcdn\.net|fragmenten\.json/.test(u))).toEqual([]);
  // Naar minder kaarten: dan is het weer genoeg (2 × 5 × 2 = 20).
  await setTarget(host, 5);
  await expect(host.getByTestId('deck-short')).toHaveCount(0);
  await expect(host.getByTestId('start-game')).toBeEnabled();

  // Na een herlaad: dezelfde keuze, en niets opnieuw naar de server (die heeft ze al).
  const sent = decks.length;
  await host.reload();
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-total', '21');
  for (const id of ['oud', 'nieuw']) await expect(host.getByTestId(`list-${id}`)).toHaveAttribute('aria-checked', 'true');
  await expect(host.getByTestId('list-alles')).toHaveAttribute('aria-checked', 'false');
  await expect(host.getByTestId('period-from')).toHaveValue('1980');
  await expect(host.getByTestId('period-to')).toHaveValue('2000');
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-synced', 'yes');
  await host.waitForTimeout(1000);
  expect(decks.length).toBe(sent);

  // «Alle jaren» haalt de periode weg.
  await host.getByTestId('period-clear').click();
  await expect(host.getByTestId('period-from')).toHaveValue('');
  await expect(host.getByTestId('period-to')).toHaveValue('');
  await expect(host.getByTestId('period-clear')).toHaveCount(0);
  await expectSynced(host, BOTH, 85);
  await expect(bob.getByTestId('lobby-playlist')).toHaveText(`Nummers: ${BOTH} · 85 nummers`);

  // Ook in een volgend spel op deze gsm (een nieuwe wachtkamer) blijft de keuze.
  await host.getByRole('button', { name: 'Verlaat het spel' }).click();
  await hostGame(host, 'Hanne');
  await expect(host.getByTestId('music-panel')).toHaveAttribute('data-source', 'fragment');
  await expectSynced(host, BOTH, 85);
});

test('lijstkeuze: te weinig nummers houdt Start tegen, met uitleg; een lege keuze of periode ook', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  await expectSynced(host, 'Alle testfragmenten', 90);
  await expect(host.getByTestId('start-game')).toBeEnabled();

  // Alleen «Nieuwe testfragmenten» (31): te weinig voor 2 spelers naar 10 kaarten (40).
  await host.getByTestId('list-nieuw').click();
  await expectSynced(host, 'Nieuwe testfragmenten', 31);
  await expect(host.getByTestId('deck-short')).toHaveText(
    'Te weinig nummers: voor 2 spelers naar 10 kaarten zijn er minstens 40 nodig. Vink meer lijsten aan, kies een ruimere periode of speel naar minder kaarten.',
  );
  await expect(host.getByTestId('start-game')).toBeDisabled();
  await expect(host.getByTestId('deck-mismatch')).toHaveText('Te weinig nummers: kies er meer bij «Nummers».');
  await expect(bob.getByTestId('lobby-playlist')).toHaveText('Nummers: Nieuwe testfragmenten · 31 nummers');

  // Een periode met maar 1 nummer: minder dan de server aanneemt, dus de oude stapel gaat weg.
  await host.getByTestId('period-from').selectOption('2015');
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-total', '1');
  await expect(host.getByTestId('deck-count')).toHaveText('1');
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-synced', 'yes');
  await expect(bob.getByTestId('lobby-playlist')).toHaveCount(0);
  await expect(host.getByTestId('start-game')).toBeDisabled();

  // Een periode zonder één nummer in die lijst.
  await host.getByTestId('list-oud').click();
  await host.getByTestId('list-nieuw').click();
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-total', '0');
  await expect(host.getByTestId('deck-short')).toHaveText('Geen nummers in deze periode. Kies een ruimere periode of andere lijsten.');
  await expect(host.getByTestId('count-oud')).toHaveText('0 nummers');

  // Niets aangevinkt.
  await host.getByTestId('list-oud').click();
  await expect(host.getByTestId('deck-short')).toHaveText('Vink minstens één lijst aan.');
  await expect(host.getByTestId('deck-name')).toHaveText('Nog geen lijst gekozen');
  await expect(host.getByTestId('deck-mismatch')).toHaveText('Kies eerst nummers bij «Nummers».');
  await expect(host.getByTestId('start-game')).toBeDisabled();

  // «Alle testfragmenten» samen met een andere: aanvinken zet de rest uit.
  await host.getByTestId('list-oud').click();
  await host.getByTestId('list-alles').click();
  await expect(host.getByTestId('list-oud')).toHaveAttribute('aria-checked', 'false');
  await host.getByTestId('period-clear').click();
  await expectSynced(host, 'Alle testfragmenten', 90);
  await expect(host.getByTestId('deck-short')).toHaveCount(0);
  await expect(host.getByTestId('start-game')).toBeEnabled();
  await expect(bob.getByTestId('lobby-playlist')).toHaveText('Nummers: Alle testfragmenten · 90 nummers');
});

test('lijstkeuze: een volledig kort spel met twee lijsten en een periode, zonder lek', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  await host.getByTestId('list-oud').click();
  await host.getByTestId('list-nieuw').click();
  await host.getByTestId('period-from').selectOption('1980');
  await host.getByTestId('period-to').selectOption('2000');
  await setTarget(host, 3);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  await expectSynced(host, `${BOTH}, 1980–2000`, 21);
  await expect(bob.getByTestId('lobby-playlist')).toHaveText(`Nummers: ${BOTH}, 1980–2000 · 21 nummers`);

  const chosen = new Set(
    FRAGMENTS.tracks
      .filter((t) => t.year >= 1980 && t.year <= 2000 && t.lists.some((l) => l === 'oud' || l === 'nieuw'))
      .map((t) => `dz-${t.deezer}`),
  );
  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  // De startkaarten komen ook uit de keuze.
  for (const y of await activeYears(host)) expect(y >= 1980 && y <= 2000).toBe(true);

  let last = null;
  for (let turn = 0; turn < 12; turn++) {
    const trackId = await playing(host, last);
    last = trackId;
    expect(chosen.has(trackId), `${trackId} zit niet in de keuze`).toBe(true);
    const activeId = await host.getByTestId('turn-banner').getAttribute('data-active');
    const active = pages[ids.indexOf(activeId)];
    const card = fragmentOf(trackId);
    await placeCard(active, correctSlot(await activeYears(active), card.year));
    expect(leaked(bob, trackId), 'antwoord lekte naar de gast').toBe(false);
    const challenge = await othersHaveTokens(host, activeId);
    await active.getByTestId('confirm-place').click();
    if (challenge) {
      await passWaiting(pages, active);
      await active.getByTestId('reveal-now').click();
    }
    await expect(host.getByTestId('reveal')).toHaveAttribute('data-track', trackId);
    await expect(host.getByTestId('reveal')).toHaveAttribute('data-correct', 'yes');
    if (await host.getByTestId('winner').isVisible()) break;
    await active.getByTestId('next-turn').click();
  }
  await expect(host.getByTestId('winner')).toBeVisible();
  const winners = await host.getByTestId('winner').getAttribute('data-winners');
  expect(ids).toContain(winners);
  await expect(bob.getByTestId('winner')).toHaveAttribute('data-winners', winners);
});

test('lijstkeuze: op een smal scherm (320 px) met grotere letters valt niets buiten beeld', async ({ browser }) => {
  const host = await openPhone(browser, { viewport: { width: 320, height: 640 } });
  await host.context().addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html, body, button, input, select { font-size: 21px; }';
      document.head.append(style);
    });
  });
  await fakeDeezer(host.context());
  await host.reload();
  const code = await hostGame(host, 'Hanne');
  await host.getByTestId('source-fragment').click();
  await host.getByTestId('fragment-unlock').click();
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  await host.getByTestId('list-oud').click();
  await host.getByTestId('list-nieuw').click();
  await host.getByTestId('period-from').selectOption('1980');
  await host.getByTestId('period-to').selectOption('2000');
  await expect(host.getByTestId('deck-short')).toBeVisible();
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-synced', 'yes');

  // Geen horizontaal scrollen, en elk deel van de keuze past in beeld.
  expect(await host.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const parts = [
    'list-alles',
    'list-oud',
    'list-nieuw',
    'count-oud',
    'period-from',
    'period-to',
    'period-clear',
    'deck-total',
    'deck-name',
    'deck-short',
    'start-game',
    'deck-mismatch',
  ];
  for (const id of parts) {
    const el = host.getByTestId(id);
    await el.scrollIntoViewIfNeeded();
    await expectFullyVisible(el);
  }
  // Er ligt niets over de knoppen: de wachtkamer heeft geen zwevende balk, maar de bovenbalk plakt wel bovenaan.
  for (const id of ['list-nieuw', 'period-to', 'period-clear', 'start-game']) {
    const el = host.getByTestId(id);
    await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    const onTop = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return node === hit || node.contains(hit);
    });
    expect(onTop, `${id} ligt onder iets anders`).toBe(true);
  }
});
