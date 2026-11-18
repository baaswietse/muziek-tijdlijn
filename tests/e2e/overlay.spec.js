import { test, expect } from '@playwright/test';
import { openPhone, hostGame, setupMusic, joinGame, myId, YEAR, lastPlayed, activeYears, correctSlot, skipTo, placeCard, placeToken, playCount, stepTo } from './helpers.js';

// Een melding of balk bedekt nooit een knop die de speler moet kunnen
// aantikken: ook niet als de verbinding wegvalt (balk bovenaan, melding
// onderaan, foutmelding bij het token), op geen enkele schermhoogte en met het
// token op de bovenste of de onderste plaats van de tijdlijn.

/** Ligt het midden van het element bovenaan (niets erover)? */
const onTop = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit) ? true : `${hit?.className || hit?.tagName} over ${el.dataset.testid}`;
  });

/** Hanne (host) en Bob met 1 kaart; Bob legt, Hanne kan een token inzetten. */
async function challengeForHanne(browser) {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const ids = await Promise.all([host, bob].map(myId));
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  await skipTo(host, ids[1], await playCount(host));
  const right = correctSlot(await activeYears(bob), YEAR.get(await lastPlayed(host)));
  await placeCard(bob, right);
  await bob.getByTestId('confirm-place').click();
  await expect(host.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
  // De plaats aan de andere kant van Bobs kaart: helemaal boven of helemaal onder.
  return { host, bob, free: right === 0 ? 1 : 0, placed: right };
}

/**
 * Verbinding weg op het moment van bevestigen: daarna (melding onderaan,
 * balk bovenaan, foutmelding bij het token) moeten de knop en de pijltjes
 * vrij liggen.
 */
async function confirmOffline(page) {
  // Offline houden tot na de controle: anders verdwijnt de melding zodra de
  // app herverbindt, en hangt de uitkomst af van hoe snel dat gaat.
  await page.context().setOffline(true);
  await page.evaluate(async () => {
    window.__mt.drop();
    document.querySelector('[data-testid="confirm-bet"]').click();
    // Lang genoeg voor de melding, de balk en het verschuiven ervan.
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await expect(page.getByTestId('toast')).toBeVisible();
  await expect(page.getByTestId('bet-error')).toBeVisible();
  for (const id of ['confirm-bet', 'move-up', 'move-down']) {
    const loc = page.getByTestId(id);
    await expect(loc).toBeInViewport({ ratio: 1 });
    expect(await onTop(loc), `${id} bedekt`).toBe(true);
  }
  await expect(page.locator('.game-top .banner')).toBeVisible();
  // Weer verbonden, voor het volgende geval.
  await page.context().setOffline(false);
  await expect(page.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 10_000 });
}

test('verbinding weg bij het bevestigen van een token: niets bedekt de knop, op elke hoogte en plaats', async ({ browser }) => {
  test.setTimeout(240_000);
  const { host, free } = await challengeForHanne(browser);
  for (const height of [480, 560, 600, 680, 760, 844]) {
    await host.setViewportSize({ width: 390, height });
    for (const scroll of ['vanzelf', 'onderaan', 'bovenaan']) {
      // Opnieuw neerleggen: de app schuift de knop in beeld.
      await stepTo(host, 'drag-token', null);
      await placeToken(host, free);
      // De speler scrollt zelf zo ver mogelijk, zolang de knop nog helemaal vrij ligt.
      if (scroll !== 'vanzelf') {
        await host.evaluate((where) => {
          const btn = document.querySelector('[data-testid="confirm-bet"]');
          const bar = document.querySelector('[data-testid="action-bar"]').getBoundingClientRect().top;
          const head = document.querySelector('.game-top').getBoundingClientRect().bottom;
          const r = btn.closest('[data-row]').getBoundingClientRect();
          // Onderaan: de knop net boven de plek van meldingen; bovenaan: het token net onder de bovenbalk.
          const by = where === 'onderaan' ? btn.getBoundingClientRect().bottom - (bar - 120) : r.top - (head + 8);
          window.scrollBy(0, by);
        }, scroll);
      }
      await test.step(`${height}px, ${scroll}`, () => confirmOffline(host));
    }
  }
  await host.context().close();
});
