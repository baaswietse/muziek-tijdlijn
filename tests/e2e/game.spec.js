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
  const cas = await openPhone(browser, { hash: `#/j/${code}` });
  await expect(cas.getByTestId('code-input')).toHaveValue(code);
  await cas.getByTestId('name-input').fill('Cas');
  await cas.getByTestId('enter-button').click();

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

  // Iedereen start met één onthulde kaart en ziet die van de anderen.
  for (const p of pages) {
    for (const id of ids) expect(await countOf(p, id)).toBe(1);
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
  await expect(host.locator(`[data-testid="board-row"][data-player="${ids[1]}"]`)).toContainText('offline');

  // Intussen gaat het spel verder: de host slaat beurten over tot hij zelf speelt.
  for (let i = 0; i < 3; i++) {
    if ((await host.getByTestId('turn-banner').getAttribute('data-mine')) === 'yes') break;
    await host.getByTestId('skip-turn').click();
    await expect(host.getByTestId('turn-banner')).toHaveAttribute('data-mine', 'yes');
  }
  await host.getByTestId('slot-0').click();
  await host.getByTestId('confirm-place').click();
  await expect(host.getByTestId('reveal')).toBeVisible();
  const track = await host.getByTestId('reveal').getAttribute('data-track');
  await expect(bob.getByTestId('reveal')).toHaveCount(0); // Bob heeft nog niets gezien

  // Scherm weer aan: Bob herverbindt vanzelf en ziet meteen de juiste stand.
  await bob.context().setOffline(false);
  await expect(bob.getByTestId('net-status')).toHaveAttribute('data-status', 'online', { timeout: 15_000 });
  await expect(bob.getByTestId('reveal')).toHaveAttribute('data-track', track);
  await expect(host.locator(`[data-testid="board-row"][data-player="${ids[1]}"]`)).not.toContainText('offline');

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
  await expect(host.getByTestId('host-music-error')).toContainText('vindt het toestel niet');
  expect(await playCount(host)).toBe(0);
  await host.getByTestId('replay').click();
  await expect(host.getByTestId('host-music-error')).toHaveCount(0);
  await expect.poll(() => playCount(host)).toBe(1);
  const first = await lastPlayed(host);

  // Ander nummer: zelfde speler, nieuw nummer.
  const active = await host.getByTestId('turn-banner').getAttribute('data-active');
  await host.getByTestId('skip-track').click();
  await expect.poll(() => playCount(host)).toBe(2);
  expect(await lastPlayed(host)).not.toBe(first);
  await expect(host.getByTestId('turn-banner')).toHaveAttribute('data-active', active);

  // Beurt overslaan: de andere speler is aan de beurt.
  await host.getByTestId('skip-turn').click();
  await expect(host.getByTestId('turn-banner')).not.toHaveAttribute('data-active', active);
  await expect(bob.getByTestId('skip-turn')).toHaveCount(0);

  // Laat instappen: Cas krijgt meteen een startkaart.
  const cas = await openPhone(browser);
  await cas.getByTestId('code-input').fill(code);
  await cas.getByTestId('name-input').fill('Cas');
  await cas.getByTestId('enter-button').click();
  await expect(cas.getByTestId('turn-banner')).toBeVisible();
  const casId = await myId(cas);
  expect(await countOf(cas, casId)).toBe(1);
  await expect(host.getByTestId('board-row')).toHaveCount(3);

  // Speler verwijderen: Cas vliegt eruit en belandt op het startscherm.
  await host.locator(`[data-testid="board-row"][data-player="${casId}"] .board-head`).click();
  await host.getByRole('button', { name: 'Haal Cas uit het spel' }).click();
  await expect(host.getByTestId('board-row')).toHaveCount(2);
  await expect(cas.getByTestId('enter-button')).toBeVisible();
  await expect(cas.getByTestId('toast')).toContainText('uit het spel gehaald');
  for (const p of [host, bob, cas]) await p.context().close();
});
