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
  wrongSlot,
  hostAction,
  placeCard,
  placeToken,
  passWaiting,
} from './helpers.js';

// De hoofdknop van de beurt ("Leg het …", "Onthul", "Volgende beurt", en voor
// wie moet kiezen "Ik zet geen token in") staat altijd op dezelfde plek: in een
// zwevende balk onderaan, in beeld zonder scrollen, en niets bedekt hem.

/** Ligt het midden van de knop bovenaan (geen balk, melding of kaart erover)? */
const onTop = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });

/** Plaats en grootte van de knop op het scherm. */
const boxOf = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });

const toBottom = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

/** De speler staat onderaan de pagina en ziet de knop toch helemaal, onbedekt. */
async function expectReachable(page, testid) {
  await toBottom(page);
  const button = page.getByTestId(testid);
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(await onTop(button), `${testid} is bedekt`).toBe(true);
  // Ook bovenaan de pagina staat hij er.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(await onTop(button), `${testid} is bedekt`).toBe(true);
}

/** Gsm's met de gegeven namen; de eerste is host. Bob (de tweede) aan de beurt. */
async function phonesWithBob(browser, names, viewport) {
  const pages = [];
  for (const name of names) {
    const page = await openPhone(browser);
    if (viewport) await page.setViewportSize(viewport);
    pages.push(page);
  }
  const host = pages[0];
  const code = await hostGame(host, names[0]);
  await setupMusic(host);
  for (let i = 1; i < pages.length; i++) await joinGame(pages[i], code, names[i]);
  for (const p of pages) await expect(p.getByTestId('lobby-player')).toHaveCount(names.length);
  const ids = await Promise.all(pages.map(myId));
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  // De host slaat beurten over tot Bob aan de beurt is.
  let n = 1;
  for (let i = 0; i <= pages.length; i++) {
    await expect.poll(() => playCount(host)).toBe(n);
    if ((await host.getByTestId('turn-banner').getAttribute('data-active')) === ids[1]) break;
    await hostAction(host, 'skip-turn');
    n++;
  }
  const bob = pages[1];
  await expect(bob.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  const year = YEAR.get(await lastPlayed(host));
  const slot = correctSlot(await activeYears(bob), year);
  return { pages, host, bob, ids, slot };
}

test('hoofdknop: Leg, Onthul en Volgende beurt op exact dezelfde plek, en een dubbele tik doet geen twee stappen', async ({ browser }) => {
  const { pages, host, bob, slot } = await phonesWithBob(browser, ['Hanne', 'Bob']);
  // Voor er een plaats gekozen is, staat de knop er al (uitgeschakeld).
  const place = bob.getByTestId('confirm-place');
  await expect(place).toBeDisabled();
  await expect(place).toHaveText('Kies eerst een plaats');
  const before = await boxOf(place);
  await placeCard(bob, slot);
  await expect(place).toBeEnabled();
  const atPlace = await boxOf(place);
  expect(atPlace).toEqual(before);
  await place.click();

  // Tussenfase: Hanne (host) moet kiezen, dus haar balk toont haar keuze. Bob
  // ziet Onthul op dezelfde plek, uitgeschakeld, met op wie hij wacht.
  const reveal = bob.getByTestId('reveal-now');
  await expect(reveal).toBeDisabled();
  await expect(bob.getByTestId('bar-note')).toHaveText('Nog wachten op Hanne.');
  expect(await boxOf(reveal)).toEqual(atPlace);
  await expect(host.getByTestId('pass-bet')).toBeEnabled();
  await expect(host.getByTestId('reveal-now')).toHaveCount(0);
  await host.getByTestId('pass-bet').click();
  // De host heeft nu Onthul op de plek waar zijn keuze stond.
  await expect(host.getByTestId('reveal-now')).toBeEnabled();
  await expect(reveal).toBeEnabled();
  await expect(bob.getByTestId('bar-note')).toHaveCount(0);
  expect(await boxOf(reveal)).toEqual(atPlace);

  // Een dubbele (en zelfs een herhaalde) tik op Onthul: alleen de onthulling.
  const plays = await playCount(host);
  const r = await boxOf(reveal);
  const x = r.x + r.w / 2;
  const y = r.y + r.h / 2;
  await bob.mouse.dblclick(x, y);
  for (let i = 0; i < 4; i++) {
    await bob.waitForTimeout(120);
    await bob.mouse.click(x, y);
  }
  for (const p of pages) await expect(p.getByTestId('reveal')).toBeVisible();
  await bob.waitForTimeout(1200);
  for (const p of pages) {
    await expect(p.getByTestId('reveal')).toBeVisible();
    await expect(p.getByTestId('turn-banner')).toHaveCount(0);
  }
  expect(await playCount(host), 'geen volgende nummer gestart').toBe(plays);
  // Volgende beurt staat weer op dezelfde plek, en werkt na de korte pauze.
  const next = bob.getByTestId('next-turn');
  await expect(next).toBeEnabled();
  expect(await boxOf(next)).toEqual(atPlace);
  // Het raad-token kan dus nog gegeven worden voor iemand doorgaat.
  await bob.getByTestId('token-button').first().click();
  await expect(bob.getByTestId('reveal-token')).toBeVisible();
  await next.click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  for (const p of pages) await p.context().close();
});

test('hoofdknop: een nieuwe knop reageert even niet, ook niet bij leggen gevolgd door onthullen', async ({ browser }) => {
  // Bob legt met een dubbele tik op "Leg het": de tweede tik mag niets doen,
  // ook niet op de knop die daarna op dezelfde plek verschijnt.
  const { pages, host, bob, slot } = await phonesWithBob(browser, ['Hanne', 'Bob']);
  await placeCard(bob, slot);
  const place = bob.getByTestId('confirm-place');
  await expect(place).toBeEnabled();
  await place.dblclick();
  await expect(bob.getByTestId('challenge-banner')).toBeVisible();
  // Onthul staat er en is uit (Hanne moet nog kiezen); er gebeurde niets meer.
  await expect(bob.getByTestId('reveal-now')).toBeDisabled();
  await host.getByTestId('pass-bet').click();
  // Net na het verschijnen staat de knop even uit, zichtbaar.
  await expect(host.getByTestId('reveal-now')).toHaveAttribute('data-cooling', 'yes');
  await expect(host.getByTestId('reveal-now')).toBeDisabled();
  await expect(host.getByTestId('reveal-now')).toHaveAttribute('data-cooling', 'no');
  await expect(host.getByTestId('reveal-now')).toBeEnabled();
  for (const p of pages) await expect(p.getByTestId('reveal')).toHaveCount(0);
  for (const p of pages) await p.context().close();
});

test('hoofdknop: een melding verschijnt boven de balk en bedekt de knop niet', async ({ browser }) => {
  const { pages, bob, slot } = await phonesWithBob(browser, ['Hanne', 'Bob'], { width: 390, height: 600 });
  await placeCard(bob, slot);
  await expect(bob.getByTestId('confirm-place')).toBeEnabled();
  // De verbinding valt weg en Bob tikt op "Leg het": er komt een melding.
  const seen = await bob.evaluate(async () => {
    window.__mt.drop();
    document.querySelector('[data-testid="confirm-place"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const btn = document.querySelector('[data-testid="confirm-place"]');
    const toast = document.querySelector('[data-testid="toast"]');
    const r = btn.getBoundingClientRect();
    const bar = document.querySelector('[data-testid="action-bar"]').getBoundingClientRect();
    return {
      toast: Boolean(toast),
      onTop: btn.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
      aboveBar: toast ? toast.getBoundingClientRect().bottom <= bar.top : null,
    };
  });
  expect(seen).toEqual({ toast: true, onTop: true, aboveBar: true });
  // Weer verbonden: opnieuw tikken lukt. Wacht op wat Bob ziet: de melding
  // "Geen verbinding" verdwijnt pas als de nieuwe verbinding er is. Alleen op
  // het bolletje wachten volstaat niet: dat blijft groen tot de oude verbinding
  // echt dicht is, wat tegen de echte server enkele honderden ms duurt.
  await expect(bob.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 });
  await expect(bob.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await bob.getByTestId('confirm-place').click();
  for (const p of pages) await expect(p.getByTestId('challenge-banner')).toBeVisible();
  for (const p of pages) await p.context().close();
});

/**
 * Bob speelt `turns` beurten juist (Hanne past telkens, de host slaat haar
 * eigen beurten over): daarna heeft hij `turns` kaarten meer. Geeft het aantal
 * gestarte nummers terug.
 */
async function bobCollects({ host, bob, ids, pages }, turns, plays) {
  for (let k = 0; k < turns; k++) {
    for (let i = 0; i < 3; i++) {
      await expect.poll(() => playCount(host)).toBe(plays);
      if ((await host.getByTestId('turn-banner').getAttribute('data-active')) === ids[1]) break;
      await hostAction(host, 'skip-turn');
      plays++;
    }
    const year = YEAR.get(await lastPlayed(host));
    await placeCard(bob, correctSlot(await activeYears(bob), year));
    await bob.getByTestId('confirm-place').click();
    await passWaiting(pages, bob);
    await bob.getByTestId('reveal-now').click();
    await expect(bob.getByTestId('reveal')).toHaveAttribute('data-correct', 'yes');
    await bob.getByTestId('next-turn').click();
    plays++;
  }
  return plays;
}

test('klein scherm (390×600) met 9 kaarten: elke verplichte knop staat in beeld, voor elke rol en fase', async ({ browser }) => {
  test.setTimeout(240_000);
  const size = { width: 390, height: 600 };
  const { pages, host, bob, ids } = await phonesWithBob(browser, ['Hanne', 'Bob'], size);
  // Bob verzamelt 9 kaarten (het doel is 10), daarna stapt Cas nog in.
  let plays = await bobCollects({ host, bob, ids, pages }, 8, await playCount(host));
  const cas = await openPhone(browser);
  await cas.setViewportSize(size);
  await cas.getByTestId('code-input').fill(await host.getByTestId('room-code').textContent());
  await cas.getByTestId('name-input').fill('Cas');
  await cas.getByTestId('enter-button').click();
  await expect(cas.getByTestId('turn-banner')).toBeVisible();
  pages.push(cas);
  ids.push(await myId(cas));
  for (let i = 0; i < 4; i++) {
    await expect.poll(() => playCount(host)).toBe(plays);
    if ((await host.getByTestId('turn-banner').getAttribute('data-active')) === ids[1]) break;
    await hostAction(host, 'skip-turn');
    plays++;
  }
  await expect(bob.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  expect(await activeYears(bob)).toHaveLength(9);
  // De pagina van Bob is langer dan het scherm.
  expect(await bob.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(100);

  // Aan de beurt: de knop om te leggen (eerst nog uit), ook onderaan de pagina.
  await expectReachable(bob, 'confirm-place');
  // Bewust fout: met een 10e kaart zou Bob winnen en is er geen volgende beurt.
  const year = YEAR.get(await lastPlayed(host));
  const slot = wrongSlot(await activeYears(bob), year);
  expect(slot).not.toBeNull();
  await placeCard(bob, slot);
  await expectReachable(bob, 'confirm-place');
  await bob.getByTestId('confirm-place').click();

  // Tussenfase: wie moet kiezen (ook de host), ziet "Ik zet geen token in";
  // de speler aan beurt ziet Onthul.
  for (const p of [host, cas]) await expect(p.getByTestId('challenge-banner')).toHaveAttribute('data-must-choose', 'yes');
  await expectReachable(host, 'pass-bet');
  await expectReachable(cas, 'pass-bet');
  await expectReachable(bob, 'reveal-now');
  // Cas kiest een plaats voor zijn token: de bevestigknop staat in beeld.
  const other = slot === 0 ? 9 : 0;
  await placeToken(cas, other);
  const confirmBet = cas.getByTestId('confirm-bet');
  await expect(confirmBet).toBeInViewport({ ratio: 1 });
  expect(await onTop(confirmBet), 'confirm-bet is bedekt').toBe(true);
  await expectReachable(cas, 'pass-bet');
  await cas.getByTestId('pass-bet').click();
  await toBottom(host);
  await host.getByTestId('pass-bet').click();
  // De host kan nu ook onthullen; Cas heeft niets meer te doen.
  await expectReachable(host, 'reveal-now');
  await expect(cas.getByTestId('action-bar')).toHaveCount(0);

  // Iedereen staat onderaan; na de onthulling staat de uitkomst toch in beeld.
  for (const p of pages) await toBottom(p);
  await bob.getByTestId('reveal-now').click();
  for (const p of pages) {
    await expect(p.getByTestId('reveal')).toBeVisible();
    // Juist of fout, jaar, titel en artiest: in beeld en niet onder de kopbalk of de balk.
    for (const part of ['.reveal-verdict', '.reveal-year', '.reveal-title', '.reveal-artist']) {
      const loc = p.getByTestId('reveal').locator(part);
      await expect(loc).toBeInViewport({ ratio: 1 });
      await expect.poll(() => onTop(loc), { message: `${part} is bedekt` }).toBe(true);
    }
  }
  // Het raad-token: de knoppen voor de speler aan beurt, opeisen voor Cas.
  for (const b of await bob.getByTestId('token-button').all()) {
    await b.scrollIntoViewIfNeeded();
    await expect(b).toBeInViewport({ ratio: 1 });
    expect(await onTop(b)).toBe(true);
  }
  await cas.getByTestId('token-claim-button').scrollIntoViewIfNeeded();
  await expect(cas.getByTestId('token-claim-button')).toBeInViewport({ ratio: 1 });
  // Doorgaan: de speler aan beurt en de host.
  await expectReachable(bob, 'next-turn');
  await expectReachable(host, 'next-turn');
  await expect(cas.getByTestId('next-turn')).toHaveCount(0);
  await bob.getByTestId('next-turn').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  for (const p of pages) await p.context().close();
});
