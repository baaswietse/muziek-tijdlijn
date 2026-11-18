// Tests voor Wikidata als derde bron (web/src/lib/wikidata.js) en de beslisregel
// met drie bronnen (decide in web/src/lib/years.js). Zonder netwerk: Wikidata
// is nagebootst. Dezelfde gevallen als tools/test_tracks.py.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../../web/src/lib/wikidata.js';
import * as Y from '../../web/src/lib/years.js';

const SEP = '\u001f';
/** Een rij zoals de zoekdienst ze teruggeeft (na wdSearch). */
const row = (q, labels, performers, dates, types = 'Q134556') => ({
  q,
  item: 'http://www.wikidata.org/entity/Q1',
  labels: [labels].flat().join(SEP),
  performers: [performers].flat().join(SEP),
  dates: [dates].flat().filter(Boolean).map((d) => `${d}-01-01T00:00:00Z`).join(' '),
  types,
});

test('wdTitle en wdUseful', () => {
  assert.equal(W.wdTitle('Hips Don’t Lie (feat. Wyclef Jean)'), "hips don't lie");
  assert.equal(W.wdTitle('Hotel California - 2013 Remaster'), 'hotel california');
  assert.equal(W.wdTitle('Roses - Imanbek Remix'), 'roses');
  assert.equal(W.wdUseful('Hotel California - 2013 Remaster'), true);
  // Wikidata beschrijft het origineel: niet vragen voor remixes, live-opnames en heropnames.
  assert.equal(W.wdUseful('Roses - Imanbek Remix'), false);
  assert.equal(W.wdUseful('Pump It - Live 2022'), false);
  assert.equal(W.wdUseful('Love Story (Taylor’s Version)'), false);
});

test('wdSearches: ook zonder haakjes (Heaven Must Be Missing an Angel (Pt. 1) heet in Wikidata zonder)', () => {
  assert.deepEqual(W.wdSearches('Heaven Must Be Missing an Angel (Pt. 1)'), ['heaven must be missing an angel (pt. 1)', 'heaven must be missing an angel']);
  assert.deepEqual(W.wdSearches('Radar Love'), ['radar love']);
  const rows = [row('heaven must be missing an angel', 'Heaven Must Be Missing an Angel', 'Tavares', ['1976-05', '1986-02'])];
  assert.equal(W.wdPick({ title: 'Heaven Must Be Missing an Angel (Pt. 1)', artists: ['Tavares'] }, rows).year, 1976);
});

test('wdQuery zoekt alle titels in één vraag, veilig geschreven', () => {
  const q = W.wdQuery(['radar love', 'een "lied" \\ met tekens']);
  assert.ok(q.includes('VALUES ?q { "radar love" "een \\"lied\\" \\\\ met tekens" }'));
  assert.ok(q.includes('mwapi:search ?q'));
  assert.ok(q.includes('wdt:P175'));
  assert.ok(q.includes('wdt:P577'));
});

test('wdPick: titel én uitvoerder moeten passen; albums en video\'s tellen niet; het vroegste jaar', () => {
  const rows = [
    row('radar love', 'Radar Love', 'Golden Earring', ['1973-07', '1974']),
    row('radar love', 'Radar Love', 'Golden Earring', '1971', 'Q482994'), // album met dezelfde titel
    row('radar love', 'Radar Love', 'Golden Earring', '1970', 'Q193977'), // videoclip
    row('radar love', 'Radar Love', 'White Lion', '1989'), // cover
    row('radar love', 'Radar Love (Live)', 'Golden Earring', '1960'), // andere titel
    row('radar love', 'Radar Love', 'Golden Earring', '1972', 'Q482994 Q134556'), // album én single: telt
    row('iets anders', 'Radar Love', 'Golden Earring', '1950'),
  ];
  assert.deepEqual(W.wdPick({ title: 'Radar Love', artists: ['Golden Earring'] }, rows), { year: 1972, items: 2 });
  assert.deepEqual(W.wdPick({ title: 'Radar Love', artists: ['Iemand'] }, rows), { year: null, items: 0 });
  // Accenten, hoofdletters en "The" maken niet uit; een tweede artiest volstaat.
  const ch = [row('cowboy', 'Cowboy', ['Ch!pz', 'Chipz'], '2003')];
  assert.equal(W.wdPick({ title: 'Cowboy - Single Version', artists: ['Gast', 'Chipz'] }, ch).year, 2003);
});

test('wdSearch: één POST met een gewoon formulier; opnieuw bij drukte, opgeven bij lang wachten', async () => {
  const calls = [];
  let n = 0;
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    n++;
    if (n === 1) return { ok: false, status: 503, headers: { get: () => null } };
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: { bindings: [{ q: { value: 'radar love' }, item: { value: 'x' }, labels: { value: 'Radar Love' }, performers: { value: 'Golden Earring' }, dates: { value: '1973-01-01T00:00:00Z' }, types: { value: 'Q134556' } }] } }),
    };
  };
  const rows = await W.wdSearch(['radar love'], { fetchFn, interval: 0 });
  assert.equal(rows[0].labels, 'Radar Love');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, W.WD_URL);
  assert.equal(calls[0].init.method, 'POST');
  // Alleen headers waarvoor de browser niets vooraf vraagt (CORS).
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Accept', 'Content-Type']);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(new URLSearchParams(calls[0].init.body).get('query').includes('"radar love"'));

  // 429 met een veel te lange Retry-After: meteen opgeven (dan zonder Wikidata).
  const busy = async () => ({ ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '3600' : null) } });
  await assert.rejects(W.wdSearch(['x'], { fetchFn: busy, interval: 0 }), /te lang/);
  await assert.rejects(W.wdSearch(['x'], { fetchFn: async () => ({ ok: false, status: 400 }), interval: 0 }), /400/);
});

test('wdLookup: blokken van 25 titels, geen remixes of live; faalt een blok, dan stopt het', async () => {
  const tracks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `Lied ${i}`, artists: ['Band'] }));
  tracks.push({ id: 'remix', title: 'Lied 1 - X Remix', artists: ['Band'] }, { id: 'dubbel', title: 'Lied 2 - Remastered', artists: ['Band'] });
  const asked = [];
  const fetchFn = async (url, init) => {
    const query = new URLSearchParams(init.body).get('query');
    const titles = [...query.matchAll(/"(lied \d+)"/g)].map((m) => m[1]);
    asked.push(titles);
    return { ok: true, status: 200, json: async () => ({ results: { bindings: titles.map((t) => Object.fromEntries(Object.entries(row(t, t, 'Band', '1990')).map(([k, v]) => [k, { value: v }]))) } }) };
  };
  const seen = [];
  const out = await W.wdLookup(tracks, { fetchFn, interval: 0, onResult: (id) => seen.push(id) });
  assert.deepEqual(asked.map((a) => a.length), [25, 5]);
  assert.equal(out.get('t0').year, 1990);
  assert.equal(out.get('dubbel').year, 1990); // zelfde titel als t2: één keer gevraagd
  assert.equal(out.has('remix'), false);
  assert.equal(seen.length, 31);
  assert.equal(out.failed, undefined);

  let n = 0;
  const flaky = async (url, init) => (++n === 1 ? fetchFn(url, init) : { ok: false, status: 400 });
  const half = await W.wdLookup(tracks, { fetchFn: flaky, interval: 0 });
  assert.equal(half.size, 26);
  assert.equal(half.failed, true);
});

// ---------------------------------------------------------------- beslissen met drie bronnen
// Echte gevallen (november 2026), met wat elke bron zei.

const mb = (year, extra = {}) => ({ year, official: true, method: 'exact', raw: year, count: 5, ...extra });
const pick = (title, s, m, w) => {
  const r = Y.decide({ title, spotifyYear: s }, m, w === undefined ? undefined : { year: w });
  return [r.year, r.source, r.doubts.length];
};

test('decide: twee bronnen die het eens zijn, winnen; Wikidata beslist bij onenigheid', () => {
  // Paint It, Black: MusicBrainz 1964 (één uitgave), Spotify en Wikidata 1966.
  // (het latere jaar van MusicBrainz zelf telt dan: bron musicbrainz)
  assert.deepEqual(pick('Paint It, Black', 1966, mb(1964, { count: 1, next: 1966 }), 1966), [1966, 'musicbrainz', 0]);
  // Radar Love zonder de regel voor verzamelaars: Spotify en Wikidata 1973.
  assert.deepEqual(pick('Radar Love', 1973, mb(1971, { count: 1 }), 1973), [1973, 'spotify', 0]);
  // Smoke on the Water: Spotify een heruitgave (1998), MusicBrainz 1972, Wikidata 1973 (de single).
  assert.deepEqual(pick('Smoke on the Water', 1998, mb(1972), 1973), [1972, 'musicbrainz', 0]);
  // Sebastian: beide te laat, Wikidata 1973: Wikidata, maar met twijfel.
  const seb = Y.decide({ title: 'Sebastian', spotifyYear: 1999 }, mb(1987, { count: 3 }), { year: 1973 });
  assert.deepEqual([seb.year, seb.source, seb.doubts], [1973, 'wikidata', ['Spotify zegt 1999, MusicBrainz 1987, Wikidata 1973']]);
  assert.deepEqual(seb.b, { sp: 1999, mb: 1987, wd: 1973 });
  // Geen overeenstemming en MusicBrainz maar één uitgave: twijfel.
  assert.deepEqual(pick('Tim', 1998, mb(1975, { count: 1 }), null), [1975, 'musicbrainz', 1]);
  // MusicBrainz met meerdere uitgaven vóór een heruitgave bij Spotify: geen twijfel, ook zonder Wikidata.
  assert.deepEqual(pick('Insomnia', 2014, mb(1995, { count: 6 }), 2005), [1995, 'musicbrainz', 0]);
  assert.deepEqual(pick('Insomnia', 2014, mb(1995, { count: 6 }), undefined), [1995, 'musicbrainz', 0]);
});

test('decide: één jaar verschil is niet vanzelf eens (een losse, fout gedateerde vroegste uitgave)', () => {
  // I Gotta Feeling: één album "uit 2008" bij MusicBrainz, daarna tientallen uitgaven in 2009.
  assert.deepEqual(pick('I Gotta Feeling', 2009, mb(2008, { count: 1, next: 2009 }), 2009), [2009, 'musicbrainz', 0]);
  // The Real Slim Shady, Since U Been Gone, Can't Stop Loving You: hetzelfde patroon.
  assert.deepEqual(pick('The Real Slim Shady', 2000, mb(1999, { count: 1, next: 2000 }), 2000), [2000, 'musicbrainz', 0]);
  assert.deepEqual(pick('Since U Been Gone', 2004, mb(2003, { count: 1, next: 2004 }), 2004), [2004, 'musicbrainz', 0]);
  // Maar een echte vroege single blijft: Go Your Own Way (single 1976, album 1977); Wikidata zegt 1976.
  assert.deepEqual(pick('Go Your Own Way', 1977, mb(1976, { count: 1, next: 1977 }), 1976), [1976, 'musicbrainz', 0]);
  // Zonder Wikidata zoals vroeger: het vroegste.
  assert.deepEqual(pick('Jolene', 1974, mb(1973, { count: 1, next: 1974 }), undefined), [1973, 'musicbrainz', 0]);
  // Wikidata draagt vaak de datum van de single, een jaar na het album: dat verandert niets.
  assert.deepEqual(pick('Beat It', 1982, mb(1982, { count: 12 }), 1983), [1982, 'musicbrainz', 0]);
  assert.deepEqual(pick('Hotel California', 1976, mb(1976, { count: 8 }), 1977), [1976, 'musicbrainz', 0]);
  // Spotify een jaar te vroeg, MusicBrainz en Wikidata precies eens.
  assert.deepEqual(pick('Lied', 2008, mb(2009), 2009), [2009, 'musicbrainz', 0]);
});

test('decide: remixes, live-opnames en heropnames negeren Wikidata', () => {
  // Wikidata beschrijft het origineel; een remix krijgt nooit het jaar van het origineel.
  const remix = Y.decide({ title: 'Roses - Imanbek Remix', spotifyYear: 2019 }, { year: null }, { year: 2016 });
  assert.deepEqual([remix.year, remix.source, remix.doubts], [2019, 'spotify', ['remix niet gevonden bij MusicBrainz; jaar van het Spotify-album']]);
  assert.equal('wd' in remix.b, false);
  assert.deepEqual(pick('Pump It - Live 2022', 2023, mb(2023), 2021), [2023, 'musicbrainz', 0]);
  assert.deepEqual(pick('Love Story (Taylor’s Version)', 2021, mb(2008, { count: 9 }), 2008)[0], 2008);
});

test('decide: MusicBrainz vindt niets of is niet gevraagd', () => {
  // Ch!pz – Cowboy: MusicBrainz kent de artiest niet onder die naam; Spotify 2005, Wikidata 2003.
  const cow = Y.decide({ title: 'Cowboy - Single Version', spotifyYear: 2005 }, { year: null }, { year: 2003 });
  assert.deepEqual([cow.year, cow.source, cow.doubts], [2003, 'wikidata', ['niet gevonden bij MusicBrainz; Spotify zegt 2005, Wikidata 2003']]);
  // Spotify en Wikidata eens: geen twijfel.
  assert.deepEqual(pick('Lied', 2004, { year: null }, 2004), [2004, 'spotify', 0]);
  // Alleen Wikidata: met twijfel.
  assert.deepEqual(pick('Lied', null, { year: null }, 2004), [2004, 'wikidata', 1]);
  // Niets: geen jaar.
  assert.deepEqual(pick('Lied', null, { year: null }, null), [null, 'onbekend', 1]);
  // MusicBrainz en Wikidata zonder Spotify-jaar.
  assert.deepEqual(pick('Lied', null, mb(2008), 2012), [2008, 'musicbrainz', 1]);
  assert.deepEqual(pick('Lied', null, mb(2008), 2009), [2008, 'musicbrainz', 0]);
  // Zonder Spotify-jaar geen sprong naar een later jaar (Aerials: album 2001, single 2002).
  assert.deepEqual(pick('Aerials', null, mb(2001, { count: 1, next: 2002 }), 2002), [2001, 'musicbrainz', 0]);
});
