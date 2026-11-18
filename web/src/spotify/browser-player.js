// Afspelen in de browser zelf, met de Web Playback SDK van Spotify. De SDK
// maakt van deze pagina een Spotify-toestel: het geluid komt dan uit het
// toestel waarop de host het spel open heeft, zonder Spotify-app.
//
// De SDK zet standaard geen titel of hoes in de mediabediening van het
// toestel (enableMediaSession staat uit), dus de titel blijft verborgen.

import { accessToken, LoginRequired } from './auth.js';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const READY_TIMEOUT = 15_000;

/** Naam waaronder deze pagina in de toestellenlijst van Spotify verschijnt. */
export const BROWSER_PLAYER_NAME = 'Muziek-tijdlijn (dit toestel)';

let sdk = null; // Promise die klaar is als de SDK geladen is
let player = null;

/**
 * Laadt de SDK alvast. Zo bestaat de speler al op het moment dat de host
 * tikt, en kan het geluid binnen die tik vrijgegeven worden (nodig op gsm's).
 */
export function preloadBrowserPlayer() {
  if (window.Spotify?.Player) return Promise.resolve();
  if (!sdk) {
    sdk = new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onerror = () => {
        sdk = null;
        script.remove();
        reject(new Error('De Spotify-speler kon niet geladen worden. Controleer de verbinding van dit toestel.'));
      };
      document.head.appendChild(script);
    });
    sdk.catch(() => {});
  }
  return sdk;
}

/**
 * Wat de speler in deze browser nu speelt, in dezelfde vorm als
 * connect.state(): { trackId, linkedFrom, deviceId, isPlaying, progressMs }
 * of null. Kost geen verzoek naar Spotify.
 */
export async function browserPlayerState() {
  const p = player;
  if (!p) return null;
  let s = null;
  try {
    s = await p.getCurrentState();
  } catch {
    return null;
  }
  return toState(s, p.deviceId);
}

function toState(s, deviceId) {
  const track = s?.track_window?.current_track;
  if (!track) return null;
  return {
    trackId: track.id || String(track.uri || '').split(':').pop() || null,
    linkedFrom: track.linked_from?.id || null,
    deviceId: deviceId || null,
    isPlaying: !s.paused,
    progressMs: typeof s.position === 'number' ? s.position : null,
  };
}

/** Zet het geluid van de speler in deze browser stil (zonder verzoek naar de Web API). */
export function pauseBrowserPlayer() {
  try {
    Promise.resolve(player?.pause()).catch(() => {});
  } catch {
    // geen speler
  }
}

export function stopBrowserPlayer() {
  const old = player;
  player = null;
  try {
    old?.disconnect();
  } catch {
    // al weg
  }
}

/**
 * Een token voor de speler. Een haperende verbinding mag de speler niet
 * meteen uitloggen: een paar keer opnieuw proberen voor we opgeven.
 */
async function tokenForSdk() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await accessToken();
    } catch (err) {
      if (err instanceof LoginRequired || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Start de speler in deze pagina. Roep dit aan vanuit een tik van de host.
 * Geeft { id } van het nieuwe Spotify-toestel. Daarna melden: `onLost` (de
 * speler is weg bij Spotify), `onBack(id)` (hij is er weer, soms met een ander
 * id), `onState(state)` (wat hij speelt, zie browserPlayerState) en `onError`.
 */
export async function startBrowserPlayer({ onLost, onBack, onState, onError } = {}) {
  if (!window.Spotify?.Player) await preloadBrowserPlayer();
  stopBrowserPlayer();
  const p = new window.Spotify.Player({
    name: BROWSER_PLAYER_NAME,
    getOAuthToken: (cb) => {
      tokenForSdk()
        .then(cb)
        .catch(() => cb(''));
    },
    volume: 1,
  });
  player = p;
  // Browsers laten geluid pas toe na een handeling van de gebruiker.
  try {
    p.activateElement();
  } catch {
    // oudere versies van de SDK kennen dit niet
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('De Spotify-speler in deze browser start niet. Probeer opnieuw of kies een ander toestel.')), READY_TIMEOUT);
    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        if (player === p) stopBrowserPlayer();
        reject(err);
      } else {
        resolve(value);
      }
    }
    /** Fout bij het opstarten: afbreken. Fout nadien: melden. */
    const problem = (message, extra = {}) => {
      const err = Object.assign(new Error(message), extra);
      if (!settled) finish(err);
      else if (player === p) onError?.(err);
    };

    p.addListener('ready', ({ device_id: id }) => {
      p.deviceId = id;
      // Opnieuw klaar na een onderbreking: Spotify kan het toestel dan een
      // ander id geven. Dat moet het spel weten, anders gaat het volgende
      // startcommando naar een toestel dat niet meer bestaat.
      if (settled) {
        if (player === p) onBack?.(id);
      } else finish(null, { id });
    });
    p.addListener('not_ready', () => {
      if (settled && player === p) onLost?.();
    });
    p.addListener('player_state_changed', (s) => {
      if (settled && player === p) onState?.(toState(s, p.deviceId));
    });
    p.addListener('initialization_error', () =>
      problem('Deze browser kan Spotify niet zelf afspelen. Kies een ander toestel in de lijst.'),
    );
    p.addListener('authentication_error', () => problem('Log opnieuw in bij Spotify.', { loginRequired: true }));
    p.addListener('account_error', () => problem('Afspelen in de browser vraagt Spotify Premium.'));
    p.addListener('playback_error', ({ message }) => problem(`Afspelen in de browser mislukte${message ? `: ${message}` : '.'}`));
    p.addListener('autoplay_failed', () => problem('De browser hield het geluid tegen. Tik op «Opnieuw afspelen».'));

    Promise.resolve(p.connect())
      .then((ok) => {
        if (ok === false) finish(new Error('De Spotify-speler in deze browser kon niet verbinden.'));
      })
      .catch(() => finish(new Error('De Spotify-speler in deze browser kon niet verbinden.')));
  });
}
