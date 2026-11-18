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
  await expect(host.getByTestId('list-alles')).toContainText('40 nummers');
  await expect(host.getByTestId('list-oud')).toContainText('20 nummers');
  await expect(host.getByTestId('list-leeg')).toHaveCount(0);
  await expect(host.getByTestId('deck-mismatch')).toContainText('Kies eerst een lijst');
  await host.getByTestId('list-oud').click();
  await expect(host.getByTestId('deck-current')).toHaveText('Lijst «Oude testfragmenten» · 20 nummers');
  await expect(host.getByTestId('start-game')).toBeEnabled();

  const bob = await openPhone(browser);
  bob.requests_ = [];
  bob.on('request', (r) => bob.requests_.push(r.url()));
  await joinGame(bob, code, 'Bob');
  await expect(bob.getByTestId('lobby-playlist')).toHaveText('Nummers: lijst «Oude testfragmenten» (20)');

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
  await host.getByTestId('list-alles').click();
  await expect(host.getByTestId('deck-current')).toHaveText('Lijst «Alle testfragmenten» · 40 nummers');
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
  await host.getByTestId('list-alles').click();
  await expect(host.getByTestId('deck-current')).toHaveText('Lijst «Alle testfragmenten» · 40 nummers');
  // Terug naar Spotify: de fragmentenlijst past daar niet, dus de standaardlijst.
  await host.getByTestId('source-spotify').click();
  await expect(host.getByTestId('music-login')).toBeVisible();
  await expect(host.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');
  // En weer naar fragmenten: eerst een lijst kiezen.
  await host.getByTestId('source-fragment').click();
  await expect(host.getByTestId('deck-current')).toHaveText('Kies een lijst.');
  await expect(host.getByTestId('start-game')).toBeDisabled();
  // De keuze blijft bewaard na een herlaad.
  await host.reload();
  await expect(host.getByTestId('music-panel')).toHaveAttribute('data-source', 'fragment');
});
