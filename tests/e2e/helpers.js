import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const TRACKS = JSON.parse(readFileSync(new URL('../fixtures/tracks.json', import.meta.url), 'utf8'));
export const YEAR = new Map(TRACKS.map((t) => [t.id, t.year]));

/** Opent een eigen browsercontext (= een eigen gsm) in testmodus. */
export async function openPhone(browser, { hash = '' } = {}) {
  const context = await browser.newContext();
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

  await activePage.getByTestId(`slot-${slot}`).click();
  // Iedereen ziet live waar de speler twijfelt.
  for (const p of pages) await expect(p.getByTestId('active-timeline').getByTestId('pending-card')).toBeVisible();

  // Tot hier mag geen enkele gewone speler het antwoord in zijn netwerkdata hebben.
  const track = TRACKS.find((t) => t.id === trackId);
  for (const p of pages) {
    if (p === hostPage) continue;
    // Exacte waarden tussen aanhalingstekens: titels van testnummers lijken op elkaar.
    const leaked = p.frames_.some((f) => f.includes(`"${trackId}"`) || f.includes(`"title":"${track.title}"`));
    expect(leaked, 'antwoord lekte naar een gewone speler voor de onthulling').toBe(false);
  }

  await activePage.getByTestId('confirm-place').click();
  for (const p of pages) {
    const reveal = p.getByTestId('reveal');
    await expect(reveal).toHaveAttribute('data-track', trackId);
    await expect(reveal).toHaveAttribute('data-correct', expectCorrect ? 'yes' : 'no');
    await expect(reveal).toContainText(String(year));
    await expect(reveal).toContainText(track.title);
  }
  return { activeId, activePage, trackId, year, correct: expectCorrect, cardsBefore: years.length };
}

export async function countOf(page, playerId) {
  return Number(await page.locator(`[data-testid="board-row"][data-player="${playerId}"]`).getAttribute('data-count'));
}
