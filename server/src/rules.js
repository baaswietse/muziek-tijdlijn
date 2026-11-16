// Spelregels van Muziek-tijdlijn. Zuivere functies: geen netwerk, geen klok,
// geen opslag. De server (Node of Cloudflare) roept deze aan en is daarmee de
// enige autoriteit over de spelstatus.

export const LIMITS = {
  maxPlayers: 12,
  maxNameLength: 16,
  minTarget: 3,
  maxTarget: 20,
  defaultTarget: 10,
};

/** Fout met een code voor de client en een Nederlandse boodschap voor de speler. */
export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new GameError(code, message);
}

export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.maxNameLength);
  if (!name) fail('NAME_REQUIRED', 'Vul een naam in.');
  return name;
}

/** Fisher-Yates met een aangeleverde random-functie (0 <= r < 1). */
export function shuffle(items, random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Mag een kaart met dit jaar op positie `index` in de tijdlijn?
 * `index` = aantal kaarten dat ervoor ligt. Een gelijk jaar mag ervoor of erna.
 */
export function isCorrectPlacement(timeline, year, index) {
  const before = index > 0 ? timeline[index - 1].year : -Infinity;
  const after = index < timeline.length ? timeline[index].year : Infinity;
  return before <= year && year <= after;
}

export function createRoom({ code, now }) {
  return {
    v: 1,
    code,
    phase: 'lobby', // lobby | playing | reveal | finished
    settings: { target: LIMITS.defaultTarget },
    hostId: null,
    players: [], // volgorde = beurtvolgorde
    deck: [], // nog te spelen kaarten; de bovenste is de laatste
    used: [], // track-ID's die in deze kamer al gespeeld zijn
    turn: null, // { playerId, card, pendingIndex, number }
    turnCount: 0, // aantal beurten in het lopende spel
    reveal: null, // { playerId, card, index, correct }
    winnerIds: [],
    game: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function findPlayer(state, playerId) {
  return state.players.find((p) => p.id === playerId) ?? null;
}

function requirePlayer(state, playerId) {
  const player = findPlayer(state, playerId);
  if (!player) fail('NOT_IN_ROOM', 'Je zit niet (meer) in dit spel.');
  return player;
}

function requireHost(state, playerId) {
  requirePlayer(state, playerId);
  if (state.hostId !== playerId) fail('HOST_ONLY', 'Alleen de host kan dit doen.');
}

/** Voegt een speler toe. `id` en `token` komen van de server (willekeurig). */
export function addPlayer(state, { id, token, name }) {
  const clean = cleanName(name);
  if (state.players.length >= LIMITS.maxPlayers) {
    fail('ROOM_FULL', `Dit spel zit vol (maximaal ${LIMITS.maxPlayers} spelers).`);
  }
  const lower = clean.toLowerCase();
  if (state.players.some((p) => p.name.toLowerCase() === lower)) {
    fail('NAME_TAKEN', 'Die naam is al bezet in dit spel. Kies een andere.');
  }
  const player = { id, token, name: clean, timeline: [] };
  // Wie tijdens een spel instapt, krijgt meteen een startkaart en sluit
  // achteraan aan in de beurtvolgorde.
  if (state.phase === 'playing' || state.phase === 'reveal') {
    const card = state.deck.pop();
    if (!card) fail('DECK_EMPTY', 'De stapel is op; instappen kan pas bij het volgende spel.');
    state.used.push(card.id);
    player.timeline = [card];
  }
  state.players.push(player);
  if (!state.hostId) state.hostId = id;
  return player;
}

export function setSettings(state, actorId, { target }) {
  requireHost(state, actorId);
  if (state.phase !== 'lobby' && state.phase !== 'finished') {
    fail('BAD_PHASE', 'De instellingen kunnen alleen tussen twee spellen veranderen.');
  }
  const t = Math.round(Number(target));
  if (!Number.isFinite(t) || t < LIMITS.minTarget || t > LIMITS.maxTarget) {
    fail('BAD_SETTINGS', `Kies een doel tussen ${LIMITS.minTarget} en ${LIMITS.maxTarget} kaarten.`);
  }
  state.settings.target = t;
}

/**
 * Start een (nieuw) spel. `tracks` is de volledige lijst uit tracks.json.
 * Nummers die in deze kamer al gespeeld zijn komen pas terug als de rest op is.
 */
export function startGame(state, actorId, tracks, random) {
  requireHost(state, actorId);
  if (state.phase !== 'lobby' && state.phase !== 'finished') {
    fail('BAD_PHASE', 'Het spel is al bezig.');
  }
  const n = state.players.length;
  const needed = n + 1; // een startkaart per speler en minstens één beurt
  if (tracks.length < needed) {
    fail('NOT_ENOUGH_TRACKS', 'Er zijn te weinig nummers in tracks.json om te starten.');
  }
  const used = new Set(state.used);
  let fresh = tracks.filter((t) => !used.has(t.id));
  // Te weinig ongespeelde nummers voor een behoorlijk spel: begin opnieuw.
  if (fresh.length < Math.min(tracks.length, n * (state.settings.target + 2))) {
    fresh = tracks.slice();
    state.used = [];
  }
  state.deck = shuffle(fresh, random).map(toCard);
  for (const p of state.players) {
    const card = state.deck.pop();
    state.used.push(card.id);
    p.timeline = [card];
  }
  // Willekeurige startspeler; daarna gewoon de volgorde van de lijst.
  const first = Math.floor(random() * n);
  state.players = state.players.slice(first).concat(state.players.slice(0, first));
  state.game += 1;
  state.winnerIds = [];
  state.reveal = null;
  state.turn = null;
  state.turnCount = 0;
  state.phase = 'playing';
  beginTurn(state, state.players[0].id);
}

function toCard(t) {
  return { id: t.id, artist: t.artist, title: t.title, year: t.year };
}

/**
 * Trekt een kaart voor `playerId`. Is de stapel op, dan eindigt het spel.
 * `sameTurn`: een ander nummer binnen dezelfde beurt (telt niet als nieuwe beurt).
 */
function beginTurn(state, playerId, { sameTurn = false } = {}) {
  const card = state.deck.pop();
  if (!card) {
    finish(state, leaders(state));
    return;
  }
  state.used.push(card.id);
  if (!sameTurn) state.turnCount += 1;
  state.turn = { playerId, card, pendingIndex: null, number: state.turnCount };
  state.phase = 'playing';
}

function leaders(state) {
  const best = Math.max(0, ...state.players.map((p) => p.timeline.length));
  return state.players.filter((p) => p.timeline.length === best).map((p) => p.id);
}

function finish(state, winnerIds) {
  state.phase = 'finished';
  state.turn = null;
  state.winnerIds = winnerIds;
}

function nextPlayerId(state, afterId) {
  const i = state.players.findIndex((p) => p.id === afterId);
  return state.players[(i + 1) % state.players.length].id;
}

function requireActive(state, actorId) {
  requirePlayer(state, actorId);
  if (state.phase !== 'playing' || !state.turn) fail('BAD_PHASE', 'Er is nu geen nummer om te plaatsen.');
  if (state.turn.playerId !== actorId) fail('NOT_YOUR_TURN', 'Je bent niet aan de beurt.');
}

function checkIndex(state, index) {
  const player = findPlayer(state, state.turn.playerId);
  if (!Number.isInteger(index) || index < 0 || index > player.timeline.length) {
    fail('BAD_INDEX', 'Die plaats bestaat niet op je tijdlijn.');
  }
  return player;
}

/** De actieve speler duidt (voorlopig) een plaats aan; iedereen ziet dat live. */
export function selectSlot(state, actorId, index) {
  requireActive(state, actorId);
  if (index !== null) checkIndex(state, index);
  state.turn.pendingIndex = index;
}

/** De actieve speler legt de kaart definitief. */
export function placeCard(state, actorId, index) {
  requireActive(state, actorId);
  const player = checkIndex(state, index);
  const { card } = state.turn;
  const correct = isCorrectPlacement(player.timeline, card.year, index);
  if (correct) player.timeline.splice(index, 0, card);
  state.reveal = { playerId: player.id, card, index, correct };
  state.turn = null;
  state.phase = 'reveal';
  if (correct && player.timeline.length >= state.settings.target) {
    finish(state, [player.id]);
  }
}

/** Na de onthulling: door naar de volgende speler (actieve speler of host). */
export function nextTurn(state, actorId) {
  requirePlayer(state, actorId);
  if (state.phase !== 'reveal' || !state.reveal) fail('BAD_PHASE', 'Er valt nu niets door te geven.');
  if (actorId !== state.reveal.playerId && actorId !== state.hostId) {
    fail('NOT_ALLOWED', 'Alleen de speler die net speelde of de host kan doorgaan.');
  }
  const previous = state.reveal.playerId;
  // De vorige speler kan intussen verwijderd zijn; dan is de eerste aan de beurt.
  const nextId = findPlayer(state, previous) ? nextPlayerId(state, previous) : state.players[0].id;
  state.reveal = null;
  beginTurn(state, nextId);
}

/** Host: ander nummer voor dezelfde speler (bv. nummer speelt niet af). */
export function skipTrack(state, actorId) {
  requireHost(state, actorId);
  if (state.phase !== 'playing' || !state.turn) fail('BAD_PHASE', 'Er speelt nu geen nummer.');
  beginTurn(state, state.turn.playerId, { sameTurn: true });
}

/** Host: sla de beurt van de actieve speler over (bv. even weg). */
export function skipTurn(state, actorId) {
  requireHost(state, actorId);
  if (state.phase !== 'playing' || !state.turn) fail('BAD_PHASE', 'Er is nu geen beurt bezig.');
  beginTurn(state, nextPlayerId(state, state.turn.playerId));
}

/** Host: verwijder een speler uit het spel. */
export function removePlayer(state, actorId, targetId) {
  requireHost(state, actorId);
  if (targetId === state.hostId) fail('NOT_ALLOWED', 'De host kan zichzelf niet verwijderen.');
  const target = findPlayer(state, targetId);
  if (!target) fail('NOT_FOUND', 'Die speler zit niet in dit spel.');
  const wasActive = state.phase === 'playing' && state.turn?.playerId === targetId;
  const nextId = wasActive ? nextPlayerId(state, targetId) : null;
  state.players = state.players.filter((p) => p.id !== targetId);
  state.winnerIds = state.winnerIds.filter((id) => id !== targetId);
  if (wasActive) beginTurn(state, nextId, { sameTurn: true });
}

/** Host: stop het lopende spel en ga terug naar de wachtkamer. */
export function backToLobby(state, actorId) {
  requireHost(state, actorId);
  state.phase = 'lobby';
  state.turn = null;
  state.reveal = null;
  state.winnerIds = [];
  state.deck = [];
  for (const p of state.players) p.timeline = [];
}

/**
 * Wat één speler mag zien. Het antwoord (track-ID, artiest, titel, jaar) van
 * het lopende nummer zit hier niet in; enkel de host krijgt het track-ID,
 * omdat zijn gsm Spotify moet aansturen.
 */
export function viewFor(state, playerId, online = new Set()) {
  const isHost = playerId === state.hostId;
  return {
    code: state.code,
    phase: state.phase,
    game: state.game,
    settings: { ...state.settings },
    you: playerId,
    hostId: state.hostId,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      online: online.has(p.id),
      timeline: p.timeline.map((c) => ({ ...c })),
    })),
    deckLeft: state.deck.length,
    turn: state.turn
      ? {
          playerId: state.turn.playerId,
          number: state.turn.number,
          pendingIndex: state.turn.pendingIndex,
          ...(isHost ? { trackId: state.turn.card.id } : {}),
        }
      : null,
    reveal: state.reveal
      ? {
          playerId: state.reveal.playerId,
          card: { ...state.reveal.card },
          index: state.reveal.index,
          correct: state.reveal.correct,
        }
      : null,
    winnerIds: state.winnerIds.slice(),
  };
}
