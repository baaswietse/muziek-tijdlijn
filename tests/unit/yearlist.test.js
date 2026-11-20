// Tests voor de gedeelde lijst met jaartallen op de server (server/src/yearlist.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../server/src/yearlist.js';
import * as room from '../../server/src/room.js';
import { GameError } from '../../server/src/rules.js';

const NOW = Date.UTC(2026, 5, 1);
const ID = '4uLU6hMCjMI75M1A2tKUQC';
const ID2 = '7ouMYWpwJ422jRcDASZB7P';

test('normaliseEntry houdt alleen id, jaar, bron, twijfels, regelversie, jaren per bron, titel en artiest over', () => {
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
  // Jaren per bron gaan mee; titel en artiest niet, alleen of ze er zijn.
  assert.deepEqual(L.publicEntry({ id: ID, y: 1980, s: 'musicbrainz', d: [], r: 3, b: { sp: 2001, mb: 1980, wd: 1980 }, title: 'Lied', artist: 'Band', at: 5 }), {
    y: 1980,
    s: 'musicbrainz',
    d: [],
    r: 3,
    b: { sp: 2001, mb: 1980, wd: 1980 },
    named: true,
  });
  assert.equal('named' in L.publicEntry({ id: ID, y: 1980, s: 'spotify', d: [], title: 'Lied' }), false);
});

test('normaliseEntry: jaren per bron, Wikidata als bron, titel en artiest streng nagekeken', () => {
  const e = L.normaliseEntry(
    {
      id: ID,
      y: 1973,
      s: 'wikidata',
      d: [],
      r: 3,
      b: { sp: 1999, mb: null, wd: 1973, xx: 1950, extra: 'weg' },
      title: '  Sebastian\u0000 \n (Remastered)\u202e ',
      artist: 'Steve Harley & Cockney Rebel',
    },
    NOW,
  );
  assert.deepEqual(e, { id: ID, y: 1973, s: 'wikidata', d: [], r: 3, b: { sp: 1999, mb: null, wd: 1973 }, title: 'Sebastian (Remastered)', artist: 'Steve Harley & Cockney Rebel' });
  // Ongeldige jaren per bron vallen weg; niets over: geen b.
  const bad = L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', b: { sp: '1990', mb: 1800, wd: 2030, b: 1990 } }, NOW);
  assert.equal('b' in bad, false);
  for (const b of ['x', [1990], null, 5]) assert.equal('b' in L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', b }, NOW), false);
  // Titel en artiest: platte tekst, hoogstens 120 tekens, geen andere soorten.
  const long = L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', title: 'x'.repeat(500), artist: 7 }, NOW);
  assert.equal(long.title.length, L.MAX_TEXT);
  assert.equal('artist' in long, false);
  assert.equal('title' in L.normaliseEntry({ id: ID, y: 1990, s: 'spotify', title: ' \u0007 ' }, NOW), false);
});

test('parseEntries: een item zonder bron vult alleen titel en artiest aan', () => {
  const { entries, skipped } = L.parseEntries({
    entries: [
      { id: ID, title: 'Lied', artist: 'Band' },
      { id: ID2, title: '', artist: '' }, // niets aan te vullen
      { id: 'fout!', title: 'Lied', artist: 'Band' },
      { id: ID2, y: 1990, title: 'Lied' }, // met jaar maar zonder bron: ongeldig
    ],
  }, NOW);
  assert.deepEqual(entries, [{ id: ID, title: 'Lied', artist: 'Band', fill: true }]);
  assert.equal(skipped, 3);
});

test('samenvoegen: titel aanvullen raakt het jaar niet, een oudere site wist geen titels', () => {
  const named = { ...auto(1980), r: 3, b: { sp: 1990, mb: 1980 }, title: 'Lied', artist: 'Band' };
  const fill = { id: ID, title: 'Lied', artist: 'Band', fill: true };
  // Aanvullen: alleen titel en artiest komen erbij, jaar, bron en twijfels blijven.
  assert.deepEqual(L.mergeEntry(auto(1980, { d: ['twijfel'] }), fill), { ...auto(1980, { d: ['twijfel'] }), title: 'Lied', artist: 'Band' });
  assert.deepEqual(L.mergeEntry(manual(1979), fill), { ...manual(1979), title: 'Lied', artist: 'Band' });
  // Wat er al staat, wordt niet overschreven; een onbekend nummer komt er niet bij.
  assert.equal(L.mergeEntry(named, { ...fill, title: 'Andere titel' }), null);
  assert.deepEqual(L.mergeEntry({ ...auto(1980), title: 'Lied' }, fill), { ...auto(1980), title: 'Lied', artist: 'Band' });
  assert.equal(L.mergeEntry(null, fill), null);
  assert.deepEqual(L.mergeEntries(new Map(), [fill]), []);
  // Een oudere site stuurt een item zonder titel, artiest en jaren per bron: die blijven.
  const older = { id: ID, y: 1981, s: 'musicbrainz', d: [], r: 3 };
  assert.deepEqual(L.mergeEntry(named, older), { ...older, b: named.b, title: 'Lied', artist: 'Band' });
  // Een handmatige verbetering houdt ze ook.
  assert.deepEqual(L.mergeEntry(named, manual(1978)), { ...manual(1978), b: named.b, title: 'Lied', artist: 'Band' });
  // Met oudere regels (r 2) dan wat er staat (r 3): niets.
  assert.equal(L.mergeEntry(named, auto(1975)), null);
  // Een nieuw resultaat met nieuwe jaren per bron vervangt die.
  assert.deepEqual(L.mergeEntry(named, { ...named, b: { sp: 1990, mb: 1980, wd: 1980 } }).b, { sp: 1990, mb: 1980, wd: 1980 });
});

test('export: alles wat bewaard is, in pagina\'s op track-ID', () => {
  assert.deepEqual(L.parseExport({}), { after: '', limit: L.EXPORT_PAGE });
  assert.deepEqual(L.parseExport({ after: ID, limit: 2 }), { after: ID, limit: 2 });
  for (const body of [{ after: 'fout!' }, { after: 5 }, { after: 'a'.repeat(65) }, { limit: 0 }, { limit: 501 }, { limit: '2' }, { limit: 1.5 }]) {
    assert.throws(() => L.parseExport(body), (err) => err.code === 'BAD_REQUEST');
  }
  const row = (i) => ({ id: `id${String(i).padStart(4, '0')}`, y: 1990, s: 'musicbrainz', d: [], r: 3, b: { sp: 1991, mb: 1990 }, title: 'T', artist: 'A', at: 1000 + i });
  const all = Array.from({ length: L.EXPORT_PAGE + 1 }, (_, i) => row(i));
  const first = L.exportPage(all);
  assert.equal(first.entries.length, L.EXPORT_PAGE);
  assert.equal(first.next, all[L.EXPORT_PAGE - 1].id);
  assert.deepEqual(first.entries[0], { id: 'id0000', y: 1990, s: 'musicbrainz', d: [], r: 3, b: { sp: 1991, mb: 1990 }, title: 'T', artist: 'A', at: 1000 });
  const last = L.exportPage(all.slice(L.EXPORT_PAGE));
  assert.deepEqual([last.entries.length, last.next], [1, null]);
  // Een oud item zonder de nieuwe velden.
  assert.deepEqual(L.exportPage([{ id: ID, y: 1975, s: 'spotify', d: [] }]), { entries: [{ id: ID, y: 1975, s: 'spotify', d: [], at: null }], next: null });
  assert.deepEqual(L.exportPage([]), { entries: [], next: null });
  // Kleinere pagina's.
  assert.deepEqual(L.exportPage(all.slice(0, 3), 2).next, 'id0001');
  assert.deepEqual(L.exportPage(all.slice(0, 2), 2).next, null);
});

// ---------- testrijen ----------

// De vormen van verzonnen ID's die de tests ooit schreven (tests/e2e/fake-spotify.js):
// eerst `zz${run}${label}` met nullen tot 22, nu met de lengte van het label erbij.
const OLD_FAKE = `zz${'0123456789abcde'}G1`.padEnd(22, '0');
const NEW_FAKE = `zz${'0123456789abcde'}2G1`.padEnd(22, '0');

test('possibleSpotifyId: 22 tekens base62, eerste teken 0 tot 7', () => {
  for (const id of [ID, ID2, '0000000000000000000000', '7zzzzzzzzzzzzzzzzzzzzz', '1A2b3C4d5E6f7G8h9I0jKl']) {
    assert.equal(L.possibleSpotifyId(id), true, id);
  }
  for (const id of [OLD_FAKE, NEW_FAKE, '8aaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaaaaaaa', 'Zaaaaaaaaaaaaaaaaaaaaa', ID.slice(1), ID + 'x', 'dz-3135556', '4uLU6hMCjMI75M1A2tKU-C', '', null, 5]) {
    assert.equal(L.possibleSpotifyId(id), false, String(id));
  }
  // Het grootste getal van 128 bits in base62 begint met een 7.
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = (1n << 128n) - 1n;
  let max = '';
  while (n > 0n) {
    max = ALPHABET[Number(n % 62n)] + max;
    n /= 62n;
  }
  assert.equal(max.length, 22);
  assert.equal(max[0], '7');
  assert.equal(L.possibleSpotifyId(max), true);
});

test('isTestId: alleen verzonnen ID\'s die met zz beginnen; echte nummers en fragmenten nooit', () => {
  // Alle vormen die de tests schreven en schrijven.
  for (const id of [OLD_FAKE, NEW_FAKE, 'zz', 'zzx', 'zz' + 'a'.repeat(62), 'zz_-x']) assert.equal(L.isTestId(id), true, id);
  // Bij twijfel blijft een rij staan: een echt Spotify-ID, een fragment van Deezer,
  // en elke andere vorm die geen Spotify-ID is maar ook niet als test herkend wordt.
  for (const id of [
    ID,
    ID2,
    'dz-3135556',
    'dz-1',
    'zZabc',
    'Zzabc',
    'z',
    'yzzzzzzzzzzzzzzzzzzzzz',
    'azzzzzzzzzzzzzzzzzzzzz',
    'x0',
    'id0001',
    'abcdefghijABCDEFGHIJ12',
    'zz' + 'a'.repeat(63), // te lang voor een track-ID
    'zz:track',
    '',
    null,
    undefined,
    7,
  ]) {
    assert.equal(L.isTestId(id), false, String(id));
  }
});

test('TEST_RANGE: precies de ID\'s die met zz beginnen', () => {
  assert.deepEqual(L.TEST_RANGE, { from: 'zz', to: 'z{' });
  const inRange = (id) => id >= L.TEST_RANGE.from && id < L.TEST_RANGE.to;
  // De tekens van een track-ID: A-Z a-z 0-9 _ -
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  for (const a of chars) {
    for (const b of chars) {
      for (const tail of ['', '0', 'zz', '_-']) {
        const id = a + b + tail;
        assert.equal(inRange(id), id.startsWith('zz'), id);
      }
    }
  }
  assert.equal(inRange('z'), false);
  assert.equal(inRange('zz'), true);
});

test('purgeSettings: standaard een uur en tien minuten; alleen gehele getallen >= 0 tellen', () => {
  assert.deepEqual(L.purgeSettings(), { maxAge: 3_600_000, every: 600_000, batch: L.PURGE_BATCH });
  assert.deepEqual(L.purgeSettings({ YEARS_TEST_MAX_AGE_MS: '2000', YEARS_PURGE_EVERY_MS: '0' }), { maxAge: 2000, every: 0, batch: L.PURGE_BATCH });
  for (const bad of ['', '-1', '1.5', 'abc', null]) {
    assert.deepEqual(L.purgeSettings({ YEARS_TEST_MAX_AGE_MS: bad, YEARS_PURGE_EVERY_MS: bad }), L.purgeSettings(), String(bad));
  }
  assert.equal(L.PURGE_BATCH, 500);
});

const HOUR = 60 * 60 * 1000;
const rowAt = (id, ageMs) => ({ id, y: 1990, s: 'spotify', d: [], at: NOW - ageMs });

test('expiredTestIds: alleen testrijen ouder dan de grens; echte rijen, fragmenten en verse testrijen blijven', () => {
  const rows = [
    rowAt(ID, 10 * HOUR), // echt, oud: blijft
    rowAt('dz-3135556', 10 * HOUR), // fragment, oud: blijft
    rowAt('abcdefghijABCDEFGHIJ12', 10 * HOUR), // geen Spotify-ID maar ook geen test: blijft
    rowAt(OLD_FAKE, HOUR + 1), // oudere vorm, net te oud: weg
    rowAt(NEW_FAKE, 2 * HOUR), // weg
    rowAt('zz' + 'b'.repeat(20), HOUR), // precies een uur: blijft nog
    rowAt('zz' + 'c'.repeat(20), 5 * 60 * 1000), // vers (een lopende testrun): blijft
    { id: 'zz' + 'd'.repeat(20), y: 1990, s: 'spotify', d: [] }, // zonder tijdstip: blijft
    { id: 'zz' + 'e'.repeat(20), at: null },
  ];
  assert.deepEqual(L.expiredTestIds(rows, NOW), [OLD_FAKE, NEW_FAKE]);
  assert.deepEqual(L.expiredTestIds(rows, NOW, { maxAge: 0, batch: 10 }), [OLD_FAKE, NEW_FAKE, 'zz' + 'b'.repeat(20), 'zz' + 'c'.repeat(20)]);
  assert.deepEqual(L.expiredTestIds([], NOW), []);
});

test('expiredTestIds: hoogstens één partij', () => {
  const many = Array.from({ length: 1200 }, (_, i) => rowAt(`zz${String(i).padStart(20, '0')}`, 2 * HOUR));
  const ids = L.expiredTestIds(many, NOW);
  assert.equal(ids.length, L.PURGE_BATCH);
  assert.deepEqual(ids, many.slice(0, L.PURGE_BATCH).map((r) => r.id));
  assert.equal(L.expiredTestIds(many, NOW, { batch: 3 }).length, 3);
  // Stopt met lezen zodra de partij vol is (een generator wordt niet verder doorlopen).
  let read = 0;
  function* rows() {
    for (const r of many) {
      read++;
      yield r;
    }
  }
  L.expiredTestIds(rows(), NOW, { batch: 5 });
  assert.equal(read, 6);
});

test('TestRowCleaner: hoogstens eens per zoveel tijd, meteen weer na een volle partij', () => {
  const store = new Map();
  const add = (id, at) => store.set(id, { id, at });
  for (let i = 0; i < 7; i++) add(`zz${String(i).padStart(20, '0')}`, 0);
  add(ID, 0);
  add('dz-1', 0);
  const asked = [];
  const candidates = (cutoff, batch) => {
    asked.push({ cutoff, batch });
    return [...store.values()].filter((r) => r.at < cutoff);
  };
  const remove = (ids) => ids.forEach((id) => store.delete(id));
  const cleaner = new L.TestRowCleaner({ maxAge: 1000, every: 600_000, batch: 3 });

  // Nog niets oud genoeg: niets weg, en de volgende keer pas na `every`.
  assert.equal(cleaner.run(500, candidates, remove), 0);
  assert.deepEqual(asked, [{ cutoff: -500, batch: 3 }]);
  assert.equal(cleaner.run(2000, candidates, remove), 0);
  assert.equal(asked.length, 1, 'te vroeg: niet eens gezocht');

  // Na `every`: een volle partij weg, en dan meteen bij het volgende verzoek weer.
  assert.equal(cleaner.run(600_500, candidates, remove), 3);
  assert.equal(cleaner.run(600_501, candidates, remove), 3);
  // Een halve partij: klaar, en weer wachten.
  assert.equal(cleaner.run(600_502, candidates, remove), 1);
  assert.equal(cleaner.run(600_503, candidates, remove), 0);
  assert.equal(asked.length, 4);
  assert.deepEqual([...store.keys()], [ID, 'dz-1']);
  // Ook met every 0 (de tests) blijft wat echt is staan.
  const eager = new L.TestRowCleaner({ maxAge: 0, every: 0, batch: 500 });
  assert.equal(eager.run(10_000, candidates, remove), 0);
  assert.deepEqual([...store.keys()], [ID, 'dz-1']);
});

test('TestRowCleaner: de eerste keer meteen (na een herstart of na de eerste deploy)', () => {
  const store = new Map([[NEW_FAKE, { id: NEW_FAKE, at: NOW - 30 * 24 * HOUR }], [ID, { id: ID, at: NOW - 30 * 24 * HOUR }]]);
  const cleaner = new L.TestRowCleaner();
  const removed = cleaner.run(NOW, () => store.values(), (ids) => ids.forEach((id) => store.delete(id)));
  assert.equal(removed, 1);
  assert.deepEqual([...store.keys()], [ID]);
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
