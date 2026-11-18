// Geluid op meer toestellen, alleen als de host met fragmenten van Deezer
// speelt. Zuivere functies, zoals de spelregels: de klok (`now`) komt van de
// server en is de enige klok die hier telt.
//
// Hoe het loopt:
// - De browser van de host vraagt het adres van het fragment op bij Deezer
//   (dat deed hij al om zelf af te spelen) en stuurt het met
//   `{ t: 'sound', action: 'play', trackId, url }` naar de server. Ook pauze,
//   verder spelen en een vers adres gaan zo (`pause`, `resume`, `url`).
// - De server kijkt het adres streng na (alleen https, alleen de host van de
//   Deezer-fragmenten, begrensde lengte) en bewaart het bij het nummer van de
//   lopende beurt, met zijn eigen klok: wanneer het begon en waar het staat.
// - Alleen spelers die `{ t: 'listen', on: true }` stuurden (per verbinding)
//   krijgen een apart bericht `{ t: 'sound', sound: { n, url, playing, pos } }`:
//   geen track-ID, titel, artiest of jaar, en nooit in de gewone stand.
//   `pos` is de plaats in het fragment (in seconden) op het moment dat de
//   server het bericht maakt; de gsm telt daar zelf de tijd sinds ontvangst
//   bij. Zo worden nooit de klokken van twee toestellen vergeleken.
// - Een nieuwe beurt, een ander nummer of het einde van het spel maakt het
//   geluid ongeldig: het hoort bij één nummer.

import { GameError } from './rules.js';

/** Zo lang duurt een fragment van Deezer (de gsm rekent met de echte duur als die gekend is). */
export const FRAGMENT_SECONDS = 30;
/** Langste adres dat de server doorgeeft (een echt adres is zo'n 300 tekens). */
export const MAX_URL = 600;
/** Zo vaak per start mag een speler om een vers adres vragen (elke vraag kost de host een verzoek bij Deezer). */
export const MAX_REFRESH = 3;
/** De servers van de fragmenten bij Deezer, en geen andere. */
const PREVIEW_HOST = /^(cdnt-preview|cdns-preview-[0-9a-f])\.dzcdn\.net$/;

function fail(code, message) {
  throw new GameError(code, message);
}

/**
 * Het adres van een fragment, nagekeken; null als het niet deugt. Alleen
 * `https://` naar een server van de Deezer-fragmenten, zonder poort,
 * gebruikersnaam of `#`, hoogstens MAX_URL tekens en zonder spaties of
 * stuurtekens. Zo kan een host spelers geen willekeurig adres laten openen.
 */
export function checkPreviewUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_URL) return null;
  // Letterlijk zo beginnen: geen hoofdletters, backslashes of andere vormen die de URL-lezer wel zou aanvaarden.
  if (!/^https:\/\/[a-z0-9.-]+\//.test(raw)) return null;
  if (/[\s\u0000-\u001f\u007f-\u009f"'<>\\`]/.test(raw)) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !PREVIEW_HOST.test(u.hostname)) return null;
  if (u.port || u.username || u.password || u.hash) return null;
  if (u.href.length > MAX_URL) return null;
  return u.href;
}

/** Het nummer dat nu speelt (ook tijdens de onthulling), of null. */
export function currentCard(state) {
  if ((state.phase === 'playing' || state.phase === 'challenge') && state.turn) return state.turn.card.id;
  if (state.phase === 'reveal' && state.reveal) return state.reveal.card.id;
  return null;
}

/** Het geluid van het nummer dat nu speelt, of null (geen, of van een vorig nummer). */
export function currentSound(state) {
  const s = state.sound;
  return s && s.trackId === currentCard(state) ? s : null;
}

/** Waar het fragment staat op tijdstip `now` (ms, klok van de server), in seconden sinds het begin. */
export function positionAt(sound, now) {
  if (!sound.playing) return sound.offset;
  return sound.offset + Math.max(0, now - sound.anchor) / 1000;
}

/**
 * De host bedient het geluid voor de spelers die meeluisteren. `msg`:
 * `{ action: 'play' | 'url' | 'pause' | 'resume', trackId, url? }`. Alleen de
 * host, en alleen voor het nummer van de lopende beurt: een bericht voor een
 * vorig nummer (te laat aangekomen) doet niets.
 */
export function applySound(state, actorId, msg, now) {
  if (actorId !== state.hostId) fail('HOST_ONLY', 'Alleen de host kan dit doen.');
  const card = currentCard(state);
  if (!card) fail('BAD_PHASE', 'Er speelt nu geen nummer.');
  if (msg?.trackId !== card) return false;
  const action = msg.action;
  const s = currentSound(state);
  if (action === 'play' || action === 'url') {
    const url = checkPreviewUrl(msg.url);
    if (!url) fail('BAD_URL', 'Dat is geen adres van een fragment bij Deezer.');
    if (action === 'url') {
      // Een vers adres voor hetzelfde fragment (de handtekening verliep): de plaats blijft.
      if (!s) return false;
      s.url = url;
      s.stale = false;
      return true;
    }
    // `n` telt elke start in deze kamer, ook over nummers heen: zo ziet een gsm altijd dat het een nieuwe start is.
    state.soundSeq = (state.soundSeq ?? 0) + 1;
    state.sound = { trackId: card, url, n: state.soundSeq, playing: true, offset: 0, anchor: now, stale: false, refreshes: 0 };
    return true;
  }
  if (action === 'pause') {
    if (!s || !s.playing) return false;
    s.offset = positionAt(s, now);
    s.playing = false;
    s.anchor = now;
    return true;
  }
  if (action === 'resume') {
    if (!s || s.playing) return false;
    s.playing = true;
    s.anchor = now;
    return true;
  }
  fail('UNKNOWN', 'Onbekende actie.');
}

/**
 * Een speler die meeluistert, meldt dat het adres van start `n` bij hem niet
 * speelt (misschien verlopen). De host krijgt dat te zien (`stale`) en vraagt
 * een vers adres; hoogstens MAX_REFRESH keer per start.
 */
export function reportFailed(state, n) {
  const s = currentSound(state);
  if (!s || s.n !== n || s.stale || (s.refreshes ?? 0) >= MAX_REFRESH) return false;
  s.stale = true;
  s.refreshes = (s.refreshes ?? 0) + 1;
  return true;
}

/** Ruimt het geluid van een vorig nummer op. */
export function tidySound(state) {
  if (state.sound && !currentSound(state)) state.sound = null;
}

/** Wat de host van het geluid ziet (in zijn stand): of het er is, de start, en of iemand een vers adres vraagt. */
export function hostSound(state) {
  const s = currentSound(state);
  return s ? { n: s.n, playing: s.playing, stale: Boolean(s.stale), r: s.refreshes ?? 0 } : null;
}

/**
 * Het bericht voor één verbinding, of null als die niets krijgt: alleen een
 * speler (niet de host) die meeluistert. `sound: null` zegt dat er nu niets
 * te horen is.
 */
export function soundMessage(state, playerId, listening, now) {
  if (!listening || !playerId || playerId === state.hostId) return null;
  if (!state.players.some((p) => p.id === playerId)) return null;
  const s = currentSound(state);
  return {
    t: 'sound',
    sound: s ? { n: s.n, url: s.url, playing: s.playing, pos: Math.round(positionAt(s, now) * 1000) / 1000 } : null,
  };
}
