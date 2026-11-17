// Inloggen bij Spotify met Authorization Code + PKCE, volledig in de browser.
// Er is geen Client Secret; de tokens blijven op de gsm van de host en gaan
// nooit naar de spelserver.

import { SPOTIFY_CLIENT_ID } from '../config.js';
import { storage } from '../lib/session.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Wat de host aan Spotify toestaat:
// - afspelen aansturen en de lijst met toestellen lezen;
// - zijn eigen playlists lezen, om er een te kiezen voor het spel;
// - afspelen in de browser zelf (Web Playback SDK). Spotify vraagt daarvoor
//   ook de twee user-read-scopes, om na te gaan dat het account Premium is.
export const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
  'user-read-email',
  'user-read-private',
];

const TOKENS = 'mt.spotify.tokens';
const PKCE = 'mt.spotify.pkce';

/** Exact de Redirect URI die in het Spotify-dashboard moet staan. */
export function redirectUri() {
  return location.origin + import.meta.env.BASE_URL;
}

export function hasClientId() {
  return Boolean(SPOTIFY_CLIENT_ID);
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function challengeFor(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Stuurt de host naar Spotify om toestemming te geven. Komt niet terug. */
export async function beginLogin() {
  const verifier = randomString(64);
  const state = randomString(16);
  // localStorage en niet sessionStorage: op een gsm kan de terugkeer van
  // Spotify in een ander tabblad landen.
  storage.write(PKCE, { verifier, state });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    redirect_uri: redirectUri(),
    state,
  });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

async function tokenRequest(fields) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function storeTokens(data, previous) {
  storage.write(TOKENS, {
    access: data.access_token,
    // Bij vernieuwen stuurt Spotify niet altijd een nieuw refresh-token mee.
    refresh: data.refresh_token || previous?.refresh || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    // Welke toestemmingen de host gaf (bij vernieuwen stuurt Spotify ze niet altijd mee).
    scope: data.scope || previous?.scope || '',
  });
}

/** Heeft het bewaarde token alle toestemmingen die de site nu nodig heeft? */
function hasAllScopes(tokens) {
  const granted = new Set(String(tokens?.scope || '').split(' '));
  return SCOPES.every((s) => granted.has(s));
}

/**
 * Rondt het inloggen af als de pagina net terugkomt van Spotify
 * (?code=...&state=...). Geeft null (niets te doen), { ok:true } of
 * { error:'boodschap' } terug en haalt de parameters uit de adresbalk.
 */
export async function completeLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state');
  if (!code && !error) return null;
  const pending = storage.read(PKCE);
  storage.write(PKCE, null);
  for (const key of ['code', 'error', 'state']) params.delete(key);
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  if (error) {
    return { error: error === 'access_denied' ? 'Je gaf Spotify geen toestemming.' : `Spotify gaf een fout: ${error}` };
  }
  if (!pending || !state || pending.state !== state) {
    return { error: 'Het inloggen kon niet gecontroleerd worden. Probeer opnieuw.' };
  }
  try {
    const data = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
    });
    // De host gaf zonet toestemming voor alles wat de site vroeg. Bewaar die
    // lijst zelf, los van hoe Spotify ze in het antwoord opsomt.
    storeTokens({ ...data, scope: SCOPES.join(' ') });
    return { ok: true };
  } catch (err) {
    return { error: `Inloggen bij Spotify mislukte: ${err.message}` };
  }
}

/**
 * Ingelogd met alle nodige toestemmingen. Wie inlogde voor er toestemmingen
 * bijkwamen, moet opnieuw inloggen.
 */
export function isLoggedIn() {
  const t = storage.read(TOKENS);
  return Boolean(t && (t.refresh || t.expiresAt > Date.now()) && hasAllScopes(t));
}

export function logout() {
  storage.write(TOKENS, null);
}

let refreshing = null;

/** Geeft een geldig access-token; vernieuwt het als het bijna verlopen is. */
export async function accessToken({ force = false } = {}) {
  const t = storage.read(TOKENS);
  if (!t) throw new LoginRequired();
  if (!force && t.expiresAt - Date.now() > 60_000) return t.access;
  if (!t.refresh) throw new LoginRequired();
  if (!refreshing) {
    refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })
      .then((data) => {
        storeTokens(data, t);
        return data.access_token;
      })
      .catch((err) => {
        // 400 = refresh-token ongeldig of verlopen (na 6 maanden): opnieuw inloggen.
        if (err.status === 400 || err.status === 401) {
          logout();
          throw new LoginRequired();
        }
        throw err;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export class LoginRequired extends Error {
  constructor() {
    super('Log opnieuw in bij Spotify.');
    this.loginRequired = true;
  }
}
