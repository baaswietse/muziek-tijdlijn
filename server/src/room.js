// Eén spelkamer: vertaalt berichten van spelers naar de spelregels.
// Onafhankelijk van hoe de server draait (Node of Cloudflare): die laag zorgt
// voor de verbindingen en de opslag en roept deze functies aan.

import * as rules from './rules.js';
import { GameError } from './rules.js';
import { normaliseTracks } from './tracks.js';

// Geen I en O: die lijken te veel op 1 en 0.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
export const CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;

export function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = '';
  for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
  return code;
}

export function randomId(bytes = 16) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Willekeurig getal in [0, 1) uit de cryptografische bron. */
export function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export function createRoomState(code, now = Date.now()) {
  return rules.createRoom({ code, now });
}

/** Voegt een speler toe en geeft zijn id + geheim token terug. */
export function join(state, name, now = Date.now()) {
  const player = rules.addPlayer(state, { id: randomId(6), token: randomId(16), name });
  state.updatedAt = now;
  return { playerId: player.id, token: player.token };
}

export function authenticate(state, token) {
  if (typeof token !== 'string' || token.length < 8) return null;
  const player = state.players.find((p) => p.token === token);
  return player ? player.id : null;
}

/**
 * Voert één actie van een speler uit. `loadTracks` wordt alleen aangeroepen
 * bij het starten van een spel. Gooit een GameError bij een ongeldige actie.
 */
export async function applyAction(state, playerId, msg, { loadTracks, random = secureRandom, now = Date.now() }) {
  switch (msg?.t) {
    case 'start': {
      // Eerst controleren, dan pas de nummers ophalen.
      if (state.hostId !== playerId) throw new GameError('HOST_ONLY', 'Alleen de host kan dit doen.');
      // Een eigen lijst van de host gaat voor op de standaardlijst.
      const tracks = state.custom ? state.custom.tracks : await loadTracks();
      rules.startGame(state, playerId, tracks, random);
      break;
    }
    case 'clearDeck':
      rules.clearDeck(state, playerId);
      break;
    case 'settings':
      rules.setSettings(state, playerId, { target: msg.target });
      break;
    case 'select':
      rules.selectSlot(state, playerId, msg.index === null ? null : Number(msg.index));
      break;
    case 'place':
      rules.placeCard(state, playerId, Number(msg.index));
      break;
    case 'next':
      rules.nextTurn(state, playerId);
      break;
    case 'token':
      // Lege of ontbrekende playerId: het token van deze beurt terugnemen.
      rules.giveToken(state, playerId, msg.playerId ? String(msg.playerId) : null);
      break;
    case 'challenge':
      rules.placeBet(state, playerId, Number(msg.index));
      break;
    case 'reveal':
      rules.revealTurn(state, playerId);
      break;
    case 'skipTrack':
      rules.skipTrack(state, playerId);
      break;
    case 'skipTurn':
      rules.skipTurn(state, playerId);
      break;
    case 'remove':
      rules.removePlayer(state, playerId, String(msg.playerId ?? ''));
      break;
    case 'lobby':
      rules.backToLobby(state, playerId);
      break;
    default:
      throw new GameError('UNKNOWN', 'Onbekende actie.');
  }
  state.updatedAt = now;
}

/** Grootste toegelaten verzoek voor een eigen lijst (ruim voor 500 nummers). */
export const MAX_DECK_BODY = 200_000;

/**
 * De host stuurt een eigen lijst met nummers door (apart verzoek, want te
 * groot voor een gewoon bericht). Gooit een GameError bij een ongeldig verzoek.
 */
export function setDeck(state, body, now = Date.now()) {
  const playerId = authenticate(state, body?.token);
  if (!playerId) throw new GameError('BAD_TOKEN', 'Je zit niet (meer) in dit spel.');
  rules.setDeck(state, playerId, { name: body.name, tracks: normaliseTracks(body.tracks) });
  state.updatedAt = now;
}

export function view(state, playerId, online) {
  return rules.viewFor(state, playerId, online);
}

export function errorPayload(err) {
  if (err instanceof GameError) return { t: 'error', code: err.code, message: err.message };
  return { t: 'error', code: 'SERVER', message: 'Er liep iets mis op de server.' };
}

export { GameError };
