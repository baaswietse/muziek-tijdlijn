// De echte Spotify-laag van de site (inloggen met PKCE, toestellen, afspelen),
// zonder ?mock=1. Spotify zelf is hier nagebootst op netwerkniveau: de test
// vangt de verzoeken naar accounts.spotify.com en api.spotify.com op en kijkt
// na wat de site precies verstuurt.

import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TRACKS } from './helpers.js';

const CLIENT_ID = readFileSync(new URL('../../web/src/config.js', import.meta.url), 'utf8').match(
  /SPOTIFY_CLIENT_ID = '([0-9a-f]{32})'/,
)?.[1];

const CORS = { 'access-control-allow-origin': '*' };

/** Zet een nagebootste Spotify voor deze browser op en houdt alle verzoeken bij. */
async function fakeSpotify(context) {
  const spotify = {
    authorize: null, // URL van het inlogverzoek
    tokens: [], // verzoeken naar /api/token
    calls: [], // verzoeken naar de Web API
    devices: [{ id: 'dev-1', name: 'Gsm van de host', type: 'Smartphone', is_active: true, is_restricted: false }],
    nextPlay: null, // { status, body } voor het eerstvolgende play-commando
    issued: 0,
  };

  // Inloggen: Spotify stuurt de browser terug naar de redirect URI met een code.
  await context.route('https://accounts.spotify.com/authorize**', async (route) => {
    const url = new URL(route.request().url());
    spotify.authorize = url;
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'de-code');
    back.searchParams.set('state', url.searchParams.get('state'));
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });

  await context.route('https://accounts.spotify.com/api/token', async (route) => {
    const form = Object.fromEntries(new URLSearchParams(route.request().postData() || ''));
    spotify.tokens.push({ form, contentType: route.request().headers()['content-type'] });
    spotify.issued += 1;
    await route.fulfill({
      headers: CORS,
      json: {
        access_token: `access-${spotify.issued}`,
        token_type: 'Bearer',
        expires_in: 3600,
        // Bij het vernieuwen stuurt Spotify niet altijd een nieuw refresh-token mee.
        ...(form.grant_type === 'authorization_code' ? { refresh_token: 'refresh-1' } : {}),
      },
    });
  });

  await context.route('https://api.spotify.com/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const call = {
      method: req.method(),
      path: url.pathname.replace('/v1', ''),
      query: Object.fromEntries(url.searchParams),
      body: req.postData() ? JSON.parse(req.postData()) : null,
      auth: req.headers()['authorization'],
    };
    spotify.calls.push(call);
    if (call.path === '/me/player/devices') {
      return route.fulfill({ headers: CORS, json: { devices: spotify.devices } });
    }
    const isPlay = call.path === '/me/player/play' && call.body?.uris;
    if (isPlay && spotify.nextPlay) {
      const { status, body } = spotify.nextPlay;
      spotify.nextPlay = null;
      return route.fulfill({ status, headers: CORS, json: body });
    }
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  });

  spotify.plays = () => spotify.calls.filter((c) => c.path === '/me/player/play' && c.body?.uris);
  return spotify;
}

test('echte Spotify-laag: inloggen met PKCE, toestel kiezen, afspelen en fouten opvangen', async ({ browser, baseURL }) => {
  expect(CLIENT_ID, 'Client ID ontbreekt in web/src/config.js').toBeTruthy();
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());

  // Zonder ?mock=1: dit is de site zoals de host ze in het echt gebruikt.
  await page.goto('./');
  await page.getByRole('tab', { name: 'Nieuw spel' }).click();
  await page.getByTestId('name-input').fill('Hanne');
  await page.getByTestId('enter-button').click();
  const code = (await page.getByTestId('big-code').textContent()).trim();
  await expect(page.getByTestId('start-game')).toBeDisabled();

  // --- inloggen ---
  await page.getByTestId('music-login').click();
  await expect(page.getByTestId('device-dev-1')).toBeVisible();

  const auth = spotify.authorize.searchParams;
  expect(spotify.authorize.origin + spotify.authorize.pathname).toBe('https://accounts.spotify.com/authorize');
  expect(auth.get('client_id')).toBe(CLIENT_ID);
  expect(auth.get('response_type')).toBe('code');
  expect(auth.get('redirect_uri')).toBe(baseURL); // exact de Redirect URI, met schuine streep
  expect(auth.get('code_challenge_method')).toBe('S256');
  expect(auth.get('scope').split(' ').sort()).toEqual(['user-modify-playback-state', 'user-read-playback-state']);
  expect(auth.get('state')).toMatch(/^[A-Za-z0-9]{16}$/);

  // De code wordt omgeruild zonder Client Secret, met een verifier die bij de challenge hoort.
  expect(spotify.tokens).toHaveLength(1);
  const exchange = spotify.tokens[0];
  expect(exchange.contentType).toContain('application/x-www-form-urlencoded');
  expect(exchange.form).toMatchObject({
    grant_type: 'authorization_code',
    code: 'de-code',
    redirect_uri: baseURL,
    client_id: CLIENT_ID,
  });
  expect(exchange.form).not.toHaveProperty('client_secret');
  expect(exchange.form.code_verifier).toMatch(/^[A-Za-z0-9]{43,128}$/);
  const challenge = createHash('sha256').update(exchange.form.code_verifier).digest('base64url');
  expect(auth.get('code_challenge')).toBe(challenge);

  // Terug in hetzelfde spel, en de code staat niet meer in de adresbalk.
  await expect(page.getByTestId('room-code')).toHaveText(code);
  expect(page.url()).not.toContain('code=');
  expect(page.url()).not.toContain('state=');

  // --- toestel kiezen ---
  const devicesCall = spotify.calls.find((c) => c.path === '/me/player/devices');
  expect(devicesCall).toMatchObject({ method: 'GET', auth: 'Bearer access-1' });
  await expect(page.getByTestId('device-hint')).toContainText('Spotify-app');

  // De host opent de Spotify-app op zijn gsm en komt terug naar het spel: het
  // nieuwe toestel verschijnt zonder dat hij op «Zoek opnieuw» moet tikken.
  spotify.devices = [
    ...spotify.devices,
    { id: 'dev-box', name: 'Box in de woonkamer', type: 'Speaker', is_active: false, is_restricted: false },
  ];
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByTestId('device-dev-box')).toBeVisible();
  spotify.devices = spotify.devices.filter((d) => d.id !== 'dev-box');
  await page.getByTestId('device-dev-1').click();
  await expect(page.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
  await expect(page.getByTestId('start-game')).toBeEnabled();

  // --- afspelen: het nummer van de eerste beurt start vanzelf ---
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => spotify.plays().length).toBe(1);
  const play = spotify.plays()[0];
  expect(play.method).toBe('PUT');
  expect(play.query).toEqual({ device_id: 'dev-1' });
  expect(play.auth).toBe('Bearer access-1');
  expect(play.body.position_ms).toBe(0);
  expect(play.body.uris).toHaveLength(1);
  const trackId = play.body.uris[0].replace('spotify:track:', '');
  expect(TRACKS.map((t) => t.id)).toContain(trackId);
  // Het nummer wordt herhaald zolang de beurt duurt.
  await expect
    .poll(() => spotify.calls.find((c) => c.path === '/me/player/repeat')?.query)
    .toEqual({ state: 'track', device_id: 'dev-1' });
  // Nergens op het scherm van de host staat welk nummer het is.
  const track = TRACKS.find((t) => t.id === trackId);
  await expect(page.locator('body')).not.toContainText(track.title);
  await expect(page.locator('body')).not.toContainText(trackId);

  // --- pauze en verder ---
  await page.getByRole('button', { name: 'Pauze' }).click();
  await expect.poll(() => spotify.calls.some((c) => c.path === '/me/player/pause' && c.query.device_id === 'dev-1')).toBe(true);
  await page.getByRole('button', { name: 'Verder spelen' }).click();
  await expect(page.getByRole('button', { name: 'Pauze' })).toBeVisible();

  // --- verlopen token: de site vernieuwt het en probeert opnieuw ---
  spotify.nextPlay = { status: 401, body: { error: { status: 401, message: 'The access token expired' } } };
  await page.getByTestId('replay').click();
  await expect.poll(() => spotify.tokens.length).toBe(2);
  expect(spotify.tokens[1].form).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: CLIENT_ID });
  expect(spotify.tokens[1].form).not.toHaveProperty('client_secret');
  await expect.poll(() => spotify.plays().at(-1).auth).toBe('Bearer access-2');
  expect(spotify.plays().at(-1).body.uris).toEqual([`spotify:track:${trackId}`]);
  await expect(page.getByTestId('host-music-error')).toHaveCount(0);

  // --- toestel kreeg een nieuw id (app herstart): de site vindt het terug op naam ---
  spotify.devices = [{ id: 'dev-2', name: 'Gsm van de host', type: 'Smartphone', is_active: false, is_restricted: false }];
  spotify.nextPlay = { status: 404, body: { error: { status: 404, message: 'Device not found', reason: 'NO_ACTIVE_DEVICE' } } };
  await page.getByTestId('replay').click();
  await expect.poll(() => spotify.plays().at(-1).query.device_id).toBe('dev-2');
  await expect(page.getByTestId('host-music-error')).toHaveCount(0);

  // --- geen Premium: een duidelijke melding in plaats van stilte ---
  spotify.nextPlay = { status: 403, body: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } } };
  await page.getByTestId('replay').click();
  await expect(page.getByTestId('host-music-error')).toContainText('Premium');

  // --- de tokens blijven in de browser en gaan nooit naar de spelserver ---
  const stored = await page.evaluate(() => localStorage.getItem('mt.spotify.tokens'));
  expect(JSON.parse(stored)).toMatchObject({ access: 'access-2', refresh: 'refresh-1' });
  await context.close();
});

test('inloggen geweigerd of gemanipuleerd: duidelijke melding en geen tokens', async ({ browser }) => {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  const page = await context.newPage();

  // De gebruiker weigert bij Spotify.
  await page.goto('./?error=access_denied&state=x');
  await expect(page.getByTestId('toast')).toContainText('geen toestemming');
  expect(page.url()).not.toContain('error=');

  // Een code met een state die niet van deze browser komt, wordt niet omgeruild.
  await page.goto('./?code=vreemde-code&state=niet-van-ons');
  await expect(page.getByTestId('toast')).toContainText('kon niet gecontroleerd worden');
  expect(spotify.tokens).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('mt.spotify.tokens'))).toBeNull();
  await context.close();
});
