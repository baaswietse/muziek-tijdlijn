import { test, expect } from '@playwright/test';
import { openPhone, hostGame, setupMusic, joinGame, myId, YEAR, lastPlayed, activeYears, correctSlot, skipTo, placeCard, placeToken, playCount, stepTo, expectFullyVisible } from './helpers.js';

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
  // Eerst het eerste nummer: anders telt het overslaan verkeerd.
  await expect.poll(() => playCount(host)).toBe(1);
  await skipTo(host, ids[1], 1);
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
    await expectFullyVisible(loc);
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

/** Hanne (host) en Bob met 1 kaart; Bob is aan de beurt. */
async function bobsTurn(browser) {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const ids = await Promise.all([host, bob].map(myId));
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  // Eerst het eerste nummer: anders telt het overslaan verkeerd.
  await expect.poll(() => playCount(host)).toBe(1);
  await skipTo(host, ids[1], 1);
  await expect(bob.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  return { host, bob };
}

/** Elk van deze knoppen ligt helemaal in beeld en door niets bedekt. */
async function expectFree(page, ids) {
  for (const id of ids) {
    for (const loc of await page.getByTestId(id).all()) {
      await expectFullyVisible(loc);
      expect(await onTop(loc), `${id} bedekt`).toBe(true);
    }
  }
}

/** Weer verbonden en de melding weg, voor het volgende geval. */
async function backOnline(page) {
  await page.context().setOffline(false);
  await expect(page.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 10_000 });
}

test('eigen kaart bovenaan of onderaan: de pijltjes blijven vrij als de verbinding wegvalt en er een melding komt', async ({ browser }) => {
  test.setTimeout(180_000);
  const { host, bob } = await bobsTurn(browser);
  for (const height of [480, 600, 844]) {
    await bob.setViewportSize({ width: 390, height });
    for (const [slot, edge] of [
      [0, 'bovenaan'],
      [1, 'onderaan'],
    ]) {
      await placeCard(bob, slot);
      // Het stuk tegen de rand van het vrije stuk zetten, zoals na zelf scrollen.
      await bob.evaluate((where) => {
        const piece = document.querySelector('[data-testid="drag-card"]');
        const bar = document.querySelector('[data-testid="action-bar"]').getBoundingClientRect().top;
        const head = document.querySelector('.game-top').getBoundingClientRect().bottom;
        const r = piece.getBoundingClientRect();
        window.scrollBy(0, where === 'onderaan' ? r.bottom - (bar - 8) : r.top - (head + 8));
      }, edge);
      await bob.waitForTimeout(950); // de knop in de balk reageert pas na even
      await test.step(`${height}px, ${edge}`, async () => {
        await bob.context().setOffline(true);
        await bob.evaluate(async () => {
          window.__mt.drop();
          // Leggen lukt niet zonder verbinding: er komt een melding.
          document.querySelector('[data-testid="confirm-place"]').click();
          await new Promise((resolve) => setTimeout(resolve, 400));
        });
        await expect(bob.getByTestId('toast')).toBeVisible();
        await expect(bob.locator('.game-top .banner')).toBeVisible();
        await expectFree(bob, ['move-up', 'move-down', 'confirm-place']);
        await backOnline(bob);
      });
    }
  }
  for (const p of [host, bob]) await p.context().close();
});

test('een melding tijdens de onthulling of met het menu open bedekt geen knoppen', async ({ browser }) => {
  test.setTimeout(180_000);
  const { host, bob } = await bobsTurn(browser);
  await placeCard(bob, 0);
  await bob.getByTestId('confirm-place').click();
  await host.getByTestId('pass-bet').click();
  await bob.getByTestId('reveal-now').click();
  await expect(host.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'yes');
  for (const height of [600, 844]) {
    await host.setViewportSize({ width: 390, height });
    await test.step(`onthulling, ${height}px`, async () => {
      await host.context().setOffline(true);
      await host.evaluate(async () => {
        window.__mt.drop();
        // Het raad-token geven lukt niet zonder verbinding: er komt een melding.
        document.querySelector('[data-testid="token-button"]').click();
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      await expect(host.getByTestId('toast')).toBeVisible();
      await expectFree(host, ['token-button', 'next-turn', 'outcome-toggle']);
      await backOnline(host);
    });
    await test.step(`menu, ${height}px`, async () => {
      await host.getByTestId('menu-open').click();
      await host.context().setOffline(true);
      await host.evaluate(() => window.__mt.drop());
      await expect(host.getByTestId('net-status')).not.toHaveAttribute('data-status', 'online');
      // Verwijderen lukt niet zonder verbinding: er komt een melding.
      await host.getByText('Een speler uit het spel halen').click();
      await host.getByRole('button', { name: 'Haal Bob uit het spel' }).click();
      await expect(host.getByTestId('toast')).toBeVisible();
      const menu = host.getByTestId('menu');
      for (const name of ['Verlaat het spel', 'Opnieuw afspelen', 'Haal Bob uit het spel']) {
        const loc = menu.getByRole('button', { name });
        // In het midden van het paneel (niet tegen de rand, zoals scrollIntoViewIfNeeded).
        await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expectFullyVisible(loc);
        expect(await onTop(loc), `${name} bedekt`).toBe(true);
      }
      await host.getByTestId('menu-close').click();
      await host.getByText('Een speler uit het spel halen').evaluate((el) => (el.parentElement.open = false));
      await backOnline(host);
    });
  }
  for (const p of [host, bob]) await p.context().close();
});
