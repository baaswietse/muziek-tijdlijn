import { test, expect } from '@playwright/test';
import { openPhone, hostGame, setupMusic, joinGame, setTarget, myId, YEAR, TRACKS } from './helpers.js';

// Tokens: wie artiest en nummer als eerste juist raadt (hardop aan tafel),
// krijgt na de onthulling een token. Met een token kan je bij de beurt van
// een ander een andere plaats kiezen. Deze tests spelen met drie gsm's.

const row = (page, id) => page.locator(`[data-testid="board-row"][data-player="${id}"]`);

/** Elke gsm toont voor elke speler het verwachte aantal tokens op het bord. */
async function expectTokens(pages, counts) {
  for (const p of pages) {
    for (const [id, n] of Object.entries(counts)) {
      await expect(row(p, id)).toHaveAttribute('data-tokens', String(n));
      await expect(row(p, id).getByTestId('token-count')).toHaveText(`${n} ${n === 1 ? 'token' : 'tokens'}`);
    }
  }
}

const cardCount = async (page, id) => Number(await row(page, id).getAttribute('data-count'));

const plays = (host) => host.evaluate(() => window.__mockSpotify.log.filter((e) => e.type === 'play'));

/**
 * Wacht tot de host-gsm het `n`-de nummer startte en geeft het jaar ervan:
 * daaruit kent de test de juiste plaats.
 */
async function yearOfPlay(host, n) {
  await expect.poll(async () => (await plays(host)).length).toBe(n);
  const trackId = (await plays(host)).at(-1).trackId;
  const year = YEAR.get(trackId);
  expect(year, `onbekend nummer ${trackId}`).toBeTruthy();
  return { trackId, year };
}

/** Plaats waar `year` juist ligt tussen de (gesorteerde) jaren. */
function rightSlot(years, year) {
  let i = 0;
  while (i < years.length && years[i] <= year) i++;
  return i;
}

/** Een plaats waar `year` zeker fout ligt (niet `except`), of null. */
function badSlot(years, year, except = null) {
  for (let i = 0; i <= years.length; i++) {
    const before = i > 0 ? years[i - 1] : -Infinity;
    const after = i < years.length ? years[i] : Infinity;
    if (i !== except && !(before <= year && year <= after)) return i;
  }
  return null;
}

/** Wie is aan de beurt, welk nummer speelt en hoe ligt zijn tijdlijn. */
async function currentTurn({ pages, host, ids, n }) {
  const activeId = await host.getByTestId('turn-banner').getAttribute('data-active');
  const active = pages[ids.indexOf(activeId)];
  await expect(active.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  const { trackId, year } = await yearOfPlay(host, n);
  const years = await active
    .getByTestId('active-timeline')
    .locator('li.tl-card[data-year]')
    .evaluateAll((els) => els.map((el) => Number(el.dataset.year)));
  return { activeId, active, trackId, year, years };
}

/**
 * De speler aan beurt legt op `slot`. Heeft een ander een token, dan volgt
 * eerst de tussenfase (`challenge`), anders meteen de onthulling.
 */
async function place(pages, turn, slot, { challenge }) {
  await turn.active.getByTestId(`slot-${slot}`).click();
  await turn.active.getByTestId('confirm-place').click();
  if (challenge) {
    for (const p of pages) {
      await expect(p.getByTestId('challenge-banner')).toBeVisible();
      await expect(p.getByTestId('active-timeline').getByTestId('placed-card')).toBeVisible();
      await expect(p.getByTestId('reveal')).toHaveCount(0);
    }
  } else {
    for (const p of pages) {
      await expect(p.getByTestId('reveal')).toHaveAttribute('data-track', turn.trackId);
      await expect(p.getByTestId('challenge-banner')).toHaveCount(0);
    }
  }
}

/** Einde van de tussenfase: `page` tikt op Onthul en iedereen ziet de kaart. */
async function revealNow(pages, page, trackId) {
  await page.getByTestId('reveal-now').click();
  for (const p of pages) await expect(p.getByTestId('reveal')).toHaveAttribute('data-track', trackId);
}

const othersHaveTokens = (counts, activeId) => Object.entries(counts).some(([id, k]) => id !== activeId && k > 0);

/** De speler aan beurt legt het nummer juist; wacht tot iedereen de onthulling ziet. */
async function placeCorrect({ pages, host, ids, n, counts }) {
  const turn = await currentTurn({ pages, host, ids, n });
  const challenge = othersHaveTokens(counts, turn.activeId);
  await place(pages, turn, rightSlot(turn.years, turn.year), { challenge });
  // Niemand zet in: de speler aan beurt onthult zelf.
  if (challenge) await revealNow(pages, turn.active, turn.trackId);
  return turn;
}

/** Zat het antwoord van dit nummer in de berichten die deze gsm ontving? */
function leaked(page, trackId) {
  const track = TRACKS.find((t) => t.id === trackId);
  // Exacte waarden tussen aanhalingstekens: titels van testnummers lijken op elkaar.
  return page.frames_.some((f) => f.includes(`"${trackId}"`) || f.includes(`"title":"${track.title}"`));
}

const tokenButton = (page, id) => page.locator(`[data-testid="token-button"][data-player="${id}"]`);

/** Drie gsm's in één spel; geeft de pagina's en hun speler-ID's. */
async function threePhones(browser) {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const cas = await openPhone(browser);
  await joinGame(cas, code, 'Cas');
  const pages = [host, bob, cas];
  for (const p of pages) await expect(p.getByTestId('lobby-player')).toHaveCount(3);
  const ids = await Promise.all(pages.map(myId));
  return { host, bob, cas, pages, ids };
}

test('tokens: geven, verplaatsen, terugnemen, blijven staan en terug op 0 bij een nieuw spel', async ({ browser }) => {
  const { host, bob, pages, ids } = await threePhones(browser);
  await setTarget(host, 3);
  const names = { [ids[0]]: 'Hanne', [ids[1]]: 'Bob', [ids[2]]: 'Cas' };
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));

  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  await expectTokens(pages, counts);
  let n = 1; // aantal nummers dat de host al startte

  // Zorg dat een gast aan de beurt is: de host slaat zijn eigen beurt over.
  await yearOfPlay(host, n);
  if ((await host.getByTestId('turn-banner').getAttribute('data-mine')) === 'yes') {
    await host.getByTestId('skip-turn').click();
    await expect(host.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'no');
    n++;
  }

  // Beurt 1: de gast aan beurt geeft zichzelf het token.
  const first = await placeCorrect({ pages, host, ids, n, counts });
  const activeId = first.activeId;
  const third = ids.find((id) => id !== activeId && id !== ids[0]);
  const thirdPage = pages[ids.indexOf(third)];
  // Raadvolgorde: eerst wie aan de beurt was.
  await expect(first.active.getByTestId('token-button').first()).toHaveAttribute('data-player', activeId);
  await expect(first.active.getByTestId('token-button')).toHaveCount(3);
  await expect(host.getByTestId('token-picker')).toBeVisible();
  // De derde speler (geen host, niet aan beurt) krijgt geen rij met namen,
  // alleen een knop om het token voor zichzelf op te eisen.
  await expect(thirdPage.getByTestId('token-picker')).toHaveCount(0);
  await expect(thirdPage.getByTestId('token-button')).toHaveCount(0);
  await thirdPage.getByTestId('token-claim-button').click();
  counts[third] = 1;
  await expectTokens(pages, counts);
  await expect(host.getByTestId('reveal-token')).toHaveText(`Token voor ${names[third]}`);
  await expect(tokenButton(host, third)).toHaveAttribute('aria-pressed', 'true');
  await thirdPage.getByTestId('token-unclaim').click();
  counts[third] = 0;
  await expectTokens(pages, counts);
  await expect(thirdPage.getByTestId('token-claim-button')).toBeVisible();

  await tokenButton(first.active, activeId).click();
  counts[activeId] = 1;
  await expectTokens(pages, counts);
  await expect(tokenButton(first.active, activeId)).toHaveAttribute('aria-pressed', 'true');
  await expect(tokenButton(host, activeId)).toHaveAttribute('aria-pressed', 'true');
  await expect(first.active.getByTestId('reveal-token')).toHaveText('Token voor jou');
  await expect(thirdPage.getByTestId('reveal-token')).toHaveText(`Token voor ${names[activeId]}`);
  // Heeft een ander het token, dan verdwijnt de knop om op te eisen.
  await expect(thirdPage.getByTestId('token-claim')).toHaveCount(0);

  // De host verplaatst het naar de derde speler...
  await tokenButton(host, third).click();
  counts[activeId] = 0;
  counts[third] = 1;
  await expectTokens(pages, counts);
  await expect(tokenButton(host, activeId)).toHaveAttribute('aria-pressed', 'false');
  await expect(tokenButton(first.active, third)).toHaveAttribute('aria-pressed', 'true');
  await expect(thirdPage.getByTestId('reveal-token')).toHaveText('Token voor jou');
  await expect(host.getByTestId('reveal-token')).toHaveText(`Token voor ${names[third]}`);

  // ...en neemt het terug door nog eens te tikken.
  await tokenButton(host, third).click();
  counts[third] = 0;
  await expectTokens(pages, counts);
  for (const p of pages) await expect(p.getByTestId('reveal-token')).toHaveCount(0);
  await expect(tokenButton(first.active, third)).toHaveAttribute('aria-pressed', 'false');

  // Uiteindelijk raadde de speler aan beurt het toch: weer naar hem.
  await tokenButton(first.active, activeId).click();
  counts[activeId] = 1;
  await expectTokens(pages, counts);
  await first.active.getByTestId('next-turn').click();
  n++;
  for (const p of pages) await expect(p.getByTestId('token-picker')).toHaveCount(0);
  await expectTokens(pages, counts);

  // Beurt 2: de host geeft het token aan de derde speler.
  const second = await placeCorrect({ pages, host, ids, n, counts });
  await tokenButton(host, third).click();
  counts[third] = 1;
  await expectTokens(pages, counts);
  await second.active.getByTestId('next-turn').click();
  n++;

  // Een weggevallen verbinding: na het herverbinden staan de tellers er nog.
  await bob.evaluate(() => window.__mt.drop());
  await expect(bob.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await expectTokens(pages, counts);

  // Verder spelen tot iemand wint; geen tokens tussendoor.
  let last;
  for (let i = 0; i < 12; i++) {
    last = await placeCorrect({ pages, host, ids, n, counts });
    if (await host.getByTestId('winner').isVisible()) break;
    await expectTokens(pages, counts);
    await last.active.getByTestId('next-turn').click();
    n++;
  }
  await expect(host.getByTestId('winner')).toBeVisible();
  const winner = await host.getByTestId('winner').getAttribute('data-winners');
  expect(winner).toBe(last.activeId);

  // Bij de beslissende kaart kan het token nog gegeven worden.
  const winnerPage = pages[ids.indexOf(winner)];
  await expect(winnerPage.getByTestId('token-picker')).toBeVisible();
  await tokenButton(winnerPage, winner).click();
  counts[winner] += 1;
  await expectTokens(pages, counts);
  // Het eindscherm somt op wie tokens verdiende.
  for (const p of pages) {
    for (const id of ids) {
      if (!counts[id]) continue;
      const label = p === pages[ids.indexOf(id)] ? 'jij' : names[id];
      await expect(p.getByTestId('winner-tokens')).toContainText(`${label} ${counts[id]}`);
    }
  }
  const bystander = pages.find((p) => p !== winnerPage && p !== host);
  if (bystander) await expect(bystander.getByTestId('token-picker')).toHaveCount(0);

  // Nog een spel: iedereen terug op 0.
  await host.getByTestId('play-again').click();
  for (const p of pages) {
    await expect(p.getByTestId('turn-banner')).toBeVisible();
    await expect(p.getByTestId('winner')).toHaveCount(0);
  }
  await expectTokens(pages, Object.fromEntries(ids.map((id) => [id, 0])));
  for (const p of pages) await p.context().close();
});

test('token inzetten: gewonnen bij een foute speler, verloren bij een juiste, zonder tokens meteen onthullen', async ({ browser }) => {
  const { host, pages, ids } = await threePhones(browser);
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));
  await host.getByTestId('start-game').click();
  let n = 1;

  // Beurt 1: niemand heeft een token, dus de onthulling volgt meteen.
  const t1 = await currentTurn({ pages, host, ids, n });
  await place(pages, t1, rightSlot(t1.years, t1.year), { challenge: false });
  // Hij raadde ook artiest en nummer: het token gaat naar hemzelf.
  const better = t1.activeId;
  const betterPage = t1.active;
  await tokenButton(t1.active, better).click();
  counts[better] = 1;
  await expectTokens(pages, counts);
  await t1.active.getByTestId('next-turn').click();
  n++;

  // Beurt 2: de volgende speler legt fout. Is elke plaats juist (zelfde jaar),
  // dan vraagt de host eerst een ander nummer.
  let t2 = await currentTurn({ pages, host, ids, n });
  expect(t2.activeId).not.toBe(better);
  for (let i = 0; i < 10 && badSlot(t2.years, t2.year) === null; i++) {
    await host.getByTestId('skip-track').click();
    n++;
    t2 = await currentTurn({ pages, host, ids, n });
  }
  const wrong = badSlot(t2.years, t2.year);
  expect(wrong).not.toBeNull();
  const betterCards = await cardCount(host, better);
  const activeCards = await cardCount(host, t2.activeId);
  await place(pages, t2, wrong, { challenge: true });

  // Wie aan beurt is en wie geen token heeft, kan niet inzetten.
  await expect(t2.active.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(t2.active.getByTestId('confirm-bet')).toHaveCount(0);
  const idle = pages.find((p) => p !== betterPage && p !== t2.active);
  await expect(idle.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(idle.getByTestId('active-timeline').locator('.slot-btn')).toHaveCount(0);
  await expect(betterPage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
  // De vastgelegde plaats kan je niet kiezen.
  await expect(betterPage.getByTestId(`slot-${wrong}`)).toHaveCount(0);

  // Tweestaps: aantikken kost nog niets, pas bevestigen zet het token in.
  const right = rightSlot(t2.years, t2.year);
  await betterPage.getByTestId(`slot-${right}`).click();
  await expect(betterPage.getByTestId('pending-card')).toBeVisible();
  await expectTokens(pages, counts);
  await betterPage.getByTestId('confirm-bet').click();
  counts[better] = 0;
  await expectTokens(pages, counts);
  for (const p of pages) {
    await expect(p.getByTestId('bet-mark')).toHaveAttribute('data-player', better);
    await expect(p.getByTestId('bet-mark')).toHaveAttribute('data-index', String(right));
  }
  await expect(betterPage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(t2.active.getByTestId('bet-mark')).toContainText('Token van');

  // Ook in de tussenfase lekt het antwoord niet naar gasten, en de muziek
  // start niet opnieuw.
  for (const p of pages) if (p !== host) expect(leaked(p, t2.trackId), 'antwoord lekte in de tussenfase').toBe(false);
  expect((await plays(host)).length).toBe(n);

  // Onthullen: de inzetter lag juist en krijgt de kaart op zijn eigen tijdlijn.
  await revealNow(pages, t2.active, t2.trackId);
  for (const p of pages) {
    await expect(p.getByTestId('reveal')).toHaveAttribute('data-correct', 'no');
    await expect(p.getByTestId('reveal-card-to')).toHaveAttribute('data-player', better);
    await expect(p.getByTestId('bet-mark')).toContainText('juist');
    expect(await cardCount(p, better)).toBe(betterCards + 1);
    expect(await cardCount(p, t2.activeId)).toBe(activeCards);
  }
  await expect(betterPage.getByTestId('reveal-card-to')).toContainText('Jij krijgt de kaart');
  const myYears = await betterPage
    .locator('[data-testid="my-timeline"] li.tl-card[data-year]')
    .evaluateAll((els) => els.map((el) => Number(el.dataset.year)));
  expect(myYears).toContain(t2.year);
  expect(myYears).toEqual([...myYears].sort((a, b) => a - b));
  expect((await plays(host)).length).toBe(n);

  // Hij raadde ook dit nummer: de host geeft hem een nieuw token.
  await tokenButton(host, better).click();
  counts[better] = 1;
  await expectTokens(pages, counts);
  await t2.active.getByTestId('next-turn').click();
  n++;

  // Beurt 3: de derde speler legt juist; de inzet op een foute plaats is verloren.
  const t3 = await currentTurn({ pages, host, ids, n });
  expect(t3.activeId).not.toBe(better);
  const good = rightSlot(t3.years, t3.year);
  const thirdCards = await cardCount(host, t3.activeId);
  const betterBefore = await cardCount(host, better);
  await place(pages, t3, good, { challenge: true });
  const bet = badSlot(t3.years, t3.year, good) ?? (good === 0 ? 1 : 0);
  await betterPage.getByTestId(`slot-${bet}`).click();
  await betterPage.getByTestId('confirm-bet').click();
  counts[better] = 0;
  await expectTokens(pages, counts);
  // De host onthult deze keer.
  await revealNow(pages, host, t3.trackId);
  for (const p of pages) {
    await expect(p.getByTestId('reveal')).toHaveAttribute('data-correct', 'yes');
    await expect(p.getByTestId('reveal')).toContainText('ingezette tokens zijn verloren');
    expect(await cardCount(p, t3.activeId)).toBe(thirdCards + 1);
    expect(await cardCount(p, better)).toBe(betterBefore);
  }
  await expectTokens(pages, counts);
  await t3.active.getByTestId('next-turn').click();
  n++;

  // Niemand heeft nog een token: weer meteen onthullen.
  const t4 = await currentTurn({ pages, host, ids, n });
  await place(pages, t4, rightSlot(t4.years, t4.year), { challenge: false });
  for (const p of pages) await p.context().close();
});
