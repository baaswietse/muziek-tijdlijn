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
  expectFullyVisible,
} from './helpers.js';
import { FRAGMENTS, LONG_FRAGMENT_SECONDS, audioState, fakeDeezer, fragmentOf } from './fake-deezer.js';
import { drift } from '../../web/src/fragment/sync.js';

/**
 * Host met fragmenten en een lijst; `mute`: zonder geluid op zijn eigen
 * toestel; `long`: met het testfragment van 20 s (zie fake-deezer.js).
 */
async function hostWithFragments(browser, { mute = false, list = 'oud', long = false } = {}) {
  const host = await openPhone(browser);
  const deezer = await fakeDeezer(host.context(), { long });
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
async function guest(browser, code, name, { listener = false, fake = {}, viewport = null, bigText = false } = {}) {
  const page = await openPhone(browser, { viewport });
  // Grotere letters, zoals iemand die de tekst op zijn gsm groter zette.
  if (bigText) {
    await page.context().addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = 'html, body, button, input { font-size: 21px; }';
        document.head.append(style);
      });
    });
    await page.reload();
  }
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

/** Ligt het midden van het element bovenaan (geen balk, melding of paneel erover)? */
const onTop = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit) ? true : `${hit?.className || hit?.tagName} over ${el.dataset.testid}`;
  });

/** Groot genoeg om met de vinger te raken (44 bij 44 px), helemaal in beeld en niet bedekt. */
async function tappable(loc) {
  await expectFullyVisible(loc);
  const box = await loc.boundingBox();
  expect(box.width, 'breedte').toBeGreaterThanOrEqual(44);
  expect(box.height, 'hoogte').toBeGreaterThanOrEqual(44);
  expect(await onTop(loc)).toBe(true);
}

/** De pagina schuift niet opzij (niets breder dan het scherm). */
const noSideScroll = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

/** De luidsprekerknop in de bovenbalk staat zichtbaar in stand `on`, met het menu dicht. */
async function quickIs(page, on) {
  await expect(page.getByTestId('menu')).toBeHidden();
  const btn = page.getByTestId('listen-quick');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-checked', on ? 'true' : 'false');
  await expect(btn).toHaveAccessibleName('Geluid op dit toestel');
  return btn;
}

/** Wacht tot `page` aan de beurt is (de host slaat beurten over). */
async function turnOf(host, page) {
  const id = await myId(page);
  for (let i = 0; i < 6; i++) {
    const banner = host.getByTestId('turn-banner');
    const now = await banner.getAttribute('data-active');
    if (now === id) return;
    await hostAction(host, 'skip-turn');
    await expect(banner).not.toHaveAttribute('data-active', now);
  }
  throw new Error('niet aan de beurt geraakt');
}

/** Hoe ver het fragment van host en gast uit elkaar ligt (s); 99 als er een niet speelt. */
async function gap(host, page, duration) {
  const [a, b] = await Promise.all([audioState(host), audioState(page)]);
  if (!a || !b || a.paused || b.paused) return 99;
  return drift(a.time, b.time, duration);
}

/**
 * Het fragment van host en gast loopt ongeveer gelijk: hoogstens 0,45 s. De
 * gast springt pas bij als hij meer dan TOLERANCE (0,35 s) van de plaats
 * volgens de server afwijkt (zie web/src/fragment/sync.js), dus tot 0,35 s
 * mag hij blijven staan; de rest (0,1 s) is voor wat de schatting niet ziet:
 * de tijd dat de start van de host naar de server onderweg was (live een paar
 * honderdsten), en dat de twee metingen niet op hetzelfde ogenblik vallen.
 *
 * Meet dit alleen met het fragment van 20 s (`long`, `LONG_FRAGMENT_SECONDS`).
 * Bij het fragment van 1,5 s zegt het niets: het telt modulo 1,5 s, de host
 * verliest bij elke herhaling zo'n 0,1 s tegenover de klok van de server, en
 * springen kan daar niet (zonder Range springt Chromium naar het begin, zie
 * fake-deezer.js). Het verschil hangt dan alleen af van hoe lang de test
 * erover deed, en dat is live anders dan lokaal.
 */
async function inStep(host, page, duration, { timeout = 12_000 } = {}) {
  await expect.poll(() => gap(host, page, duration), { timeout }).toBeLessThan(0.45);
}

/** Blijft het `ms` lang gelijk (binnen de gewone marge), ook na de controle om de 5 s? */
async function staysInStep(host, page, duration, ms) {
  const gaps = [];
  for (const end = Date.now() + ms; Date.now() < end; ) {
    gaps.push(Math.round((await gap(host, page, duration)) * 100) / 100);
    await host.waitForTimeout(250);
  }
  expect(Math.max(...gaps), `verschil host en gast: ${gaps.join(' ')}`).toBeLessThan(0.45);
}

test('geluid op dit toestel: een gast hoort het fragment, volgt pauze, opnieuw en ander nummer, en haakt na een herlaad weer aan', async ({ browser }) => {
  // Met het testfragment van 20 s, zodat inStep echt meet hoe gelijk het loopt.
  const { host, code } = await hostWithFragments(browser, { long: true });
  const { page: bob, deezer: bobDeezer } = await guest(browser, code, 'Bob', { listener: true, fake: { long: true } });
  const D = LONG_FRAGMENT_SECONDS;
  const { page: cas } = await guest(browser, code, 'Cas');
  const pages = [host, bob, cas];
  const ids = await Promise.all(pages.map(myId));

  // In de wachtkamer staat de keuze al, standaard uit, met de uitleg.
  await expect(bob.getByTestId('listen-card')).toHaveAttribute('data-on', 'no');
  await expect(bob.getByTestId('listen-card')).toContainText('op afstand');
  await expect(bob.getByTestId('listen-card')).toContainText('dubbel');
  // De host heeft de keuze niet (hij heeft zijn eigen geluid).
  await expect(host.getByTestId('listen-card')).toHaveCount(0);
  await expect(host.getByTestId('listen-toggle')).toHaveCount(0);

  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  const first = await playing(host);
  // Nog niets bij de gasten: geen geluid, geen adres.
  expect(await audioState(bob)).toBeNull();
  expect(soundFrames(bob)).toEqual([]);

  // De host heeft geen luidsprekerknop bovenaan.
  await expect(host.getByTestId('listen-quick')).toHaveCount(0);

  // Bob zet het geluid aan (bovenaan, zonder menu): hetzelfde fragment, gelijk met de host.
  await (await quickIs(bob, false)).click();
  await quickIs(bob, true);
  await playing(bob, { id: first.id });
  await inStep(host, bob, D);
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
  // Bovenaan: nog uit (er speelt hier niets), tot de tik.
  await quickIs(bob, false);
  await bob.getByTestId('listen-unlock').click();
  await quickIs(bob, true);
  await expect(bob.getByTestId('listen-alert')).toHaveCount(0);
  await playing(bob, { id: second.id });
  await inStep(host, bob, D);
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

  // Uit (via het menu): Bob is stil en krijgt geen adressen meer.
  await toggleListen(bob, false);
  await quickIs(bob, false);
  await expect.poll(async () => (await audioState(bob)).paused).toBe(true);
  const count = soundFrames(bob).length;
  await hostAction(host, 'replay');
  await closePanel(host);
  await playing(host, { id: third.id });
  await host.waitForTimeout(500);
  expect(soundFrames(bob).length).toBe(count);
  expect((await audioState(bob)).paused).toBe(true);
});

test('geluid op dit toestel: uit en weer aan in dezelfde beurt, en het loopt weer gelijk met de host', async ({ browser }) => {
  // Met het testfragment van 20 s: zo meet het echt hoe gelijk het loopt (zie inStep).
  const { host, code } = await hostWithFragments(browser, { long: true });
  const { page: bob } = await guest(browser, code, 'Bob', { listener: true, fake: { long: true } });
  const D = LONG_FRAGMENT_SECONDS;
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  const first = await playing(host);
  const turn = await host.getByTestId('turn-banner').getAttribute('data-active');

  // Aan: gelijk met de host.
  await (await quickIs(bob, false)).click();
  await playing(bob, { id: first.id });
  await inStep(host, bob, D);
  const n = parsed(soundFrames(bob).at(-1)).n;

  // Uit, even wachten (de host speelt verder), en weer aan: hetzelfde fragment,
  // niet van voren maar waar de host nu is, en dat blijft zo (ook na de controle om de 5 s).
  await (await quickIs(bob, true)).click();
  await quickIs(bob, false);
  await expect.poll(async () => (await audioState(bob)).paused).toBe(true);
  await host.waitForTimeout(1000);
  await (await quickIs(bob, false)).click();
  await quickIs(bob, true);
  await playing(bob, { id: first.id });
  // Meteen, niet pas bij de controle om de 5 s.
  await inStep(host, bob, D, { timeout: 3000 });
  expect((await audioState(bob)).time).toBeGreaterThan(1);
  await staysInStep(host, bob, D, 6000);

  // Meteen uit en weer aan (via het menu): ook dan.
  await toggleListen(bob, false);
  await toggleListen(bob, true);
  await playing(bob, { id: first.id });
  await inStep(host, bob, D, { timeout: 3000 });
  await staysInStep(host, bob, D, 3000);

  // Nog altijd dezelfde beurt en dezelfde start: niets begon opnieuw.
  await expect(host.getByTestId('turn-banner')).toHaveAttribute('data-active', turn);
  expect(parsed(soundFrames(bob).at(-1)).n).toBe(n);
  await expect(bob.getByTestId('listen-alert')).toHaveCount(0);
});

test('geluid op dit toestel: een host zonder geluid; de gast die meeluistert hoort het toch', async ({ browser }) => {
  const { host, code, deezer } = await hostWithFragments(browser, { mute: true });
  await expect(host.getByTestId('fragment-muted')).toBeVisible();
  await expect(host.getByTestId('music-status')).toContainText('blijft stil');
  const { page: bob } = await guest(browser, code, 'Bob', { listener: true });
  // In de wachtkamer aanzetten kan ook.
  await bob.getByTestId('listen-on').click();
  await expect(bob.getByTestId('listen-card')).toHaveAttribute('data-on', 'yes');
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
  await expect(bob.getByTestId('listen-card')).toHaveCount(0);
  await expect(bob.locator('main')).not.toContainText('Hoor je');
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  // Geen knop bovenaan en geen tip.
  await expect(bob.getByTestId('listen-quick')).toHaveCount(0);
  await bob.waitForTimeout(500);
  await expect(bob.getByTestId('listen-hint')).toHaveCount(0);
  await expect(bob.getByTestId('listen-alert')).toHaveCount(0);
  await openMenu(bob);
  await expect(bob.getByTestId('menu')).toContainText('Spelregels');
  await expect(bob.getByTestId('listen-toggle')).toHaveCount(0);
  await closePanel(bob);
  // Geen geluidsbericht en geen adres.
  expect(soundFrames(bob)).toEqual([]);
  expect(bob.frames_.some((f) => f.includes('dzcdn'))).toBe(false);
});

test('geluid op dit toestel: een duidelijk blok bovenaan de wachtkamer en een luidsprekerknop bovenaan het spel', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  const { page: bob } = await guest(browser, code, 'Bob', { listener: true });
  const card = bob.getByTestId('listen-card');

  // Bovenaan (boven de uitnodiging), met een vraag in gewone taal en een echte knop.
  await expect(card).toHaveAttribute('data-on', 'no');
  await expect(card).toContainText('Hoor je de muziek van de host niet?');
  expect(await bob.evaluate(() => document.querySelector('main.page > *')?.dataset.testid)).toBe('listen-card');
  await expect(bob.getByRole('button', { name: 'Zet het geluid hier aan' })).toBeVisible();
  await tappable(bob.getByTestId('listen-on'));

  // Eén tik: aan, en dat staat er duidelijk.
  await bob.getByTestId('listen-on').click();
  await expect(card).toHaveAttribute('data-on', 'yes');
  await expect(card).toContainText('Het geluid staat aan op deze gsm');
  await expect(bob.getByTestId('listen-status')).toHaveText('Wacht op het fragment van de host…');
  // Weer uit kan ook, en weer aan.
  await tappable(bob.getByTestId('listen-off'));
  await bob.getByTestId('listen-off').click();
  await expect(card).toHaveAttribute('data-on', 'no');
  await bob.getByTestId('listen-on').click();
  await expect(card).toHaveAttribute('data-on', 'yes');

  await host.getByTestId('start-game').click();
  const first = await playing(host);
  await playing(bob, { id: first.id });
  // Op het spelscherm: «aan», zichtbaar zonder het menu te openen; geen tip (het staat al aan).
  const quick = await quickIs(bob, true);
  await tappable(quick);
  await expect(bob.getByTestId('listen-hint')).toHaveCount(0);

  // Eén tik: uit en stil.
  await quick.click();
  await quickIs(bob, false);
  await expect.poll(async () => (await audioState(bob)).paused).toBe(true);
  // Het menu zegt hetzelfde.
  await openMenu(bob);
  await expect(bob.getByTestId('listen-toggle')).toHaveAttribute('aria-checked', 'false');
  await closePanel(bob);
  // Ook nu geen tip: Bob zette het zelf uit.
  await bob.waitForTimeout(300);
  await expect(bob.getByTestId('listen-hint')).toHaveCount(0);

  // Weer aan: het fragment speelt weer.
  await quick.click();
  await quickIs(bob, true);
  await playing(bob, { id: first.id });
});

test('geluid op dit toestel: staat het uit terwijl er een fragment loopt, dan één keer per spel een tip die je wegtikt', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  const { page: bob } = await guest(browser, code, 'Bob', { listener: true });
  const { page: cas } = await guest(browser, code, 'Cas', { listener: true });
  // In de wachtkamer nog geen tip (er loopt nog niets).
  await expect(bob.getByTestId('listen-hint')).toHaveCount(0);
  await host.getByTestId('start-game').click();
  const first = await playing(host);

  // Bob en Cas zien de tip; het geluid gaat er niet vanzelf van aan.
  for (const p of [bob, cas]) {
    await expect(p.getByTestId('listen-hint')).toContainText('Hoor je de muziek niet?');
    await quickIs(p, false);
  }
  await expect(host.getByTestId('listen-hint')).toHaveCount(0);
  expect(await audioState(bob)).toBeNull();

  // Bob tikt de tip weg: weg, en nog altijd stil.
  await tappable(bob.getByTestId('listen-hint-close'));
  await bob.getByTestId('listen-hint-close').click();
  await expect(bob.getByTestId('listen-hint')).toHaveCount(0);
  await quickIs(bob, false);
  expect(await audioState(bob)).toBeNull();

  // Cas zet het geluid met één tik aan vanuit de tip.
  await tappable(cas.getByTestId('listen-hint-on'));
  await cas.getByTestId('listen-hint-on').click();
  await expect(cas.getByTestId('listen-hint')).toHaveCount(0);
  await quickIs(cas, true);
  await playing(cas, { id: first.id });

  // Niet opnieuw: niet na een herlaad, niet als Cas het weer uitzet, niet bij de volgende beurt.
  await bob.reload();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  await cas.getByTestId('listen-quick').click();
  await quickIs(cas, false);
  const turn = await host.getByTestId('turn-banner').getAttribute('data-active');
  await hostAction(host, 'skip-turn');
  await closePanel(host);
  await expect(host.getByTestId('turn-banner')).not.toHaveAttribute('data-active', turn);
  await playing(host, { not: first.id });
  await bob.waitForTimeout(500);
  for (const p of [bob, cas]) await expect(p.getByTestId('listen-hint')).toHaveCount(0);
});

test('geluid op dit toestel: op een smal scherm (320 px) met grotere letters blijft alles zichtbaar en vrij', async ({ browser }) => {
  const { host, code } = await hostWithFragments(browser);
  const { page: bob } = await guest(browser, code, 'Bob', { listener: true, viewport: { width: 320, height: 640 }, bigText: true });

  // Wachtkamer: het blok en zijn knop, uit en aan, helemaal binnen de breedte van het scherm.
  const card = bob.getByTestId('listen-card');
  await expectFullyVisible(card);
  await tappable(bob.getByTestId('listen-on'));
  await bob.getByTestId('listen-on').click();
  await expect(card).toHaveAttribute('data-on', 'yes');
  await expectFullyVisible(card);
  await tappable(bob.getByTestId('listen-off'));
  await bob.getByTestId('listen-off').click();
  await expect(bob.getByTestId('listen-card')).toHaveAttribute('data-on', 'no');

  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  await playing(host);
  // De bovenbalk en de tip.
  await expect(bob.getByTestId('listen-hint')).toBeVisible();
  await expectFullyVisible(bob.getByTestId('listen-hint'));
  for (const id of ['stand-open', 'listen-quick', 'menu-open', 'listen-hint-on', 'listen-hint-close']) await tappable(bob.getByTestId(id));
  await noSideScroll(bob);

  // Bob aan de beurt, met een gekozen plaats: de zwevende balk staat onderaan.
  // De tip opnieuw (alsof hij hem nog niet zag), om te zien dat ook dan niets bedekt raakt.
  await turnOf(host, bob);
  await closePanel(host);
  await bob.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('mt.listenHint.')) localStorage.removeItem(k);
  });
  await bob.reload();
  await expect(bob.getByTestId('listen-hint')).toBeVisible();
  await placeCard(bob, 0);
  await expect(bob.getByTestId('action-bar')).toBeVisible();
  for (const id of ['stand-open', 'listen-quick', 'menu-open', 'listen-hint-on', 'listen-hint-close', 'confirm-place']) await tappable(bob.getByTestId(id));
  await noSideScroll(bob);

  // Aan met de knop bovenaan: de tip gaat weg, de rest blijft vrij.
  await bob.getByTestId('listen-quick').click();
  await quickIs(bob, true);
  await expect(bob.getByTestId('listen-hint')).toHaveCount(0);
  for (const id of ['stand-open', 'listen-quick', 'menu-open', 'confirm-place']) await tappable(bob.getByTestId(id));
  await noSideScroll(bob);
});
