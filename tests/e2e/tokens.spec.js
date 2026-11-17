import { test, expect } from '@playwright/test';
import { openPhone, hostGame, setupMusic, joinGame, setTarget, myId, YEAR, TRACKS } from './helpers.js';

// Tokens: iedereen begint een spel met 2 tokens; wie artiest en nummer als
// eerste juist raadt (hardop aan tafel), krijgt na de onthulling een token
// extra. Met een token kan je bij de beurt van een ander een andere plaats
// kiezen. De meeste tests spelen met drie gsm's.

const START = 2;

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
 * De host slaat beurten over tot `targetId` aan de beurt is. Geeft het nieuwe
 * aantal gestarte nummers terug.
 */
async function skipUntil({ host, ids }, n, targetId) {
  for (let i = 0; i <= ids.length; i++) {
    await yearOfPlay(host, n);
    const activeId = await host.getByTestId('turn-banner').getAttribute('data-active');
    if (activeId === targetId) return n;
    await host.getByTestId('skip-turn').click();
    n++;
    await expect(host.getByTestId('turn-banner')).not.toHaveAttribute('data-active', activeId);
  }
  throw new Error(`${targetId} raakte niet aan de beurt`);
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
    // De speler aan beurt ziet meteen dat hij moet onthullen.
    await expect(turn.active.getByTestId('challenge-banner')).toContainText('Tik op Onthul');
    await expect(turn.active.getByTestId('reveal-now')).toBeVisible();
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

test('tokens: 2 bij de start, geven, verplaatsen, terugnemen, blijven staan en weer 2 bij een nieuw spel', async ({ browser }) => {
  const { host, bob, pages, ids } = await threePhones(browser);
  await setTarget(host, 3);
  const names = { [ids[0]]: 'Hanne', [ids[1]]: 'Bob', [ids[2]]: 'Cas' };
  const counts = Object.fromEntries(ids.map((id) => [id, START]));

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
  counts[third] = START + 1;
  await expectTokens(pages, counts);
  await expect(host.getByTestId('reveal-token')).toHaveText(`Token voor ${names[third]}`);
  await expect(tokenButton(host, third)).toHaveAttribute('aria-pressed', 'true');
  await thirdPage.getByTestId('token-unclaim').click();
  counts[third] = START;
  await expectTokens(pages, counts);
  await expect(thirdPage.getByTestId('token-claim-button')).toBeVisible();

  await tokenButton(first.active, activeId).click();
  counts[activeId] = START + 1;
  await expectTokens(pages, counts);
  await expect(tokenButton(first.active, activeId)).toHaveAttribute('aria-pressed', 'true');
  await expect(tokenButton(host, activeId)).toHaveAttribute('aria-pressed', 'true');
  await expect(first.active.getByTestId('reveal-token')).toHaveText('Token voor jou');
  await expect(thirdPage.getByTestId('reveal-token')).toHaveText(`Token voor ${names[activeId]}`);
  // Heeft een ander het token, dan verdwijnt de knop om op te eisen.
  await expect(thirdPage.getByTestId('token-claim')).toHaveCount(0);

  // De host verplaatst het naar de derde speler...
  await tokenButton(host, third).click();
  counts[activeId] = START;
  counts[third] = START + 1;
  await expectTokens(pages, counts);
  await expect(tokenButton(host, activeId)).toHaveAttribute('aria-pressed', 'false');
  await expect(tokenButton(first.active, third)).toHaveAttribute('aria-pressed', 'true');
  await expect(thirdPage.getByTestId('reveal-token')).toHaveText('Token voor jou');
  await expect(host.getByTestId('reveal-token')).toHaveText(`Token voor ${names[third]}`);

  // ...en neemt het terug door nog eens te tikken.
  await tokenButton(host, third).click();
  counts[third] = START;
  await expectTokens(pages, counts);
  for (const p of pages) await expect(p.getByTestId('reveal-token')).toHaveCount(0);
  await expect(tokenButton(first.active, third)).toHaveAttribute('aria-pressed', 'false');

  // Uiteindelijk raadde de speler aan beurt het toch: weer naar hem.
  await tokenButton(first.active, activeId).click();
  counts[activeId] = START + 1;
  await expectTokens(pages, counts);
  await first.active.getByTestId('next-turn').click();
  n++;
  for (const p of pages) await expect(p.getByTestId('token-picker')).toHaveCount(0);
  await expectTokens(pages, counts);

  // Beurt 2: de host geeft het token aan de derde speler.
  const second = await placeCorrect({ pages, host, ids, n, counts });
  await tokenButton(host, third).click();
  counts[third] = START + 1;
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
  // Het eindscherm somt op wie nog hoeveel tokens heeft.
  for (const p of pages) {
    await expect(p.getByTestId('winner-tokens')).toContainText('Tokens over');
    for (const id of ids) {
      const label = p === pages[ids.indexOf(id)] ? 'jij' : names[id];
      await expect(p.getByTestId('winner-tokens')).toContainText(`${label} ${counts[id]}`);
    }
  }
  const bystander = pages.find((p) => p !== winnerPage && p !== host);
  if (bystander) await expect(bystander.getByTestId('token-picker')).toHaveCount(0);

  // Nog een spel: iedereen weer op 2, ook wie er meer had.
  expect(Object.values(counts).some((k) => k !== START)).toBe(true);
  await host.getByTestId('play-again').click();
  for (const p of pages) {
    await expect(p.getByTestId('turn-banner')).toBeVisible();
    await expect(p.getByTestId('winner')).toHaveCount(0);
  }
  await expectTokens(pages, Object.fromEntries(ids.map((id) => [id, START])));
  for (const p of pages) await p.context().close();
});

test('token inzetten: gewonnen bij een foute speler, verloren bij een juiste, alle plaatsen bezet, zonder tokens niet', async ({ browser }) => {
  const { host, pages, ids } = await threePhones(browser);
  const counts = Object.fromEntries(ids.map((id) => [id, START]));
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  await expectTokens(pages, counts);
  let n = 1;

  // Beurt 1: de speler aan beurt legt fout. Is elke plaats juist (zelfde
  // jaar), dan vraagt de host eerst een ander nummer.
  let t1 = await currentTurn({ pages, host, ids, n });
  for (let i = 0; i < 10 && badSlot(t1.years, t1.year) === null; i++) {
    await host.getByTestId('skip-track').click();
    n++;
    t1 = await currentTurn({ pages, host, ids, n });
  }
  const wrong = badSlot(t1.years, t1.year);
  expect(wrong).not.toBeNull();
  // Iedereen heeft nog maar één kaart: twee plaatsen, één ervan juist.
  expect(t1.years).toHaveLength(1);
  const better = ids.find((id) => id !== t1.activeId);
  const betterPage = pages[ids.indexOf(better)];
  const idle = ids.find((id) => id !== t1.activeId && id !== better);
  const idlePage = pages[ids.indexOf(idle)];
  const betterCards = await cardCount(host, better);
  const activeCards = await cardCount(host, t1.activeId);
  await place(pages, t1, wrong, { challenge: true });

  // Wie aan beurt is, kan niet inzetten; de anderen hebben elk 2 tokens.
  await expect(t1.active.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(t1.active.getByTestId('confirm-bet')).toHaveCount(0);
  for (const p of [betterPage, idlePage]) {
    await expect(p.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
    await expect(p.getByTestId('challenge-banner')).toContainText('Je hebt 2 tokens');
  }
  // De vastgelegde plaats kan je niet kiezen.
  await expect(betterPage.getByTestId(`slot-${wrong}`)).toHaveCount(0);

  // Tweestaps: aantikken kost nog niets, pas bevestigen zet het token in.
  const right = rightSlot(t1.years, t1.year);
  await betterPage.getByTestId(`slot-${right}`).click();
  await expect(betterPage.getByTestId('pending-card')).toBeVisible();
  await expectTokens(pages, counts);
  await betterPage.getByTestId('confirm-bet').click();
  counts[better] = START - 1;
  await expectTokens(pages, counts);
  for (const p of pages) {
    await expect(p.getByTestId('bet-mark')).toHaveAttribute('data-player', better);
    await expect(p.getByTestId('bet-mark')).toHaveAttribute('data-index', String(right));
  }
  await expect(betterPage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(t1.active.getByTestId('bet-mark')).toContainText('Token van');
  // Nu zijn beide plaatsen bezet: de derde speler kan niet meer inzetten en houdt zijn tokens.
  await expect(idlePage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(idlePage.getByTestId('challenge-banner')).toContainText('Alle andere plaatsen zijn al bezet');
  await expect(idlePage.getByTestId('active-timeline').locator('.slot-btn')).toHaveCount(0);

  // Ook in de tussenfase lekt het antwoord niet naar gasten, en de muziek
  // start niet opnieuw.
  for (const p of pages) if (p !== host) expect(leaked(p, t1.trackId), 'antwoord lekte in de tussenfase').toBe(false);
  expect((await plays(host)).length).toBe(n);

  // Onthullen: de inzetter lag juist en krijgt de kaart op zijn eigen tijdlijn.
  await revealNow(pages, t1.active, t1.trackId);
  for (const p of pages) {
    await expect(p.getByTestId('reveal')).toHaveAttribute('data-correct', 'no');
    await expect(p.getByTestId('reveal-card-to')).toHaveAttribute('data-player', better);
    await expect(p.getByTestId('bet-mark')).toContainText('juist');
    expect(await cardCount(p, better)).toBe(betterCards + 1);
    expect(await cardCount(p, t1.activeId)).toBe(activeCards);
  }
  await expect(betterPage.getByTestId('reveal-card-to')).toContainText('Jij krijgt de kaart');
  const myYears = await betterPage
    .locator('[data-testid="my-timeline"] li.tl-card[data-year]')
    .evaluateAll((els) => els.map((el) => Number(el.dataset.year)));
  expect(myYears).toContain(t1.year);
  expect(myYears).toEqual([...myYears].sort((a, b) => a - b));
  expect((await plays(host)).length).toBe(n);
  await expectTokens(pages, counts);
  await t1.active.getByTestId('next-turn').click();
  n++;

  // Beurt 2: de derde speler legt juist; de inzet op een andere plaats is verloren.
  n = await skipUntil({ host, ids }, n, idle);
  const t2 = await currentTurn({ pages, host, ids, n });
  const good = rightSlot(t2.years, t2.year);
  const idleCards = await cardCount(host, idle);
  const betterBefore = await cardCount(host, better);
  await place(pages, t2, good, { challenge: true });
  const bet = badSlot(t2.years, t2.year, good) ?? (good === 0 ? 1 : 0);
  await betterPage.getByTestId(`slot-${bet}`).click();
  await betterPage.getByTestId('confirm-bet').click();
  counts[better] = 0;
  await expectTokens(pages, counts);
  // De host onthult deze keer.
  await revealNow(pages, host, t2.trackId);
  for (const p of pages) {
    await expect(p.getByTestId('reveal')).toHaveAttribute('data-correct', 'yes');
    await expect(p.getByTestId('reveal')).toContainText('ingezette tokens zijn verloren');
    expect(await cardCount(p, idle)).toBe(idleCards + 1);
    expect(await cardCount(p, better)).toBe(betterBefore);
  }
  await expectTokens(pages, counts);
  await t2.active.getByTestId('next-turn').click();
  n++;

  // Beurt 3: wie zijn tokens op heeft, kan niet inzetten; de anderen wel nog.
  n = await skipUntil({ host, ids }, n, t1.activeId);
  const t3 = await currentTurn({ pages, host, ids, n });
  await place(pages, t3, rightSlot(t3.years, t3.year), { challenge: true });
  await expect(betterPage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'no');
  await expect(betterPage.getByTestId('active-timeline').locator('.slot-btn')).toHaveCount(0);
  await expect(betterPage.getByTestId('confirm-bet')).toHaveCount(0);
  await expect(idlePage.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
  await revealNow(pages, t3.active, t3.trackId);
  await expectTokens(pages, counts);
  for (const p of pages) await p.context().close();
});

test('zonder tokens bij de anderen: meteen onthullen, ook al heeft de speler aan beurt er zelf', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  const [hanne, bobId] = ids;
  const counts = { [hanne]: START, [bobId]: START };
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  await expectTokens(pages, counts);
  let n = 1;

  // Bob zet bij elke beurt van Hanne een token in; zijn eigen beurten slaat de host over.
  for (let i = 0; i < START; i++) {
    n = await skipUntil({ host, ids }, n, hanne);
    const turn = await currentTurn({ pages, host, ids, n });
    const slot = rightSlot(turn.years, turn.year);
    await place(pages, turn, slot, { challenge: true });
    const left = START - i;
    await expect(bob.getByTestId('challenge-banner')).toContainText(`Je hebt ${left} ${left === 1 ? 'token' : 'tokens'}`);
    await bob.getByTestId(`slot-${slot === 0 ? 1 : 0}`).click();
    await bob.getByTestId('confirm-bet').click();
    counts[bobId] -= 1;
    await expectTokens(pages, counts);
    await revealNow(pages, host, turn.trackId);
    await host.getByTestId('next-turn').click();
    n++;
  }
  expect(counts[bobId]).toBe(0);

  // Bij Bob kan Hanne nog inzetten: daar komt de tussenfase nog wel.
  n = await skipUntil({ host, ids }, n, bobId);
  const bobTurn = await currentTurn({ pages, host, ids, n });
  await place(pages, bobTurn, rightSlot(bobTurn.years, bobTurn.year), { challenge: true });
  await expect(host.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
  await revealNow(pages, bob, bobTurn.trackId);
  await bob.getByTestId('next-turn').click();
  n++;

  // Bij Hanne heeft niemand anders nog een token: meteen de onthulling.
  n = await skipUntil({ host, ids }, n, hanne);
  const last = await currentTurn({ pages, host, ids, n });
  await place(pages, last, rightSlot(last.years, last.year), { challenge: false });
  await expectTokens(pages, counts);
  for (const p of pages) await p.context().close();
});

// ---- Inzetten moet ondubbelzinnig zijn ----
// Een speler mag nooit denken dat hij een token inzette terwijl dat niet zo is:
// aantikken alleen zet niets in, een mislukte bevestiging zegt dat, en na de
// onthulling hoort hij dat hij zijn token nog heeft.

/** Ligt de knop zelf bovenaan op zijn middelpunt (geen balk of melding erover)? */
const onTop = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });

/**
 * Hanne (host) en Bob; Bob is aan de beurt, legt juist en Hanne heeft een
 * plaats waar het nummer zeker fout ligt. `beforeChallenge` loopt net voor het
 * leggen (bv. om de verbinding van Hanne om te leiden).
 */
async function hanneBetsOnBob(browser, { beforeChallenge } = {}) {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  const [hanne, bobId] = ids;
  const counts = { [hanne]: START, [bobId]: START };
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  let n = await skipUntil({ host, ids }, 1, bobId);
  let turn = await currentTurn({ pages, host, ids, n });
  // Hetzelfde jaar als Bobs kaart is overal juist: dan eerst een ander nummer.
  for (let i = 0; i < 10 && badSlot(turn.years, turn.year) === null; i++) {
    await host.getByTestId('skip-track').click();
    n++;
    turn = await currentTurn({ pages, host, ids, n });
  }
  const right = rightSlot(turn.years, turn.year);
  const wrong = badSlot(turn.years, turn.year, right);
  expect(wrong).not.toBeNull();
  if (beforeChallenge) await beforeChallenge(host);
  await place(pages, turn, right, { challenge: true });
  return { host, bob, pages, ids, hanne, bobId, counts, turn, wrong };
}

test('token inzetten: aangetikt is nog niet ingezet, de knop staat bij de plaats en na de onthulling hoor je dat je token er nog is', async ({ browser }) => {
  const { host, bob, pages, counts, turn, wrong } = await hanneBetsOnBob(browser);
  // Een kleine gsm: ook dan staat de bevestigknop in beeld.
  await host.setViewportSize({ width: 390, height: 600 });
  await host.getByTestId(`slot-${wrong}`).click();

  // De aangetikte plaats zegt dat er nog niets ingezet is en ziet er anders
  // uit dan de kaart die Bob vastlegde.
  const pick = host.getByTestId('bet-pick');
  await expect(pick).toContainText('Nog niet ingezet');
  const look = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await look(pick)).not.toBe(await look(host.getByTestId('placed-card')));
  // De knop staat bij die plaats, helemaal in beeld en door niets bedekt.
  const button = pick.getByTestId('confirm-bet');
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(await onTop(button)).toBe(true);
  await expect(button).toHaveText(/^Zet token (vóór|na) \d{4}$/);
  // Aantikken kost niets.
  await expectTokens(pages, counts);
  await expect(host.getByTestId('my-tokens')).toHaveText('2 tokens');

  // Bob onthult voor Hanne bevestigt: haar token is niet ingezet en dat zegt haar scherm.
  await revealNow(pages, bob, turn.trackId);
  await expect(host.getByTestId('bet-missed')).toContainText('niet ingezet');
  await expect(host.getByTestId('bet-missed')).toContainText('Je hebt nog 2 tokens');
  await expect(host.getByTestId('bet-missed')).toHaveAttribute('data-reason', 'picked');
  await expect(host.getByTestId('reveal-my-bet')).toHaveCount(0);
  await expect(bob.getByTestId('bet-missed')).toHaveCount(0);
  for (const p of pages) await expect(p.getByTestId('bet-mark')).toHaveCount(0);
  await expectTokens(pages, counts);

  // Bij de volgende beurt is die melding weg.
  await bob.getByTestId('next-turn').click();
  await expect(host.getByTestId('turn-banner')).toBeVisible();
  await expect(host.getByTestId('bet-missed')).toHaveCount(0);
  for (const p of pages) await p.context().close();
});

test('token inzetten zonder verbinding: de keuze blijft staan en er is niets ingezet; opnieuw tikken lukt en je ziet meteen dat je token weg is', async ({ browser }) => {
  const { host, bob, pages, hanne, counts, turn, wrong } = await hanneBetsOnBob(browser);
  await host.getByTestId(`slot-${wrong}`).click();
  // De verbinding valt weg op het moment dat Hanne bevestigt. Meteen daarna
  // (voor de app herverbindt) staat de melding onderaan, maar niet op de knop.
  const atClick = await host.evaluate(async () => {
    window.__mt.drop();
    document.querySelector('[data-testid="confirm-bet"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const btn = document.querySelector('[data-testid="confirm-bet"]');
    const r = btn.getBoundingClientRect();
    return {
      toast: Boolean(document.querySelector('[data-testid="toast"]')),
      onTop: btn.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
    };
  });
  expect(atClick).toEqual({ toast: true, onTop: true });
  await expect(host.getByTestId('bet-error')).toContainText('Geen verbinding');
  await expect(host.getByTestId('bet-error')).toContainText('nog niet ingezet');
  await expect(host.getByTestId('bet-pick')).toContainText('Nog niet ingezet');
  const button = host.getByTestId('bet-pick').getByTestId('confirm-bet');
  await expect(button).toBeEnabled();
  expect(await onTop(button)).toBe(true);
  // Terug verbonden: de melding "Geen verbinding" verdwijnt, de keuze blijft.
  await expect(host.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await expect(host.getByTestId('toast')).toHaveCount(0);
  await expect(host.getByTestId('bet-pick')).toContainText('Nog niet ingezet');
  await expectTokens(pages, counts);
  for (const p of pages) await expect(p.getByTestId('bet-mark')).toHaveCount(0);

  // Opnieuw tikken: nu is het token ingezet, en de teller en de tekst zeggen het meteen.
  await button.click();
  counts[hanne] = START - 1;
  await expectTokens(pages, counts);
  await expect(host.getByTestId('bet-pick')).toHaveCount(0);
  await expect(host.getByTestId('bet-error')).toHaveCount(0);
  await expect(host.getByTestId('challenge-banner')).toContainText('Je zette een token in');
  await expect(host.getByTestId('my-tokens')).toHaveText('1 token');
  await expect(host.getByTestId('bet-mark')).toHaveAttribute('data-player', hanne);

  // Fout gegokt: na de onthulling staat er dat het token weg is.
  await revealNow(pages, bob, turn.trackId);
  await expect(host.getByTestId('reveal-my-bet')).toHaveAttribute('data-correct', 'no');
  await expect(host.getByTestId('reveal-my-bet')).toContainText('Jouw token lag fout');
  await expect(host.getByTestId('reveal-my-bet')).toContainText('je hebt nog 1 token');
  await expect(host.getByTestId('bet-missed')).toHaveCount(0);
  await expect(bob.getByTestId('reveal-my-bet')).toHaveCount(0);
  await expectTokens(pages, counts);
  for (const p of pages) await p.context().close();
});

test('token inzetten: komt de bevestiging niet aan, dan zegt het scherm dat en is het token na de onthulling niet weg', async ({ browser }) => {
  // Een verbinding die open lijkt maar niets doorlaat (zoals na een
  // vergrendeld scherm): Hanne's inzet raakt nooit bij de server.
  let swallow = false;
  const { host, pages, counts, turn, wrong } = await hanneBetsOnBob(browser, {
    beforeChallenge: async (page) => {
      await page.routeWebSocket(/\/ws$/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => {
          if (swallow && String(m).includes('"challenge"')) return;
          server.send(m);
        });
        server.onMessage((m) => ws.send(m));
      });
      // Pas een nieuw geladen pagina gebruikt de omleiding; de sessie blijft bewaard.
      await page.reload();
      await expect(page.getByTestId('turn-banner')).toBeVisible();
    },
  });
  await host.getByTestId(`slot-${wrong}`).click();
  swallow = true;
  await host.getByTestId('confirm-bet').click();
  await expect(host.getByTestId('confirm-bet')).toHaveText('Even geduld…');
  await expect(host.getByTestId('confirm-bet')).toBeDisabled();
  await expect(host.getByTestId('bet-pick')).toContainText('Token wordt ingezet');
  // Geen antwoord: na enkele seconden zegt het scherm dat het niet gelukt is.
  await expect(host.getByTestId('bet-error')).toContainText('nog niet ingezet', { timeout: 15_000 });
  await expect(host.getByTestId('confirm-bet')).toBeEnabled();
  await expect(host.getByTestId('bet-pick')).toContainText('Nog niet ingezet');
  await expectTokens(pages, counts);

  // De host onthult zelf terwijl zijn keuze nog openstaat: eerst een vraag.
  const asked = new Promise((resolve) => host.once('dialog', (d) => resolve(d.message())));
  await host.getByTestId('reveal-now').click();
  expect(await asked).toContain('nog niet ingezet');
  for (const p of pages) await expect(p.getByTestId('reveal')).toHaveAttribute('data-track', turn.trackId);
  await expect(host.getByTestId('bet-missed')).toHaveAttribute('data-reason', 'sent');
  await expect(host.getByTestId('bet-missed')).toContainText('Je hebt nog 2 tokens');
  await expectTokens(pages, counts);
  for (const p of pages) await p.context().close();
});
