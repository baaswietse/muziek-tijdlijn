// Afspelen via de Spotify Web API (Spotify Connect): de site stuurt een
// commando naar een Spotify-toestel van de host (zijn gsm, een laptop, een
// Connect-box) en dat toestel speelt het nummer. De site zelf maakt geen geluid.

import { accessToken, beginLogin, isLoggedIn, logout, hasClientId, LoginRequired } from './auth.js';

const API = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(message, { status = 0, reason = '', loginRequired = false, deviceGone = false, network = false, timeout = false, retryAfter = 0 } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.loginRequired = loginRequired;
    this.deviceGone = deviceGone;
    this.network = network; // geen verbinding
    this.timeout = timeout; // geen antwoord binnen de tijd
    this.retryAfter = retryAfter; // seconden (bij 429)
  }
}

function explain(status, reason, detail, path = '', retryAfter = 0) {
  if (status === 404 && !path.startsWith('/me/player')) {
    return new SpotifyError('Spotify vindt dit niet (meer). Bestaat de playlist nog?', { status, reason });
  }
  if (status === 404) {
    return new SpotifyError(
      'Spotify vindt het toestel niet. Open de Spotify-app op dat toestel, speel even iets af en probeer opnieuw.',
      { status, reason, deviceGone: true },
    );
  }
  if (status === 403 && reason === 'PREMIUM_REQUIRED') {
    return new SpotifyError('Hiervoor is Spotify Premium nodig.', { status, reason });
  }
  if (status === 403) {
    return new SpotifyError(
      'Spotify weigert dit. Mogelijke oorzaken: het toestel laat geen bediening op afstand toe, de playlist is niet van jou, of dit account staat niet bij de gebruikers van de Spotify-app (dashboard > User Management).',
      { status, reason },
    );
  }
  if (status === 429) {
    return new SpotifyError('Te veel verzoeken naar Spotify. Wacht even en probeer opnieuw.', { status, reason, retryAfter });
  }
  if (status === 401) return new SpotifyError('Log opnieuw in bij Spotify.', { status, loginRequired: true });
  if (status >= 500) return new SpotifyError('Spotify heeft even een storing. Probeer opnieuw.', { status, reason });
  return new SpotifyError(detail || `Spotify gaf een fout (${status}).`, { status, reason });
}

/** Zo lang wacht de site op een antwoord van Spotify. */
const TIMEOUT = 10_000;

async function call(method, path, { query, body } = {}, retried = false) {
  let token;
  try {
    token = await accessToken({ force: retried });
  } catch (err) {
    if (err instanceof LoginRequired) throw new SpotifyError(err.message, { loginRequired: true });
    throw new SpotifyError('Geen verbinding met Spotify. Controleer het internet van dit toestel.', { network: true });
  }
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  // Een verzoek dat blijft hangen (zwak netwerk) mag de wachtrij met
  // commando's niet eindeloos ophouden.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  let res;
  let text;
  try {
    res = await fetch(API + path + qs, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    text = await res.text();
  } catch {
    if (controller.signal.aborted) throw new SpotifyError('Spotify antwoordt niet. Probeer opnieuw.', { timeout: true });
    throw new SpotifyError('Geen verbinding met Spotify. Controleer het internet van dit toestel.', { network: true });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && !retried) return call(method, path, { query, body }, true);
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Sommige player-commando's antwoorden met platte tekst; negeren.
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw explain(res.status, data?.error?.reason || '', data?.error?.message || '', path, retryAfter);
  }
  return data;
}

const deviceQuery = (deviceId) => (deviceId ? { device_id: deviceId } : undefined);

export const connect = {
  kind: 'connect',
  configured: hasClientId,
  isLoggedIn,
  login: beginLogin,
  logout,

  /** Toestellen waarop de host Spotify open heeft. */
  async devices() {
    const data = await call('GET', '/me/player/devices');
    return (data?.devices || [])
      .filter((d) => d.id)
      .map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted }));
  },

  /**
   * Speelt één nummer vanaf `positionMs` op het gekozen toestel. Alleen dit
   * ene nummer (geen playlist of album als context), zodat Spotify geen eigen
   * volgorde kan volgen. Herhalen zet music.js apart, na een bevestigde start.
   */
  async play(trackId, deviceId, { positionMs = 0 } = {}) {
    await call('PUT', '/me/player/play', {
      query: deviceQuery(deviceId),
      body: { uris: [`spotify:track:${trackId}`], position_ms: positionMs },
    });
  },

  /** Herhaalstand: 'track' (dit nummer opnieuw) of 'off'. */
  async repeat(mode, deviceId) {
    await call('PUT', '/me/player/repeat', { query: { state: mode, ...deviceQuery(deviceId) } });
  },

  /**
   * Wat er nu echt speelt: { trackId, linkedFrom, deviceId, isPlaying,
   * progressMs } of null (niets). Met `market=from_token` meldt Spotify bij
   * "track relinking" ook het gevraagde nummer (linked_from). Gaat alleen naar
   * het afspeelscherm van de site; titels worden nergens getoond.
   */
  async state() {
    const data = await call('GET', '/me/player', { query: { market: 'from_token', additional_types: 'track' } });
    if (!data || !data.item) return null;
    return {
      trackId: data.item.id || null,
      linkedFrom: data.item.linked_from?.id || null,
      deviceId: data.device?.id || null,
      isPlaying: Boolean(data.is_playing),
      progressMs: typeof data.progress_ms === 'number' ? data.progress_ms : null,
    };
  },

  async pause(deviceId) {
    await call('PUT', '/me/player/pause', { query: deviceQuery(deviceId) });
  },

  async resume(deviceId) {
    await call('PUT', '/me/player/play', { query: deviceQuery(deviceId) });
  },

  /**
   * De playlists van de host waarvan Spotify de nummers laat lezen: die van
   * hemzelf en die waaraan hij meewerkt.
   */
  async playlists() {
    const me = await call('GET', '/me');
    const out = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const page = await call('GET', '/me/playlists', { query: { limit: '50', offset: String(offset) } });
      for (const p of page?.items || []) {
        if (!p?.id || !(p.owner?.id === me?.id || p.collaborative)) continue;
        // Sinds februari 2026 heet het veld 'items'; vroeger 'tracks'.
        out.push({ id: p.id, name: p.name || 'Naamloos', total: p.items?.total ?? p.tracks?.total ?? 0 });
      }
      if (!page?.next) break;
    }
    return out;
  },

  /** Alle nummers van één playlist: [{ id, title, artists, spotifyDate }]. */
  async playlistTracks(playlistId) {
    const out = [];
    const seen = new Set();
    for (let offset = 0; offset < 2000; offset += 50) {
      const page = await call('GET', `/playlists/${encodeURIComponent(playlistId)}/items`, {
        query: { limit: '50', offset: String(offset), additional_types: 'track' },
      });
      for (const entry of page?.items || []) {
        const item = entry?.item || entry?.track;
        if (!item?.id || entry.is_local || (item.type && item.type !== 'track') || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push({
          id: item.id,
          title: item.name || '',
          artists: (item.artists || []).map((a) => a?.name).filter(Boolean),
          spotifyDate: item.album?.release_date || null,
        });
      }
      if (!page?.next) break;
    }
    return out;
  },

};
