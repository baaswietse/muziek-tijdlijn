// De echte Spotify-laag van de site (inloggen met PKCE, toestellen, afspelen,
// playlists), zonder ?mock=1. Spotify en MusicBrainz zijn hier nagebootst op
// netwerkniveau: de test vangt de verzoeken op en kijkt na wat de site
// precies verstuurt.

import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TRACKS } from './helpers.js';

const CLIENT_ID = readFileSync(new URL('../../web/src/config.js', import.meta.url), 'utf8').match(
  /SPOTIFY_CLIENT_ID = '([0-9a-f]{32})'/,
)?.[1];

// De lijst die op de site zelf staat (nagekeken jaartallen).
const SITE_TRACKS = JSON.parse(readFileSync(new URL('../../web/public/tracks.json', import.meta.url), 'utf8'));

const SCOPES = [
  'playlist-read-collaborative',
  'playlist-read-private',
  'streaming',
  'user-modify-playback-state',
  'user-read-email',
  'user-read-playback-state',
  'user-read-private',
];

const CORS = { 'access-control-allow-origin': '*' };

// Nagebootste Web Playback SDK: maakt van de pagina een "toestel" sdk-dev-N.
const FAKE_SDK = `
  window.__sdkPlayers = [];
  window.Spotify = {
    Player: class {
      constructor(options) {
        this.options = options;
        this.listeners = {};
        this.activated = false;
        this.disconnected = false;
        window.__sdkPlayers.push(this);
      }
      addListener(name, fn) { this.listeners[name] = fn; return true; }
      activateElement() { this.activated = true; return Promise.resolve(); }
      connect() {
        const n = window.__sdkPlayers.length;
        this.options.getOAuthToken((token) => {
          this.token = token;
          setTimeout(() => this.listeners.ready && this.listeners.ready({ device_id: 'sdk-dev-' + n }), 10);
        });
        return Promise.resolve(true);
      }
      disconnect() { this.disconnected = true; }
    },
  };
  if (window.onSpotifyWebPlaybackSDKReady) window.onSpotifyWebPlaybackSDKReady();
`;

/** Zet een nagebootste Spotify voor deze browser op en houdt alle verzoeken bij. */
async function fakeSpotify(context) {
  const spotify = {
    authorize: null, // URL van het inlogverzoek
    tokens: [], // verzoeken naar /api/token
    calls: [], // verzoeken naar de Web API
    devices: [{ id: 'dev-1', name: 'Gsm van de host', type: 'Smartphone', is_active: true, is_restricted: false }],
    playlists: [],
    playlistItems: {},
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
        // Bij het vernieuwen stuurt Spotify niet altijd een refresh-token of de scopes mee.
        ...(form.grant_type === 'authorization_code'
          ? { refresh_token: 'refresh-1', scope: spotify.authorize.searchParams.get('scope') }
          : {}),
      },
    });
  });

  await context.route('https://sdk.scdn.co/spotify-player.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }),
  );

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
    if (call.path === '/me') return route.fulfill({ headers: CORS, json: { id: 'user-1', display_name: 'Hanne' } });
    if (call.path === '/me/playlists') return route.fulfill({ headers: CORS, json: { items: spotify.playlists, next: null } });
    const items = call.path.match(/^\/playlists\/([^/]+)\/items$/);
    if (items) {
      const list = spotify.playlistItems[items[1]];
      if (!list) return route.fulfill({ status: 403, headers: CORS, json: { error: { status: 403, message: 'Forbidden' } } });
      const offset = Number(call.query.offset || 0);
      const limit = Number(call.query.limit || 20);
      const page = list.slice(offset, offset + limit);
      return route.fulfill({
        headers: CORS,
        json: { items: page, total: list.length, next: offset + limit < list.length ? 'meer' : null },
      });
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

/** De host maakt een spel en logt in bij (de nagebootste) Spotify. */
async function hostAndLogin(page) {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Nieuw spel' }).click();
  await page.getByTestId('name-input').fill('Hanne');
  await page.getByTestId('enter-button').click();
  const code = (await page.getByTestId('big-code').textContent()).trim();
  await page.getByTestId('music-login').click();
  await expect(page.getByTestId('device-dev-1')).toBeVisible();
  return code;
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
  expect(auth.get('scope').split(' ').sort()).toEqual(SCOPES);
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
  // Na het vernieuwen (zonder scopes in het antwoord) blijft de host ingelogd.
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('mt.spotify.tokens')));
  expect(stored).toMatchObject({ access: 'access-2', refresh: 'refresh-1' });
  expect(stored.scope.split(' ').sort()).toEqual(SCOPES);
  await context.close();
});

test('dit toestel: afspelen in de browser zelf met de Spotify-speler', async ({ browser }) => {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  const page = await context.newPage();
  await hostAndLogin(page);

  // «Dit toestel» staat bovenaan; een tik start de speler in de pagina.
  await page.getByTestId('device-browser').click();
  await expect(page.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');
  await expect(page.getByTestId('music-status')).toContainText('uit dit toestel');
  await expect(page.getByTestId('device-browser')).toHaveAttribute('aria-pressed', 'true');
  const sdk = await page.evaluate(() => {
    const p = window.__sdkPlayers.at(-1);
    return { name: p.options.name, volume: p.options.volume, mediaSession: p.options.enableMediaSession, activated: p.activated, token: p.token };
  });
  expect(sdk.name).toBe('Muziek-tijdlijn (dit toestel)');
  expect(sdk.activated, 'geluid vrijgegeven binnen de tik').toBe(true);
  expect(sdk.token).toBe('access-1');
  expect(sdk.volume).toBe(1);
  // De speler zet geen titel in de mediabediening van het toestel.
  expect(sdk.mediaSession).toBeUndefined();

  // De speler duikt ook op in de toestellenlijst van Spotify, maar staat er bij ons niet dubbel in.
  spotify.devices = [...spotify.devices, { id: 'sdk-dev-1', name: 'Muziek-tijdlijn (dit toestel)', type: 'Computer', is_active: true, is_restricted: false }];
  await page.getByRole('button', { name: 'Zoek opnieuw' }).click();
  await expect(page.getByTestId('device-dev-1')).toBeVisible();
  await expect(page.getByTestId('device-sdk-dev-1')).toHaveCount(0);
  await expect(page.getByTestId('music-status')).toHaveAttribute('data-ready', 'yes');

  // Het spel stuurt het nummer naar de speler in de browser. Kent Spotify de
  // pas gestarte speler nog niet (404), dan probeert het spel even later opnieuw.
  spotify.nextPlay = { status: 404, body: { error: { status: 404, message: 'Device not found', reason: 'NO_ACTIVE_DEVICE' } } };
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => spotify.plays().length).toBe(2);
  expect(spotify.plays()[1].query).toEqual({ device_id: 'sdk-dev-1' });
  await expect(page.getByTestId('host-music-error')).toHaveCount(0);
  await expect(page.getByTestId('host-music-status')).toContainText('Speelt op');
  const playing = spotify.plays()[1].body.uris[0];

  // Na herladen is de speler weg: het spel zegt dat, en één tik zet hem weer aan.
  await page.reload();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await expect(page.getByTestId('browser-off')).toBeVisible();
  expect(spotify.plays()).toHaveLength(2); // nog niets opnieuw gestart: er is geen geluid om op te spelen
  await page.getByTestId('device-browser').click();
  await expect(page.getByTestId('browser-off')).toHaveCount(0);
  // Het geluid viel weg bij het herladen, dus het lopende nummer begint opnieuw op de nieuwe speler.
  await expect.poll(() => spotify.plays().length).toBe(3);
  expect(spotify.plays()[2].query).toEqual({ device_id: 'sdk-dev-1' });
  expect(spotify.plays()[2].body.uris[0]).toBe(playing);
  await expect(page.getByTestId('host-music-status')).toContainText('Speelt op');

  // Een ander toestel kiezen sluit de speler in de browser af.
  await page.getByRole('button', { name: 'Muziekinstellingen' }).click();
  await page.getByTestId('device-dev-1').click();
  expect(await page.evaluate(() => window.__sdkPlayers.at(-1).disconnected)).toBe(true);
  await context.close();
});

test('eigen playlist: nummers lezen, jaartallen opzoeken en ermee spelen', async ({ browser }) => {
  const context = await browser.newContext();
  const spotify = await fakeSpotify(context);
  await context.addInitScript(() => {
    window.__mtLookupInterval = 0; // de pauze tussen opzoekingen is hier niet nodig
  });

  // --- de playlist bij Spotify ---
  const [known1, known2] = SITE_TRACKS; // staan al nagekeken op de site: niet opnieuw opzoeken
  const item = (id, name, artist, date, extra = {}) => ({
    item: { type: 'track', id, name, artists: [{ name: artist }], album: { release_date: date } },
    ...extra,
  });
  const fillers = [1, 2, 3, 4, 5].map((n) => item(`vulnummer000000000000${n}`, `Vul ${n}`, 'Vulband', `${1990 + n}-01-01`));
  spotify.playlists = [
    { id: 'PL1', name: 'Feestje', owner: { id: 'user-1' }, collaborative: false, items: { total: 14 } },
    { id: 'PL2', name: 'Van iemand anders', owner: { id: 'iemand' }, collaborative: false, items: { total: 50 } },
    { id: 'PL3', name: 'Samen gemaakt', owner: { id: 'iemand' }, collaborative: true, tracks: { total: 3 } },
  ];
  spotify.playlistItems.PL1 = [
    item(known1.id, `${known1.title} - Remastered`, known1.artist.split(', ')[0], '2019-01-01'),
    item(known2.id, known2.title, known2.artist.split(', ')[0], '2019-01-01'),
    item('nieuwlied0000000000000A', 'Nieuw Lied A', 'Band A', '2010-05-05'), // MusicBrainz veel vroeger dan Spotify
    item('nieuwlied0000000000000B', 'Nieuw Lied B', 'Band B', '2001-03-03'), // beide gelijk
    item('nieuwlied0000000000000C', 'Nieuw Lied C', 'Band C', '1999'), // niet bij MusicBrainz
    item('nieuwlied0000000000000D', 'Nieuw Lied D - Remastered 2015', 'Band D', '2015-09-09'),
    item('nieuwlied0000000000000E', 'Nieuw Lied E', 'Band E', null), // nergens een jaar
    item('nieuwlied000000000000B2', 'Nieuw Lied B - Single Version', 'Band B', '2001-03-03'), // dubbel
    item('lokaalbestand0000000001', 'Eigen opname', 'Ik', '2020', { is_local: true }),
    { item: null },
    ...fillers,
  ];

  // --- MusicBrainz ---
  const mb = { queries: [] };
  const answers = {
    'Nieuw Lied A': { artist: 'Band A', date: '1987-06-01' },
    'Nieuw Lied B': { artist: 'Band B', date: '2001' },
    'Nieuw Lied D': { artist: 'Band D', date: '1975-11-21' },
    ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`Vul ${n}`, { artist: 'Vulband', date: String(1990 + n) }])),
  };
  await context.route('https://musicbrainz.org/ws/2/recording**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query');
    mb.queries.push(query);
    const title = query.match(/recording:"([^"]*)"/)?.[1];
    const hit = answers[title];
    const recordings = hit
      ? [
          {
            id: `mb-${title}`,
            title,
            'first-release-date': hit.date,
            'artist-credit': [{ name: hit.artist, artist: { name: hit.artist } }],
            releases: [{ date: hit.date, status: 'Official', 'release-group': { 'primary-type': 'Album', 'secondary-types': [] } }],
          },
        ]
      : [];
    await route.fulfill({ headers: CORS, json: { count: recordings.length, recordings } });
  });

  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const uploads = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/deck')) uploads.push(JSON.parse(req.postData()));
  });
  const code = await hostAndLogin(page);
  await page.getByTestId('device-dev-1').click();
  await expect(page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');

  // Een tweede speler kijkt mee in de wachtkamer; hij heeft geen Spotify nodig.
  const guest = await (await browser.newContext()).newPage();
  const guestFrames = [];
  guest.on('websocket', (ws) => ws.on('framereceived', (f) => guestFrames.push(String(f.payload))));
  await guest.goto('./');
  await guest.getByTestId('code-input').fill(code);
  await guest.getByTestId('name-input').fill('Bob');
  await guest.getByTestId('enter-button').click();
  await expect(guest.getByTestId('waiting')).toBeVisible();

  // --- playlist kiezen: alleen eigen playlists en playlists waaraan je meewerkt ---
  await page.getByTestId('deck-open').click();
  await expect(page.getByTestId('playlist-PL1')).toContainText('Feestje');
  await expect(page.getByTestId('playlist-PL1')).toContainText('14 nummers');
  await expect(page.getByTestId('playlist-PL3')).toContainText('3 nummers');
  await expect(page.getByTestId('playlist-PL2')).toHaveCount(0);
  await page.getByTestId('playlist-PL1').click();

  // --- resultaat: de lijst staat op de server en iedereen ziet welke lijst het is ---
  await expect(page.getByTestId('deck-current')).toHaveText('Playlist «Feestje» · 11 nummers', { timeout: 20_000 });
  await expect(guest.getByTestId('lobby-playlist')).toContainText('Feestje');
  await expect(guest.getByTestId('lobby-playlist')).toContainText('11');

  expect(uploads).toHaveLength(1);
  const sent = uploads[0];
  expect(sent.name).toBe('Feestje');
  expect(sent.token).toMatch(/^[0-9a-f]{32}$/);
  const year = Object.fromEntries(sent.tracks.map((t) => [t.id, t.year]));
  expect(year).toEqual({
    [known1.id]: known1.year, // uit de nagekeken lijst van de site
    [known2.id]: known2.year,
    nieuwlied0000000000000A: 1987, // MusicBrainz (eerste release) wint van het Spotify-album
    nieuwlied0000000000000B: 2001,
    nieuwlied0000000000000C: 1999, // niet gevonden: jaar van het Spotify-album
    nieuwlied0000000000000D: 1975,
    vulnummer0000000000001: 1991,
    vulnummer0000000000002: 1992,
    vulnummer0000000000003: 1993,
    vulnummer0000000000004: 1994,
    vulnummer0000000000005: 1995,
  });
  // Titels zonder versie-aanduiding; alleen wat het spel nodig heeft gaat mee.
  const d = sent.tracks.find((t) => t.id === 'nieuwlied0000000000000D');
  expect(d).toEqual({ id: 'nieuwlied0000000000000D', artist: 'Band D', title: 'Nieuw Lied D', year: 1975 });
  expect(sent.tracks.find((t) => t.id === known1.id).title).toBe(known1.title);

  // Wat al nagekeken op de site staat, wordt niet opnieuw opgezocht; de rest één keer.
  expect(mb.queries.some((q) => q.includes(known2.title))).toBe(false);
  expect(mb.queries.filter((q) => q.includes('"Nieuw Lied B"'))).toHaveLength(1);
  expect(mb.queries.some((q) => q.includes('Eigen opname'))).toBe(false);

  // De gewone speler krijgt de nummers van de lijst niet te zien.
  expect(guestFrames.some((f) => f.includes('Nieuw Lied') || f.includes('nieuwlied'))).toBe(false);

  // --- twijfelgevallen nakijken en verbeteren ---
  await expect(page.getByTestId('deck-panel')).toContainText('1 nummer doet niet mee');
  const doubts = page.getByTestId('deck-doubts');
  await expect(doubts).toContainText('4 jaartallen om na te kijken');
  await doubts.locator('summary').click();
  await expect(doubts).toContainText('Spotify zegt 2010, MusicBrainz 1987');
  await expect(doubts).toContainText('niet gevonden bij MusicBrainz');
  await expect(doubts).toContainText('geen jaar gevonden'); // de host kan het jaar zelf invullen
  await page.getByTestId('doubt-nieuwlied0000000000000C').fill('1998');
  await page.getByTestId('doubt-nieuwlied0000000000000C').blur();
  await expect.poll(() => uploads.length).toBe(2);
  expect(uploads[1].tracks.find((t) => t.id === 'nieuwlied0000000000000C').year).toBe(1998);
  await expect(doubts).toContainText('3 jaartallen om na te kijken');

  // --- spelen met de eigen lijst ---
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('turn-banner')).toBeVisible();
  await expect.poll(() => spotify.plays().length).toBe(1);
  const own = new Set(sent.tracks.map((t) => t.id));
  const playing = spotify.plays()[0].body.uris[0].replace('spotify:track:', '');
  expect(own.has(playing), 'het nummer komt uit de eigen playlist').toBe(true);
  // Elke startkaart komt ook uit de eigen lijst.
  const startCards = await page.locator('[data-testid="board"] .year-chip').allTextContents();
  const ownYears = new Set(uploads[1].tracks.map((t) => String(t.year)));
  for (const y of startCards) expect(ownYears.has(y)).toBe(true);

  // --- de keuze is onthouden: een tweede keer wordt niets meer opgezocht ---
  await page.getByRole('button', { name: 'Stop dit spel' }).click();
  await expect(page.getByTestId('deck-current')).toContainText('Feestje');
  const before = mb.queries.length;
  await page.getByTestId('deck-open').click();
  await page.getByTestId('playlist-PL1').click();
  await expect.poll(() => uploads.length).toBe(3);
  expect(uploads[2].tracks.find((t) => t.id === 'nieuwlied0000000000000C').year).toBe(1998); // eigen verbetering blijft
  expect(mb.queries.length, 'ook «niet gevonden» is onthouden').toBe(before);

  // --- terug naar de standaardlijst ---
  await page.getByTestId('deck-default').click();
  await expect(page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');
  await expect(guest.getByTestId('lobby-playlist')).toHaveCount(0);
  // De laatst gebruikte playlist staat klaar voor een volgende keer.
  await expect(page.getByTestId('deck-last')).toContainText('Feestje');

  // --- een playlist van iemand anders: duidelijke melding ---
  spotify.playlists.push({ id: 'PL9', name: 'Verdwenen', owner: { id: 'user-1' }, collaborative: false, items: { total: 5 } });
  await page.getByTestId('deck-open').click();
  await page.getByTestId('playlist-PL9').click();
  await expect(page.getByTestId('deck-error')).toContainText('Spotify weigert');
  await expect(page.getByTestId('deck-current')).toHaveText('Standaardlijst van het spel');

  await guest.context().close();
  await context.close();
});

test('wie inlogde voor er toestemmingen bijkwamen, moet opnieuw inloggen', async ({ browser }) => {
  const context = await browser.newContext();
  await fakeSpotify(context);
  const page = await context.newPage();
  // Een token van vroeger: alleen de twee afspeel-scopes.
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.setItem(
      'mt.spotify.tokens',
      JSON.stringify({
        access: 'oud',
        refresh: 'oud-refresh',
        expiresAt: Date.now() + 3_600_000,
        scope: 'user-modify-playback-state user-read-playback-state',
      }),
    );
  });
  await page.getByRole('tab', { name: 'Nieuw spel' }).click();
  await page.getByTestId('name-input').fill('Hanne');
  await page.getByTestId('enter-button').click();
  await expect(page.getByTestId('music-login')).toBeVisible();
  await expect(page.getByTestId('deck-panel')).toContainText('Log in bij Spotify');
  // Na opnieuw inloggen werkt alles.
  await page.getByTestId('music-login').click();
  await expect(page.getByTestId('device-dev-1')).toBeVisible();
  await expect(page.getByTestId('deck-open')).toBeVisible();
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
