// Spelregels van Muziek-tijdlijn. Zuivere functies: geen netwerk, geen klok,
// geen opslag. De server (Node of Cloudflare) roept deze aan en is daarmee de
// enige autoriteit over de spelstatus.

export const LIMITS = {
  maxPlayers: 12,
  maxNameLength: 16,
  minTarget: 3,
  maxTarget: 20,
  defaultTarget: 10,
  // Een eigen lijst van de host (gekozen playlist).
  minDeck: 10,
  maxDeck: 500,
  maxDeckName: 60,
  // Tokens waarmee elke speler een spel begint (ook wie laat instapt).
  startTokens: 2,
  // Zoveel tokens kost het om op je eigen beurt de kaart te kopen.
  buyCost: 3,
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
    phase: 'lobby', // lobby | playing | challenge | reveal | finished
    settings: { target: LIMITS.defaultTarget },
    hostId: null,
    players: [], // volgorde = beurtvolgorde
    deck: [], // nog te spelen kaarten; de bovenste is de laatste
    custom: null, // eigen lijst van de host: { name, tracks }, anders de standaardlijst
    used: [], // track-ID's die in deze kamer al gespeeld zijn
    // Tijdens `challenge` ook placedIndex (vastgelegde plaats), bets: [{ playerId, index }]
    // en passes: [playerId] (wie bevestigde deze beurt geen token in te zetten).
    turn: null, // { playerId, card, pendingIndex, number }
    turnCount: 0, // aantal beurten in het lopende spel
    // Na ingezette tokens ook bets: [{ playerId, index, correct }] en cardTo;
    // na een gekochte kaart bought: true.
    reveal: null, // { playerId, card, index, correct, guessTokenTo? }
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
  // `token` is het geheime sleuteltje van de speler; `guessTokens` telt zijn
  // tokens: de starttokens plus wat hij verdiende met het raden van artiest en
  // nummer, min wat hij inzette. Wie in de wachtkamer binnenkomt, krijgt ze ook
  // al (startGame zet ze toch opnieuw), zodat er nergens een ander getal staat.
  const player = { id, token, name: clean, timeline: [], guessTokens: LIMITS.startTokens };
  // Wie tijdens een spel instapt, krijgt meteen een startkaart en sluit
  // achteraan aan in de beurtvolgorde.
  if (state.phase === 'playing' || state.phase === 'challenge' || state.phase === 'reveal') {
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
 * Host: speel met een eigen lijst (een playlist die hij koos). `tracks` is al
 * nagekeken door normaliseTracks. De lijst blijft op de server; spelers zien
 * alleen de naam en het aantal nummers.
 */
export function setDeck(state, actorId, { name, tracks }) {
  requireHost(state, actorId);
  if (state.phase !== 'lobby' && state.phase !== 'finished') {
    fail('BAD_PHASE', 'De lijst met nummers kan alleen tussen twee spellen veranderen.');
  }
  if (!Array.isArray(tracks) || tracks.length < LIMITS.minDeck) {
    fail('DECK_TOO_SMALL', `Een lijst heeft minstens ${LIMITS.minDeck} nummers met een jaartal nodig.`);
  }
  if (tracks.length > LIMITS.maxDeck) {
    fail('DECK_TOO_LARGE', `Een lijst mag hoogstens ${LIMITS.maxDeck} nummers hebben.`);
  }
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxDeckName) || 'Eigen lijst';
  state.custom = { name: clean, tracks: tracks.map(toCard) };
}

/** Host: terug naar de standaardlijst. */
export function clearDeck(state, actorId) {
  requireHost(state, actorId);
  if (state.phase !== 'lobby' && state.phase !== 'finished') {
    fail('BAD_PHASE', 'De lijst met nummers kan alleen tussen twee spellen veranderen.');
  }
  state.custom = null;
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
    p.guessTokens = LIMITS.startTokens;
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

/**
 * De actieve speler legt de kaart definitief. Heeft een andere speler een
 * token, dan volgt eerst de fase `challenge` waarin anderen kunnen inzetten;
 * anders meteen de onthulling, zodat het basisspel even vlot blijft.
 */
export function placeCard(state, actorId, index) {
  requireActive(state, actorId);
  const player = checkIndex(state, index);
  const canChallenge = state.players.some((p) => p.id !== player.id && (p.guessTokens ?? 0) > 0);
  if (canChallenge) {
    state.turn.pendingIndex = index;
    state.turn.placedIndex = index;
    state.turn.bets = [];
    state.turn.passes = [];
    state.phase = 'challenge';
    return;
  }
  resolveTurn(state, index, []);
}

/**
 * Kan `player` nu de kaart kopen? Geeft null als het mag, anders een fout
 * (code en boodschap). De kaart die het doel haalt, koop je niet: die moet je
 * verdienen door juist te leggen. Bij een doel van 10 kan je dus kopen tot en
 * met je 9e kaart (met 8 kaarten), niet je 10e.
 */
export function buyBlock(state, player) {
  const cost = LIMITS.buyCost;
  const have = player.guessTokens ?? 0;
  if (have < cost) return { code: 'NO_TOKEN', message: `Een kaart kopen kost ${cost} tokens; je hebt er ${have}.` };
  const target = state.settings.target;
  if (player.timeline.length >= target - 1) {
    return {
      code: 'LAST_CARD',
      message: `Je laatste kaart (de ${target}e) kan je niet kopen: die moet je verdienen door juist te leggen.`,
    };
  }
  return null;
}

/**
 * De speler aan beurt koopt de kaart van het nummer dat nu speelt, voor hij een
 * plaats bevestigt. Ze komt meteen juist op zijn tijdlijn; er komt geen
 * tussenfase (tegen een gekochte kaart kan niemand inzetten), wel de gewone
 * onthulling, waarbij het raad-token nog gegeven kan worden.
 */
export function buyCard(state, actorId) {
  requireActive(state, actorId);
  const player = findPlayer(state, actorId);
  const block = buyBlock(state, player);
  if (block) fail(block.code, block.message);
  const { card } = state.turn;
  player.guessTokens -= LIMITS.buyCost;
  const index = slotFor(player.timeline, card.year);
  player.timeline.splice(index, 0, card);
  state.reveal = { playerId: player.id, card, index, correct: true, bought: true };
  state.turn = null;
  state.phase = 'reveal';
  // Kan niet: kopen gaat alleen tot één kaart voor het doel. Voor de zekerheid.
  if (player.timeline.length >= state.settings.target) finish(state, [player.id]);
}

/** Waar `year` juist ligt in een gesorteerde tijdlijn (na gelijke jaren). */
function slotFor(timeline, year) {
  let i = 0;
  while (i < timeline.length && timeline[i].year <= year) i++;
  return i;
}

/**
 * Onthult de beurt. Ligt de actieve speler juist, dan houdt hij de kaart en
 * zijn alle inzetten verloren. Ligt hij fout, dan gaat de kaart naar de eerste
 * inzetter (in volgorde van inzetten) die wel juist lag, op de juiste plaats in
 * zijn eigen tijdlijn. Ingezette tokens zijn altijd verbruikt.
 */
function resolveTurn(state, index, bets) {
  const player = findPlayer(state, state.turn.playerId);
  const { card } = state.turn;
  // Alles beoordelen op de tijdlijn zoals ze lag, vóór er iets bijkomt.
  const correct = isCorrectPlacement(player.timeline, card.year, index);
  const results = bets.map((b) => ({
    playerId: b.playerId,
    index: b.index,
    correct: isCorrectPlacement(player.timeline, card.year, b.index),
  }));
  let receiver = null;
  if (correct) {
    receiver = player;
    player.timeline.splice(index, 0, card);
  } else {
    const hit = results.find((r) => r.correct && findPlayer(state, r.playerId));
    if (hit) {
      receiver = findPlayer(state, hit.playerId);
      receiver.timeline.splice(slotFor(receiver.timeline, card.year), 0, card);
    }
  }
  // `guessTokenTo` komt er pas bij als iemand het token van deze beurt krijgt;
  // `bets` en `cardTo` alleen als er tokens ingezet werden.
  state.reveal = { playerId: player.id, card, index, correct };
  if (results.length) {
    state.reveal.bets = results;
    state.reveal.cardTo = receiver ? receiver.id : null;
  }
  state.turn = null;
  state.phase = 'reveal';
  // Dezelfde winstregel als bij een gewone beurt, voor wie de kaart kreeg.
  if (receiver && receiver.timeline.length >= state.settings.target) {
    finish(state, [receiver.id]);
  }
}

/** Aantal plaatsen op de tijdlijn van de speler aan beurt waar nog niemand ligt. */
function freeSlots(state) {
  const active = findPlayer(state, state.turn.playerId);
  // Alle plaatsen, min die van de speler aan beurt, min de ingezette.
  return (active?.timeline.length ?? 0) + 1 - 1 - state.turn.bets.length;
}

/**
 * Tijdens `challenge`: op wie wacht het onthullen nog? Op elke andere speler
 * die nu kán inzetten: minstens 1 token, nog niet ingezet of gepast, en er is
 * nog een vrije plaats. `online` (Set met speler-ID's) laat wie niet verbonden
 * is buiten beschouwing, zodat niemand het spel blokkeert door weg te vallen;
 * komt hij terug voor de onthulling, dan moet hij weer kiezen. Zonder `online`
 * telt iedereen mee.
 */
export function waitingFor(state, online = null) {
  if (state.phase !== 'challenge' || !state.turn) return [];
  const { turn } = state;
  if (freeSlots(state) < 1) return [];
  const passes = turn.passes ?? []; // kamers van voor het passen kennen het veld niet
  return state.players
    .filter(
      (p) =>
        p.id !== turn.playerId &&
        (p.guessTokens ?? 0) > 0 &&
        !turn.bets.some((b) => b.playerId === p.id) &&
        !passes.includes(p.id) &&
        (!online || online.has(p.id)),
    )
    .map((p) => p.id);
}

/**
 * Tijdens `challenge`: een andere speler zet een token in op een andere, nog
 * vrije plaats op de tijdlijn van de speler aan beurt. Kost meteen 1 token en
 * is definitief; wie eerst inzet, heeft de plaats.
 */
export function placeBet(state, actorId, index) {
  const actor = requirePlayer(state, actorId);
  if (state.phase !== 'challenge' || !state.turn) fail('BAD_PHASE', 'Je kan nu geen token inzetten.');
  const { turn } = state;
  if (actorId === turn.playerId) fail('NOT_ALLOWED', 'Op je eigen beurt kan je geen token inzetten.');
  if (turn.bets.some((b) => b.playerId === actorId)) fail('ALREADY_BET', 'Je zette deze beurt al een token in.');
  if ((turn.passes ?? []).includes(actorId)) fail('PASSED', 'Je koos al om deze beurt geen token in te zetten.');
  if ((actor.guessTokens ?? 0) < 1) fail('NO_TOKEN', 'Je hebt geen token om in te zetten.');
  const active = findPlayer(state, turn.playerId);
  if (!Number.isInteger(index) || index < 0 || index > active.timeline.length) {
    fail('BAD_INDEX', 'Die plaats bestaat niet op die tijdlijn.');
  }
  if (index === turn.placedIndex || turn.bets.some((b) => b.index === index)) {
    fail('SLOT_TAKEN', 'Die plaats is al bezet. Kies een andere.');
  }
  actor.guessTokens -= 1;
  turn.bets.push({ playerId: actorId, index });
}

/**
 * Tijdens `challenge`: een andere speler bevestigt dat hij deze beurt geen
 * token inzet. Dat is definitief voor deze beurt; nog eens verandert niets.
 */
export function passBet(state, actorId) {
  requirePlayer(state, actorId);
  if (state.phase !== 'challenge' || !state.turn) fail('BAD_PHASE', 'Er valt nu niets te kiezen.');
  const { turn } = state;
  if (actorId === turn.playerId) fail('NOT_ALLOWED', 'Op je eigen beurt zet je geen token in.');
  if (turn.bets.some((b) => b.playerId === actorId)) fail('ALREADY_BET', 'Je zette deze beurt al een token in.');
  turn.passes = turn.passes ?? [];
  if (!turn.passes.includes(actorId)) turn.passes.push(actorId);
}

/**
 * Einde van de fase `challenge`: de speler aan beurt of de host onthult, maar
 * pas als iedereen die kan inzetten gekozen heeft (zie waitingFor). Wacht het
 * spel nog op iemand die verbonden is maar niet reageert, dan kan alleen de
 * host toch onthullen, met `force`.
 */
export function revealTurn(state, actorId, { online = null, force = false } = {}) {
  requirePlayer(state, actorId);
  if (state.phase !== 'challenge' || !state.turn) fail('BAD_PHASE', 'Er valt nu niets te onthullen.');
  if (actorId !== state.turn.playerId && actorId !== state.hostId) {
    fail('NOT_ALLOWED', 'Alleen de speler aan beurt of de host kan onthullen.');
  }
  const waiting = waitingFor(state, online);
  if (waiting.length && !force) {
    const names = waiting.map((id) => findPlayer(state, id).name).join(', ');
    fail('WAITING', `Nog niet iedereen koos of hij een token inzet. We wachten op ${names}.`);
  }
  if (waiting.length && actorId !== state.hostId) {
    fail('HOST_ONLY', 'Alleen de host kan onthullen terwijl er nog op iemand gewacht wordt.');
  }
  resolveTurn(state, state.turn.placedIndex, state.turn.bets);
}

/** De beurt telt niet (overgeslagen, speler weg): ingezette tokens gaan terug. */
function refundBets(state) {
  for (const b of state.turn?.bets ?? []) {
    const p = findPlayer(state, b.playerId);
    if (p) p.guessTokens = (p.guessTokens ?? 0) + 1;
  }
}

const turnRunning = (state) => (state.phase === 'playing' || state.phase === 'challenge') && state.turn;

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
  if (!turnRunning(state)) fail('BAD_PHASE', 'Er speelt nu geen nummer.');
  refundBets(state);
  beginTurn(state, state.turn.playerId, { sameTurn: true });
}

/** Host: sla de beurt van de actieve speler over (bv. even weg). */
export function skipTurn(state, actorId) {
  requireHost(state, actorId);
  if (!turnRunning(state)) fail('BAD_PHASE', 'Er is nu geen beurt bezig.');
  refundBets(state);
  beginTurn(state, nextPlayerId(state, state.turn.playerId));
}

/** Host: verwijder een speler uit het spel. */
export function removePlayer(state, actorId, targetId) {
  requireHost(state, actorId);
  if (targetId === state.hostId) fail('NOT_ALLOWED', 'De host kan zichzelf niet verwijderen.');
  const target = findPlayer(state, targetId);
  if (!target) fail('NOT_FOUND', 'Die speler zit niet in dit spel.');
  const wasActive = turnRunning(state) && state.turn.playerId === targetId;
  const nextId = wasActive ? nextPlayerId(state, targetId) : null;
  // Is de speler aan beurt weg, dan telt de beurt niet: inzetters krijgen hun
  // token terug. Een inzetter die weg moet, verliest gewoon zijn inzet.
  if (wasActive) refundBets(state);
  else if (state.phase === 'challenge' && state.turn) {
    state.turn.bets = state.turn.bets.filter((b) => b.playerId !== targetId);
    if (state.turn.passes) state.turn.passes = state.turn.passes.filter((id) => id !== targetId);
  }
  state.players = state.players.filter((p) => p.id !== targetId);
  state.winnerIds = state.winnerIds.filter((id) => id !== targetId);
  // Had die speler het token van deze onthulling, dan vervalt het mee.
  if (state.reveal?.guessTokenTo === targetId) state.reveal.guessTokenTo = null;
  if (wasActive) beginTurn(state, nextId, { sameTurn: true });
}

/**
 * Tijdens de onthulling: geef het token van deze beurt aan wie artiest en
 * nummer als eerste juist raadde (dat gebeurt hardop aan tafel). Per beurt is
 * er hoogstens één token: een andere speler kiezen verplaatst het, `null`
 * neemt het terug. De host en de speler aan beurt mogen alles (dezelfden als
 * bij "volgende beurt": vaak tikt de speler aan beurt zelf meteen door); wie
 * zelf raadde, kan het voor zichzelf opeisen.
 * Ook na de beslissende kaart (fase `finished`, de onthulling blijft dan
 * zichtbaar) kan het token nog gegeven worden.
 */
export function giveToken(state, actorId, targetId) {
  requirePlayer(state, actorId);
  const open = state.reveal && (state.phase === 'reveal' || state.phase === 'finished');
  if (!open) fail('BAD_PHASE', 'Een token geven kan alleen tijdens de onthulling.');
  const target = targetId ? findPlayer(state, targetId) : null;
  if (targetId && !target) fail('NOT_FOUND', 'Die speler zit niet in dit spel.');
  const previous = state.reveal.guessTokenTo ?? null;
  if (previous === (target?.id ?? null)) return;
  // Wie zelf raadde, mag het token voor zichzelf opeisen zolang niemand het
  // heeft, en het weer teruggeven. Afnemen of doorgeven kan hij niet.
  const full = actorId === state.reveal.playerId || actorId === state.hostId;
  if (!full) {
    const claim = target?.id === actorId && previous === null;
    const giveBack = target === null && previous === actorId;
    if (!claim && !giveBack) {
      fail(
        'NOT_ALLOWED',
        previous && previous !== actorId
          ? 'Het token van deze beurt is al aan iemand anders gegeven.'
          : 'Je kan het token alleen voor jezelf opeisen; de host of de speler aan beurt kan het aan iemand anders geven.',
      );
    }
  }
  // Wie het token had (en nog meespeelt), geeft het terug.
  const old = previous ? findPlayer(state, previous) : null;
  if (old) old.guessTokens = Math.max(0, (old.guessTokens ?? 0) - 1);
  if (target) target.guessTokens = (target.guessTokens ?? 0) + 1;
  state.reveal.guessTokenTo = target?.id ?? null;
}

/** Host: stop het lopende spel en ga terug naar de wachtkamer. */
export function backToLobby(state, actorId) {
  requireHost(state, actorId);
  state.phase = 'lobby';
  state.turn = null;
  state.reveal = null;
  state.winnerIds = [];
  state.deck = [];
  for (const p of state.players) {
    p.timeline = [];
    p.guessTokens = LIMITS.startTokens;
  }
}

/**
 * Wat één speler mag zien. `online` = wie nu verbonden is (ook voor wie in de
 * tussenfase nog moet kiezen). Het antwoord (track-ID, artiest, titel, jaar) van
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
      // Oudere opgeslagen kamers kennen het veld nog niet: dat telt als 0.
      guessTokens: p.guessTokens ?? 0,
    })),
    deckLeft: state.deck.length,
    // Welke lijst er gespeeld wordt; de nummers zelf gaan niet mee.
    playlist: state.custom ? { name: state.custom.name, count: state.custom.tracks.length } : null,
    turn: state.turn
      ? {
          playerId: state.turn.playerId,
          number: state.turn.number,
          pendingIndex: state.turn.pendingIndex,
          // Tijdens `challenge`: de vastgelegde plaats, wie waar inzette, wie
          // bevestigde geen token in te zetten en op wie het onthullen nog wacht.
          ...(state.phase === 'challenge'
            ? {
                placedIndex: state.turn.placedIndex,
                bets: state.turn.bets.map((b) => ({ ...b })),
                passes: (state.turn.passes ?? []).slice(),
                waiting: waitingFor(state, online),
              }
            : {}),
          ...(isHost ? { trackId: state.turn.card.id } : {}),
        }
      : null,
    reveal: state.reveal
      ? {
          playerId: state.reveal.playerId,
          card: { ...state.reveal.card },
          index: state.reveal.index,
          correct: state.reveal.correct,
          guessTokenTo: state.reveal.guessTokenTo ?? null,
          bought: Boolean(state.reveal.bought),
          bets: (state.reveal.bets ?? []).map((b) => ({ ...b })),
          cardTo: state.reveal.cardTo !== undefined ? state.reveal.cardTo : state.reveal.correct ? state.reveal.playerId : null,
        }
      : null,
    winnerIds: state.winnerIds.slice(),
  };
}
