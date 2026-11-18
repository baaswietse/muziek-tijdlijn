// Nagebootste Spotify (inloggen, Web API, Web Playback SDK), MusicBrainz en
// Wikidata op netwerkniveau, voor de tests met de echte Spotify-laag van de site.
// Het echte MusicBrainz en Wikidata worden nooit aangesproken, ook niet tegen
// de echte site (MT_LIVE=1): fakeSpotify blokkeert ze, fakeMusicBrainz en
// fakeWikidata antwoorden in hun plaats.

import { expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

export const CORS = { 'access-control-allow-origin': '*' };

// Nagebootste Web Playback SDK: maakt van de pagina een "toestel" sdk-dev-N.
// Wat de speler speelt, volgt de nagebootste Web API (hieronder): de speler
// vraagt die toestand regelmatig op, zoals de echte SDK ze via Spotify krijgt,
// en meldt veranderingen met player_state_changed.
const FAKE_SDK = `
  window.__sdkPlayers = [];
  window.Spotify = {
    Player: class {
      constructor(options) {
        this.options = options;
        this.listeners = {};
        this.activated = false;
        this.disconnected = false;
        this.state = null;
        window.__sdkPlayers.push(this);
      }
      addListener(name, fn) { this.listeners[name] = fn; return true; }
      emit(name, arg) { if (this.listeners[name]) this.listeners[name](arg); }
      activateElement() { this.activated = true; return Promise.resolve(); }
      connect() {
        const n = window.__sdkPlayers.length;
        this.options.getOAuthToken((token) => {
          this.token = token;
          setTimeout(() => { this.deviceId = 'sdk-dev-' + n; this.emit('ready', { device_id: this.deviceId }); }, 10);
        });
        this.poll = setInterval(() => this.sync(), 100);
        return Promise.resolve(true);
      }
      async sync() {
        if (this.disconnected || !this.deviceId) return;
        let data = null;
        try {
          const res = await fetch('https://api.spotify.com/v1/me/player?fake_sdk=1');
          data = res.status === 200 ? await res.json() : null;
        } catch { return; }
        const mine = data && data.device && data.device.id === this.deviceId && data.item;
        const next = mine
          ? { paused: !data.is_playing, position: data.progress_ms, track_window: { current_track: { id: data.item.id, uri: data.item.uri, linked_from: data.item.linked_from || { id: null, uri: null } } } }
          : null;
        const before = this.state;
        this.state = next;
        const changed = (before && before.track_window.current_track.id) !== (next && next.track_window.current_track.id)
          || (before && before.paused) !== (next && next.paused)
          || (before && next && next.position < before.position);
        if (changed && next) this.emit('player_state_changed', next);
      }
      getCurrentState() { return Promise.resolve(this.state); }
      pause() {
        return fetch('https://api.spotify.com/v1/me/player/pause?fake_sdk=1&device_id=' + this.deviceId, { method: 'PUT' });
      }
      /** Test: de speler valt even weg en komt terug, met een ander id. */
      reconnect(id) {
        this.emit('not_ready', { device_id: this.deviceId });
        setTimeout(() => { this.deviceId = id; this.emit('ready', { device_id: id }); }, 50);
      }
      disconnect() { this.disconnected = true; clearInterval(this.poll); }
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
    nextPlay: null, // { status, body, headers } voor het eerstvolgende play-commando
    issued: 0,
    // Wat er speelt: { trackId, deviceId, startedAt, pausedAt, repeat } of null.
    player: null,
    repeat: 'off',
    // Slecht gedrag, om na te bootsen wat echte toestellen en Spotify soms doen:
    bad: {
      playFailures: [], // per play-commando om de beurt: { status, body, headers }
      ignorePlays: 0, // zoveel play-commando's antwoorden «gelukt» zonder over te schakelen
      applyDelays: [], // per play-commando: pas na zoveel ms uitvoeren (volgorde niet gegarandeerd)
      responseDelays: [], // per play-commando: zo lang wachten met antwoorden
      relink: {}, // track-ID -> { id, linked }: speelt een andere versie (met of zonder linked_from)
      report: null, // meld altijd dit track-ID, wat er ook gevraagd werd (toestel hangt vast)
    },
  };

  // Nooit naar het echte MusicBrainz of Wikidata. Een nagebootste versie
  // (fakeMusicBrainz, fakeWikidata) komt later en gaat dus voor.
  for (const host of ['https://musicbrainz.org/**', 'https://query.wikidata.org/**', 'https://www.wikidata.org/**']) {
    await context.route(host, (route) => route.abort('blockedbyclient'));
  }

  const now = () => Date.now();
  const playing = () => spotify.player;
  /** Voert een play-commando uit op het nagebootste toestel. */
  function apply(trackId, deviceId, positionMs) {
    spotify.player = { trackId, deviceId, startedAt: now() - positionMs, pausedAt: null };
  }
  /** Test: het nummer is ten einde. Met herhalen begint het opnieuw, anders is het gedaan. */
  spotify.endTrack = () => {
    const p = playing();
    if (!p) return;
    if (spotify.repeat === 'track') p.startedAt = now();
    else spotify.player = null;
  };
  /** Test: wat het toestel nu echt speelt (zoals de spelers het horen). */
  spotify.heard = () => {
    const p = playing();
    if (!p || p.pausedAt) return null;
    return spotify.bad.report || spotify.bad.relink[p.trackId]?.id || p.trackId;
  };
  spotify.playerJson = () => {
    const p = playing();
    if (!p) return null;
    const relink = spotify.bad.relink[p.trackId];
    const id = spotify.bad.report || relink?.id || p.trackId;
    return {
      device: { id: p.deviceId, is_active: true },
      is_playing: !p.pausedAt,
      progress_ms: (p.pausedAt || now()) - p.startedAt,
      repeat_state: spotify.repeat,
      timestamp: p.startedAt,
      item: {
        type: 'track',
        id,
        uri: `spotify:track:${id}`,
        name: 'Titel die nooit op het scherm mag',
        ...(relink?.linked && !spotify.bad.report ? { linked_from: { id: p.trackId, uri: `spotify:track:${p.trackId}` } } : {}),
      },
    };
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
    // De nagebootste SDK in de pagina vraagt zelf de toestand op: dat is geen verzoek van de site.
    const fromSdk = url.searchParams.has('fake_sdk');
    if (!fromSdk) spotify.calls.push(call);
    if (call.path === '/me/player' && call.method === 'GET') {
      const json = spotify.playerJson();
      return json ? route.fulfill({ headers: CORS, json }) : route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (call.path === '/me/player/repeat') {
      spotify.repeat = call.query.state;
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (call.path === '/me/player/pause') {
      if (spotify.player && !spotify.player.pausedAt) spotify.player.pausedAt = now();
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (call.path === '/me/player/play' && !call.body?.uris) {
      const p = spotify.player;
      if (p?.pausedAt) {
        p.startedAt += now() - p.pausedAt;
        p.pausedAt = null;
      }
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
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
    if (isPlay) {
      const bad = spotify.bad;
      const wait = bad.responseDelays.shift() || 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const failure = spotify.nextPlay || bad.playFailures.shift();
      if (spotify.nextPlay) spotify.nextPlay = null;
      if (failure) {
        return route
          .fulfill({ status: failure.status, headers: { ...CORS, ...(failure.headers || {}) }, json: failure.body || { error: { status: failure.status, message: 'fout' } } })
          .catch(() => {});
      }
      const trackId = call.body.uris[0].replace('spotify:track:', '');
      const deviceId = call.query.device_id || spotify.player?.deviceId || spotify.devices[0]?.id;
      const positionMs = call.body.position_ms || 0;
      const later = bad.applyDelays.shift() || 0;
      if (bad.ignorePlays > 0) bad.ignorePlays -= 1;
      else if (later) setTimeout(() => apply(trackId, deviceId, positionMs), later);
      else apply(trackId, deviceId, positionMs);
      return route.fulfill({ status: 204, headers: CORS, body: '' }).catch(() => {});
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

/**
 * Nagebootste Wikidata (de zoekdienst query.wikidata.org). `answers`: titel in
 * kleine letters -> { artist, date } of een lijst daarvan; andere titels kent
 * ze niet. `mode`: 'ok', 'down' (onbereikbaar) of 'busy' (429, veel te lang
 * wachten). Geeft { queries: [[titels per verzoek]], mode } terug.
 */
export async function fakeWikidata(context, answers, { mode = 'ok' } = {}) {
  const wd = { queries: [], mode };
  await context.route('https://query.wikidata.org/**', async (route) => {
    const req = route.request();
    const query = new URLSearchParams(req.postData() || '').get('query') || '';
    const values = /VALUES \?q \{([^}]*)\}/.exec(query)?.[1] || '';
    const titles = [...values.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
    wd.queries.push(titles);
    if (wd.mode === 'down') return route.abort('connectionrefused').catch(() => {});
    if (wd.mode === 'busy') {
      return route.fulfill({ status: 429, headers: { ...CORS, 'retry-after': '3600' }, body: 'Too Many Requests' }).catch(() => {});
    }
    const bindings = [];
    for (const q of titles) {
      for (const hit of [answers[q] || []].flat()) {
        bindings.push({
          q: { type: 'literal', value: q },
          item: { type: 'uri', value: `http://www.wikidata.org/entity/Q${9000 + bindings.length}` },
          labels: { type: 'literal', value: hit.title || q },
          performers: { type: 'literal', value: hit.artist },
          dates: { type: 'literal', value: hit.date ? `${hit.date}-01-01T00:00:00Z` : '' },
          types: { type: 'literal', value: hit.types || 'Q134556' },
        });
      }
    }
    const json = { head: { vars: ['q', 'item', 'labels', 'performers', 'dates', 'types'] }, results: { bindings } };
    await route.fulfill({ headers: { ...CORS, 'content-type': 'application/sparql-results+json' }, json }).catch(() => {});
  });
  return wd;
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
