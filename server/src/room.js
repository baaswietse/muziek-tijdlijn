// Eén spelkamer: vertaalt berichten van spelers naar de spelregels.
// Onafhankelijk van hoe de server draait (Node of Cloudflare): die laag zorgt
// voor de verbindingen en de opslag en roept deze functies aan.

import * as rules from './rules.js';
import { GameError } from './rules.js';
import { normaliseTracks } from './tracks.js';
import * as sound from './sound.js';

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
 * bij het starten van een spel. `online` (Set met speler-ID's) zegt wie nu
 * verbonden is: wie weg is, houdt het onthullen niet tegen. Gooit een
 * GameError bij een ongeldige actie.
 */
export async function applyAction(
  state,
  playerId,
  msg,
  { loadTracks, online = null, random = secureRandom, now = Date.now(), grace = rules.HOST_GRACE_MS },
) {
  switch (msg?.t) {
    case 'setHost':
      // De host geeft zijn rol aan een andere speler die nu verbonden is.
      rules.setHost(state, playerId, String(msg.playerId ?? ''), { online });
      break;
    case 'takeHost':
      // De host is al een tijd weg: deze speler wordt host. Alleen als de
      // server dat zelf ziet (wie verbonden is, en sinds wanneer de host weg is).
      if (!online) throw new GameError('SERVER', 'Er liep iets mis op de server.');
      rules.takeHost(state, playerId, { online, now, grace });
      break;
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
    case 'buy':
      rules.buyCard(state, playerId);
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
    case 'pass':
      rules.passBet(state, playerId);
      break;
    case 'reveal':
      // `force`: de host onthult toch, terwijl er nog op iemand gewacht wordt.
      rules.revealTurn(state, playerId, { online, force: msg.force === true });
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
      rules.backToLobby(state, playerId, { why: msg.why === 'music' ? 'music' : null });
      break;
    case 'sound':
      // De host bedient het geluid voor wie meeluistert (alleen met fragmenten; zie sound.js).
      sound.applySound(state, playerId, msg, now);
      break;
    default:
      throw new GameError('UNKNOWN', 'Onbekende actie.');
  }
  // Een nieuwe beurt, een ander nummer of het einde: het geluid van het vorige nummer vervalt.
  sound.tidySound(state);
  // Begin en einde van het spel, voor het eindscherm.
  rules.markTimes(state, now);
  if (online) rules.trackHost(state, online, now);
  state.updatedAt = now;
}

/**
 * Controleert dat `token` van de host van dit spel is. Gebruikt voor de
 * gedeelde lijst met jaartallen: die verklapt antwoorden, dus gasten mogen ze
 * niet lezen, en alleen een host mag erin schrijven.
 */
export function authenticateHost(state, token) {
  const playerId = authenticate(state, token);
  if (!playerId) throw new GameError('BAD_TOKEN', 'Je zit niet (meer) in dit spel.');
  if (playerId !== state.hostId) throw new GameError('HOST_ONLY', 'Alleen de host kan dit doen.');
  return playerId;
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

/**
 * Wat één speler mag zien. De host krijgt er ook bij of er geluid is voor wie
 * meeluistert (`sound`: zonder adres, dat heeft hij zelf).
 */
export function view(state, playerId, online, { now = Date.now(), grace = rules.HOST_GRACE_MS } = {}) {
  const v = rules.viewFor(state, playerId, online, { now, grace });
  if (playerId === state.hostId) v.sound = sound.hostSound(state);
  return v;
}

/**
 * Sinds wanneer de host weg is, bijhouden (zie rules.trackHost). De server
 * roept dit op bij elke verandering in wie verbonden is; true als het
 * veranderde (dan moet het bewaard worden).
 */
export function trackHost(state, online, now = Date.now()) {
  return rules.trackHost(state, online, now);
}

/**
 * Een verbinding die zo lang (ms) niets meer stuurde, telt als weg. De gsm
 * stuurt om de 15 s een ping (web/src/lib/net.js); zo valt een gsm waarvan de
 * batterij leeg is of die zijn netwerk kwijt is (zonder dat de verbinding
 * netjes sluit) na hoogstens drie gemiste pings weg.
 */
export const STALE_MS = 45_000;

/** Zo lang (ms) moet de host weg zijn voor een ander host kan worden (zie rules.js). */
export const HOST_GRACE_MS = rules.HOST_GRACE_MS;

/** Leeft een verbinding nog? `seen`: tijdstip (ms) van het laatste bericht. */
export function alive(seen, now = Date.now(), stale = STALE_MS) {
  return Number.isFinite(seen) && now - seen <= stale;
}

/** Een getal uit een omgevingsvariabele (ms), of `fallback` als het geen geldig getal is. */
export function msSetting(raw, fallback) {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Het geluidsbericht voor één verbinding (zie sound.js), of null. `listening`:
 * deze verbinding vroeg om geluid (`{ t: 'listen', on: true }`).
 */
export function soundMessage(state, playerId, listening, now = Date.now()) {
  return sound.soundMessage(state, playerId, listening, now);
}

/** Een meeluisterende speler meldt dat start `n` niet speelt; true als de host een vers adres moet vragen. */
export function soundFailed(state, playerId, n) {
  if (!state.players.some((p) => p.id === playerId) || playerId === state.hostId) return false;
  return sound.reportFailed(state, Number(n));
}

export function errorPayload(err) {
  if (err instanceof GameError) return { t: 'error', code: err.code, message: err.message };
  return { t: 'error', code: 'SERVER', message: 'Er liep iets mis op de server.' };
}

export { GameError };
