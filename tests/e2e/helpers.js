import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Lokaal speelt de server met de testnummers; tegen de live site (MT_LIVE=1)
// met de echte lijst die ook op de site staat.
const TRACKS_FILE = process.env.MT_LIVE === '1' ? '../../web/public/tracks.json' : '../fixtures/tracks.json';
export const TRACKS = JSON.parse(readFileSync(new URL(TRACKS_FILE, import.meta.url), 'utf8'));
export const YEAR = new Map(TRACKS.map((t) => [t.id, t.year]));

/**
 * Opent een eigen browsercontext (= een eigen gsm) in testmodus. Met `name`
 * kent die gsm al een naam van een vorig spel, zoals na een eerdere spelavond.
 */
export async function openPhone(browser, { hash = '', name = '' } = {}) {
  const context = await browser.newContext();
  if (name) {
    await context.addInitScript((n) => {
      try {
        if (!localStorage.getItem('mt.name')) localStorage.setItem('mt.name', JSON.stringify(n));
      } catch {
        // about:blank heeft geen opslag
      }
    }, name);
  }
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  // Alles wat de server naar deze gsm stuurt, om te kunnen nakijken wat lekt.
  page.frames_ = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => page.frames_.push(String(f.payload)));
  });
  await page.goto(`./?mock=1${hash}`);
  return page;
}

export async function hostGame(page, name = 'Hanne') {
  await page.getByRole('tab', { name: 'Nieuw spel' }).click();
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('enter-button').click();
  const code = (await page.getByTestId('big-code').textContent()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  return code;
}

export async function setupMusic(page) {
  await page.getByTestId('music-login').click();
  await page.getByTestId('device-mock-box').click();
  await expect(page.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
}

export async function joinGame(page, code, name) {
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('enter-button').click();
  await expect(page.getByTestId('big-code')).toHaveText(code);
}

/**
 * Opent de uitnodigingslink van `code` op een gsm die de site al open heeft,
 * zoals na het scannen van de QR-code. Standaard via hashchange in hetzelfde
 * tabblad; met `fresh` als nieuw geladen pagina.
 */
export async function openInvite(page, code, { fresh = false } = {}) {
  if (fresh) await page.goto('about:blank');
  await page.goto(`./?mock=1#/j/${code}`);
}

/** Wat er nog in de adresbalk staat na het #. */
export const hashOf = (page) => page.evaluate(() => location.hash);

/** Een code die nooit bestaat: de server gebruikt geen I of O in codes. */
export const NO_SUCH_ROOM = 'OOOO';

export async function setTarget(page, target) {
  for (let i = 0; i < 20; i++) {
    const now = parseInt(await page.getByTestId('target').textContent(), 10);
    if (now === target) return;
    await page.getByRole('button', { name: now > target ? 'Minder kaarten' : 'Meer kaarten' }).click();
    await expect(page.getByTestId('target')).not.toHaveText(`${now} kaarten`);
  }
}

export const myId = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mt.session')).playerId);

/** Het track-ID dat de host het laatst naar "Spotify" stuurde. */
export async function lastPlayed(hostPage) {
  return hostPage.evaluate(() => {
    const plays = window.__mockSpotify.log.filter((e) => e.type === 'play');
    return plays.length ? plays[plays.length - 1].trackId : null;
  });
}

export const playCount = (hostPage) =>
  hostPage.evaluate(() => window.__mockSpotify.log.filter((e) => e.type === 'play').length);

/**
 * Opent het menu (spelcode, hostbediening, spelregels, verlaten) als het nog
 * dicht is. Het blijft open tot een knop het sluit of `closePanel`.
 */
export async function openMenu(page) {
  if ((await page.getByTestId('menu').getAttribute('data-open')) !== 'yes') await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('menu')).toBeVisible();
}

/** Opent de stand (alle spelers, kaarten en tokens). */
export async function openStand(page) {
  if ((await page.getByTestId('stand').getAttribute('data-open')) !== 'yes') await page.getByTestId('stand-open').click();
  await expect(page.getByTestId('stand')).toBeVisible();
}

/** Sluit het menu of de stand, als er een open is. */
export async function closePanel(page) {
  for (const id of ['menu', 'stand']) {
    if ((await page.getByTestId(id).getAttribute('data-open')) === 'yes') await page.getByTestId(`${id}-close`).click();
    await expect(page.getByTestId(id)).toBeHidden();
  }
}

/** Een knop uit het hostmenu: "Ander nummer", "Sla beurt over", "Opnieuw afspelen". */
export async function hostAction(page, testid) {
  await openMenu(page);
  await page.getByTestId(testid).click();
}

/**
 * Wie aan de beurt is, legt de kaart (voorlopig) op plaats `index` van zijn
 * tijdlijn. Elke spec legt via deze ene weg.
 */
export async function placeCard(page, index) {
  await page.getByTestId(`slot-${index}`).click();
  await expect(page.getByTestId('active-timeline').getByTestId('pending-card')).toBeVisible();
}

/**
 * In de tussenfase: zet je token (voorlopig, nog niet bevestigd) op plaats
 * `index` van de tijdlijn van de speler aan beurt.
 */
export async function placeToken(page, index) {
  await page.getByTestId(`slot-${index}`).click();
  await expect(page.getByTestId('bet-pick')).toBeVisible();
}

/**
 * Plaatsen op de tijdlijn van de speler aan beurt waar je token nog heen kan
 * (leeg als je niet kan inzetten).
 */
export async function tokenTargets(page) {
  const ids = await page.getByTestId('active-timeline').locator('.slot-btn').evaluateAll((els) => els.map((el) => el.dataset.testid));
  return ids.map((id) => Number(id.replace('slot-', '')));
}

export async function activeYears(page) {
  return page
    .getByTestId('active-timeline')
    .locator('li.tl-card[data-year]')
    .evaluateAll((els) => els.map((el) => Number(el.dataset.year)));
}

/** Plaats waar `year` juist ligt tussen de (gesorteerde) jaren. */
export function correctSlot(years, year) {
  let i = 0;
  while (i < years.length && years[i] <= year) i++;
  return i;
}

/** Een plaats waar `year` zeker fout ligt, of null als elke plaats juist is. */
export function wrongSlot(years, year) {
  for (let i = 0; i <= years.length; i++) {
    const before = i > 0 ? years[i - 1] : -Infinity;
    const after = i < years.length ? years[i] : Infinity;
    if (!(before <= year && year <= after)) return i;
  }
  return null;
}

/**
 * Speelt één beurt. `pages` = alle gsm's, `hostPage` = die van de host.
 * Geeft terug wie speelde, welk nummer en of het juist was.
 */
export async function playTurn({ pages, hostPage, ids, want = 'correct', playsSoFar }) {
  const banner = hostPage.getByTestId('turn-banner');
  await expect(banner).toBeVisible();
  const activeId = await banner.getAttribute('data-active');
  const activePage = pages[ids.indexOf(activeId)];
  await expect(activePage.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');

  // De host-gsm start het nummer van deze beurt; daaruit kent de test het antwoord.
  await expect.poll(() => playCount(hostPage)).toBe(playsSoFar + 1);
  const trackId = await lastPlayed(hostPage);
  const year = YEAR.get(trackId);
  expect(year, `onbekend nummer ${trackId}`).toBeTruthy();

  const years = await activeYears(activePage);
  let slot = want === 'wrong' ? wrongSlot(years, year) : correctSlot(years, year);
  let expectCorrect = want !== 'wrong';
  if (slot === null) {
    slot = 0;
    expectCorrect = true;
  }

  await placeCard(activePage, slot);
  // Iedereen ziet live waar de speler twijfelt.
  for (const p of pages) await expect(p.getByTestId('active-timeline').getByTestId('pending-card')).toBeVisible();

  // Tot hier mag geen enkele gewone speler het antwoord in zijn netwerkdata hebben.
  const track = TRACKS.find((t) => t.id === trackId);
  const expectNoLeak = (when) => {
    for (const p of pages) {
      if (p === hostPage) continue;
      // Exacte waarden tussen aanhalingstekens: titels van testnummers lijken op elkaar.
      const leaked = p.frames_.some((f) => f.includes(`"${trackId}"`) || f.includes(`"title":"${track.title}"`));
      expect(leaked, `antwoord lekte naar een gewone speler ${when}`).toBe(false);
    }
  };
  expectNoLeak('voor de onthulling');

  // Heeft een andere speler nog een token (iedereen begint met 2), dan volgt
  // eerst de tussenfase; anders meteen de onthulling.
  const challenge = await othersHaveTokens(hostPage, activeId);
  await activePage.getByTestId('confirm-place').click();
  if (challenge) {
    for (const p of pages) {
      await expect(p.getByTestId('challenge-banner')).toHaveAttribute('data-active', activeId);
      await expect(p.getByTestId('active-timeline').getByTestId('placed-card')).toBeVisible();
      await expect(p.getByTestId('reveal')).toHaveCount(0);
      // Alleen de speler aan beurt en de host zien de knop om te onthullen; een
      // host die zelf nog moet kiezen, ziet eerst zijn eigen keuze.
      const choosing = (await p.getByTestId('challenge-banner').getAttribute('data-must-choose')) === 'yes';
      await expect(p.getByTestId('reveal-now')).toHaveCount(p === activePage || (p === hostPage && !choosing) ? 1 : 0);
      await expect(p.getByTestId('pass-bet')).toHaveCount(choosing ? 1 : 0);
    }
    await expect(activePage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
    // Ook in de tussenfase lekt niets en start de muziek niet opnieuw.
    expectNoLeak('in de tussenfase');
    expect(await playCount(hostPage)).toBe(playsSoFar + 1);
    // Onthullen kan pas als iedereen met een token koos. Niemand zet in: de
    // anderen passen, daarna onthult de speler aan beurt zelf.
    await passWaiting(pages, activePage);
    await expect(hostPage.getByTestId('reveal-now')).toHaveCount(1);
    await activePage.getByTestId('reveal-now').click();
  }
  for (const p of pages) {
    const reveal = p.getByTestId('reveal');
    await expect(reveal).toHaveAttribute('data-track', trackId);
    await expect(reveal).toHaveAttribute('data-correct', expectCorrect ? 'yes' : 'no');
    await expect(reveal).toContainText(String(year));
    await expect(reveal).toContainText(track.title);
    await expect(p.getByTestId('challenge-banner')).toHaveCount(0);
  }
  expect(await playCount(hostPage), 'het nummer start niet opnieuw bij de onthulling').toBe(playsSoFar + 1);
  return { activeId, activePage, trackId, year, correct: expectCorrect, cardsBefore: years.length, challenge };
}

/**
 * Tussenfase: elke gsm in `pages` op wie het onthullen nog wacht, tikt op "Ik
 * zet geen token in". Tot dan is "Onthul" bij `revealer` uitgeschakeld en
 * noemt het scherm op wie er gewacht wordt; daarna kan hij onthullen.
 */
export async function passWaiting(pages, revealer) {
  const banner = revealer.getByTestId('challenge-banner');
  await expect(banner).toBeVisible();
  for (const p of pages) await expect(p.getByTestId('challenge-banner')).toBeVisible();
  const waiting = await banner.getAttribute('data-waiting');
  if (waiting) {
    await expect(revealer.getByTestId('reveal-now')).toBeDisabled();
    await expect(revealer.getByTestId('waiting-for')).toContainText('Nog wachten op');
  }
  for (const p of pages) {
    if ((await p.getByTestId('challenge-banner').getAttribute('data-must-choose')) !== 'yes') continue;
    await p.getByTestId('pass-bet').click();
    await expect(p.getByTestId('challenge-banner')).toHaveAttribute('data-must-choose', 'no');
    await expect(p.getByTestId('challenge-banner')).toContainText('Je zet deze beurt geen token in');
  }
  await expect(banner).toHaveAttribute('data-waiting', '');
  await expect(revealer.getByTestId('waiting-for')).toHaveCount(0);
  await expect(revealer.getByTestId('reveal-now')).toBeEnabled();
}

/** Heeft volgens het bord op `page` een andere speler dan `activeId` nog een token? */
export async function othersHaveTokens(page, activeId) {
  const rows = await page
    .getByTestId('board-row')
    .evaluateAll((els) => els.map((el) => ({ id: el.dataset.player, tokens: Number(el.dataset.tokens) })));
  return rows.some((r) => r.id !== activeId && r.tokens > 0);
}

export async function countOf(page, playerId) {
  return Number(await page.locator(`[data-testid="board-row"][data-player="${playerId}"]`).getAttribute('data-count'));
}
