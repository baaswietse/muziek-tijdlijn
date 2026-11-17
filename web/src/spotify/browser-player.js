// Afspelen in de browser zelf, met de Web Playback SDK van Spotify. De SDK
// maakt van deze pagina een Spotify-toestel: het geluid komt dan uit het
// toestel waarop de host het spel open heeft, zonder Spotify-app.
//
// De SDK zet standaard geen titel of hoes in de mediabediening van het
// toestel (enableMediaSession staat uit), dus de titel blijft verborgen.

import { accessToken } from './auth.js';

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
 * Start de speler in deze pagina. Roep dit aan vanuit een tik van de host.
 * Geeft { id } van het nieuwe Spotify-toestel. `onLost` en `onError` melden
 * wat er daarna misloopt.
 */
export async function startBrowserPlayer({ onLost, onError } = {}) {
  if (!window.Spotify?.Player) await preloadBrowserPlayer();
  stopBrowserPlayer();
  const p = new window.Spotify.Player({
    name: BROWSER_PLAYER_NAME,
    getOAuthToken: (cb) => {
      accessToken()
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

    p.addListener('ready', ({ device_id: id }) => finish(null, { id }));
    p.addListener('not_ready', () => {
      if (settled && player === p) onLost?.();
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
