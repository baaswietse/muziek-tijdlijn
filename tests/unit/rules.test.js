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
  rules.placeCard(state, active, idx);
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
    rules.placeCard(state, state.turn.playerId, correctIndex(state));
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
    rules.placeCard(state, state.turn.playerId, wrongIndex(state) ?? 0);
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
  rules.placeCard(state, active, 0);
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
    rules.placeCard(state, state.turn.playerId, correctIndex(state));
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
  // na het plaatsen ziet iedereen de kaart
  rules.placeCard(state, state.turn.playerId, 0);
  for (const p of state.players) {
    const v = rules.viewFor(state, p.id);
    assert.deepEqual(v.reveal.card, card);
    assert.equal(v.turn, null);
  }
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
