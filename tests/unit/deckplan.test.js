// Tests voor het rekenwerk rond een eigen playlist (web/src/lib/deckplan.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../web/src/lib/deckplan.js';

/** Voorspelbare "willekeur" voor de tests. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const track = (i, title = `Lied ${i}`, artist = 'Band') => ({ id: `t${i}`, title, artists: [artist], spotifyDate: '2001' });

test('shuffled: zelfde elementen, origineel ongewijzigd', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const out = P.shuffled(items, seeded(3));
  assert.notDeepEqual(out, items);
  assert.deepEqual([...out].sort((a, b) => a - b), items);
  assert.deepEqual(items, Array.from({ length: 20 }, (_, i) => i));
});

test('withoutDoubles: album- en singleversie van hetzelfde nummer tellen één keer', () => {
  const list = [track(1, 'Lied B'), track(2, 'Lied B - Single Version'), track(3, 'Lied C'), track(4, 'Lied B', 'Andere Band')];
  assert.deepEqual(
    P.withoutDoubles(list).map((t) => t.id),
    ['t1', 't3', 't4'],
  );
});

test('pickTracks: tot 500 nummers doen ze allemaal mee, in de volgorde van de playlist', () => {
  const list = Array.from({ length: 500 }, (_, i) => track(i));
  const out = P.pickTracks(list, 500, seeded());
  assert.equal(out.sampled, false);
  assert.equal(out.total, 500);
  assert.deepEqual(out.tracks, list);
});

test('pickTracks: meer dan 500 geeft een willekeurige greep van 500, elke keer een andere', () => {
  const list = Array.from({ length: 1200 }, (_, i) => track(i));
  const a = P.pickTracks(list, 500, seeded(1));
  const b = P.pickTracks(list, 500, seeded(2));
  assert.equal(a.sampled, true);
  assert.equal(a.total, 1200);
  assert.equal(a.tracks.length, 500);
  assert.equal(new Set(a.tracks.map((t) => t.id)).size, 500);
  // Volgorde van de playlist blijft behouden.
  const index = a.tracks.map((t) => Number(t.id.slice(1)));
  assert.deepEqual(index, [...index].sort((x, y) => x - y));
  // Een greep uit de hele playlist, niet alleen het begin.
  assert.ok(index.some((i) => i >= 1000), 'ook nummers van achteraan');
  assert.ok(index.filter((i) => i < 500).length < 400, 'niet vooral het begin');
  // Een andere keer, een andere greep.
  assert.notDeepEqual(
    a.tracks.map((t) => t.id),
    b.tracks.map((t) => t.id),
  );
});

test('lookupOrder: eerst wat gekend is, dan de onbekende nummers door elkaar', () => {
  const list = Array.from({ length: 40 }, (_, i) => track(i));
  const known = (t) => Number(t.id.slice(1)) % 4 === 0; // t0, t4, t8, ...
  const order = P.lookupOrder(list, known, seeded(5));
  assert.equal(order.length, 40);
  assert.deepEqual(
    order.slice(0, 10).map((t) => t.id),
    list.filter(known).map((t) => t.id),
  );
  const rest = order.slice(10).map((t) => Number(t.id.slice(1)));
  assert.ok(rest.every((i) => i % 4 !== 0));
  assert.notDeepEqual(rest, [...rest].sort((x, y) => x - y), 'niet in de volgorde van de playlist');
  // De eerste tien op te zoeken nummers komen uit de hele playlist.
  assert.ok(Math.max(...rest.slice(0, 10)) - Math.min(...rest.slice(0, 10)) > 20);
});

test('deckOf: alleen nummers met een jaartal, hoogstens 500, alleen wat het spel nodig heeft', () => {
  const rows = [
    { id: 'a', title: 'A', artist: 'X', year: 1990, source: 'musicbrainz', doubts: ['x'] },
    { id: 'b', title: 'B', artist: 'X', year: null, source: 'onbekend', doubts: [] },
  ];
  assert.deepEqual(P.deckOf(rows), [{ id: 'a', artist: 'X', title: 'A', year: 1990 }]);
  const many = Array.from({ length: 600 }, (_, i) => ({ id: `r${i}`, title: 'T', artist: 'A', year: 2000 }));
  assert.equal(P.deckOf(many).length, 500);
});

test('secondsPerLookup en minutesLeft: geschatte resterende tijd', () => {
  assert.equal(P.secondsPerLookup({ done: 0, elapsedMs: 0, fallback: 2.5 }), 2.5);
  assert.equal(P.secondsPerLookup({ done: 2, elapsedMs: 60_000, fallback: 2.5 }), 2.5, 'te weinig gemeten');
  assert.equal(P.secondsPerLookup({ done: 10, elapsedMs: 30_000, fallback: 2.5 }), 3);
  assert.equal(P.minutesLeft(0, 3), 0);
  assert.equal(P.minutesLeft(5, 3), 1, 'minstens 1 minuut zolang er iets te doen is');
  assert.equal(P.minutesLeft(400, 3), 20);
});

test('uploadWait: niet bij elk nummer naar de server', () => {
  const base = { first: 5000, every: 20_000 };
  assert.equal(P.uploadWait({ ...base, now: 1000, startedAt: 0, lastUpload: 0 }), 4000);
  assert.equal(P.uploadWait({ ...base, now: 9000, startedAt: 0, lastUpload: 0 }), 0);
  assert.equal(P.uploadWait({ ...base, now: 30_000, startedAt: 0, lastUpload: 25_000 }), 15_000);
  assert.equal(P.uploadWait({ ...base, now: 50_000, startedAt: 0, lastUpload: 25_000 }), 0);
});

test('canSendDeck: alleen tussen twee spellen', () => {
  assert.equal(P.canSendDeck('lobby'), true);
  assert.equal(P.canSendDeck('finished'), true);
  for (const phase of ['playing', 'challenge', 'reveal', null, undefined]) assert.equal(P.canSendDeck(phase), false);
});
