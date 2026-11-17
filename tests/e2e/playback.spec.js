// Het juiste nummer door de boxen, ook als Spotify of het toestel zich slecht
// gedraagt. De nagebootste Spotify (fake-spotify.js) houdt bij wat het toestel
// echt speelt (`heard()`); de test vergelijkt dat met het nummer dat de server
// voor deze beurt koos. Elk geval hieronder liet vroeger het vorige nummer
// (of een ander) spelen terwijl het spel een nieuw nummer verwachtte.

import { test, expect } from '@playwright/test';
import { TRACKS } from './helpers.js';
import { fakeSpotify, hostAndLogin } from './fake-spotify.js';

test.describe.configure({ timeout: 90_000 });

const TITLE = new Map(TRACKS.map((t) => [t.id, t.title]));

/** Volgt het track-ID van de lopende beurt zoals de server het naar de host stuurt. */
function watchTurn(page) {
  const turn = { trackId: null, number: null };
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(String(f.payload));
        if (msg.t === 'state') {
          turn.trackId = msg.state.turn?.trackId ?? null;
          turn.number = msg.state.turn?.number ?? null;
        }
      } catch {
        // geen JSON
      }
    }),
  );
  return turn;
}

/** Een host met (nagebootst) Spotify, een gekozen toestel en een lopend spel. */
async function startGame(browser, { device = 'dev-1' } = {}) {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const turn = watchTurn(page);
  await hostAndLogin(page);
  if (device === 'browser') await page.getByTestId('device-browser').click();
  else await page.getByTestId(`device-${device}`).click();
  await expect(page.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => turn.trackId).toBeTruthy();
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  await expect(page.getByTestId('host-music-status')).toHaveAttribute('data-status', 'playing');
  return { context, spotify, page, turn };
}

/** Host tikt «Ander nummer» en wacht tot de server een nieuw nummer koos. */
async function nextTrack(page, turn) {
  const before = turn.trackId;
  await page.getByTestId('skip-track').click();
  await expect.poll(() => turn.trackId).not.toBe(before);
  return before;
}

/**
 * Op het scherm van de host staat de titel van deze nummers nergens: niet in
 * de pagina, de tab, de adresbalk of de mediabediening. (De startkaarten zijn
 * wel onthuld; die tellen niet.)
 */
async function noTitleVisible(page, ids) {
  const text = await page.locator('body').innerText();
  const title = await page.title();
  for (const id of ids) {
    expect(text).not.toContain(TITLE.get(id));
    expect(text).not.toContain(id);
    expect(title).not.toContain(TITLE.get(id));
    expect(page.url()).not.toContain(id);
  }
  expect(text).not.toContain('Titel die nooit');
  expect(await page.evaluate(() => navigator.mediaSession?.metadata ?? null)).toBeNull();
}

test('startcommando mislukt (502, 429): het spel probeert vanzelf opnieuw', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  for (const failure of [
    { status: 502, body: { error: { status: 502, message: 'Bad gateway' } } },
    { status: 429, headers: { 'retry-after': '1' }, body: { error: { status: 429, message: 'API rate limit exceeded' } } },
  ]) {
    spotify.bad.playFailures.push(failure);
    const old = await nextTrack(page, turn);
    // Vroeger bleef het vorige nummer (met herhalen) gewoon doorspelen.
    await expect.poll(() => spotify.heard(), { timeout: 15_000 }).toBe(turn.trackId);
    expect(spotify.heard()).not.toBe(old);
    await expect(page.getByTestId('host-music-status')).toHaveAttribute('data-status', 'playing');
    await expect(page.getByTestId('host-music-error')).toHaveCount(0);
  }
  await context.close();
});

test('«gelukt» maar het toestel schakelt niet over: het spel merkt het en start opnieuw', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  spotify.bad.ignorePlays = 1;
  const old = await nextTrack(page, turn);
  expect(spotify.heard()).toBe(old); // eerst hoort iedereen nog het vorige nummer
  await expect.poll(() => spotify.heard(), { timeout: 15_000 }).toBe(turn.trackId);
  // Het herhalen staat pas aan nadat het nieuwe nummer echt speelt.
  expect(spotify.repeat).toBe('track');
  await context.close();
});

test('commando’s in omgekeerde volgorde: een oud startcommando dat laat aankomt, wordt rechtgezet', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  // Het volgende startcommando antwoordt meteen, maar Spotify voert het pas na
  // 3 s uit; het commando daarna meteen. Zonder controle wint het oude.
  spotify.bad.applyDelays.push(3000);
  await nextTrack(page, turn);
  await expect.poll(() => spotify.plays().length).toBeGreaterThanOrEqual(2);
  await nextTrack(page, turn);
  const expected = turn.trackId;
  await page.waitForTimeout(3500);
  // Nu speelt het oude, laat aangekomen nummer…
  // …tot de nacontrole het merkt en het juiste opnieuw start.
  await expect.poll(() => spotify.heard(), { timeout: 20_000 }).toBe(expected);
  await expect(page.getByTestId('host-music-status')).toHaveAttribute('data-status', 'playing');
  await context.close();
});

test('het toestel blijft het vorige nummer spelen: stilzetten en een duidelijke waarschuwing zonder titel', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  const old = turn.trackId;
  spotify.bad.report = old; // het toestel hangt vast op het vorige nummer
  await nextTrack(page, turn);
  const wrong = page.getByTestId('music-wrong');
  await expect(wrong).toBeVisible({ timeout: 20_000 });
  await expect(wrong).toContainText('niet het nummer van deze beurt');
  // Liever stilte dan het vorige nummer dat telkens opnieuw begint.
  expect(spotify.heard()).toBeNull();
  // Begrensd: niet eindeloos opnieuw proberen.
  const plays = spotify.plays().length;
  await page.waitForTimeout(1500);
  expect(spotify.plays().length).toBe(plays);
  await noTitleVisible(page, [old, turn.trackId]);
  // Het toestel doet het weer: één tik start het juiste nummer.
  spotify.bad.report = null;
  await page.getByTestId('music-fix').click();
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  await expect(wrong).toHaveCount(0);
  await context.close();
});

test('track relinking: een andere versie van hetzelfde nummer is geen vals alarm', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  // Spotify speelt voor elk gevraagd nummer een andere versie: de helft met
  // linked_from (zoals de documentatie zegt), de helft zonder.
  TRACKS.forEach((t, i) => {
    spotify.bad.relink[t.id] = { id: `RL${t.id.slice(2)}`, linked: i % 2 === 0 };
  });
  for (let i = 0; i < 4; i++) {
    const before = spotify.plays().length;
    await nextTrack(page, turn);
    await expect.poll(() => spotify.plays().length).toBe(before + 1);
    await expect(page.getByTestId('host-music-status')).toHaveAttribute('data-status', 'playing');
  }
  // Ook de nacontrole laat het zo.
  await page.waitForTimeout(9000);
  await expect(page.getByTestId('music-wrong')).toHaveCount(0);
  expect(spotify.plays().length).toBe(5);
  await context.close();
});

test('herladen tijdens een beurt: speelt er intussen iets anders, dan herstelt het spel dat', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  const old = await nextTrack(page, turn);
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  // Pas als het spel de start bevestigde, telt het nummer als gestart.
  await expect(page.getByTestId('host-music-status')).toHaveAttribute('data-status', 'playing');
  const plays = spotify.plays().length;
  // Gewoon herladen: het nummer speelt al, dus het begint niet opnieuw.
  await page.reload();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(spotify.plays().length).toBe(plays);
  // Het toestel viel terug op het vorige nummer terwijl de host herlaadde.
  spotify.player.trackId = old;
  await page.reload();
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  await context.close();
});

test('aantal verzoeken per beurt blijft klein', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser);
  await page.waitForTimeout(9000); // nacontrole van de eerste beurt voorbij
  const from = spotify.calls.length;
  await nextTrack(page, turn);
  await expect.poll(() => spotify.heard()).toBe(turn.trackId);
  await page.waitForTimeout(9500);
  const calls = spotify.calls.slice(from).map((c) => `${c.method} ${c.path}`);
  // Starten, één controle, herhalen aan en één nacontrole.
  expect(calls.sort()).toEqual(['GET /me/player', 'GET /me/player', 'PUT /me/player/play', 'PUT /me/player/repeat']);
  await context.close();
});

test('dit toestel: de speler verbindt opnieuw met een ander id, het spel speelt verder op dat id', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser, { device: 'browser' });
  // Spotify verbindt de speler in de browser opnieuw (na een haperende
  // verbinding) en geeft hem een nieuw id; de oude sessie is weg.
  await page.evaluate(() => window.__sdkPlayers.at(-1).reconnect('sdk-dev-9'));
  await expect.poll(() => spotify.player?.deviceId, { timeout: 10_000 }).toBe('sdk-dev-9');
  expect(spotify.heard()).toBe(turn.trackId);
  // De volgende beurt gaat naar het nieuwe id, niet naar het weggevallen toestel.
  await nextTrack(page, turn);
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  expect(spotify.player.deviceId).toBe('sdk-dev-9');
  await expect(page.getByTestId('host-music-error')).toHaveCount(0);
  await context.close();
});

test('dit toestel: het startcommando komt niet aan en het vorige nummer begint opnieuw', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser, { device: 'browser' });
  spotify.bad.ignorePlays = 1;
  const old = await nextTrack(page, turn);
  // Het vorige nummer speelde al lang en is net ten einde: met herhalen begint het opnieuw.
  spotify.endTrack();
  expect(spotify.player.trackId).toBe(old);
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  // Ook als het later toch nog eens gebeurt, meldt de speler het en herstelt het spel.
  spotify.player.trackId = old;
  spotify.player.startedAt = Date.now();
  await expect.poll(() => spotify.heard(), { timeout: 10_000 }).toBe(turn.trackId);
  await context.close();
});

test('dit toestel: een herkansing van een vorig startcommando komt nooit na het nieuwe', async ({ browser }) => {
  const { context, spotify, page, turn } = await startGame(browser, { device: 'browser' });
  // Spotify kent de speler even niet (404): het spel probeert na 0,7 s opnieuw.
  // Intussen tikt de host al op «Ander nummer».
  spotify.nextPlay = { status: 404, body: { error: { status: 404, message: 'Device not found' } } };
  const before = spotify.calls.length;
  await nextTrack(page, turn);
  await expect.poll(() => spotify.calls.length).toBeGreaterThan(before);
  await nextTrack(page, turn);
  const expected = turn.trackId;
  await page.waitForTimeout(2500);
  expect(spotify.heard()).toBe(expected);
  await context.close();
});
