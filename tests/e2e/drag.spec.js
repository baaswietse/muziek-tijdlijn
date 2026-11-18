import { test, expect } from '@playwright/test';
import {
  openPhone,
  hostGame,
  setupMusic,
  joinGame,
  myId,
  playCount,
  lastPlayed,
  YEAR,
  activeYears,
  correctSlot,
  hostAction,
  openMenu,
  openStand,
  skipTo,
  collectCards,
  passWaiting,
  pieceIndex,
  placeCard,
  expectSameSpot,
} from './helpers.js';

// Het spelscherm: je kaart (en je token) sleep je van de houder boven de
// zwevende balk naar een plaats op de tijdlijn, met de muis of de vinger. De
// knoppen omhoog/omlaag zijn de weg zonder slepen. De onthulling, de stand en
// het menu zijn panelen van onderaan.

/**
 * Hanne (host) en Bob; Bob speelt eerst `cards - 1` beurten juist en is dan
 * weer aan de beurt. `bob` geeft opties voor Bobs gsm (viewport, touch).
 */
async function duo(browser, { cards = 1, bob: bobOptions = {} } = {}) {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser, bobOptions);
  await joinGame(bob, code, 'Bob');
  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  let plays = await collectCards({ host, player: bob, pages }, cards - 1, 1);
  plays = await skipTo(host, ids[1], plays);
  await expect(bob.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  expect(await activeYears(bob)).toHaveLength(cards);
  const year = YEAR.get(await lastPlayed(host));
  return { host, bob, pages, ids, plays, year };
}

/** Midden van een element op het scherm, eventueel verschoven. */
async function centerOf(loc, dx = 0) {
  const b = await loc.boundingBox();
  return { x: b.x + (dx >= 0 ? dx || b.width / 2 : b.width + dx), y: b.y + b.height / 2 };
}

/** Een punt links op het stuk (weg van de knoppen omhoog/omlaag rechts). */
const grip = (loc) => centerOf(loc, 30);

/**
 * Het punt op het scherm waar plaats `slot` van de tijdlijn ligt, gerekend
 * zoals de app het doet: zonder de eigen keuze erin (die schuift weg zodra je
 * ze oppakt).
 */
function slotPoint(page, slot, testid = 'active-timeline') {
  return page.getByTestId(testid).evaluate((list, i) => {
    const rows = [...list.children].filter((el) => el.hasAttribute('data-row'));
    const pick = rows.find((el) => el.hasAttribute('data-pick'));
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const size = pick ? pick.getBoundingClientRect().height + gap : 0;
    const after = (el) => pick && rows.indexOf(el) > rows.indexOf(pick);
    const cards = rows.filter((el) => el.hasAttribute('data-card'));
    const top = (el) => el.getBoundingClientRect().top - (after(el) ? size : 0);
    const bottom = (el) => el.getBoundingClientRect().bottom - (after(el) ? size : 0);
    const lr = list.getBoundingClientRect();
    let y;
    if (i === 0) y = top(cards[0]) - 6;
    else if (i === cards.length) y = bottom(cards.at(-1)) + 6;
    else y = (bottom(cards[i - 1]) + top(cards[i])) / 2;
    return { x: lr.left + lr.width / 2, y };
  }, slot);
}

/** Muis: oppakken bij `from`, slepen naar `to`, eventueel even vasthouden, loslaten. */
async function mouseDrag(page, from, to, { hold = 0, release = true, steps = 14 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  if (hold) await page.waitForTimeout(hold);
  if (release) await page.mouse.up();
}

/**
 * Vinger (aanraakscherm): touch-events via het DevTools-protocol van Chromium.
 * Met `end: null` blijft de vinger op het scherm; de sessie komt terug om het
 * gebaar later te beëindigen.
 */
async function touchDrag(page, from, to, { steps = 12, end = 'touchEnd', hold = 0 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y) }] : [] });
  await touch('touchStart', from);
  for (let k = 1; k <= steps; k++) {
    await touch('touchMove', { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
  }
  if (hold) await page.waitForTimeout(hold);
  if (!end) return cdp;
  await touch(end);
  await cdp.detach();
  return null;
}

/** Nergens hangt nog iets: geen zwevende kopie, geen verschoven kaarten. */
async function expectSettled(page) {
  await expect(page.getByTestId('drag-ghost')).toHaveCount(0);
  const left = await page.evaluate(() => ({
    moved: [...document.querySelectorAll('[data-row]')].filter((el) => el.style.transform).length,
    dragging: document.querySelector('.timeline.is-dragging') !== null || document.documentElement.classList.contains('dragging'),
  }));
  expect(left).toEqual({ moved: 0, dragging: false });
}

/** Bij de host: na welke kaart (index) ligt de "?" van de speler aan beurt (-1 = niet zichtbaar). */
const pendingAt = (page) =>
  page.getByTestId('active-timeline').evaluate((list) => {
    const p = list.querySelector('[data-testid="pending-card"]');
    if (!p) return -1;
    const next = p.nextElementSibling;
    return next?.hasAttribute('data-card') ? Number(next.dataset.card) : Number.POSITIVE_INFINITY;
  });

test('slepen met de muis: van de houder naar een plaats, de kaarten maken plaats, verplaatsen en terug naar de houder', async ({ browser }) => {
  const { host, bob, pages } = await duo(browser, { cards: 3 });
  const card = bob.getByTestId('drag-card');
  await expect(card).toHaveAttribute('data-where', 'holder');
  await expect(bob.getByTestId('confirm-place')).toBeDisabled();
  // De tijdlijn toont alleen kaarten: geen plaatsen met een plusteken.
  await expect(bob.getByTestId('active-timeline').locator('[data-row]')).toHaveCount(3);

  // Oppakken en boven plaats 1 houden: kaart 1 en 2 schuiven op.
  const second = bob.locator('[data-testid="active-timeline"] [data-card="1"]');
  const before = (await second.boundingBox()).y;
  await mouseDrag(bob, await grip(card), await slotPoint(bob, 1), { release: false });
  await expect(bob.getByTestId('drag-ghost')).toBeVisible();
  await expect(bob.getByTestId('active-timeline')).toHaveAttribute('data-hover', '1');
  await expect.poll(async () => (await second.boundingBox()).y - before).toBeGreaterThan(30);
  await expect(bob.locator('.tl-drop.on')).toContainText('tussen');
  // Tijdens het slepen gaat er nog niets naar de server.
  await expect(host.getByTestId('active-timeline').getByTestId('pending-card')).toHaveCount(0);
  await bob.mouse.up();
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '1');
  await expect(card).toHaveAttribute('data-where', 'timeline');
  await expect(bob.getByTestId('confirm-place')).toBeEnabled();
  await expect(bob.getByTestId('confirm-place')).toHaveText(/^Leg het tussen \d{4} en \d{4}$/);
  // Bij het loslaten gaat de keuze naar de server: de host ziet waar Bob twijfelt.
  await expect.poll(() => pendingAt(host)).toBe(1);

  // Opnieuw slepen verplaatst ze: helemaal achteraan.
  await mouseDrag(bob, await grip(card), await slotPoint(bob, 3));
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '3');
  await expect.poll(() => pendingAt(host)).toBe(Number.POSITIVE_INFINITY);

  // Terug naar de houder: geen keuze meer, ook niet bij de host.
  const holder = bob.getByTestId('card-holder');
  await mouseDrag(bob, await grip(card), await centerOf(holder), { release: false });
  await expect(holder).toHaveClass(/\btarget\b/);
  await bob.mouse.up();
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-where', 'holder');
  await expect(card).toHaveAttribute('data-index', '');
  await expect(bob.getByTestId('confirm-place')).toBeDisabled();
  await expect(bob.getByTestId('confirm-place')).toHaveText('Kies eerst een plaats');
  await expect.poll(() => pendingAt(host)).toBe(-1);

  // Een gewone klik op de kaart (zonder bewegen) kiest niets.
  await bob.mouse.click((await grip(card)).x, (await grip(card)).y);
  await expect(card).toHaveAttribute('data-index', '');

  // Juist leggen en bevestigen: zoals altijd.
  const year = YEAR.get(await lastPlayed(host));
  const right = correctSlot(await activeYears(bob), year);
  await mouseDrag(bob, await grip(card), await slotPoint(bob, right));
  await expect(card).toHaveAttribute('data-index', String(right));
  await bob.getByTestId('confirm-place').click();
  await expect(bob.getByTestId('challenge-banner')).toBeVisible();
  await expect(bob.getByTestId('drag-card')).toHaveCount(0);
  await expect(bob.getByTestId('card-holder')).toHaveCount(0);
  for (const p of pages) await expect(p.getByTestId('active-timeline').getByTestId('placed-card')).toBeVisible();
  for (const p of pages) await p.context().close();
});

test('slepen met de vinger: naar een plaats en terug, en een afgebroken gebaar laat niets hangen', async ({ browser }) => {
  const { host, bob } = await duo(browser, { cards: 2, bob: { touch: true, viewport: { width: 390, height: 600 } } });
  const card = bob.getByTestId('drag-card');
  await touchDrag(bob, await grip(card), await slotPoint(bob, 1));
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '1');
  await expect.poll(() => pendingAt(host)).toBe(1);

  // Naar plaats 0, dan terug naar de houder.
  await touchDrag(bob, await grip(card), await slotPoint(bob, 0));
  await expect(card).toHaveAttribute('data-index', '0');
  await touchDrag(bob, await grip(card), await centerOf(bob.getByTestId('card-holder')));
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '');
  await expect.poll(() => pendingAt(host)).toBe(-1);

  // Het systeem breekt het gebaar af (pointercancel): de kaart blijft in de houder.
  const cdp = await touchDrag(bob, await grip(card), await slotPoint(bob, 1), { end: null });
  await expect(bob.getByTestId('drag-ghost')).toBeVisible();
  await expect(bob.getByTestId('active-timeline')).toHaveAttribute('data-hover', '1');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.detach();
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '');
  await expect.poll(() => pendingAt(host)).toBe(-1);

  // Een vinger op een gewone kaart sleept niets: de kaart blijft in de houder.
  const first = bob.locator('[data-testid="active-timeline"] [data-card="0"]');
  await touchDrag(bob, await centerOf(first), { x: 200, y: 120 });
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '');
  for (const p of [host, bob]) await p.context().close();
});

test('lange tijdlijn: tot bij de rand slepen schuift de tijdlijn vanzelf mee', async ({ browser }) => {
  const { bob } = await duo(browser, { cards: 5, bob: { viewport: { width: 390, height: 520 } } });
  const card = bob.getByTestId('drag-card');
  // Onderaan de pagina: de eerste kaart staat niet meer in beeld.
  await bob.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bottomY = await bob.evaluate(() => window.scrollY);
  expect(bottomY).toBeGreaterThan(50);
  const head = await bob.locator('.game-top').boundingBox();
  // Tot net onder de bovenbalk slepen en vasthouden: de tijdlijn schuift naar boven.
  await mouseDrag(bob, await grip(card), { x: 200, y: head.y + head.height + 8 }, { release: false });
  await expect.poll(() => bob.evaluate(() => window.scrollY), { timeout: 5000 }).toBe(0);
  await expect(bob.getByTestId('active-timeline')).toHaveAttribute('data-hover', '0');
  await bob.mouse.up();
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '0');

  // En omgekeerd: van bovenaan tot net boven de zwevende balk.
  const bar = await bob.getByTestId('action-bar').boundingBox();
  await mouseDrag(bob, await grip(card), { x: 200, y: bar.y - 8 }, { release: false });
  await expect.poll(() => bob.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThanOrEqual(bottomY - 5);
  await expect(bob.getByTestId('active-timeline')).toHaveAttribute('data-hover', '5');
  await bob.mouse.up();
  await expectSettled(bob);
  await expect(card).toHaveAttribute('data-index', '5');
  await bob.context().close();
});

test('afgebroken slepen: scherm gedraaid, verbinding weg of de beurt voorbij laat geen kaart in de lucht', async ({ browser }) => {
  const { host, bob, ids, plays } = await duo(browser, { cards: 2 });
  const card = bob.getByTestId('drag-card');
  await placeCard(bob, 2);
  await expect.poll(() => pendingAt(host)).toBe(Number.POSITIVE_INFINITY);

  // Scherm gedraaid midden in een sleep: de kaart blijft waar ze lag.
  await mouseDrag(bob, await grip(card), await slotPoint(bob, 0), { release: false });
  await expect(bob.getByTestId('active-timeline')).toHaveAttribute('data-hover', '0');
  await bob.setViewportSize({ width: 844, height: 390 });
  await expectSettled(bob);
  await bob.mouse.up();
  await expect(card).toHaveAttribute('data-index', '2');
  await bob.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => pendingAt(host)).toBe(Number.POSITIVE_INFINITY);

  // De verbinding valt weg midden in een sleep.
  await mouseDrag(bob, await grip(card), await slotPoint(bob, 0), { release: false });
  await expect(bob.getByTestId('drag-ghost')).toBeVisible();
  await bob.evaluate(() => window.__mt.drop());
  await expectSettled(bob);
  await bob.mouse.up();
  await expect(card).toHaveAttribute('data-index', '2');
  await expect(bob.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });

  // De host slaat de beurt over terwijl Bob sleept: niets blijft hangen.
  await mouseDrag(bob, await grip(card), await slotPoint(bob, 1), { release: false });
  await expect(bob.getByTestId('drag-ghost')).toBeVisible();
  await hostAction(host, 'skip-turn');
  await expect(bob.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'no');
  await expectSettled(bob);
  await bob.mouse.up();
  await expect(bob.getByTestId('drag-card')).toHaveCount(0);
  // Bij zijn volgende beurt begint Bob weer met de kaart in de houder.
  await skipTo(host, ids[1], plays + 1);
  await expect(bob.getByTestId('drag-card')).toHaveAttribute('data-index', '');
  await expectSettled(bob);
  for (const p of [host, bob]) await p.context().close();
});

test('zonder slepen: knoppen omhoog/omlaag en pijltjestoetsen, met een naam per plaats', async ({ browser }) => {
  const { host, bob } = await duo(browser, { cards: 2 });
  const [a, b] = await activeYears(bob);
  const up = bob.getByTestId('move-up');
  const down = bob.getByTestId('move-down');
  const card = bob.getByTestId('drag-card');
  // In de houder: omhoog gaat naar de laatste plaats, omlaag kan niet.
  await expect(up).toHaveAttribute('aria-label', `Eén plaats hoger: na ${b}`);
  await expect(down).toBeDisabled();
  await expect(card).toHaveAttribute('aria-label', 'Het nummer, ligt nog in de houder');
  await up.click();
  await expect(card).toHaveAttribute('data-index', '2');
  await expect(card).toHaveAttribute('aria-label', `Het nummer, ligt na ${b}`);
  await expect(bob.getByTestId('announce')).toHaveText(`De kaart ligt nu na ${b}.`);
  await expect.poll(() => pendingAt(host)).toBe(Number.POSITIVE_INFINITY);
  // De focus blijft op de knop, ook al staat de kaart nu in de tijdlijn.
  await expect(up).toBeFocused();
  await expect(up).toHaveAttribute('aria-label', `Eén plaats hoger: tussen ${a} en ${b}`);
  await expect(down).toHaveAttribute('aria-label', 'Terug naar de houder');
  // Met het toetsenbord: Enter op de knop, en de pijltjes.
  await bob.keyboard.press('Enter');
  await expect(card).toHaveAttribute('data-index', '1');
  await bob.keyboard.press('ArrowUp');
  await expect(card).toHaveAttribute('data-index', '0');
  await expect(up).toBeDisabled();
  await expect(up).toHaveAttribute('aria-label', 'Kan niet hoger');
  await expect.poll(() => pendingAt(host)).toBe(0);
  await bob.keyboard.press('ArrowDown');
  await bob.keyboard.press('ArrowDown');
  await expect(card).toHaveAttribute('data-index', '2');
  await bob.keyboard.press('ArrowDown');
  await expect(card).toHaveAttribute('data-index', '');
  await expect(card).toHaveAttribute('data-where', 'holder');
  await expect(bob.getByTestId('announce')).toHaveText('De kaart ligt weer in de houder.');
  await expect.poll(() => pendingAt(host)).toBe(-1);
  await expect(bob.getByTestId('confirm-place')).toBeDisabled();
  for (const p of [host, bob]) await p.context().close();
});

test('token slepen: een bezette plaats neemt niets aan, het token terug naar de houder, en bevestigen bij het token', async ({ browser }) => {
  const { host, bob, pages, year } = await duo(browser, { cards: 2 });
  const right = correctSlot(await activeYears(bob), year);
  await placeCard(bob, right);
  await bob.getByTestId('confirm-place').click();
  await expect(host.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
  const token = host.getByTestId('drag-token');
  await expect(token).toHaveAttribute('data-index', '');
  await expect(host.getByTestId('pass-bet')).toBeVisible();

  // Op de plaats waar Bob zijn kaart legde: geen plaats, het token blijft in de houder.
  await mouseDrag(host, await grip(token), await centerOf(host.getByTestId('placed-card')), { release: false });
  await expect(host.getByTestId('active-timeline')).toHaveAttribute('data-hover', '');
  await expect(host.locator('.tl-drop.on')).toHaveCount(0);
  await host.mouse.up();
  await expectSettled(host);
  await expect(token).toHaveAttribute('data-index', '');
  await expect(host.getByTestId('bet-pick')).toHaveCount(0);

  // Op een vrije plaats: nog niet ingezet, met de knop erbij.
  const free = right === 0 ? 2 : 0;
  await mouseDrag(host, await grip(token), await slotPoint(host, free));
  await expectSettled(host);
  await expect(host.getByTestId('drag-token')).toHaveAttribute('data-index', String(free));
  const pick = host.getByTestId('bet-pick');
  await expect(pick).toContainText('Nog niet ingezet');
  await expect(pick.getByTestId('confirm-bet')).toHaveText('Zet token hier');
  await expect(host.getByTestId('pass-bet')).toBeVisible();
  // Zolang het niet bevestigd is, ziet Bob niets en kost het niets.
  await expect(bob.getByTestId('bet-mark')).toHaveCount(0);
  await expect(host.locator(`[data-testid="board-row"][data-player="${await myId(host)}"]`)).toHaveAttribute('data-tokens', '2');

  // Terug naar de houder, en opnieuw op die vrije plaats.
  await mouseDrag(host, await grip(host.getByTestId('drag-token')), await centerOf(host.getByTestId('card-holder')));
  await expectSettled(host);
  await expect(host.getByTestId('bet-pick')).toHaveCount(0);
  await expect(host.getByTestId('drag-token')).toHaveAttribute('data-index', '');
  await mouseDrag(host, await grip(host.getByTestId('drag-token')), await slotPoint(host, free));
  await host.getByTestId('confirm-bet').click();
  for (const p of pages) {
    await expect(p.getByTestId('bet-mark')).toHaveAttribute('data-index', String(free));
  }
  await expect(host.getByTestId('drag-token')).toHaveCount(0);
  await expect(host.getByTestId('challenge-banner')).toContainText('Je zette een token in');
  await expect(host.locator(`[data-testid="board-row"][data-player="${await myId(host)}"]`)).toHaveAttribute('data-tokens', '1');
  for (const p of pages) await p.context().close();
});

test('onthulling als paneel: de tijdlijn verspringt niet, wegvegen en weer openen, dicht bij de volgende beurt', async ({ browser }) => {
  const { host, bob, pages, year } = await duo(browser, { cards: 3 });
  const right = correctSlot(await activeYears(bob), year);
  await placeCard(bob, right);
  await bob.getByTestId('confirm-place').click();
  await passWaiting(pages, bob);
  // Waar staan de kaarten nu, bij Bob en bij Hanne (en de "?" van Bob)?
  const where = (page) =>
    page.getByTestId('active-timeline').evaluate((list) => ({
      scroll: window.scrollY,
      rows: [...list.children].filter((el) => el.hasAttribute('data-row')).map((el) => el.getBoundingClientRect().top),
    }));
  const before = await Promise.all(pages.map(where));
  await bob.getByTestId('reveal-now').click();
  for (const p of pages) {
    await expect(p.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'yes');
    await expect(p.getByTestId('reveal')).toBeVisible();
  }
  // Elke rij staat nog op dezelfde plaats; de "?" is een gemarkeerde kaart geworden.
  await bob.waitForTimeout(500);
  const after = await Promise.all(pages.map(where));
  for (const k of [0, 1]) {
    expect(after[k].rows).toHaveLength(before[k].rows.length);
    expectSameSpot(after[k], before[k], 'tijdlijn');
  }
  for (const p of pages) {
    await expect(p.locator(`[data-testid="active-timeline"] [data-card="${right}"]`)).toHaveClass(/\bfresh\b/);
  }
  // Het paneel staat net boven de zwevende balk, de knop staat vrij.
  const sheet = await bob.getByTestId('outcome-sheet').boundingBox();
  const bar = await bob.getByTestId('action-bar').boundingBox();
  expect(Math.abs(sheet.y + sheet.height - bar.y)).toBeLessThanOrEqual(1);

  // Inklappen met de knop en weer openen.
  await bob.getByTestId('outcome-toggle').click();
  await expect(bob.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'no');
  await expect(bob.getByTestId('reveal')).toBeHidden();
  await expect(bob.getByTestId('outcome-toggle')).toContainText(String(year));
  await bob.getByTestId('outcome-toggle').click();
  await expect(bob.getByTestId('reveal')).toBeVisible();

  // Naar onder vegen (muis op de kop) klapt het in; omhoog vegen opent het weer.
  const headBox = await bob.locator('.outcome-head').boundingBox();
  const start = { x: headBox.x + 40, y: headBox.y + 10 };
  await mouseDrag(bob, start, { x: start.x, y: start.y + 160 });
  await expect(bob.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'no');
  expectSameSpot(await where(bob), before[1], 'tijdlijn na wegvegen');
  const small = await bob.locator('.outcome-head').boundingBox();
  await mouseDrag(bob, { x: small.x + 40, y: small.y + 20 }, { x: small.x + 40, y: small.y - 120 });
  await expect(bob.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'yes');
  await expect(bob.getByTestId('reveal')).toBeVisible();

  // Hanne klapt het in; bij de volgende beurt is het overal weg.
  await host.getByTestId('outcome-toggle').click();
  await bob.getByTestId('next-turn').click();
  for (const p of pages) {
    await expect(p.getByTestId('turn-banner')).toBeVisible();
    await expect(p.getByTestId('outcome-sheet')).toHaveCount(0);
  }
  for (const p of pages) await p.context().close();
});

test('stand en menu: openen, sluiten en een tijdlijn bekijken', async ({ browser }) => {
  const { host, bob, ids } = await duo(browser, { cards: 2 });
  // De knop "Stand" toont je eigen kaarten en tokens.
  await expect(bob.getByTestId('stand-open')).toContainText('2 / 10 kaarten');
  await expect(bob.getByTestId('stand-open')).toContainText('2 tokens');
  await expect(host.getByTestId('stand-open')).toContainText('1 / 10 kaarten');
  await expect(host.getByTestId('stand')).toBeHidden();
  await openStand(host);
  const stand = host.getByTestId('stand');
  await expect(stand.getByTestId('board-row')).toHaveCount(2);
  await expect(stand.locator(`[data-player="${ids[1]}"]`)).toContainText('aan de beurt');
  await expect(stand.getByTestId('deck-left')).toContainText(/Beurt \d+ · nog \d+ nummers in de stapel/);
  // Escape sluit, en de focus gaat terug naar de knop.
  await host.keyboard.press('Escape');
  await expect(stand).toBeHidden();
  await expect(host.getByTestId('stand-open')).toBeFocused();
  // Tik op een naam: die tijdlijn staat op het scherm.
  await openStand(host);
  await stand.locator(`[data-player="${ids[0]}"] .board-head`).click();
  await expect(stand).toBeHidden();
  await expect(host.getByTestId('my-timeline')).toBeVisible();
  await expect(host.getByTestId('view-mine')).toHaveAttribute('aria-pressed', 'true');
  await host.getByTestId('view-active').click();
  await expect(host.getByTestId('active-timeline')).toBeVisible();

  // Het menu: de spelcode voor iedereen, de hostbediening alleen voor de host.
  await openMenu(bob);
  await expect(bob.getByTestId('room-code')).toBeVisible();
  await expect(bob.getByTestId('host-controls')).toHaveCount(0);
  await expect(bob.getByRole('button', { name: 'Verlaat het spel' })).toBeVisible();
  await bob.getByTestId('menu-close').click();
  await expect(bob.getByTestId('menu')).toBeHidden();
  await openMenu(host);
  for (const id of ['replay', 'skip-track', 'skip-turn', 'host-music-status']) await expect(host.getByTestId(id)).toBeVisible();
  // Tik naast het paneel: dicht.
  await host.mouse.click(200, 30);
  await expect(host.getByTestId('menu')).toBeHidden();
  // De spelregels staan in het menu.
  await openMenu(host);
  await host.getByText('Spelregels', { exact: true }).click();
  await expect(host.getByTestId('menu')).toContainText('Wie eerst 10 kaarten heeft');
  for (const p of [host, bob]) await p.context().close();
});

test('wat de anderen zien: de keuze gaat pas bij het loslaten naar de server', async ({ browser }) => {
  const { host, bob, plays } = await duo(browser, { cards: 2 });
  await bob.evaluate(() => {
    // Tel wat er verstuurd wordt.
    const orig = WebSocket.prototype.send;
    window.__sent = [];
    WebSocket.prototype.send = function (data) {
      window.__sent.push(String(data));
      return orig.call(this, data);
    };
  });
  const card = bob.getByTestId('drag-card');
  // Heen en weer over alle plaatsen, en dan los op plaats 1.
  const from = await grip(card);
  // De punten vooraf: tijdens het slepen schuiven de kaarten.
  const at = await Promise.all([0, 1, 2].map((i) => slotPoint(bob, i)));
  await bob.mouse.move(from.x, from.y);
  await bob.mouse.down();
  for (const i of [2, 0, 2, 1, 0, 1]) {
    await bob.mouse.move(at[i].x, at[i].y, { steps: 6 });
    await expect(bob.getByTestId('active-timeline')).toHaveAttribute('data-hover', String(i));
  }
  await bob.mouse.up();
  await expect(card).toHaveAttribute('data-index', '1');
  const selects = (await bob.evaluate(() => window.__sent)).filter((m) => m.includes('"select"'));
  expect(selects).toEqual(['{"t":"select","index":1}']);
  await expect.poll(() => pendingAt(host)).toBe(1);
  expect(await playCount(host)).toBe(plays);
  for (const p of [host, bob]) await p.context().close();
});
