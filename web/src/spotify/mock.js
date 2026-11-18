// Nagebootste Spotify-laag voor de testmodus (?mock=1) en de automatische
// tests: geen login, geen geluid, maar hetzelfde gedrag als de echte laag.
// Elk commando komt in window.__mockSpotify.log, zodat een test kan nakijken
// wat er "gespeeld" werd.

import { storage } from '../lib/session.js';
import { SpotifyError } from './connect.js';

const LOGIN = 'mt.mock.login';
// Wat het nagebootste toestel speelt; blijft over een herlaad heen, zoals een
// echte box die gewoon verder speelt als de gsm van de host herlaadt.
const PLAYING = 'mt.mock.playing';

const state = {
  log: [],
  /** Zet op een tekst om het volgende play-commando te laten mislukken. */
  failNextPlay: null,
  /** Zoveel play-commando's antwoorden «gelukt» maar het toestel schakelt niet over. */
  ignorePlays: 0,
  devices: [{ id: 'mock-box', name: 'Testbox (geen geluid)', type: 'Speaker', active: true, restricted: false }],
};

if (typeof window !== 'undefined') window.__mockSpotify = state;

const tick = () => new Promise((r) => setTimeout(r, 20));

export const mock = {
  kind: 'mock',
  configured: () => true,
  /** Korte wachttijden voor de controle na het starten: er is geen echt toestel. */
  timing: { checks: [30, 60, 120], late: 0 },
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
    if (state.ignorePlays > 0) {
      state.ignorePlays -= 1;
      return;
    }
    storage.write(PLAYING, { trackId, deviceId, startedAt: Date.now() - positionMs, paused: false });
  },
  async repeat(mode, deviceId) {
    state.log.push({ type: 'repeat', mode, deviceId });
  },
  async state() {
    await tick();
    const now = storage.read(PLAYING);
    if (!now) return null;
    return {
      trackId: now.trackId,
      linkedFrom: null,
      deviceId: now.deviceId,
      isPlaying: !now.paused,
      progressMs: Date.now() - now.startedAt,
    };
  },
  async pause(deviceId) {
    await tick();
    state.log.push({ type: 'pause', deviceId });
    const now = storage.read(PLAYING);
    if (now) storage.write(PLAYING, { ...now, paused: true });
  },
  async resume(deviceId) {
    await tick();
    state.log.push({ type: 'resume', deviceId });
    const now = storage.read(PLAYING);
    if (now) storage.write(PLAYING, { ...now, paused: false });
  },
};
