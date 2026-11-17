import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../../server/src/rules.js';
import { GameError } from '../../server/src/rules.js';
import * as room from '../../server/src/room.js';
import { normaliseTracks } from '../../server/src/tracks.js';

function makeTracks(n, startYear = 1960) {
  return Array.from({ length: n }, (_, i) => ({
    id: `track${String(i).padStart(3, '0')}`,
    artist: `Artiest ${i}`,
    title: `Titel ${i}`,
    year: startYear + i,
  }));
}

/** Voorspelbare "random": altijd 0, dus shuffle wordt een vaste permutatie. */
const zero = () => 0;

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function newRoom(names = ['Ann', 'Bob', 'Cas']) {
  const state = rules.createRoom({ code: 'TEST', now: 0 });
  names.forEach((name, i) => rules.addPlayer(state, { id: `p${i}`, token: `token-${i}-xxxxxxxx`, name }));
  return state;
}

function throwsCode(fn, code) {
  assert.throws(fn, (err) => err instanceof GameError && err.code === code, `verwacht fout ${code}`);
}

/** Index waarop de lopende kaart juist ligt voor de actieve speler. */
function correctIndex(state) {
  const p = rules.findPlayer(state, state.turn.playerId);
  const y = state.turn.card.year;
  let i = 0;
  while (i < p.timeline.length && p.timeline[i].year <= y) i++;
  return i;
}

function wrongIndex(state) {
  const p = rules.findPlayer(state, state.turn.playerId);
  for (let i = 0; i <= p.timeline.length; i++) {
    if (!rules.isCorrectPlacement(p.timeline, state.turn.card.year, i)) return i;
  }
  return null;
}

/** Tokens waarmee iedereen een spel begint. */
const S = rules.LIMITS.startTokens;

/**
 * De speler aan beurt legt de kaart. Komt er een tussenfase (een ander heeft
 * nog tokens), dan zet niemand in en onthult de speler aan beurt zelf.
 */
function placeAndReveal(state, index) {
  const active = state.turn.playerId;
  rules.placeCard(state, active, index);
  if (state.phase === 'challenge') rules.revealTurn(state, active);
}

test('isCorrectPlacement: randen, midden en gelijke jaren', () => {
  const tl = [{ year: 1970 }, { year: 1980 }, { year: 1980 }, { year: 1990 }];
  assert.equal(rules.isCorrectPlacement(tl, 1960, 0), true);
  assert.equal(rules.isCorrectPlacement(tl, 1975, 0), false);
  assert.equal(rules.isCorrectPlacement(tl, 1975, 1), true);
  assert.equal(rules.isCorrectPlacement(tl, 1995, 4), true);
  assert.equal(rules.isCorrectPlacement(tl, 1985, 4), false);
  // gelijk jaar: ervoor, ertussen en erna zijn allemaal juist
  assert.equal(rules.isCorrectPlacement(tl, 1980, 1), true);
  assert.equal(rules.isCorrectPlacement(tl, 1980, 2), true);
  assert.equal(rules.isCorrectPlacement(tl, 1980, 3), true);
  assert.equal(rules.isCorrectPlacement(tl, 1980, 0), false);
  assert.equal(rules.isCorrectPlacement(tl, 1980, 4), false);
  assert.equal(rules.isCorrectPlacement([], 2000, 0), true);
});

test('spelers toevoegen: eerste is host, namen uniek en opgeschoond', () => {
  const state = newRoom(['  Ann  ', 'Bob']);
  assert.equal(state.hostId, 'p0');
  assert.equal(state.players[0].name, 'Ann');
  throwsCode(() => rules.addPlayer(state, { id: 'x', token: 't', name: 'ann' }), 'NAME_TAKEN');
  throwsCode(() => rules.addPlayer(state, { id: 'x', token: 't', name: '   ' }), 'NAME_REQUIRED');
  const long = rules.addPlayer(state, { id: 'y', token: 't', name: 'x'.repeat(50) });
  assert.equal(long.name.length, rules.LIMITS.maxNameLength);
});

test('kamer zit vol na het maximum aantal spelers', () => {
  const state = rules.createRoom({ code: 'TEST', now: 0 });
  for (let i = 0; i < rules.LIMITS.maxPlayers; i++) {
    rules.addPlayer(state, { id: `p${i}`, token: `t${i}`, name: `Speler ${i}` });
  }
  throwsCode(() => rules.addPlayer(state, { id: 'z', token: 't', name: 'Teveel' }), 'ROOM_FULL');
});

test('start: alleen host, iedereen één startkaart, eerste beurt loopt', () => {
  const state = newRoom();
  const tracks = makeTracks(30);
  throwsCode(() => rules.startGame(state, 'p1', tracks, zero), 'HOST_ONLY');
  rules.startGame(state, 'p0', tracks, seeded(7));
  assert.equal(state.phase, 'playing');
  assert.equal(state.game, 1);
  for (const p of state.players) assert.equal(p.timeline.length, 1);
  // Iedereen begint met 2 tokens.
  assert.equal(S, 2);
  for (const p of state.players) assert.equal(p.guessTokens, 2);
  assert.ok(state.turn.card);
  assert.equal(state.turn.number, 1);
  assert.equal(state.deck.length, 30 - 3 - 1);
  // geen kaart twee keer uitgedeeld
  const ids = [...state.players.map((p) => p.timeline[0].id), state.turn.card.id, ...state.deck.map((c) => c.id)];
  assert.equal(new Set(ids).size, 30);
  throwsCode(() => rules.startGame(state, 'p0', tracks, zero), 'BAD_PHASE');
});

test('start faalt met te weinig nummers', () => {
  const state = newRoom();
  throwsCode(() => rules.startGame(state, 'p0', makeTracks(3), zero), 'NOT_ENOUGH_TRACKS');
});

test('juist plaatsen: kaart blijft, onthulling, daarna volgende speler', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(3));
  const active = state.turn.playerId;
  const card = state.turn.card;
  const other = state.players.find((p) => p.id !== active).id;
  throwsCode(() => rules.placeCard(state, other, 0), 'NOT_YOUR_TURN');
  throwsCode(() => rules.placeCard(state, active, 5), 'BAD_INDEX');
  throwsCode(() => rules.placeCard(state, active, 0.5), 'BAD_INDEX');
  const idx = correctIndex(state);
  rules.placeCard(state, active, idx);
  // De anderen hebben hun starttokens: eerst de tussenfase, dan de onthulling.
  assert.equal(state.phase, 'challenge');
  assert.equal(state.reveal, null);
  rules.revealTurn(state, active);
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.reveal, { playerId: active, card, index: idx, correct: true });
  const tl = rules.findPlayer(state, active).timeline;
  assert.equal(tl.length, 2);
  assert.ok(tl[0].year <= tl[1].year, 'tijdlijn blijft gesorteerd');
  // doorgaan: de speler zelf of de host, niemand anders
  const third = state.players.find((p) => p.id !== active && p.id !== state.hostId);
  if (third) throwsCode(() => rules.nextTurn(state, third.id), 'NOT_ALLOWED');
  rules.nextTurn(state, active);
  assert.equal(state.phase, 'playing');
  assert.equal(state.reveal, null);
  const order = state.players.map((p) => p.id);
  assert.equal(state.turn.playerId, order[(order.indexOf(active) + 1) % order.length]);
  assert.equal(state.turn.number, 2);
});

test('fout plaatsen: kaart is weg, tijdlijn onveranderd', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(5));
  const active = state.turn.playerId;
  const before = rules.findPlayer(state, active).timeline.slice();
  const idx = wrongIndex(state);
  assert.notEqual(idx, null);
  placeAndReveal(state, idx);
  assert.equal(state.reveal.correct, false);
  assert.deepEqual(rules.findPlayer(state, active).timeline, before);
  rules.nextTurn(state, state.hostId);
  assert.equal(state.phase, 'playing');
});

test('voorlopige keuze is zichtbaar en alleen voor de actieve speler', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(9));
  const active = state.turn.playerId;
  const other = state.players.find((p) => p.id !== active).id;
  throwsCode(() => rules.selectSlot(state, other, 0), 'NOT_YOUR_TURN');
  rules.selectSlot(state, active, 1);
  assert.equal(rules.viewFor(state, other).turn.pendingIndex, 1);
  rules.selectSlot(state, active, null);
  assert.equal(state.turn.pendingIndex, null);
  throwsCode(() => rules.selectSlot(state, active, 9), 'BAD_INDEX');
});

test('wie het doel haalt, wint meteen', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.setSettings(state, 'p0', { target: 3 });
  rules.startGame(state, 'p0', makeTracks(40), seeded(11));
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 100) {
    placeAndReveal(state, correctIndex(state));
    if (state.phase === 'reveal') rules.nextTurn(state, state.hostId);
  }
  assert.equal(state.phase, 'finished');
  assert.equal(state.winnerIds.length, 1);
  assert.equal(rules.findPlayer(state, state.winnerIds[0]).timeline.length, 3);
  assert.ok(state.reveal.correct, 'laatste onthulling blijft zichtbaar');
  throwsCode(() => rules.nextTurn(state, state.hostId), 'BAD_PHASE');
});

test('stapel op: wie de meeste kaarten heeft wint (gelijkstand kan)', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.startGame(state, 'p0', makeTracks(5), seeded(2)); // 2 startkaarten + 3 beurten
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 20) {
    placeAndReveal(state, wrongIndex(state) ?? 0);
    if (state.phase === 'reveal') rules.nextTurn(state, state.hostId);
  }
  assert.equal(state.phase, 'finished');
  assert.ok(state.winnerIds.length >= 1);
  const best = Math.max(...state.players.map((p) => p.timeline.length));
  for (const id of state.winnerIds) assert.equal(rules.findPlayer(state, id).timeline.length, best);
});

test('instappen tijdens het spel: startkaart en achteraan in de volgorde', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.startGame(state, 'p0', makeTracks(30), seeded(4));
  const deckBefore = state.deck.length;
  const late = rules.addPlayer(state, { id: 'late', token: 'token-late-xxxx', name: 'Laat' });
  assert.equal(late.timeline.length, 1);
  assert.equal(state.deck.length, deckBefore - 1);
  assert.equal(state.players.at(-1).id, 'late');
});

test('host kan nummer of beurt overslaan en spelers verwijderen', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(6));
  const active = state.turn.playerId;
  const firstCard = state.turn.card.id;
  const notHost = state.players.find((p) => p.id !== 'p0').id;
  throwsCode(() => rules.skipTrack(state, notHost), 'HOST_ONLY');
  rules.skipTrack(state, 'p0');
  assert.equal(state.turn.playerId, active);
  assert.notEqual(state.turn.card.id, firstCard);
  assert.equal(state.turn.number, 1);
  rules.skipTurn(state, 'p0');
  assert.notEqual(state.turn.playerId, active);
  assert.equal(state.turn.number, 2);
  // actieve speler verwijderen: beurt gaat door naar de volgende
  const nowActive = state.turn.playerId;
  if (nowActive !== 'p0') {
    rules.removePlayer(state, 'p0', nowActive);
    assert.equal(rules.findPlayer(state, nowActive), null);
    assert.notEqual(state.turn.playerId, nowActive);
    assert.equal(state.phase, 'playing');
  }
  throwsCode(() => rules.removePlayer(state, 'p0', 'p0'), 'NOT_ALLOWED');
  throwsCode(() => rules.removePlayer(state, 'p0', 'bestaat-niet'), 'NOT_FOUND');
});

test('speler verwijderen tijdens de onthulling breekt de beurtvolgorde niet', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(8));
  // zorg dat een niet-host aan de beurt is
  while (state.turn.playerId === 'p0') rules.skipTurn(state, 'p0');
  const active = state.turn.playerId;
  placeAndReveal(state, 0);
  rules.removePlayer(state, 'p0', active);
  rules.nextTurn(state, 'p0');
  assert.equal(state.phase, 'playing');
  assert.ok(rules.findPlayer(state, state.turn.playerId));
});

test('instellingen: alleen host, alleen tussen spellen, binnen de grenzen', () => {
  const state = newRoom();
  throwsCode(() => rules.setSettings(state, 'p1', { target: 5 }), 'HOST_ONLY');
  throwsCode(() => rules.setSettings(state, 'p0', { target: 1 }), 'BAD_SETTINGS');
  throwsCode(() => rules.setSettings(state, 'p0', { target: 'abc' }), 'BAD_SETTINGS');
  rules.setSettings(state, 'p0', { target: 7 });
  assert.equal(state.settings.target, 7);
  rules.startGame(state, 'p0', makeTracks(30), zero);
  throwsCode(() => rules.setSettings(state, 'p0', { target: 5 }), 'BAD_PHASE');
});

test('een tweede spel in dezelfde kamer herhaalt geen nummers zolang er genoeg zijn', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.setSettings(state, 'p0', { target: 3 });
  const tracks = makeTracks(60);
  rules.startGame(state, 'p0', tracks, seeded(21));
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 100) {
    placeAndReveal(state, correctIndex(state));
    if (state.phase === 'reveal') rules.nextTurn(state, state.hostId);
  }
  const usedFirst = new Set(state.used);
  rules.startGame(state, 'p0', tracks, seeded(22));
  assert.equal(state.game, 2);
  const dealt = [...state.players.map((p) => p.timeline[0].id), state.turn.card.id, ...state.deck.map((c) => c.id)];
  for (const id of dealt) assert.ok(!usedFirst.has(id), `nummer ${id} werd herhaald`);
});

test('terug naar de wachtkamer wist tijdlijnen en beurt', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(1));
  throwsCode(() => rules.backToLobby(state, 'p1'), 'HOST_ONLY');
  rules.backToLobby(state, 'p0');
  assert.equal(state.phase, 'lobby');
  assert.equal(state.turn, null);
  for (const p of state.players) assert.equal(p.timeline.length, 0);
});

test('viewFor verbergt het antwoord voor iedereen behalve het track-ID voor de host', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(13));
  const card = state.turn.card;
  for (const p of state.players) {
    const v = rules.viewFor(state, p.id, new Set(['p0']));
    const json = JSON.stringify(v);
    assert.ok(!json.includes('"token'), 'tokens lekken niet');
    assert.ok(!json.includes(card.title), 'titel lekt niet');
    assert.ok(!json.includes(card.artist + '"'), 'artiest lekt niet');
    assert.equal('deck' in v, false);
    assert.equal('used' in v, false);
    if (p.id === state.hostId) {
      assert.equal(v.turn.trackId, card.id);
    } else {
      assert.equal('trackId' in v.turn, false);
      assert.ok(!json.includes(card.id), 'track-ID lekt niet naar gewone spelers');
    }
    assert.equal(v.players.find((x) => x.id === 'p0').online, true);
    assert.equal(v.players.find((x) => x.id === 'p1').online, false);
  }
  // na het plaatsen (en de tussenfase) ziet iedereen de kaart
  placeAndReveal(state, 0);
  for (const p of state.players) {
    const v = rules.viewFor(state, p.id);
    assert.deepEqual(v.reveal.card, card);
    assert.equal(v.turn, null);
  }
});

test('eigen lijst van de host: alleen host, tussen spellen, met grenzen', () => {
  const state = newRoom();
  const deck = makeTracks(40, 1980);
  throwsCode(() => rules.setDeck(state, 'p1', { name: 'X', tracks: deck }), 'HOST_ONLY');
  throwsCode(() => rules.setDeck(state, 'p0', { name: 'X', tracks: makeTracks(3) }), 'DECK_TOO_SMALL');
  throwsCode(() => rules.setDeck(state, 'p0', { name: 'X', tracks: makeTracks(501) }), 'DECK_TOO_LARGE');
  throwsCode(() => rules.setDeck(state, 'p0', { name: 'X', tracks: 'rommel' }), 'DECK_TOO_SMALL');
  rules.setDeck(state, 'p0', { name: '  Mijn   playlist  ', tracks: deck });
  assert.equal(state.custom.name, 'Mijn playlist');
  assert.equal(state.custom.tracks.length, 40);
  // Spelers zien alleen naam en aantal, niet de nummers.
  const v = rules.viewFor(state, 'p1');
  assert.deepEqual(v.playlist, { name: 'Mijn playlist', count: 40 });
  assert.ok(!JSON.stringify(v).includes(deck[0].title));
  rules.startGame(state, 'p0', state.custom.tracks, seeded(3));
  throwsCode(() => rules.setDeck(state, 'p0', { name: 'X', tracks: deck }), 'BAD_PHASE');
  throwsCode(() => rules.clearDeck(state, 'p0'), 'BAD_PHASE');
  rules.backToLobby(state, 'p0');
  throwsCode(() => rules.clearDeck(state, 'p1'), 'HOST_ONLY');
  rules.clearDeck(state, 'p0');
  assert.equal(state.custom, null);
  assert.equal(rules.viewFor(state, 'p0').playlist, null);
});

test('room: een eigen lijst gaat voor op de standaardlijst en vraagt het token van de host', async () => {
  const state = room.createRoomState('ABCD', 0);
  const host = room.join(state, 'Host');
  const guest = room.join(state, 'Gast');
  const own = makeTracks(30, 2000).map((t) => ({ ...t, id: `eigen${t.id}`, extra: 'weg', source: 'musicbrainz' }));
  assert.throws(() => room.setDeck(state, { token: 'fout-token-123', name: 'X', tracks: own }), (e) => e.code === 'BAD_TOKEN');
  assert.throws(() => room.setDeck(state, { token: guest.token, name: 'X', tracks: own }), (e) => e.code === 'HOST_ONLY');
  // Ongeldige nummers vallen weg; blijven er te weinig over, dan wordt de lijst geweigerd.
  assert.throws(
    () => room.setDeck(state, { token: host.token, name: 'X', tracks: own.map((t) => ({ ...t, year: 'geen' })) }),
    (e) => e.code === 'DECK_TOO_SMALL',
  );
  room.setDeck(state, { token: host.token, name: 'Rock', tracks: own });
  assert.deepEqual(Object.keys(state.custom.tracks[0]).sort(), ['artist', 'id', 'title', 'year']);

  let loads = 0;
  const loadTracks = async () => {
    loads++;
    return makeTracks(30);
  };
  await room.applyAction(state, host.playerId, { t: 'start' }, { loadTracks });
  assert.equal(loads, 0, 'de standaardlijst wordt niet opgehaald');
  const ids = [...state.players.flatMap((p) => p.timeline), state.turn.card, ...state.deck].map((c) => c.id);
  assert.ok(ids.every((id) => id.startsWith('eigen')));
  assert.equal(ids.length, 30);

  // Terug naar de standaardlijst.
  await room.applyAction(state, host.playerId, { t: 'lobby' }, { loadTracks });
  await room.applyAction(state, host.playerId, { t: 'clearDeck' }, { loadTracks });
  await room.applyAction(state, host.playerId, { t: 'start' }, { loadTracks });
  assert.equal(loads, 1);
  assert.ok(!state.turn.card.id.startsWith('eigen'));
});

test('room: join, authenticate en applyAction', async () => {
  const state = room.createRoomState('ABCD', 0);
  const host = room.join(state, 'Host');
  const guest = room.join(state, 'Gast');
  assert.notEqual(host.token, guest.token);
  assert.equal(room.authenticate(state, host.token), host.playerId);
  assert.equal(room.authenticate(state, 'fout-token-123'), null);
  assert.equal(room.authenticate(state, ''), null);
  assert.equal(room.authenticate(state, undefined), null);

  let loads = 0;
  const loadTracks = async () => {
    loads++;
    return makeTracks(30);
  };
  await assert.rejects(room.applyAction(state, guest.playerId, { t: 'start' }, { loadTracks }), (e) => e.code === 'HOST_ONLY');
  assert.equal(loads, 0, 'nummers worden niet geladen voor een niet-host');
  await room.applyAction(state, host.playerId, { t: 'start' }, { loadTracks });
  assert.equal(state.phase, 'playing');
  await assert.rejects(room.applyAction(state, host.playerId, { t: 'bestaat-niet' }, { loadTracks }), (e) => e.code === 'UNKNOWN');
  const active = state.turn.playerId;
  await room.applyAction(state, active, { t: 'select', index: 0 }, { loadTracks });
  assert.equal(state.turn.pendingIndex, 0);
  await room.applyAction(state, active, { t: 'place', index: 0 }, { loadTracks });
  // De ander heeft zijn starttokens: eerst de tussenfase.
  assert.equal(state.phase, 'challenge');
  await room.applyAction(state, active, { t: 'reveal' }, { loadTracks });
  assert.equal(state.phase, 'reveal');
  await room.applyAction(state, host.playerId, { t: 'next' }, { loadTracks });
  assert.equal(state.phase, 'playing');
  assert.deepEqual(room.errorPayload(new GameError('X', 'y')), { t: 'error', code: 'X', message: 'y' });
  assert.equal(room.errorPayload(new Error('intern detail')).message.includes('intern'), false);
});

test('codes: vier letters zonder I en O', () => {
  for (let i = 0; i < 200; i++) {
    const code = room.randomCode();
    assert.match(code, room.CODE_PATTERN);
  }
});

test('normaliseTracks filtert ongeldige en dubbele nummers', () => {
  const tracks = normaliseTracks([
    { id: 'abc123', artist: 'A', title: 'T', year: 1999, source: 'musicbrainz' },
    { id: 'abc123', artist: 'A', title: 'Dubbel', year: 1999 },
    { id: 'geen jaar', artist: 'A', title: 'T' },
    { id: 'x1', artist: '', title: 'T', year: 2000 },
    { id: 'x2', artist: 'A', title: 'T', year: '2001' },
    { id: 'x3', artist: 'A', title: 'T', year: 1999.5 },
    null,
    'tekst',
  ]);
  assert.deepEqual(tracks, [
    { id: 'abc123', artist: 'A', title: 'T', year: 1999 },
    { id: 'x2', artist: 'A', title: 'T', year: 2001 },
  ]);
  assert.deepEqual(normaliseTracks({ tracks: [{ id: 'a', artist: 'A', title: 'T', year: 1 }] }), []);
  assert.deepEqual(normaliseTracks('rommel'), []);
});

// ---------- tokens voor wie artiest en nummer raadt ----------

/** Speelt tot de onthulling, met een niet-host aan de beurt. */
function toReveal(seed = 31, names) {
  const state = newRoom(names);
  rules.startGame(state, 'p0', makeTracks(40), seeded(seed));
  while (state.turn.playerId === 'p0') rules.skipTurn(state, 'p0');
  const active = state.turn.playerId;
  placeAndReveal(state, correctIndex(state));
  return { state, active };
}

const tokensOf = (state, id) => rules.findPlayer(state, id).guessTokens;

test('token: geven, verplaatsen, nog eens dezelfde, terugnemen', () => {
  const { state, active } = toReveal();
  const other = state.players.find((p) => p.id !== active && p.id !== 'p0').id;
  for (const p of state.players) assert.equal(p.guessTokens, S);

  rules.giveToken(state, active, active);
  assert.equal(tokensOf(state, active), S + 1);
  assert.equal(state.reveal.guessTokenTo, active);

  // Dezelfde speler nog eens: niets verandert.
  rules.giveToken(state, 'p0', active);
  assert.equal(tokensOf(state, active), S + 1);

  // Een andere speler: het token verhuist.
  rules.giveToken(state, 'p0', other);
  assert.equal(tokensOf(state, active), S);
  assert.equal(tokensOf(state, other), S + 1);
  assert.equal(state.reveal.guessTokenTo, other);

  // Terugnemen, ook twee keer na elkaar.
  rules.giveToken(state, active, null);
  assert.equal(tokensOf(state, other), S);
  assert.equal(state.reveal.guessTokenTo, null);
  rules.giveToken(state, active, null);
  for (const p of state.players) assert.equal(p.guessTokens, S);
});

test('token: host en speler aan beurt alles, een ander alleen voor zichzelf als het nog vrij is', () => {
  const { state, active } = toReveal(33, ['Ann', 'Bob', 'Cas', 'Dirk']);
  const [bystander, other] = state.players.filter((p) => p.id !== active && p.id !== 'p0').map((p) => p.id);
  throwsCode(() => rules.giveToken(state, 'onbekend', active), 'NOT_IN_ROOM');
  throwsCode(() => rules.giveToken(state, 'p0', 'bestaat-niet'), 'NOT_FOUND');
  // Een ander geven kan een gewone speler niet (Nederlandstalige fout).
  assert.throws(() => rules.giveToken(state, bystander, active), /alleen voor jezelf opeisen/);
  throwsCode(() => rules.giveToken(state, bystander, other), 'NOT_ALLOWED');
  assert.equal(state.reveal.guessTokenTo ?? null, null);
  for (const p of state.players) assert.equal(p.guessTokens, S);

  // Voor zichzelf opeisen mag, en weer teruggeven ook.
  rules.giveToken(state, bystander, bystander);
  assert.equal(tokensOf(state, bystander), S + 1);
  rules.giveToken(state, bystander, bystander); // nog eens: niets verandert
  assert.equal(tokensOf(state, bystander), S + 1);
  // Een andere gewone speler kan het niet afnemen of terugzetten.
  assert.throws(() => rules.giveToken(state, other, other), /al aan iemand anders gegeven/);
  throwsCode(() => rules.giveToken(state, other, null), 'NOT_ALLOWED');
  assert.equal(tokensOf(state, bystander), S + 1);
  rules.giveToken(state, bystander, null);
  assert.equal(tokensOf(state, bystander), S);
  assert.equal(state.reveal.guessTokenTo, null);

  // De speler aan beurt kan het van een opeiser afnemen; die kan het dan niet terugpakken.
  rules.giveToken(state, other, other);
  rules.giveToken(state, active, active);
  assert.equal(tokensOf(state, other), S);
  throwsCode(() => rules.giveToken(state, other, other), 'NOT_ALLOWED');
  throwsCode(() => rules.giveToken(state, other, null), 'NOT_ALLOWED');
  assert.equal(tokensOf(state, active), S + 1);
  rules.giveToken(state, active, null);

  // Na "volgende beurt" is het te laat, en in de wachtkamer kan het ook niet.
  rules.giveToken(state, active, active);
  rules.nextTurn(state, active);
  throwsCode(() => rules.giveToken(state, 'p0', active), 'BAD_PHASE');
  assert.equal(tokensOf(state, active), S + 1, 'het token blijft na de beurt');
  const lobby = newRoom();
  throwsCode(() => rules.giveToken(lobby, 'p0', 'p1'), 'BAD_PHASE');
});

test('token: één per beurt, tellers lopen op over beurten', () => {
  const { state, active } = toReveal(35);
  rules.giveToken(state, active, 'p0');
  rules.nextTurn(state, 'p0');
  // Volgende beurt: een nieuw token, ook voor dezelfde speler.
  placeAndReveal(state, 0);
  assert.equal(state.reveal.guessTokenTo ?? null, null);
  rules.giveToken(state, 'p0', 'p0');
  assert.equal(tokensOf(state, 'p0'), S + 2);
  rules.giveToken(state, 'p0', 'p0');
  assert.equal(tokensOf(state, 'p0'), S + 2);
});

test('token: kan nog bij de beslissende laatste kaart', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.setSettings(state, 'p0', { target: 3 });
  rules.startGame(state, 'p0', makeTracks(40), seeded(11));
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 100) {
    placeAndReveal(state, correctIndex(state));
    if (state.phase === 'reveal') rules.nextTurn(state, state.hostId);
  }
  assert.equal(state.phase, 'finished');
  const winner = state.winnerIds[0];
  const loser = state.players.find((p) => p.id !== winner).id;
  rules.giveToken(state, winner, loser);
  assert.equal(tokensOf(state, loser), S + 1);
  rules.giveToken(state, 'p0', winner);
  assert.equal(tokensOf(state, loser), S);
  assert.equal(tokensOf(state, winner), S + 1);
  assert.equal(rules.viewFor(state, loser).reveal.guessTokenTo, winner);
  // Het token verandert niets aan de winnaar.
  assert.deepEqual(state.winnerIds, [winner]);
  // "Nog een spel" (meteen vanuit het eindscherm) begint weer met 2 tokens
  // voor iedereen, en dan kan het niet meer.
  rules.startGame(state, 'p0', makeTracks(40), seeded(12));
  for (const p of state.players) assert.equal(p.guessTokens, S);
  throwsCode(() => rules.giveToken(state, 'p0', 'p0'), 'BAD_PHASE');
});

test('token: na een lege stapel (geen onthulling meer) kan het niet', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.startGame(state, 'p0', makeTracks(4), seeded(2)); // 2 startkaarten + 2 beurten
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 20) {
    placeAndReveal(state, wrongIndex(state) ?? 0);
    if (state.phase === 'reveal') rules.nextTurn(state, state.hostId);
  }
  assert.equal(state.phase, 'finished');
  assert.equal(state.reveal, null);
  throwsCode(() => rules.giveToken(state, 'p0', 'p0'), 'BAD_PHASE');
});

test('token: weer 2 in de wachtkamer en bij een nieuw spel, ook wie laat instapt krijgt er 2', () => {
  // In de wachtkamer binnenkomen: meteen 2 (startGame zet ze toch opnieuw).
  const lobby = newRoom();
  for (const p of lobby.players) assert.equal(p.guessTokens, S);

  const { state, active } = toReveal(37);
  rules.giveToken(state, 'p0', active);
  assert.equal(tokensOf(state, active), S + 1);
  // Laat instappen tijdens de onthulling en tijdens een beurt: ook 2.
  const late = rules.addPlayer(state, { id: 'late', token: 'token-late-xxxx', name: 'Laat' });
  assert.equal(late.guessTokens, S);
  rules.nextTurn(state, 'p0');
  const later = rules.addPlayer(state, { id: 'later', token: 'token-later-xxx', name: 'Later' });
  assert.equal(later.guessTokens, S);
  assert.equal(rules.viewFor(state, 'p0').players.find((x) => x.id === 'later').guessTokens, S);
  // De laatkomer kan zijn tokens meteen inzetten bij een ander.
  rules.placeCard(state, state.turn.playerId, 0);
  assert.equal(state.phase, 'challenge');
  rules.placeBet(state, 'later', 1);
  assert.equal(tokensOf(state, 'later'), S - 1);

  // Terug naar de wachtkamer: iedereen weer op 2.
  rules.backToLobby(state, 'p0');
  for (const p of state.players) assert.equal(p.guessTokens, S);
  rules.startGame(state, 'p0', makeTracks(40), seeded(38));
  for (const p of state.players) assert.equal(p.guessTokens, S);
  while (state.turn.playerId === 'p0') rules.skipTurn(state, 'p0');
  placeAndReveal(state, 0);
  rules.giveToken(state, 'p0', 'p1');
  assert.equal(tokensOf(state, 'p1'), S + 1);
  // "Nog een spel" via de wachtkamer: ook weer 2.
  rules.backToLobby(state, 'p0');
  rules.startGame(state, 'p0', makeTracks(40), seeded(39));
  for (const p of state.players) assert.equal(p.guessTokens, S);
});

test('token: verwijderde speler neemt het token van deze beurt mee', () => {
  const { state, active } = toReveal(41, ['Ann', 'Bob', 'Cas', 'Dirk']);
  const other = state.players.find((p) => p.id !== active && p.id !== 'p0').id;
  rules.giveToken(state, active, other);
  rules.removePlayer(state, 'p0', other);
  assert.equal(state.reveal.guessTokenTo, null);
  for (const p of state.players) assert.equal(p.guessTokens, S);
  // Daarna gewoon opnieuw geven.
  rules.giveToken(state, active, active);
  assert.equal(tokensOf(state, active), S + 1);
  // De speler aan beurt zelf verwijderen: alleen de host kan nog geven, en doorgaan werkt.
  rules.removePlayer(state, 'p0', active);
  assert.equal(state.reveal.guessTokenTo, null);
  rules.giveToken(state, 'p0', 'p0');
  assert.equal(tokensOf(state, 'p0'), S + 1);
  rules.nextTurn(state, 'p0');
  assert.equal(state.phase, 'playing');
});

test('token: view toont tellers en ontvanger, oude kamers zonder veld tellen als 0 tot het volgende spel', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(30), seeded(43));
  // Een kamer uit de opslag van voor de tokens.
  for (const p of state.players) delete p.guessTokens;
  const card = state.turn.card;
  for (const p of state.players) {
    const v = rules.viewFor(state, p.id);
    for (const x of v.players) assert.equal(x.guessTokens, 0);
    const json = JSON.stringify(v);
    assert.ok(!json.includes(card.title), 'titel lekt niet');
    assert.ok(!json.includes('"token'), 'geheime sleutels lekken niet');
  }
  const active = state.turn.playerId;
  // Zonder veld heeft niemand tokens: geen tussenfase, meteen de onthulling.
  rules.placeCard(state, active, 0);
  assert.equal(state.phase, 'reveal');
  assert.equal(rules.viewFor(state, 'p1').reveal.guessTokenTo, null);
  rules.giveToken(state, active, 'p2');
  for (const p of state.players) {
    const v = rules.viewFor(state, p.id);
    assert.equal(v.reveal.guessTokenTo, 'p2');
    assert.equal(v.players.find((x) => x.id === 'p2').guessTokens, 1);
    assert.equal(v.players.find((x) => x.id === 'p1').guessTokens, 0);
  }
  // Wie nu instapt, krijgt gewoon 2; het volgende spel zet iedereen op 2.
  assert.equal(rules.addPlayer(state, { id: 'p9', token: 'token-9-xxxxxxxx', name: 'Nieuw' }).guessTokens, S);
  rules.nextTurn(state, 'p0');
  rules.backToLobby(state, 'p0');
  rules.startGame(state, 'p0', makeTracks(30), seeded(44));
  for (const p of state.players) assert.equal(p.guessTokens, S);
});

test('room: actie token geeft, verplaatst en neemt terug', async () => {
  const state = room.createRoomState('ABCD', 0);
  const host = room.join(state, 'Host');
  const guest = room.join(state, 'Gast');
  const loadTracks = async () => makeTracks(30);
  await room.applyAction(state, host.playerId, { t: 'start' }, { loadTracks });
  const active = state.turn.playerId;
  await room.applyAction(state, active, { t: 'place', index: 0 }, { loadTracks });
  await room.applyAction(state, active, { t: 'reveal' }, { loadTracks });
  await room.applyAction(state, active, { t: 'token', playerId: guest.playerId }, { loadTracks });
  assert.equal(tokensOf(state, guest.playerId), S + 1);
  await room.applyAction(state, host.playerId, { t: 'token', playerId: host.playerId }, { loadTracks });
  assert.equal(tokensOf(state, guest.playerId), S);
  assert.equal(tokensOf(state, host.playerId), S + 1);
  await room.applyAction(state, host.playerId, { t: 'token', playerId: '' }, { loadTracks });
  assert.equal(tokensOf(state, host.playerId), S);
  await room.applyAction(state, host.playerId, { t: 'token', playerId: guest.playerId }, { loadTracks });
  await room.applyAction(state, host.playerId, { t: 'token', playerId: null }, { loadTracks });
  assert.equal(tokensOf(state, guest.playerId), S);
  await assert.rejects(
    room.applyAction(state, host.playerId, { t: 'token', playerId: 'niemand' }, { loadTracks }),
    (e) => e.code === 'NOT_FOUND',
  );
});

// ---------- een token inzetten bij de beurt van een ander ----------

const yearCards = (years, prefix) =>
  years.map((year, i) => ({ id: `${prefix}${i}`, artist: `A ${prefix}${i}`, title: `T ${prefix}${i}`, year }));

/**
 * Een spel met vier spelers waarin `active` (geen host) aan de beurt is met
 * een gekende tijdlijn en kaart; `tokens` = aantal tokens per speler-ID.
 */
function betSetup({ years = [1970, 1980, 1990], cardYear = 1985, tokens = {}, target } = {}) {
  const state = newRoom(['Ann', 'Bob', 'Cas', 'Dirk']);
  if (target) rules.setSettings(state, 'p0', { target });
  rules.startGame(state, 'p0', makeTracks(40), seeded(51));
  while (state.turn.playerId !== 'p1') rules.skipTurn(state, 'p0');
  for (const p of state.players) {
    p.timeline = yearCards([2000 + Number(p.id.slice(1))], `${p.id}-`);
    p.guessTokens = tokens[p.id] ?? 0;
  }
  rules.findPlayer(state, 'p1').timeline = yearCards(years, 'act');
  state.turn.card = { id: 'geheim01', artist: 'Geheime Artiest', title: 'Geheime Titel', year: cardYear };
  return state;
}

test('inzet: zonder tokens bij de anderen volgt de onthulling meteen', () => {
  // De speler aan beurt zelf heeft wel een token: dat telt niet.
  const state = betSetup({ tokens: { p1: 2 } });
  rules.placeCard(state, 'p1', 2);
  assert.equal(state.phase, 'reveal');
  assert.equal('bets' in state.reveal, false);
  assert.equal(rules.viewFor(state, 'p2').reveal.cardTo, 'p1');
  assert.deepEqual(rules.viewFor(state, 'p2').reveal.bets, []);
});

test('inzet: tussenfase, wie mag waar inzetten en de view lekt niets', () => {
  const state = betSetup({ tokens: { p2: 2, p3: 1 } });
  throwsCode(() => rules.placeBet(state, 'p2', 0), 'BAD_PHASE'); // nog niet geplaatst
  rules.placeCard(state, 'p1', 2);
  assert.equal(state.phase, 'challenge');
  // De speler aan beurt kan niet meer verplaatsen.
  throwsCode(() => rules.selectSlot(state, 'p1', 1), 'BAD_PHASE');
  throwsCode(() => rules.placeCard(state, 'p1', 1), 'BAD_PHASE');
  throwsCode(() => rules.nextTurn(state, 'p0'), 'BAD_PHASE');
  throwsCode(() => rules.placeBet(state, 'p1', 0), 'NOT_ALLOWED');
  throwsCode(() => rules.placeBet(state, 'p2', 2), 'SLOT_TAKEN');
  throwsCode(() => rules.placeBet(state, 'p2', 4), 'BAD_INDEX');
  throwsCode(() => rules.placeBet(state, 'p2', -1), 'BAD_INDEX');
  rules.placeBet(state, 'p2', 3);
  assert.equal(tokensOf(state, 'p2'), 1, 'inzetten kost meteen een token');
  throwsCode(() => rules.placeBet(state, 'p2', 0), 'ALREADY_BET');
  throwsCode(() => rules.placeBet(state, 'p3', 3), 'SLOT_TAKEN');
  rules.placeBet(state, 'p3', 0);
  assert.equal(tokensOf(state, 'p3'), 0);
  // Wie geen tokens (meer) heeft, kan niet inzetten.
  throwsCode(() => rules.placeBet(state, 'p0', 1), 'NO_TOKEN');
  // Late instapper: startkaart en 2 tokens.
  const late = rules.addPlayer(state, { id: 'p4', token: 'token-4-xxxxxxxx', name: 'Els' });
  assert.equal(late.guessTokens, S);

  for (const p of state.players) {
    const v = rules.viewFor(state, p.id);
    const json = JSON.stringify(v);
    assert.equal(v.phase, 'challenge');
    assert.equal(v.turn.placedIndex, 2);
    assert.equal(v.turn.pendingIndex, 2);
    assert.deepEqual(v.turn.bets, [
      { playerId: 'p2', index: 3 },
      { playerId: 'p3', index: 0 },
    ]);
    assert.equal(v.reveal, null);
    assert.ok(!json.includes('Geheime'), 'titel en artiest lekken niet');
    assert.ok(!json.includes('1985'), 'het jaar lekt niet');
    assert.ok(!json.includes('"token'), 'geheime sleutels lekken niet');
    if (p.id === 'p0') assert.equal(v.turn.trackId, 'geheim01');
    else assert.ok(!json.includes('geheim01'), 'track-ID lekt niet naar gewone spelers');
  }

  // Onthullen: alleen de speler aan beurt of de host.
  throwsCode(() => rules.revealTurn(state, 'p2'), 'NOT_ALLOWED');
  rules.revealTurn(state, 'p1');
  assert.equal(state.phase, 'reveal');
  throwsCode(() => rules.revealTurn(state, 'p1'), 'BAD_PHASE');
  throwsCode(() => rules.placeBet(state, 'p0', 1), 'BAD_PHASE');
});

test('inzet: speler aan beurt juist, hij houdt de kaart en de inzetten zijn verloren', () => {
  const state = betSetup({ tokens: { p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 2); // 1985 tussen 1980 en 1990: juist
  rules.placeBet(state, 'p2', 3);
  rules.placeBet(state, 'p3', 1);
  rules.revealTurn(state, 'p0');
  assert.equal(state.reveal.correct, true);
  assert.equal(state.reveal.cardTo, 'p1');
  assert.deepEqual(state.reveal.bets, [
    { playerId: 'p2', index: 3, correct: false },
    { playerId: 'p3', index: 1, correct: false },
  ]);
  assert.deepEqual(rules.findPlayer(state, 'p1').timeline.map((c) => c.year), [1970, 1980, 1985, 1990]);
  assert.equal(tokensOf(state, 'p2'), 0);
  assert.equal(tokensOf(state, 'p3'), 0);
  assert.equal(rules.findPlayer(state, 'p2').timeline.length, 1);
});

test('inzet: speler aan beurt fout, de juiste inzetter krijgt de kaart op zijn eigen tijdlijn', () => {
  const state = betSetup({ cardYear: 1975, tokens: { p2: 1, p3: 3 } });
  rules.placeCard(state, 'p1', 3); // na 1990: fout
  rules.placeBet(state, 'p2', 0); // vóór 1970: fout
  rules.placeBet(state, 'p3', 1); // tussen 1970 en 1980: juist
  rules.revealTurn(state, 'p1');
  assert.equal(state.reveal.correct, false);
  assert.equal(state.reveal.cardTo, 'p3');
  assert.deepEqual(rules.findPlayer(state, 'p1').timeline.map((c) => c.year), [1970, 1980, 1990]);
  // Op de juiste plaats in de eigen tijdlijn van p3 (die had 2003).
  assert.deepEqual(rules.findPlayer(state, 'p3').timeline.map((c) => c.year), [1975, 2003]);
  assert.equal(tokensOf(state, 'p3'), 2, 'ook bij winst is het token verbruikt');
  assert.equal(tokensOf(state, 'p2'), 0);
  const v = rules.viewFor(state, 'p0');
  assert.equal(v.reveal.cardTo, 'p3');
  assert.equal(v.reveal.card.title, 'Geheime Titel');
  assert.deepEqual(v.reveal.bets.map((b) => b.correct), [false, true]);
  // Daarna gewoon verder.
  rules.nextTurn(state, 'p1');
  assert.equal(state.turn.playerId, 'p2');
});

test('inzet: niemand juist, de kaart is weg', () => {
  const state = betSetup({ cardYear: 1975, tokens: { p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 0);
  rules.placeBet(state, 'p2', 2);
  rules.placeBet(state, 'p3', 3);
  rules.revealTurn(state, 'p0');
  assert.equal(state.reveal.cardTo, null);
  for (const p of state.players) assert.ok(!p.timeline.some((c) => c.id === 'geheim01'));
  assert.equal(tokensOf(state, 'p2') + tokensOf(state, 'p3'), 0);
});

test('inzet: gelijke jaren zijn aan beide kanten juist, de eerste inzetter wint', () => {
  // Kaart uit 1980 en een 1980 op de tijdlijn: plaats 1 en 2 zijn allebei juist.
  const state = betSetup({ cardYear: 1980, tokens: { p0: 1, p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 0); // fout
  rules.placeBet(state, 'p3', 2); // juist (na 1980), eerst ingezet
  rules.placeBet(state, 'p2', 1); // juist (vóór 1980), later
  rules.placeBet(state, 'p0', 3); // fout
  rules.revealTurn(state, 'p0');
  assert.equal(state.reveal.cardTo, 'p3');
  assert.deepEqual(state.reveal.bets.map((b) => [b.playerId, b.correct]), [
    ['p3', true],
    ['p2', true],
    ['p0', false],
  ]);
  assert.equal(rules.findPlayer(state, 'p3').timeline.length, 2);
  assert.equal(rules.findPlayer(state, 'p2').timeline.length, 1);
});

test('inzet: wie zo zijn laatste kaart krijgt, wint', () => {
  const state = betSetup({ cardYear: 1975, tokens: { p2: 1 }, target: 3 });
  rules.findPlayer(state, 'p2').timeline = yearCards([1950, 2010], 'p2x');
  rules.placeCard(state, 'p1', 3);
  rules.placeBet(state, 'p2', 1);
  rules.revealTurn(state, 'p1');
  assert.equal(state.phase, 'finished');
  assert.deepEqual(state.winnerIds, ['p2']);
  assert.deepEqual(rules.findPlayer(state, 'p2').timeline.map((c) => c.year), [1950, 1975, 2010]);
  assert.equal(state.reveal.cardTo, 'p2');
  // Het raad-token kan bij deze laatste onthulling nog gegeven worden.
  rules.giveToken(state, 'p1', 'p0');
  assert.equal(tokensOf(state, 'p0'), 1);
});

test('inzet: overslaan en verwijderen geven ingezette tokens terug', () => {
  // Ander nummer: de beurt telt niet.
  let state = betSetup({ tokens: { p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 0);
  rules.placeBet(state, 'p2', 1);
  throwsCode(() => rules.skipTrack(state, 'p2'), 'HOST_ONLY');
  rules.skipTrack(state, 'p0');
  assert.equal(state.phase, 'playing');
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(tokensOf(state, 'p2'), 1);

  // Beurt overslaan.
  state = betSetup({ tokens: { p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 0);
  rules.placeBet(state, 'p2', 1);
  rules.placeBet(state, 'p3', 2);
  rules.skipTurn(state, 'p0');
  assert.equal(state.phase, 'playing');
  assert.equal(state.turn.playerId, 'p2');
  assert.equal(tokensOf(state, 'p2'), 1);
  assert.equal(tokensOf(state, 'p3'), 1);

  // De speler aan beurt wordt verwijderd: inzetters krijgen hun token terug.
  state = betSetup({ tokens: { p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 0);
  rules.placeBet(state, 'p2', 1);
  rules.removePlayer(state, 'p0', 'p1');
  assert.equal(state.phase, 'playing');
  assert.equal(state.turn.playerId, 'p2');
  assert.equal(tokensOf(state, 'p2'), 1);

  // Een inzetter wordt verwijderd: zijn inzet vervalt, de rest loopt door.
  state = betSetup({ cardYear: 1975, tokens: { p2: 1, p3: 1 } });
  rules.placeCard(state, 'p1', 0);
  rules.placeBet(state, 'p2', 1); // juist, maar p2 vertrekt
  rules.placeBet(state, 'p3', 2);
  rules.removePlayer(state, 'p0', 'p2');
  assert.equal(state.phase, 'challenge');
  assert.deepEqual(state.turn.bets, [{ playerId: 'p3', index: 2 }]);
  assert.equal(tokensOf(state, 'p3'), 0);
  rules.revealTurn(state, 'p1');
  assert.equal(state.reveal.cardTo, null);
  assert.deepEqual(state.reveal.bets, [{ playerId: 'p3', index: 2, correct: false }]);
});

test('inzet: na de starttokens verdien je er alleen bij door te raden, een nieuw spel begint weer op 2', () => {
  const state = betSetup({ tokens: {} });
  rules.placeCard(state, 'p1', 2);
  assert.equal(state.phase, 'reveal', 'zonder tokens geen tussenfase');
  rules.giveToken(state, 'p1', 'p2');
  rules.nextTurn(state, 'p1');
  // p2 is nu zelf aan de beurt: zijn token telt dan niet.
  assert.equal(state.turn.playerId, 'p2');
  rules.placeCard(state, 'p2', 0);
  assert.equal(state.phase, 'reveal');
  rules.nextTurn(state, 'p2');
  // Bij de volgende speler kan p2 het token wel inzetten.
  rules.placeCard(state, 'p3', 0);
  assert.equal(state.phase, 'challenge');
  rules.placeBet(state, 'p2', 1);
  assert.equal(tokensOf(state, 'p2'), 0);
  rules.backToLobby(state, 'p0');
  rules.startGame(state, 'p0', makeTracks(40), seeded(52));
  for (const p of state.players) assert.equal(p.guessTokens, S);
});

test('inzet: zijn de tokens van de anderen op, dan volgt de onthulling weer meteen', () => {
  const state = newRoom(['Ann', 'Bob']);
  rules.startGame(state, 'p0', makeTracks(40), seeded(61));
  const [a, b] = state.players.map((p) => p.id);
  // Bij elke beurt van a zet b een token in; de beurten van b slaat de host over.
  for (let i = 0; i < S; i++) {
    while (state.turn.playerId !== a) rules.skipTurn(state, 'p0');
    rules.placeCard(state, a, 0);
    assert.equal(state.phase, 'challenge', `b heeft nog ${tokensOf(state, b)} token(s)`);
    rules.placeBet(state, b, 1);
    rules.revealTurn(state, a);
    rules.nextTurn(state, a);
  }
  assert.equal(tokensOf(state, b), 0);
  assert.equal(tokensOf(state, a), S, 'a heeft zijn tokens nog');
  // Bij b kan a nog inzetten: daar komt de tussenfase nog wel.
  assert.equal(state.turn.playerId, b);
  rules.placeCard(state, b, 0);
  assert.equal(state.phase, 'challenge');
  rules.revealTurn(state, b);
  rules.nextTurn(state, b);
  // Bij a heeft niemand anders nog een token: meteen onthullen.
  assert.equal(state.turn.playerId, a);
  rules.placeCard(state, a, 0);
  assert.equal(state.phase, 'reveal');
  assert.equal('bets' in state.reveal, false);
  // Verdient b een token, dan komt de tussenfase terug.
  rules.giveToken(state, a, b);
  rules.nextTurn(state, a);
  rules.skipTurn(state, 'p0');
  rules.placeCard(state, a, 0);
  assert.equal(state.phase, 'challenge');
});

test('inzet: een spel met één speler kent geen tussenfase', () => {
  const state = newRoom(['Ann']);
  rules.startGame(state, 'p0', makeTracks(20), seeded(62));
  assert.equal(tokensOf(state, 'p0'), S);
  rules.placeCard(state, 'p0', 0);
  assert.equal(state.phase, 'reveal');
});

test('room: acties challenge en reveal', async () => {
  const state = betSetup({ cardYear: 1975, tokens: { p2: 1 } });
  const opts = { loadTracks: async () => makeTracks(30) };
  await room.applyAction(state, 'p1', { t: 'place', index: 3 }, opts);
  assert.equal(state.phase, 'challenge');
  await assert.rejects(room.applyAction(state, 'p2', { t: 'challenge', index: 'x' }, opts), (e) => e.code === 'BAD_INDEX');
  await room.applyAction(state, 'p2', { t: 'challenge', index: 1 }, opts);
  await assert.rejects(room.applyAction(state, 'p3', { t: 'reveal' }, opts), (e) => e.code === 'NOT_ALLOWED');
  await room.applyAction(state, 'p0', { t: 'reveal' }, opts);
  assert.equal(state.reveal.cardTo, 'p2');
});
