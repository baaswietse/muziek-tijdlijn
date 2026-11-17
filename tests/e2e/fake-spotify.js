// Nagebootste Spotify (inloggen, Web API, Web Playback SDK) en MusicBrainz op
// netwerkniveau, voor de tests met de echte Spotify-laag van de site.

import { expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

export const CORS = { 'access-control-allow-origin': '*' };

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
export async function fakeSpotify(context) {
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
export async function hostAndLogin(page) {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Nieuw spel' }).click();
  await page.getByTestId('name-input').fill('Hanne');
  await page.getByTestId('enter-button').click();
  const code = (await page.getByTestId('big-code').textContent()).trim();
  await page.getByTestId('music-login').click();
  await expect(page.getByTestId('device-dev-1')).toBeVisible();
  return code;
}

/**
 * Maakt verzonnen track-ID's in de vorm van Spotify (22 letters en cijfers),
 * uniek per testrun: `id('A')`. De server bewaart opgezochte jaartallen in een
 * gedeelde lijst. Met vaste ID's zou een tweede run (zeker tegen de echte
 * server, MT_LIVE=1) alles al gekend vinden, en een echt nummer mag een test
 * daar nooit raken.
 */
export function fakeIds() {
  const run = randomBytes(8).toString('hex'); // 16 tekens, anders bij elke run
  return (label) => {
    if (!/^[A-Za-z0-9]{1,4}$/.test(label)) throw new Error(`label ${label}: 1 tot 4 letters of cijfers`);
    return `zz${run}${label}`.padEnd(22, '0');
  };
}

/**
 * Nagebootste MusicBrainz. `answers`: titel -> { artist, date }; andere titels
 * vindt ze niet. Geeft { queries } terug om de verzoeken te tellen. Met
 * `delay` (ms) antwoordt ze trager, om "nog bezig" te kunnen testen.
 */
export async function fakeMusicBrainz(context, answers, { delay = 0 } = {}) {
  const mb = { queries: [], delay };
  await context.route('https://musicbrainz.org/ws/2/recording**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query');
    mb.queries.push(query);
    if (mb.delay) await new Promise((resolve) => setTimeout(resolve, mb.delay));
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
    // Na een herlaad of gestopte opzoeking is het verzoek er niet meer.
    await route.fulfill({ headers: CORS, json: { count: recordings.length, recordings } }).catch(() => {});
  });
  return mb;
}

/** Een nummer in een playlist zoals de Web API van Spotify het geeft. */
export const playlistItem = (id, name, artist, date, extra = {}) => ({
  item: { type: 'track', id, name, artists: [{ name: artist }], album: { release_date: date } },
  ...extra,
});

/**
 * Houdt de verzoeken van deze pagina naar de gedeelde lijst met jaartallen bij:
 * { lookups: [{ url, body, status, response }], writes: [...] }.
 */
export function watchYears(page) {
  const traffic = { lookups: [], writes: [] };
  page.on('requestfinished', async (req) => {
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'POST' || !/\/api\/rooms\/[A-Za-z]{4}\/years(\/lookup)?$/.test(path)) return;
    const res = await req.response();
    let response = null;
    try {
      response = await res.json();
    } catch {
      // geen JSON
    }
    const entry = { url: req.url(), body: JSON.parse(req.postData()), status: res.status(), response };
    (path.endsWith('/lookup') ? traffic.lookups : traffic.writes).push(entry);
  });
  return traffic;
}
