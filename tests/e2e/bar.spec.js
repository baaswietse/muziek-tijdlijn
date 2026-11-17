import { test, expect } from '@playwright/test';
import { openPhone, hostGame, setupMusic, joinGame, myId, playCount, lastPlayed, YEAR, activeYears, correctSlot } from './helpers.js';

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
    await host.getByTestId('skip-turn').click();
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
  await bob.getByTestId(`slot-${slot}`).click();
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
  await bob.getByTestId(`slot-${slot}`).click();
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
  await bob.getByTestId(`slot-${slot}`).click();
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
  // Weer verbonden: opnieuw tikken lukt.
  await expect(bob.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await bob.getByTestId('confirm-place').click();
  for (const p of pages) await expect(p.getByTestId('challenge-banner')).toBeVisible();
  for (const p of pages) await p.context().close();
});

test('lange pagina (390×500): elke verplichte knop staat in beeld zonder scrollen, voor elke rol en fase', async ({ browser }) => {
  const { pages, host, bob, slot } = await phonesWithBob(browser, ['Hanne', 'Bob', 'Cas'], { width: 390, height: 500 });
  const cas = pages[2];
  // De pagina is veel langer dan het scherm.
  for (const p of pages) {
    expect(await p.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(400);
  }
  // Aan de beurt: de knop om te leggen (eerst nog uit), ook onderaan de pagina.
  await expectReachable(bob, 'confirm-place');
  await bob.getByTestId(`slot-${slot}`).click();
  await expectReachable(bob, 'confirm-place');
  await bob.getByTestId('confirm-place').click();

  // Tussenfase: wie moet kiezen (ook de host), ziet "Ik zet geen token in";
  // de speler aan beurt ziet Onthul.
  for (const p of [host, cas]) await expect(p.getByTestId('challenge-banner')).toHaveAttribute('data-must-choose', 'yes');
  await expectReachable(host, 'pass-bet');
  await expectReachable(cas, 'pass-bet');
  await expectReachable(bob, 'reveal-now');
  await toBottom(cas);
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
  // Doorgaan: de speler aan beurt en de host.
  await expectReachable(bob, 'next-turn');
  await expectReachable(host, 'next-turn');
  await expect(cas.getByTestId('next-turn')).toHaveCount(0);
  await bob.getByTestId('next-turn').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();
  for (const p of pages) await p.context().close();
});
