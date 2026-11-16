// Nagebootste Spotify-laag voor de testmodus (?mock=1) en de automatische
// tests: geen login, geen geluid, maar hetzelfde gedrag als de echte laag.
// Elk commando komt in window.__mockSpotify.log, zodat een test kan nakijken
// wat er "gespeeld" werd.

import { storage } from '../lib/session.js';
import { SpotifyError } from './connect.js';

const LOGIN = 'mt.mock.login';

const state = {
  log: [],
  /** Zet op een tekst om het volgende play-commando te laten mislukken. */
  failNextPlay: null,
  devices: [{ id: 'mock-box', name: 'Testbox (geen geluid)', type: 'Speaker', active: true, restricted: false }],
};

if (typeof window !== 'undefined') window.__mockSpotify = state;

const tick = () => new Promise((r) => setTimeout(r, 20));

export const mock = {
  kind: 'mock',
  configured: () => true,
  isLoggedIn: () => storage.read(LOGIN) === true,
  async login() {
    storage.write(LOGIN, true);
  },
  logout() {
    storage.write(LOGIN, null);
  },
  async devices() {
    await tick();
    return state.devices.map((d) => ({ ...d }));
  },
  async play(trackId, deviceId, { positionMs = 0 } = {}) {
    await tick();
    if (state.failNextPlay) {
      const message = state.failNextPlay;
      state.failNextPlay = null;
      state.log.push({ type: 'play-failed', trackId, deviceId });
      throw new SpotifyError(message, { status: 404, deviceGone: true });
    }
    state.log.push({ type: 'play', trackId, deviceId, positionMs });
  },
  async pause(deviceId) {
    await tick();
    state.log.push({ type: 'pause', deviceId });
  },
  async resume(deviceId) {
    await tick();
    state.log.push({ type: 'resume', deviceId });
  },
  async release(deviceId) {
    state.log.push({ type: 'release', deviceId });
  },
};
