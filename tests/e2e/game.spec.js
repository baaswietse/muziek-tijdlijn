import { test, expect } from '@playwright/test';
import {
  openPhone,
  hostGame,
  setupMusic,
  joinGame,
  setTarget,
  myId,
  playTurn,
  playCount,
  lastPlayed,
  countOf,
  activeYears,
  hostAction,
  openMenu,
  closePanel,
  placeCard,
} from './helpers.js';

test('volledig spel met drie gsm\'s: binnenkomen, beurten, onthulling, winnaar, nieuw spel', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');

  // De start-knop werkt pas als de muziek klaar is.
  await expect(host.getByTestId('start-game')).toBeDisabled();
  await setupMusic(host);
  await expect(host.getByTestId('start-game')).toBeEnabled();

  // Speler 2 tikt de code in, speler 3 komt binnen via de QR-link.
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  // Via de link hoeft Cas enkel zijn naam te geven: geen codeveld meer.
  const cas = await openPhone(browser, { hash: `#/j/${code}` });
  await expect(cas.getByTestId('invite-screen')).toContainText(code);
  await expect(cas.getByTestId('code-input')).toHaveCount(0);
  await cas.getByTestId('invite-name').fill('Cas');
  await cas.getByTestId('invite-join').click();
  await expect(cas.getByTestId('big-code')).toHaveText(code);

  const pages = [host, bob, cas];
  for (const p of pages) {
    await expect(p.getByTestId('lobby-player')).toHaveCount(3);
    await expect(p.getByTestId('lobby-players')).toContainText('Hanne');
    await expect(p.getByTestId('lobby-players')).toContainText('Cas');
  }
  await expect(host.getByTestId('qr')).toBeVisible();
  await expect(bob.getByTestId('waiting')).toBeVisible();
  await expect(bob.getByTestId('start-game')).toHaveCount(0);

  // Instelling van de host komt live bij de anderen.
  await setTarget(host, 3);
  await expect(bob.getByText('Je speelt naar 3 kaarten.')).toBeVisible();

  const ids = await Promise.all(pages.map(myId));
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();

  // Iedereen start met één onthulde kaart en 2 tokens, en ziet die van de anderen.
  for (const p of pages) {
    for (const id of ids) {
      expect(await countOf(p, id)).toBe(1);
      await expect(p.locator(`[data-testid="board-row"][data-player="${id}"]`)).toHaveAttribute('data-tokens', '2');
    }
  }

  let turns = 0;
  let sawWrong = false;
  let sawCorrect = false;
  const played = [];
  while (turns < 40) {
    // Eerst bewust één keer fout (lukt niet als elke plaats juist is, bv. bij
    // twee nummers uit hetzelfde jaar: dan de volgende beurt), daarna alles juist.
    const want = sawWrong ? 'correct' : 'wrong';
    const res = await playTurn({ pages, hostPage: host, ids, want, playsSoFar: played.length });
    played.push(res.trackId);
    turns++;
    // Niemand zet in, dus de anderen houden hun tokens: elke beurt de tussenfase.
    expect(res.challenge).toBe(true);
    const expected = res.cardsBefore + (res.correct ? 1 : 0);
    for (const p of pages) expect(await countOf(p, res.activeId)).toBe(expected);
    if (res.correct) {
      sawCorrect = true;
      // De nieuwe kaart ligt op de tijdlijn en die is nog gesorteerd.
      const years = await activeYears(res.activePage);
      expect(years).toEqual([...years].sort((a, b) => a - b));
      expect(years).toContain(res.year);
    } else {
      sawWrong = true;
      await expect(res.activePage.getByTestId('wrong-card')).toBeVisible();
    }
    if (await host.getByTestId('winner').isVisible()) break;
    // Alleen de speler zelf of de host kan doorgaan.
    const bystander = pages.find((p) => p !== res.activePage && p !== host);
    await expect(bystander.getByTestId('next-turn')).toHaveCount(0);
    await res.activePage.getByTestId('next-turn').click();
    await expect(host.getByTestId('reveal')).toHaveCount(0);
  }
  expect(sawWrong).toBe(true);
  expect(sawCorrect).toBe(true);

  // Winnaar: op elke gsm dezelfde, met precies 3 kaarten.
  const winners = await host.getByTestId('winner').getAttribute('data-winners');
  expect(ids).toContain(winners);
  for (const p of pages) {
    await expect(p.getByTestId('winner')).toHaveAttribute('data-winners', winners);
    expect(await countOf(p, winners)).toBe(3);
  }
  await expect(pages[ids.indexOf(winners)].getByTestId('winner')).toContainText('Jij wint');

  // De host-gsm speelde elk nummer precies één keer, op het gekozen toestel.
  const log = await host.evaluate(() => window.__mockSpotify.log.filter((e) => e.type === 'play'));
  expect(log.map((e) => e.trackId)).toEqual(played);
  expect(new Set(played).size).toBe(played.length);
  for (const e of log) expect(e.deviceId).toBe('mock-box');
  // De gsm's van de andere spelers sturen nooit iets naar Spotify.
  for (const p of [bob, cas]) expect(await p.evaluate(() => window.__mockSpotify.log.length)).toBe(0);

  // Afgelopen: de host heeft in het menu een weg terug naar de wachtkamer, maar
  // geen «Verlaat het spel» en geen «Stop dit spel»; een gast kan nog verlaten.
  await openMenu(host);
  const hostMenu = host.getByTestId('menu');
  await expect(hostMenu.getByTestId('menu-to-lobby')).toBeVisible();
  await expect(hostMenu.getByRole('button', { name: 'Verlaat het spel' })).toHaveCount(0);
  await expect(hostMenu.getByRole('button', { name: 'Stop dit spel' })).toHaveCount(0);
  await closePanel(host);
  await openMenu(bob);
  await expect(bob.getByTestId('menu').getByRole('button', { name: 'Verlaat het spel' })).toBeVisible();
  await expect(bob.getByTestId('menu-to-lobby')).toHaveCount(0);
  await closePanel(bob);

  // Nog een spel in dezelfde kamer.
  await expect(bob.getByTestId('play-again')).toHaveCount(0);
  await host.getByTestId('play-again').click();
  for (const p of pages) {
    await expect(p.getByTestId('turn-banner')).toBeVisible();
    await expect(p.getByTestId('winner')).toHaveCount(0);
    for (const id of ids) expect(await countOf(p, id)).toBe(1);
  }
  for (const p of pages) await p.context().close();
});

test('herverbinden na een weggevallen verbinding en na herladen', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  await host.getByTestId('start-game').click();
  await expect(bob.getByTestId('turn-banner')).toBeVisible();

  // Bob zijn scherm "vergrendelt": geen netwerk en de verbinding valt weg.
  await bob.context().setOffline(true);
  await bob.evaluate(() => window.__mt.drop());
  await expect(bob.getByTestId('net-status')).not.toHaveAttribute('data-status', 'online');
  await expect(host.locator(`[data-testid="board-row"][data-player="${ids[1]}"]`)).toContainText('niet verbonden');

  // Intussen gaat het spel verder: de host slaat beurten over tot hij zelf speelt.
  for (let i = 0; i < 3; i++) {
    if ((await host.getByTestId('turn-banner').getAttribute('data-mine')) === 'yes') break;
    await hostAction(host, 'skip-turn');
    await expect(host.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  }
  await placeCard(host, 0);
  await host.getByTestId('confirm-place').click();
  // Bob heeft zijn 2 starttokens nog (ook offline): eerst de tussenfase.
  await expect(host.getByTestId('challenge-banner')).toBeVisible();
  await expect(host.getByTestId('reveal')).toHaveCount(0);
  await host.getByTestId('reveal-now').click();
  await expect(host.getByTestId('reveal')).toBeVisible();
  const track = await host.getByTestId('reveal').getAttribute('data-track');
  await expect(bob.getByTestId('reveal')).toHaveCount(0); // Bob heeft nog niets gezien

  // Scherm weer aan: Bob herverbindt vanzelf en ziet meteen de juiste stand.
  await bob.context().setOffline(false);
  await expect(bob.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await expect(bob.getByTestId('reveal')).toHaveAttribute('data-track', track);
  await expect(host.locator(`[data-testid="board-row"][data-player="${ids[1]}"]`)).not.toContainText('niet verbonden');

  // Herladen: Bob zit nog in hetzelfde spel, zonder opnieuw binnen te komen.
  await bob.reload();
  await expect(bob.getByTestId('room-code')).toHaveText(code);
  await expect(bob.getByTestId('reveal')).toHaveAttribute('data-track', track);

  // De host gaat door en herlaadt midden in een beurt: het nummer start niet opnieuw.
  const playsBefore = await playCount(host);
  await host.getByTestId('next-turn').click();
  await expect(host.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => playCount(host)).toBe(playsBefore + 1);
  const playing = await lastPlayed(host);
  await host.reload();
  await expect(host.getByTestId('turn-banner')).toBeVisible();
  await openMenu(host);
  await expect(host.getByTestId('host-music-status')).toBeVisible();
  await host.waitForTimeout(500);
  expect(await playCount(host)).toBe(0);
  // Opnieuw afspelen kan nog wel, met hetzelfde nummer.
  await host.getByTestId('replay').click();
  await expect.poll(() => lastPlayed(host)).toBe(playing);
  for (const p of pages) await p.context().close();
});

test('foutmeldingen bij binnenkomen: verkeerde code en bezette naam', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  const other = await openPhone(browser);

  const wrong = code === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  await other.getByTestId('code-input').fill(wrong);
  await other.getByTestId('name-input').fill('Bob');
  await other.getByTestId('enter-button').click();
  await expect(other.getByTestId('toast')).toContainText('bestaat niet');

  await other.getByTestId('code-input').fill(code.toLowerCase());
  await expect(other.getByTestId('code-input')).toHaveValue(code);
  await other.getByTestId('name-input').fill('hanne');
  await other.getByTestId('enter-button').click();
  await expect(other.getByTestId('toast')).toContainText('al bezet');

  await other.getByTestId('name-input').fill('');
  await other.getByTestId('enter-button').click();
  await expect(other.getByTestId('toast')).toContainText('naam');
  await expect(host.getByTestId('lobby-player')).toHaveCount(1);
  for (const p of [host, other]) await p.context().close();
});

test('host-bediening: muziekfout, ander nummer, beurt overslaan, laat instappen, speler verwijderen', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');

  // Het eerste nummer mislukt (toestel weg): de host krijgt een duidelijke melding.
  await host.evaluate(() => {
    window.__mockSpotify.failNextPlay = 'Spotify vindt het toestel niet.';
  });
  await host.getByTestId('start-game').click();
  // De melding staat op het spelscherm zelf, met de knop die het oplost.
  await expect(host.getByTestId('host-music-error')).toContainText('vindt het toestel niet');
  await expect(host.getByTestId('host-music-error')).toBeVisible();
  expect(await playCount(host)).toBe(0);
  await host.getByTestId('alert-replay').click();
  await expect(host.getByTestId('host-music-error')).toHaveCount(0);
  await expect.poll(() => playCount(host)).toBe(1);
  const first = await lastPlayed(host);

  // Ander nummer: zelfde speler, nieuw nummer.
  const active = await host.getByTestId('turn-banner').getAttribute('data-active');
  await hostAction(host, 'skip-track');
  await expect.poll(() => playCount(host)).toBe(2);
  expect(await lastPlayed(host)).not.toBe(first);
  await expect(host.getByTestId('turn-banner')).toHaveAttribute('data-active', active);

  // Beurt overslaan: de andere speler is aan de beurt.
  await hostAction(host, 'skip-turn');
  await expect(host.getByTestId('turn-banner')).not.toHaveAttribute('data-active', active);
  await expect(bob.getByTestId('skip-turn')).toHaveCount(0);
  await expect(bob.getByTestId('host-controls')).toHaveCount(0);

  // Laat instappen: Cas krijgt meteen een startkaart en 2 tokens.
  const cas = await openPhone(browser);
  await cas.getByTestId('code-input').fill(code);
  await cas.getByTestId('name-input').fill('Cas');
  await cas.getByTestId('enter-button').click();
  await expect(cas.getByTestId('turn-banner')).toBeVisible();
  const casId = await myId(cas);
  expect(await countOf(cas, casId)).toBe(1);
  await expect(host.getByTestId('board-row')).toHaveCount(3);
  for (const p of [host, cas]) await expect(p.locator(`[data-testid="board-row"][data-player="${casId}"]`)).toHaveAttribute('data-tokens', '2');

  // Speler verwijderen: Cas vliegt eruit en belandt op het startscherm.
  await openMenu(host);
  await host.getByText('Een speler uit het spel halen').click();
  await host.getByRole('button', { name: 'Haal Cas uit het spel' }).click();
  await expect(host.getByTestId('board-row')).toHaveCount(2);
  await expect(cas.getByTestId('enter-button')).toBeVisible();
  await expect(cas.getByTestId('toast')).toContainText('uit het spel gehaald');
  for (const p of [host, bob, cas]) await p.context().close();
});

test('host stopt het spel in plaats van het te verlaten; verlaten kan in de wachtkamer', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);
  await host.getByTestId('start-game').click();
  for (const p of [host, bob]) await expect(p.getByTestId('turn-banner')).toBeVisible();

  // Tijdens het spel: de host alleen «Stop dit spel», een gast alleen «Verlaat het spel».
  await openMenu(host);
  const hostMenu = host.getByTestId('menu');
  await expect(hostMenu.getByRole('button', { name: 'Stop dit spel' })).toBeVisible();
  await expect(hostMenu.getByRole('button', { name: 'Verlaat het spel' })).toHaveCount(0);
  await openMenu(bob);
  const bobMenu = bob.getByTestId('menu');
  await expect(bobMenu.getByRole('button', { name: 'Verlaat het spel' })).toBeVisible();
  await expect(bobMenu.getByRole('button', { name: 'Stop dit spel' })).toHaveCount(0);
  await closePanel(bob);

  // Stoppen brengt iedereen terug naar de wachtkamer; de host blijft host.
  await hostMenu.getByRole('button', { name: 'Stop dit spel' }).click();
  for (const p of [host, bob]) await expect(p.getByTestId('big-code')).toHaveText(code);
  await expect(host.getByTestId('start-game')).toBeVisible();

  // In de wachtkamer kan de host nog vertrekken, maar de vraag zegt wat dat
  // betekent voor wie achterblijft. Eerst «Annuleer»: er verandert niets.
  const asked = [];
  host.removeAllListeners('dialog');
  host.on('dialog', (d) => {
    asked.push(d.message());
    d.dismiss();
  });
  await host.getByRole('button', { name: 'Verlaat het spel' }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain('Je bent de host');
  expect(asked[0]).toContain('zonder host');
  expect(asked[0]).toContain('nieuw spel');
  await expect(host.getByTestId('big-code')).toHaveText(code);

  // Een gast krijgt de gewone vraag.
  const bobAsked = [];
  bob.removeAllListeners('dialog');
  bob.on('dialog', (d) => {
    bobAsked.push(d.message());
    d.dismiss();
  });
  await bob.getByRole('button', { name: 'Verlaat het spel' }).click();
  await expect.poll(() => bobAsked.length).toBe(1);
  expect(bobAsked[0]).toBe('Dit spel verlaten?');
  await expect(bob.getByTestId('big-code')).toHaveText(code);

  // Nu echt: de host staat terug op het startscherm.
  host.removeAllListeners('dialog');
  host.on('dialog', (d) => d.accept());
  await host.getByRole('button', { name: 'Verlaat het spel' }).click();
  await expect(host.getByRole('tab', { name: 'Nieuw spel' })).toBeVisible();
  await expect(bob.getByTestId('big-code')).toHaveText(code);
  for (const p of [host, bob]) await p.context().close();
});

test('host alleen in de wachtkamer: bij verlaten de gewone vraag', async ({ browser }) => {
  const host = await openPhone(browser);
  await hostGame(host, 'Hanne');
  const asked = [];
  host.removeAllListeners('dialog');
  host.on('dialog', (d) => {
    asked.push(d.message());
    d.accept();
  });
  await host.getByRole('button', { name: 'Verlaat het spel' }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe('Dit spel verlaten?');
  await expect(host.getByRole('tab', { name: 'Nieuw spel' })).toBeVisible();
  await host.context().close();
});
