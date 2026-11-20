// De host-rol doorgeven en overnemen, met drie gsm's. De wachttijd voor
// overnemen staat in de tests op HOST_GRACE_MS (playwright.config.js; in een
// echt spel 30 s). Fragmenten tegen een nagebootste Deezer (fake-deezer.js),
// Spotify nagebootst (?mock=1).

import { test, expect } from '@playwright/test';
import {
  openPhone,
  hostGame,
  joinGame,
  setupMusic,
  openMenu,
  openStand,
  closePanel,
  hostAction,
  activeYears,
  correctSlot,
  placeCard,
  passWaiting,
  othersHaveTokens,
  myId,
  lastPlayed,
} from './helpers.js';
import { fakeDeezer, fragmentOf, mediaOf } from './fake-deezer.js';
import { HOST_GRACE_MS } from '../../playwright.config.js';

const GRACE = process.env.MT_LIVE === '1' ? 30_000 : HOST_GRACE_MS;

/** Alle <audio>-elementen van een gsm (de host-speler en die om mee te luisteren). */
async function audios(page) {
  const list = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="fragment-audio"]')].map((a) => ({ src: a.currentSrc || a.src || '', paused: a.paused, loop: a.loop })),
  );
  return list.map((a) => ({ ...a, id: mediaOf(a.src)?.id ?? null, version: mediaOf(a.src)?.version ?? null }));
}

/** Het fragment dat nu op `page` speelt (niet gepauzeerd), of null. */
async function nowPlaying(page) {
  const on = (await audios(page)).find((a) => !a.paused && a.id);
  return on ? on.id : null;
}

/** Wacht tot `page` fragment `id` speelt (of eender welk, of een ander dan `not`). */
async function playing(page, { id = null, not = null } = {}) {
  await expect.poll(async () => {
    const now = await nowPlaying(page);
    return Boolean(now && (!id || now === id) && now !== not);
  }).toBe(true);
  return nowPlaying(page);
}

/** Speelt `page` niets meer? */
async function silent(page) {
  await expect.poll(() => nowPlaying(page)).toBeNull();
}

/** Een gast; `deezer`: met een eigen nagebootste Deezer (wie meeluistert of host kan worden). */
async function guest(browser, code, name, { deezer = true } = {}) {
  const page = await openPhone(browser);
  if (deezer) await fakeDeezer(page.context());
  await joinGame(page, code, name);
  return page;
}

/** Host met fragmenten (geluid aan) en de testlijst; drie gsm's. */
async function fragmentGame(browser) {
  const host = await openPhone(browser);
  await fakeDeezer(host.context());
  const code = await hostGame(host, 'Hanne');
  await host.getByTestId('source-fragment').click();
  await host.getByTestId('fragment-unlock').click();
  await expect(host.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
  await host.getByTestId('list-oud').click();
  await expect(host.getByTestId('start-game')).toBeEnabled();
  const bob = await guest(browser, code, 'Bob');
  const cas = await guest(browser, code, 'Cas');
  await expect(host.getByTestId('lobby-player')).toHaveCount(3);
  return { host, bob, cas, code };
}

/** Wie aan de beurt is, legt juist en onthult; daarna «Volgende beurt». */
async function finishTurn(pages, hostPage, trackId) {
  const ids = await Promise.all(pages.map(myId));
  const activeId = await hostPage.getByTestId('turn-banner').getAttribute('data-active');
  const active = pages[ids.indexOf(activeId)];
  const year = fragmentOf(trackId).year;
  await placeCard(active, correctSlot(await activeYears(active), year));
  const challenge = await othersHaveTokens(hostPage, activeId);
  await active.getByTestId('confirm-place').click();
  if (challenge) {
    await passWaiting(pages, active);
    await active.getByTestId('reveal-now').click();
  }
  for (const p of pages) await expect(p.getByTestId('reveal')).toHaveAttribute('data-track', trackId);
  await active.getByTestId('next-turn').click();
}

/** Wat de server naar `page` stuurde bevat het ID van dit nummer (vóór de onthulling mag dat alleen bij de host). */
const gotId = (page, trackId) => page.frames_.some((f) => f.includes(`"${trackId}"`));

/** Zet de gsm uit (batterij leeg): de pagina weg, de verbinding dicht. De gsm onthoudt zijn plaats. */
async function phoneOff(page) {
  await page.goto('about:blank');
}

/** De gsm weer aan: de site opnieuw open, met dezelfde plaats in het spel. */
async function phoneOn(page) {
  await page.goto('./?mock=1');
}

test('doorgeven in de wachtkamer: de nieuwe host stelt de muziek in en start, de oude speelt mee', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const cas = await openPhone(browser);
  await joinGame(cas, code, 'Cas');
  await expect(host.getByTestId('lobby-player')).toHaveCount(3);
  const [hanneId, bobId] = await Promise.all([myId(host), myId(bob)]);

  // Alleen de host ziet «Maak host», bij de anderen; de gasten niet.
  await expect(host.getByTestId('make-host')).toHaveCount(2);
  await expect(bob.getByTestId('make-host')).toHaveCount(0);

  // Een speler die niet verbonden is, kan geen host worden: geen knop.
  await phoneOff(cas);
  await expect(host.getByTestId('make-host')).toHaveCount(1);
  await phoneOn(cas);
  await expect(host.getByTestId('make-host')).toHaveCount(2);

  // Met een bevestigingsvraag die zegt wat er verandert.
  const asked = [];
  host.removeAllListeners('dialog');
  host.on('dialog', (d) => {
    asked.push(d.message());
    d.accept();
  });
  await host.locator(`[data-testid="make-host"][data-player="${bobId}"]`).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain('Bob host maken?');
  expect(asked[0]).toContain('gewone speler');

  // Bob is host: hij krijgt de muziek, de lijst en de startknop; Hanne wacht nu zoals een gast.
  await expect(bob.getByTestId('start-game')).toBeVisible();
  await expect(bob.getByTestId('music-panel')).toBeVisible();
  await expect(bob.getByTestId('toast')).toContainText('Jij bent nu de host');
  await expect(host.getByTestId('waiting')).toBeVisible();
  await expect(host.getByTestId('start-game')).toHaveCount(0);
  await expect(host.getByTestId('make-host')).toHaveCount(0);
  await expect(host.getByTestId('toast')).toContainText('Bob is nu de host');
  await expect(cas.getByTestId('toast')).toContainText('Bob is nu de host');
  for (const p of [host, bob, cas]) {
    const row = p.getByTestId('lobby-player').filter({ hasText: 'Bob' });
    await expect(row.getByText('host', { exact: true })).toBeVisible();
    await expect(p.getByTestId('lobby-player').filter({ hasText: 'Hanne' }).getByText('host', { exact: true })).toHaveCount(0);
  }
  // Een bericht van de oude host dat alleen de host mag sturen, weigert de server.
  await host.evaluate(() => window.__mt.send({ t: 'settings', target: 4 }));
  await expect(host.getByTestId('toast')).toContainText('Alleen de host');
  // Overnemen kan niet zolang de host er is.
  await host.evaluate(() => window.__mt.send({ t: 'takeHost' }));
  await expect(host.getByTestId('toast')).toContainText('De host is er');
  await expect(host.getByTestId('host-away')).toHaveCount(0);

  // Bob logt in bij (de nagebootste) Spotify en start; de muziek komt van zijn gsm.
  await setupMusic(bob);
  await bob.getByTestId('start-game').click();
  for (const p of [host, bob, cas]) await expect(p.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => lastPlayed(bob)).not.toBeNull();
  expect(await lastPlayed(host), 'de oude host start niets').toBeNull();
  // Hanne speelt gewoon mee (ze staat op het bord) en heeft geen hostbediening, wel «Verlaat het spel».
  await openStand(host);
  await expect(host.locator(`[data-testid="board-row"][data-player="${hanneId}"]`)).toBeVisible();
  await closePanel(host);
  await openMenu(host);
  await expect(host.getByTestId('host-controls')).toHaveCount(0);
  await expect(host.getByTestId('menu').getByRole('button', { name: 'Verlaat het spel' })).toBeVisible();
  await closePanel(host);
  // Bob heeft de hostbediening, geen «Verlaat het spel» (eerst doorgeven), wel de uitleg.
  await openMenu(bob);
  await expect(bob.getByTestId('host-controls')).toBeVisible();
  await expect(bob.getByTestId('menu').getByRole('button', { name: 'Verlaat het spel' })).toHaveCount(0);
  await expect(bob.getByTestId('host-leave-hint')).toContainText('Geef eerst de host-rol door');
  await closePanel(bob);
  for (const p of [host, bob, cas]) await p.context().close();
});

test('doorgeven tijdens een spel met fragmenten: de muziek gaat door bij de nieuwe host, wie meeluistert blijft horen', async ({ browser }) => {
  const { host, bob, cas } = await fragmentGame(browser);
  const casId = await myId(cas);
  const pages = [host, bob, cas];
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  const first = await playing(host);

  // Bob speelt op afstand: geluid op zijn gsm.
  await bob.getByTestId('listen-quick').click();
  await playing(bob, { id: first });
  const bobVersion = (await audios(bob)).find((a) => !a.paused).version;

  // Hanne geeft de rol door aan Cas (menu, met bevestiging).
  await openMenu(host);
  await host.getByTestId('hand-over').locator('summary').click();
  await host.locator(`[data-testid="make-host"][data-player="${casId}"]`).click();
  await expect(host.getByTestId('menu')).toBeHidden();

  // Hanne is een gewone speler: haar muziek is stil, geen hostbediening, wel verlaten.
  await silent(host);
  await openMenu(host);
  await expect(host.getByTestId('host-controls')).toHaveCount(0);
  await expect(host.getByTestId('menu').getByRole('button', { name: 'Verlaat het spel' })).toBeVisible();
  await closePanel(host);

  // Bob hoort gewoon verder hetzelfde fragment, zonder onderbreking.
  await playing(bob, { id: first });
  expect((await audios(bob)).find((a) => !a.paused).version).toBe(bobVersion);

  // Cas ziet meteen wat hij moet doen: het geluid aanzetten (of geen geluid hier).
  const alert = cas.getByTestId('browser-off');
  await expect(alert).toContainText('Jij bent nu de host');
  await expect(alert.getByTestId('alert-mute')).toBeVisible();
  await alert.getByTestId('device-browser').click();
  await playing(cas, { id: first });
  await expect(cas.getByTestId('browser-off')).toHaveCount(0);
  await playing(bob, { id: first });

  // Cas bedient nu alles: ander nummer. Bob volgt, Hanne krijgt het ID niet meer.
  await hostAction(cas, 'skip-track');
  await closePanel(cas);
  const second = await playing(cas, { not: first });
  await playing(bob, { id: second });
  expect(gotId(host, second), 'de oude host krijgt het ID van het nummer niet meer').toBe(false);
  expect(gotId(bob, second)).toBe(false);
  expect(gotId(cas, second), 'de nieuwe host krijgt het ID om af te spelen').toBe(true);

  // De beurt afmaken: de volgende beurt speelt bij Cas en Bob.
  await finishTurn(pages, cas, second);
  const third = await playing(cas, { not: second });
  await playing(bob, { id: third });
  await silent(host);

  // Hanne gaf de rol door en mag nu vertrekken; het spel gaat door.
  await openMenu(host);
  await host.getByTestId('menu').getByRole('button', { name: 'Verlaat het spel' }).click();
  await expect(host.getByRole('tab', { name: 'Nieuw spel' })).toBeVisible();
  await expect(cas.getByTestId('turn-banner')).toBeVisible();
  await playing(bob, { id: third });
  for (const p of pages) await p.context().close();
});

test('de host valt weg: pas na de wachttijd kan een speler host worden, en het spel gaat verder', async ({ browser }) => {
  const { host, bob, cas } = await fragmentGame(browser);
  const hanneId = await myId(host);
  await host.getByTestId('start-game').click();
  for (const p of [host, bob, cas]) await expect(p.getByTestId('turn-banner')).toBeVisible();
  const first = await playing(host);
  await cas.getByTestId('listen-quick').click();
  await playing(cas, { id: first });

  // Een korte haper (scherm even weg) lokt niets uit, ook niet na de wachttijd.
  await phoneOff(host);
  await host.waitForTimeout(1000);
  await phoneOn(host);
  await expect(host.getByTestId('turn-banner')).toBeVisible();
  await bob.waitForTimeout(GRACE + 1000);
  await expect(bob.getByTestId('host-away')).toHaveCount(0);
  await bob.evaluate(() => window.__mt.send({ t: 'takeHost' }));
  await expect(bob.getByTestId('toast')).toContainText('De host is er');

  // Nu echt weg (batterij leeg).
  await phoneOff(host);
  const off = Date.now();
  await openStand(bob);
  await expect(bob.locator(`[data-testid="board-row"][data-player="${hanneId}"]`)).toContainText('niet verbonden');
  await closePanel(bob);
  // Voor de wachttijd om is: geen melding, en de server weigert wie het toch vraagt.
  await expect(bob.getByTestId('host-away')).toHaveCount(0);
  await expect(cas.getByTestId('host-away')).toHaveCount(0);
  await bob.evaluate(() => window.__mt.send({ t: 'takeHost' }));
  await expect(bob.getByTestId('toast')).toContainText('nog maar net weg');
  expect(Date.now() - off, 'die controle gebeurde binnen de wachttijd').toBeLessThan(GRACE);
  // Cas (die meeluistert) hoort het fragment nog altijd.
  await playing(cas, { id: first });

  // Na de wachttijd: bij iedereen «De host is weg» met «Word host».
  for (const p of [bob, cas]) {
    await expect(p.getByTestId('host-away')).toBeVisible({ timeout: GRACE + 5000 });
    await expect(p.getByTestId('host-away')).toContainText('De host is weg');
    await expect(p.getByTestId('host-away')).toContainText('Hanne');
  }
  expect(Date.now() - off).toBeGreaterThanOrEqual(GRACE - 500);

  // Bob tikt eerst: hij is host, bij Cas verdwijnt de melding.
  await bob.getByTestId('take-host').click();
  await expect(bob.getByTestId('host-away')).toHaveCount(0);
  await expect(cas.getByTestId('host-away')).toHaveCount(0);
  await expect(cas.getByTestId('toast')).toContainText('Bob is nu de host');
  // Cas tikt net te laat (of omzeilt de knop): er is al een host.
  await cas.evaluate(() => window.__mt.send({ t: 'takeHost' }));
  await expect(cas.getByTestId('toast')).toContainText('De host is er');

  // Bob neemt de muziek over: hetzelfde nummer van de beurt; Cas blijft horen.
  await expect(bob.getByTestId('browser-off')).toContainText('Jij bent nu de host');
  await bob.getByTestId('browser-off').getByTestId('device-browser').click();
  await playing(bob, { id: first });
  await playing(cas, { id: first });

  // Het spel gaat verder: onthullen, volgende beurt, nieuw fragment bij Bob en Cas.
  const pages = [bob, cas];
  const revealed = await finishTurnWithout(pages, bob, first, hanneId);
  const second = await playing(bob, { not: revealed });
  await playing(cas, { id: second });

  // Hanne komt terug: een gewone speler, zonder hostbediening of muziek.
  await phoneOn(host);
  await expect(host.getByTestId('turn-banner').or(host.getByTestId('challenge-banner'))).toBeVisible();
  await openMenu(host);
  await expect(host.getByTestId('host-controls')).toHaveCount(0);
  await expect(host.getByTestId('menu').getByRole('button', { name: 'Verlaat het spel' })).toBeVisible();
  await closePanel(host);
  await expect(host.getByTestId('host-away')).toHaveCount(0);
  await expect(host.getByTestId('browser-off')).toHaveCount(0);
  expect(await nowPlaying(host)).toBeNull();
  expect(gotId(host, second)).toBe(false);
  for (const p of [host, bob, cas]) await p.context().close();
});

/**
 * Zoals finishTurn, maar Hanne is weg: is zij aan de beurt, dan slaat de
 * (nieuwe) host haar beurt over. Geeft het nummer dat onthuld werd.
 */
async function finishTurnWithout(pages, hostPage, trackId, goneId) {
  const banner = hostPage.getByTestId('turn-banner');
  if ((await banner.getAttribute('data-active')) === goneId) {
    await hostAction(hostPage, 'skip-turn');
    await expect(banner).not.toHaveAttribute('data-active', goneId);
    trackId = await playing(hostPage, { not: trackId });
  }
  await finishTurn(pages, hostPage, trackId);
  return trackId;
}

test('Spotify: de nieuwe host logt in of stopt het spel en speelt verder met fragmenten', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const cas = await guest(browser, code, 'Cas');
  const [bobId, casId] = await Promise.all([myId(bob), myId(cas)]);
  await host.getByTestId('start-game').click();
  for (const p of [host, bob, cas]) await expect(p.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => lastPlayed(host)).not.toBeNull();
  const track = await lastPlayed(host);

  // Hanne geeft de rol door aan Bob, die niet ingelogd is bij Spotify.
  await openMenu(host);
  await host.getByTestId('hand-over').locator('summary').click();
  await host.locator(`[data-testid="make-host"][data-player="${bobId}"]`).click();
  // Hanne zet de muziek op haar toestel stil.
  await expect.poll(() => host.evaluate(() => window.__mockSpotify.log.some((e) => e.type === 'pause'))).toBe(true);

  // Bob ziet meteen wat er moet gebeuren, met twee keuzes.
  const setup = bob.getByTestId('host-spotify-setup');
  await expect(setup).toContainText('Jij bent nu de host');
  await expect(setup).toContainText('Spotify');
  await expect(setup.getByTestId('alert-login')).toBeVisible();
  await expect(setup.getByTestId('alert-fragments')).toBeVisible();
  // Hij logt in en kiest een toestel: het nummer van de beurt start bij hem.
  await setup.getByTestId('alert-login').click();
  await expect(bob.getByTestId('host-spotify-setup')).toHaveCount(0);
  await bob.getByTestId('host-music-setup').getByTestId('alert-settings').click();
  await bob.getByTestId('device-mock-box').click();
  await expect.poll(() => lastPlayed(bob)).toBe(track);
  await closePanel(bob);

  // Bob geeft het door aan Cas, die geen Spotify heeft: hij stopt het spel en kiest fragmenten.
  await openMenu(bob);
  await bob.getByTestId('hand-over').locator('summary').click();
  await bob.locator(`[data-testid="make-host"][data-player="${casId}"]`).click();
  await expect(cas.getByTestId('host-spotify-setup')).toBeVisible();
  await cas.getByTestId('alert-fragments').click();
  // Terug in de wachtkamer, met uitleg voor iedereen.
  for (const p of [host, bob, cas]) await expect(p.getByTestId('big-code')).toHaveText(code);
  for (const p of [host, bob]) await expect(p.getByTestId('lobby-note')).toContainText('Spotify bij de vorige host');
  // Bij Cas staan de fragmenten klaar. De Spotify-lijst past daar niet bij: er
  // valt niets over te nemen, dus hij kiest zelf lijsten (die gaan naar de server).
  await expect(cas.getByTestId('source-fragment')).toHaveAttribute('aria-pressed', 'true');
  await expect(cas.getByTestId('start-game')).toBeDisabled();
  await expect(cas.getByTestId('deck-held')).toHaveCount(0);
  await expect(cas.getByTestId('fragment-lists')).toBeVisible();
  await cas.getByTestId('fragment-unlock').click();
  await cas.getByTestId('list-oud').click();
  await expect(cas.getByTestId('deck-total')).toHaveAttribute('data-synced', 'yes');
  await expect(cas.getByTestId('start-game')).toBeEnabled();
  for (const p of [host, bob]) await expect(p.getByTestId('lobby-playlist')).toContainText('Oud');
  await cas.getByTestId('start-game').click();
  for (const p of [host, bob, cas]) await expect(p.getByTestId('turn-banner')).toBeVisible();
  await playing(cas);
  // In het nieuwe spel is de uitleg weg.
  await expect(bob.getByTestId('lobby-note')).toHaveCount(0);
  for (const p of [host, bob, cas]) await p.context().close();
});

test('wissel van host met een gecombineerde lijstkeuze: de stapel van de vorige host blijft, tot de nieuwe zelf kiest', async ({ browser }) => {
  const host = await openPhone(browser);
  await fakeDeezer(host.context());
  const code = await hostGame(host, 'Hanne');
  await host.getByTestId('source-fragment').click();
  await host.getByTestId('fragment-unlock').click();
  const bob = await guest(browser, code, 'Bob');
  // Cas heeft op zijn gsm een eigen bewaarde keuze van een vorig spel (alles).
  const cas = await openPhone(browser);
  await fakeDeezer(cas.context());
  await cas.evaluate(() => localStorage.setItem('mt.fragmentChoice', JSON.stringify({ lists: ['alles'], from: null, to: null })));
  await joinGame(cas, code, 'Cas');
  const casId = await myId(cas);

  // Hanne kiest twee lijsten samen en een periode.
  await host.getByTestId('list-oud').click();
  await host.getByTestId('list-nieuw').click();
  await host.getByTestId('period-from').selectOption({ index: 3 });
  await expect(host.getByTestId('deck-total')).toHaveAttribute('data-synced', 'yes');
  const name = (await host.getByTestId('deck-name').textContent()).trim();
  const count = Number(await host.getByTestId('deck-total').getAttribute('data-total'));
  expect(name).toContain('+');
  const shown = bob.getByTestId('lobby-playlist');
  await expect(shown).toContainText(name);
  const before = (await shown.textContent()).trim();
  const from = Number(await host.getByTestId('period-from').inputValue());

  // Vanaf nu: stuurt Hanne nog een stapel naar de server?
  const posts = [];
  host.on('request', (r) => r.method() === 'POST' && /\/deck$/.test(r.url()) && posts.push(r.url()));
  await host.getByTestId('lobby-player').filter({ hasText: 'Cas' }).getByTestId('make-host').click();
  await expect(cas.getByTestId('start-game')).toBeVisible();

  // Cas ziet wat de vorige host koos, en de server houdt die stapel.
  await expect(cas.getByTestId('deck-held')).toContainText(name);
  await expect(cas.getByTestId('fragment-lists')).toHaveCount(0);
  await cas.waitForTimeout(1500);
  await expect(shown).toHaveText(before);
  // Ook na een herlaad blijft dat zo.
  await cas.reload();
  await expect(cas.getByTestId('deck-held')).toContainText(name);
  await cas.waitForTimeout(1000);
  await expect(shown).toHaveText(before);
  expect(posts, 'de oude host stuurt niets meer').toEqual([]);
  // Hanne kan geen stapel meer kiezen.
  await expect(host.getByTestId('fragment-lists')).toHaveCount(0);

  // Cas start met die stapel: het nummer zit in de gekozen lijsten en de periode.
  await cas.getByTestId('fragment-unlock').click();
  await expect(cas.getByTestId('start-game')).toBeEnabled();
  await cas.getByTestId('start-game').click();
  for (const p of [host, bob, cas]) await expect(p.getByTestId('turn-banner')).toBeVisible();
  const id = await playing(cas);
  const t = fragmentOf(id);
  expect(t.lists.some((l) => l === 'oud' || l === 'nieuw')).toBe(true);
  expect(t.year).toBeGreaterThanOrEqual(from);
  await openStand(cas);
  await expect(cas.getByTestId('deck-left')).toContainText(`nog ${count - 4} nummers`);
  await closePanel(cas);

  // Terug in de wachtkamer: nog altijd de stapel van Hanne. Pas «Kies zelf lijsten» zet de keuze van Cas.
  await hostAction(cas, 'stop-game');
  await expect(cas.getByTestId('deck-held')).toContainText(name);
  await expect(shown).toHaveText(before);
  await cas.getByTestId('choice-own').click();
  await expect(cas.getByTestId('fragment-lists')).toBeVisible();
  await expect(cas.getByTestId('list-alles')).toHaveAttribute('aria-checked', 'true');
  await expect(cas.getByTestId('deck-total')).toHaveAttribute('data-synced', 'yes');
  await expect(shown).toContainText('Alle testfragmenten');
  expect(posts).toEqual([]);
  for (const p of [host, bob, cas]) await p.context().close();
});
