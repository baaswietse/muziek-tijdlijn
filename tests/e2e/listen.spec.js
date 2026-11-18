// «Geluid op dit toestel»: om op afstand te spelen kan een speler (niet de
// host) het fragment ook op zijn eigen gsm laten spelen, alleen als de host
// met fragmenten speelt. Tegen een nagebootste Deezer (fake-deezer.js): de
// browser van een gast die meeluistert, krijgt alleen het adres van de mp3
// (via de server) en spreekt de API van Deezer nooit aan.

import { test, expect } from '@playwright/test';
import {
  openPhone,
  hostGame,
  joinGame,
  setupMusic,
  openMenu,
  closePanel,
  hostAction,
  activeYears,
  correctSlot,
  placeCard,
  passWaiting,
  othersHaveTokens,
  myId,
} from './helpers.js';
import { FRAGMENTS, FRAGMENT_SECONDS, audioState, fakeDeezer, fragmentOf } from './fake-deezer.js';
import { drift } from '../../web/src/fragment/sync.js';

/** Host met fragmenten en een lijst; `mute`: zonder geluid op zijn eigen toestel. */
async function hostWithFragments(browser, { mute = false, list = 'oud' } = {}) {
  const host = await openPhone(browser);
  const deezer = await fakeDeezer(host.context());
  const code = await hostGame(host, 'Hanne');
  await host.getByTestId('source-fragment').click();
  await expect(host.getByTestId('music-status')).toHaveAttribute('data-ready', 'no');
  if (mute) await host.getByTestId('fragment-mute').click();
  else await host.getByTestId('fragment-unlock').click();
  await expect(host.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
  await host.getByTestId(`list-${list}`).click();
  await expect(host.getByTestId('start-game')).toBeEnabled();
  return { host, code, deezer };
}

/** Een gast; `listener`: met een eigen nagebootste Deezer, om te zien wat zijn browser opvraagt. */
async function guest(browser, code, name, { listener = false, fake = {} } = {}) {
  const page = await openPhone(browser);
  const deezer = listener ? await fakeDeezer(page.context(), fake) : null;
  page.requests_ = [];
  page.on('request', (r) => page.requests_.push(r.url()));
  await joinGame(page, code, name);
  return { page, deezer };
}

/** Wacht tot het fragment op `page` speelt (niet gepauzeerd, herhalend), en geeft wat er speelt. */
async function playing(page, { id = null, not = null } = {}) {
  await expect
    .poll(async () => {
      const s = await audioState(page);
      return Boolean(s && !s.paused && s.loop && s.id && (!id || s.id === id) && s.id !== not);
    })
    .toBe(true);
  return audioState(page);
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

const soundFrames = (page) => page.frames_.filter((f) => f.startsWith('{"t":"sound"'));
const parsed = (f) => JSON.parse(f).sound;

/** Zet «Geluid op dit toestel» aan of uit via het menu. */
async function toggleListen(page, on) {
  await openMenu(page);
  const toggle = page.getByTestId('listen-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', on ? 'false' : 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', on ? 'true' : 'false');
  await closePanel(page);
}

/** Het fragment van host en gast loopt ongeveer gelijk (binnen een paar tienden van een seconde). */
async function inStep(host, page) {
  await expect
    .poll(
      async () => {
        const [a, b] = await Promise.all([audioState(host), audioState(page)]);
        if (!a || !b || a.paused || b.paused) return 99;
        return drift(a.time, b.time, FRAGMENT_SECONDS);
      },
      { timeout: 12_000 },
    )
    .toBeLessThan(0.45);
}

test('geluid op dit toestel: een gast hoort het fragment, volgt pauze, opnieuw en ander nummer, en haakt na een herlaad weer aan', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  const { page: bob, deezer: bobDeezer } = await guest(browser, code, 'Bob', { listener: true });
  const { page: cas } = await guest(browser, code, 'Cas');
  const pages = [host, bob, cas];
  const ids = await Promise.all(pages.map(myId));

  // In de wachtkamer staat de keuze al, standaard uit, met de uitleg.
  await expect(bob.getByTestId('listen-toggle')).toHaveAttribute('aria-checked', 'false');
  await expect(bob.getByTestId('listen')).toContainText('op afstand');
  await expect(bob.getByTestId('listen')).toContainText('dubbel');
  // De host heeft de keuze niet (hij heeft zijn eigen geluid).
  await expect(host.getByTestId('listen-toggle')).toHaveCount(0);

  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  const first = await playing(host);
  // Nog niets bij de gasten: geen geluid, geen adres.
  expect(await audioState(bob)).toBeNull();
  expect(soundFrames(bob)).toEqual([]);

  // Bob zet het geluid aan (menu): hetzelfde fragment, gelijk met de host.
  await toggleListen(bob, true);
  await playing(bob, { id: first.id });
  await inStep(host, bob);
  await expect(bob.getByTestId('listen-alert')).toHaveCount(0);
  // Zijn browser speelde het adres uit de nagebootste Deezer, maar sprak de API nooit aan.
  expect(bobDeezer.media.length).toBeGreaterThan(0);
  expect(bobDeezer.api).toEqual([]);
  // Wat hij kreeg: alleen het adres, de start en de plaats.
  const got = parsed(soundFrames(bob).at(-1));
  expect(Object.keys(got).sort()).toEqual(['n', 'playing', 'pos', 'url']);
  expect(got.url).toMatch(/^https:\/\/cdnt-preview\.dzcdn\.net\//);

  // Pauze bij de host: ook bij Bob; verder spelen ook.
  await openMenu(host);
  await host.getByRole('button', { name: 'Pauze' }).click();
  await expect.poll(async () => (await audioState(bob)).paused).toBe(true);
  await host.getByRole('button', { name: 'Verder spelen' }).click();
  await playing(bob, { id: first.id });

  // Opnieuw afspelen: een vers adres bij de host, en Bob begint mee opnieuw.
  const before = (await audioState(bob)).version;
  await host.getByTestId('replay').click();
  await expect.poll(async () => (await audioState(bob)).version).toBeGreaterThan(before);
  await playing(bob, { id: first.id });
  await closePanel(host);

  // Ander nummer: Bob volgt.
  await hostAction(host, 'skip-track');
  const second = await playing(host, { not: first.id });
  await playing(bob, { id: second.id });

  // Bob herlaadt: de keuze blijft, maar de browser moet weer een tik zien.
  await bob.reload();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  await expect(bob.getByTestId('listen-alert')).toContainText('staat nog uit');
  await bob.getByTestId('listen-unlock').click();
  await expect(bob.getByTestId('listen-alert')).toHaveCount(0);
  await playing(bob, { id: second.id });
  await inStep(host, bob);
  await openMenu(bob);
  await expect(bob.getByTestId('listen-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(bob.getByTestId('listen-status')).toHaveText('Het fragment speelt op dit toestel.');
  await closePanel(bob);

  // Tot de onthulling: geen ID, titel, artiest of jaar bij de gasten, ook niet bij Bob.
  for (const id of [first.id, second.id]) {
    expect(leaked(bob, id), `antwoord lekte naar Bob (${id})`).toBe(false);
    expect(leaked(cas, id), `antwoord lekte naar Cas (${id})`).toBe(false);
  }
  // Cas zette niets aan: geen geluidsbericht en geen adres in zijn netwerkgegevens.
  expect(soundFrames(cas)).toEqual([]);
  expect(cas.frames_.some((f) => f.includes('dzcdn') || f.includes('"url"'))).toBe(false);
  expect(cas.requests_.filter((u) => /deezer\.com|dzcdn\.net|fragmenten\.json/.test(u))).toEqual([]);
  expect(await audioState(cas)).toBeNull();
  // Bob haalde alleen mp3's op, nooit de API van Deezer of de lijsten.
  expect(bob.requests_.filter((u) => /api\.deezer\.com|fragmenten\.json/.test(u))).toEqual([]);
  expect(bob.requests_.some((u) => /cdnt-preview\.dzcdn\.net/.test(u))).toBe(true);

  // De beurt afmaken: tijdens de onthulling blijft het spelen, de volgende beurt brengt een nieuw fragment.
  const activeId = await host.getByTestId('turn-banner').getAttribute('data-active');
  const active = pages[ids.indexOf(activeId)];
  const card = fragmentOf(second.id);
  await placeCard(active, correctSlot(await activeYears(active), card.year));
  const challenge = await othersHaveTokens(host, activeId);
  await active.getByTestId('confirm-place').click();
  if (challenge) {
    await passWaiting(pages, active);
    await active.getByTestId('reveal-now').click();
  }
  await expect(bob.getByTestId('reveal')).toHaveAttribute('data-track', second.id);
  await playing(bob, { id: second.id });
  await active.getByTestId('next-turn').click();
  const third = await playing(host, { not: second.id });
  await playing(bob, { id: third.id });
  expect(leaked(bob, third.id)).toBe(false);

  // Uit: Bob is stil en krijgt geen adressen meer.
  await toggleListen(bob, false);
  await expect.poll(async () => (await audioState(bob)).paused).toBe(true);
  const count = soundFrames(bob).length;
  await hostAction(host, 'replay');
  await closePanel(host);
  await playing(host, { id: third.id });
  await host.waitForTimeout(500);
  expect(soundFrames(bob).length).toBe(count);
  expect((await audioState(bob)).paused).toBe(true);
});

test('geluid op dit toestel: een host zonder geluid; de gast die meeluistert hoort het toch', async ({ browser }) => {
  const { host, code, deezer } = await hostWithFragments(browser, { mute: true });
  await expect(host.getByTestId('fragment-muted')).toBeVisible();
  await expect(host.getByTestId('music-status')).toContainText('blijft stil');
  const { page: bob } = await guest(browser, code, 'Bob', { listener: true });
  // In de wachtkamer aanzetten kan ook.
  await bob.getByTestId('listen-toggle').click();
  await expect(bob.getByTestId('listen-toggle')).toHaveAttribute('aria-checked', 'true');
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();

  // De host vraagt het adres op (één verzoek), maar speelt zelf niets.
  await expect.poll(() => deezer.api.length).toBe(1);
  const first = await playing(bob);
  const hostAudio = await audioState(host);
  expect(hostAudio === null || hostAudio.paused).toBe(true);
  await openMenu(host);
  await expect(host.getByTestId('host-music-status')).toContainText('de gsm’s van de spelers');
  // Geen melding «Zet het geluid aan» bij de host.
  await closePanel(host);
  await expect(host.getByTestId('browser-off')).toHaveCount(0);

  // Pauze en verder werken ook zo.
  await openMenu(host);
  await host.getByRole('button', { name: 'Pauze' }).click();
  await expect.poll(async () => (await audioState(bob)).paused).toBe(true);
  await host.getByRole('button', { name: 'Verder spelen' }).click();
  await playing(bob, { id: first.id });
  await closePanel(host);

  // Ander nummer.
  await hostAction(host, 'skip-track');
  await playing(bob, { not: first.id });

  // Na een herlaad blijft de host stil (keuze bewaard) en begint het bij Bob niet opnieuw.
  const n = parsed(soundFrames(bob).at(-1)).n;
  await host.reload();
  await expect(host.getByTestId('turn-banner')).toBeVisible();
  await expect(host.getByTestId('browser-off')).toHaveCount(0);
  await host.waitForTimeout(500);
  expect(parsed(soundFrames(bob).at(-1)).n).toBe(n);
});

test('geluid op dit toestel: speelt het niet bij een gast, dan ziet alleen die het, met «Probeer opnieuw»', async ({ browser }) => {
  // Bij Bob is het eerste adres van elk fragment verlopen (403); bij de host niet.
  const { host, code, deezer } = await hostWithFragments(browser);
  const { page: bob, deezer: bobDeezer } = await guest(browser, code, 'Bob', { listener: true });
  const { page: cas } = await guest(browser, code, 'Cas');
  await host.getByTestId('start-game').click();
  const first = await playing(host);
  for (const t of FRAGMENTS.tracks) bobDeezer.expired.add(String(t.deezer));

  // Verlopen: Bob vraagt via de server een vers adres; de host haalt het op en het speelt vanzelf.
  const calls = deezer.api.length;
  await toggleListen(bob, true);
  await expect.poll(() => deezer.api.length).toBe(calls + 1);
  const now = await playing(bob, { id: first.id });
  expect(now.version).toBeGreaterThan(1);
  expect(bobDeezer.media.some((m) => m.status === 403)).toBe(true);
  expect(bobDeezer.api).toEqual([]);
  // De host speelt gewoon verder (zijn eigen adres), zonder melding.
  expect((await audioState(host)).paused).toBe(false);
  await expect(host.getByTestId('host-music-error')).toHaveCount(0);

  // Geen netwerk bij Bob: alleen hij krijgt een melding met «Probeer opnieuw».
  bobDeezer.expired.clear();
  const offline = (route) => route.abort('internetdisconnected');
  await bob.context().route('https://cdnt-preview.dzcdn.net/**', offline);
  const asked = deezer.api.length;
  await hostAction(host, 'replay');
  await closePanel(host);
  // Bob vraagt een paar keer een vers adres (het zou verlopen kunnen zijn), hoogstens 3 keer per start.
  await expect.poll(() => deezer.api.length).toBe(asked + 1 + 3);
  await host.waitForTimeout(500);
  expect(deezer.api.length).toBe(asked + 1 + 3);
  const alert = bob.getByTestId('listen-alert');
  await expect(alert).toHaveAttribute('data-kind', 'error');
  await expect(alert).toContainText('speelt niet op dit toestel');
  await expect(host.getByTestId('host-music-error')).toHaveCount(0);
  await expect(cas.getByTestId('listen-alert')).toHaveCount(0);
  expect((await audioState(host)).paused).toBe(false);
  // Netwerk terug: één tik.
  await bob.context().unroute('https://cdnt-preview.dzcdn.net/**', offline);
  await bob.getByTestId('listen-retry').click();
  await expect(alert).toHaveCount(0);
  await playing(bob, { id: first.id });

  // De browser weigert het geluid: een knop om het weer aan te zetten.
  await bob.evaluate(() => {
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
  await hostAction(host, 'skip-track');
  const second = await playing(host, { not: first.id });
  await expect(alert).toHaveAttribute('data-kind', 'locked');
  await expect(alert).toContainText('liet het geluid niet toe');
  await bob.getByTestId('listen-unlock').click();
  await playing(bob, { id: second.id });
  await expect(alert).toHaveCount(0);
});

test('geluid op dit toestel: met Spotify is de keuze er niet', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  await expect(bob.getByTestId('waiting')).toBeVisible();
  await expect(bob.getByTestId('listen-toggle')).toHaveCount(0);
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  await openMenu(bob);
  await expect(bob.getByTestId('menu')).toContainText('Spelregels');
  await expect(bob.getByTestId('listen-toggle')).toHaveCount(0);
  await closePanel(bob);
  // Geen geluidsbericht en geen adres.
  expect(soundFrames(bob)).toEqual([]);
  expect(bob.frames_.some((f) => f.includes('dzcdn'))).toBe(false);
});
