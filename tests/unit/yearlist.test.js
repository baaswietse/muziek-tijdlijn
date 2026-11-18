// Tests voor de gedeelde lijst met jaartallen op de server (server/src/yearlist.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../server/src/yearlist.js';
import * as room from '../../server/src/room.js';
import { GameError } from '../../server/src/rules.js';

const NOW = Date.UTC(2026, 5, 1);
const ID = '4uLU6hMCjMI75M1A2tKUQC';
const ID2 = '7ouMYWpwJ422jRcDASZB7P';

test('normaliseEntry houdt alleen id, jaar, bron, twijfels, regelversie en jaren per bron over', () => {
  const e = L.normaliseEntry(
    { id: ID, y: 1987, s: 'musicbrainz', d: ['Spotify zegt 2010, MusicBrainz 1987'], r: 2, extra: 'weg', name: 'weg', at: 5 },
    NOW,
  );
  assert.deepEqual(e, { id: ID, y: 1987, s: 'musicbrainz', d: ['Spotify zegt 2010, MusicBrainz 1987'], r: 2 });
  // Zonder regelversie (oudere items): geen r.
  assert.deepEqual(L.normaliseEntry({ id: ID, y: 1999, s: 'spotify' }, NOW), { id: ID, y: 1999, s: 'spotify', d: [] });
});

test('normaliseEntry weigert ongeldige id, bron en jaar', () => {
  const ok = { id: ID, y: 1987, s: 'musicbrainz', d: [] };
  assert.ok(L.normaliseEntry(ok, NOW));
  for (const bad of [
    null,
    'tekst',
    [ok],
    { ...ok, id: '' },
    { ...ok, id: 'a'.repeat(65) },
    { ...ok, id: 'spotify:track:abc' },
    { ...ok, id: '../../etc' },
    { ...ok, id: 12345 },
    { ...ok, s: 'lijst' }, // staat al in tracks.json
    { ...ok, s: 'iets' },
    { ...ok, s: undefined },
    { ...ok, y: 1899 },
    { ...ok, y: 2028 }, // NOW is 2026: hoogstens volgend jaar
    { ...ok, y: 1987.5 },
    { ...ok, y: '1987' },
    { ...ok, y: null },
    { ...ok, s: 'onbekend', y: 1987 }, // 'onbekend' heeft geen jaar
  ]) {
    assert.equal(L.normaliseEntry(bad, NOW), null, JSON.stringify(bad));
  }
  assert.equal(L.normaliseEntry({ ...ok, y: 2027 }, NOW).y, 2027);
  assert.equal(L.normaliseEntry({ ...ok, y: 1900 }, NOW).y, 1900);
  // Nergens een jaar gevonden: ook dat wordt gedeeld, zonder jaar.
  assert.deepEqual(L.normaliseEntry({ id: ID, y: null, s: 'onbekend', d: ['geen jaar gevonden'], r: 2 }, NOW), {
    id: ID,
    y: null,
    s: 'onbekend',
    d: ['geen jaar gevonden'],
    r: 2,
  });
});

test('normaliseEntry knipt twijfels en regelversie bij', () => {
  const e = L.normaliseEntry(
    {
      id: ID,
      y: 1990,
      s: 'spotify',
      d: ['  een\n twee\u0000 ', 7, { x: 1 }, '', 'x'.repeat(500), 'drie', 'vier', 'vijf', 'zes'],
      r: 1.5,
    },
    NOW,
  );
  assert.equal(e.d.length, L.MAX_DOUBTS);
  assert.equal(e.d[0], 'een twee');
  assert.equal(e.d[1].length, L.MAX_DOUBT);
  assert.deepEqual(e.d.slice(2), ['drie', 'vier']);
  assert.equal('r' in e, false);
  for (const r of [0, -1, 1001, '2', null]) assert.equal('r' in L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', r }, NOW), false);
  // Een handmatige verbetering heeft geen twijfels.
  assert.deepEqual(L.normaliseEntry({ id: ID, y: 1990, s: 'handmatig', d: ['iets'] }, NOW).d, []);
  // Geen lijst: geen twijfels.
  assert.deepEqual(L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', d: 'tekst' }, NOW).d, []);
});

test('een jaar dat er alleen kwam omdat MusicBrainz onbereikbaar was, wordt niet gedeeld', () => {
  const entry = {
    id: ID,
    y: 1999,
    s: 'spotify',
    d: ['MusicBrainz was niet bereikbaar; jaar van het Spotify-album', 'niet gevonden bij MusicBrainz; jaar van het Spotify-album'],
  };
  assert.equal(L.normaliseEntry(entry, NOW), null);
});

test('parseLookup: geldige unieke ID\'s, hoogstens 500', () => {
  assert.deepEqual(L.parseLookup({ ids: [ID, ID, 'slecht id', 5, null, ID2] }), { ids: [ID, ID2] });
  assert.deepEqual(L.parseLookup({ ids: [] }), { ids: [] });
  assert.deepEqual(L.parseLookup({ ids: Array.from({ length: 500 }, () => ID) }).ids, [ID]);
  for (const body of [{}, null, { ids: 'abc' }, { ids: { 0: ID } }]) {
    assert.throws(() => L.parseLookup(body), (err) => err instanceof GameError && err.code === 'BAD_REQUEST');
  }
  assert.throws(
    () => L.parseLookup({ ids: Array.from({ length: 501 }, () => ID) }),
    (err) => err instanceof GameError && err.code === 'TOO_MANY',
  );
});

test('parseEntries: ongeldige items vallen weg, dubbels tellen één keer', () => {
  const { entries, skipped } = L.parseEntries(
    {
      entries: [
        { id: ID, y: 1980, s: 'musicbrainz', d: [] },
        { id: 'fout!', y: 1980, s: 'musicbrainz' },
        { id: ID2, y: 1990, s: 'lijst' },
        { id: ID, y: 1981, s: 'handmatig' },
      ],
    },
    NOW,
  );
  assert.deepEqual(entries, [{ id: ID, y: 1981, s: 'handmatig', d: [] }]);
  assert.equal(skipped, 3);
  assert.throws(() => L.parseEntries({ entries: 'x' }), (err) => err.code === 'BAD_REQUEST');
  assert.throws(
    () => L.parseEntries({ entries: Array.from({ length: 501 }, () => ({ id: ID, y: 1980, s: 'spotify' })) }),
    (err) => err.code === 'TOO_MANY',
  );
});

const auto = (y, extra = {}) => ({ id: ID, y, s: 'musicbrainz', d: [], r: 2, ...extra });
const manual = (y) => ({ id: ID, y, s: 'handmatig', d: [] });

test('samenvoegen: handmatig wint en wordt nooit door een automatisch resultaat overschreven', () => {
  // Nieuw nummer: komt erbij.
  assert.deepEqual(L.mergeEntry(null, auto(1980)), auto(1980));
  // Handmatig vervangt automatisch.
  assert.deepEqual(L.mergeEntry(auto(1980), manual(1979)), manual(1979));
  // Automatisch vervangt handmatig nooit, ook niet met een hogere regelversie.
  assert.equal(L.mergeEntry(manual(1979), auto(1985)), null);
  assert.equal(L.mergeEntry(manual(1979), auto(1985, { r: 9 })), null);
  // Een nieuwere handmatige verbetering vervangt een oudere.
  assert.deepEqual(L.mergeEntry(manual(1979), manual(1978)), manual(1978));
  // Een nieuwer automatisch resultaat vervangt een ouder.
  assert.deepEqual(L.mergeEntry(auto(1980), auto(1982, { d: ['iets'] })), auto(1982, { d: ['iets'] }));
  // ... maar niet met oudere regels voor remixes dan wat er staat.
  assert.equal(L.mergeEntry(auto(1980), auto(1975, { r: 1 })), null);
  const noR = { id: ID, y: 1975, s: 'spotify', d: [] };
  assert.equal(L.mergeEntry(auto(1980), noR), null);
  assert.deepEqual(L.mergeEntry(noR, auto(1980)), auto(1980));
  // Niets veranderd: niets te schrijven.
  assert.equal(L.mergeEntry(auto(1980), auto(1980)), null);
  assert.equal(L.mergeEntry(manual(1979), manual(1979)), null);
  assert.equal(L.mergeEntry(auto(1980), null), null);
});

test('mergeEntries geeft alleen wat verandert en respecteert de bovengrens', () => {
  const existing = new Map([[ID, manual(1979)]]);
  const third = 'abcdefghijABCDEFGHIJ12';
  const changed = L.mergeEntries(existing, [auto(1985), { ...auto(1990), id: ID2 }, { ...auto(1991), id: third }]);
  assert.deepEqual(
    changed.map((e) => e.id),
    [ID2, third],
  );
  // Lijst vol: nieuwe nummers komen er niet meer bij, bestaande kunnen nog verbeterd worden.
  const full = L.mergeEntries(existing, [manual(1970), { ...auto(1990), id: ID2 }, { ...auto(1991), id: third }], 1);
  assert.deepEqual(
    full.map((e) => [e.id, e.y]),
    [
      [ID, 1970],
      [ID2, 1990],
    ],
  );
  assert.deepEqual(L.mergeEntries(existing, [{ ...auto(1990), id: ID2 }], 0), []);
});

test('publicEntry geeft alleen jaar, bron, twijfels en regelversie terug', () => {
  assert.deepEqual(L.publicEntry({ id: ID, y: 1980, s: 'spotify', d: ['x'], r: 2, t: 123 }), { y: 1980, s: 'spotify', d: ['x'], r: 2 });
  assert.deepEqual(L.publicEntry({ id: ID, y: 1980, s: 'spotify', d: [] }), { y: 1980, s: 'spotify', d: [] });
  // Jaren per bron gaan mee.
  assert.deepEqual(L.publicEntry({ id: ID, y: 1980, s: 'musicbrainz', d: [], r: 3, b: { sp: 2001, mb: 1980, wd: 1980 }, title: 'Lied', artist: 'Band', at: 5 }), {
    y: 1980,
    s: 'musicbrainz',
    d: [],
    r: 3,
    b: { sp: 2001, mb: 1980, wd: 1980 },
  });
});

test('normaliseEntry: jaren per bron en Wikidata als bron', () => {
  const e = L.normaliseEntry(
    {
      id: ID,
      y: 1973,
      s: 'wikidata',
      d: [],
      r: 3,
      b: { sp: 1999, mb: null, wd: 1973, xx: 1950, extra: 'weg' },
    },
    NOW,
  );
  assert.deepEqual(e, { id: ID, y: 1973, s: 'wikidata', d: [], r: 3, b: { sp: 1999, mb: null, wd: 1973 } });
  // Ongeldige jaren per bron vallen weg; niets over: geen b.
  const bad = L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', b: { sp: '1990', mb: 1800, wd: 2030, b: 1990 } }, NOW);
  assert.equal('b' in bad, false);
  for (const b of ['x', [1990], null, 5]) assert.equal('b' in L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', b }, NOW), false);
});

test('samenvoegen: een oudere site wist de jaren per bron niet', () => {
  const named = { ...auto(1980), r: 3, b: { sp: 1990, mb: 1980 } };
  const older = { id: ID, y: 1981, s: 'musicbrainz', d: [], r: 3 };
  assert.deepEqual(L.mergeEntry(named, older), { ...older, b: named.b });
  assert.deepEqual(L.mergeEntry(named, manual(1978)), { ...manual(1978), b: named.b });
  assert.equal(L.mergeEntry(named, auto(1975)), null);
  assert.deepEqual(L.mergeEntry(named, { ...named, b: { sp: 1990, mb: 1980, wd: 1980 } }).b, { sp: 1990, mb: 1980, wd: 1980 });
});


test('authenticateHost: alleen de host van het spel', () => {
  const state = room.createRoomState('ABCD');
  const host = room.join(state, 'Hanne');
  const guest = room.join(state, 'Bob');
  assert.equal(room.authenticateHost(state, host.token), host.playerId);
  assert.throws(() => room.authenticateHost(state, guest.token), (err) => err.code === 'HOST_ONLY');
  for (const token of [undefined, '', 'kort', 'x'.repeat(32), 123]) {
    assert.throws(() => room.authenticateHost(state, token), (err) => err.code === 'BAD_TOKEN');
  }
});
