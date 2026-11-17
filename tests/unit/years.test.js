// Tests voor het opzoeken van jaartallen in de browser (web/src/lib/years.js).
// Dezelfde gevallen als tools/test_tracks.py, zodat beide versies gelijk blijven.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from '../../web/src/lib/years.js';

function rel(date, status = 'Official', secondary = []) {
  return { date, status, 'release-group': { 'primary-type': 'Album', 'secondary-types': secondary } };
}

/** Een opname zoals MusicBrainz ze teruggeeft; zonder `releases` één officiële studio-uitgave. */
function rec(title, artist, first, mbid = 'x', { aliases = [], releases } = {}) {
  return {
    id: mbid,
    title,
    'first-release-date': first,
    'artist-credit': [{ name: artist, artist: { name: artist, aliases: aliases.map((name) => ({ name })) } }],
    releases: releases ?? [rel(first)],
  };
}

test('cleanTitle haalt versie-aanduidingen weg', () => {
  const cases = {
    'Bohemian Rhapsody - Remastered 2011': 'Bohemian Rhapsody',
    'The Trooper - 1998 Remastered Version': 'The Trooper',
    'Whole Lotta Love - 1990 Remaster': 'Whole Lotta Love',
    'Fade To Black - Remastered': 'Fade To Black',
    'Paranoid (2012 Remaster)': 'Paranoid',
    'Enter Sandman - Live': 'Enter Sandman',
    'Song [feat. Iemand]': 'Song',
    'Heroes - Single Version; 2014 Remaster': 'Heroes',
    'Black - 2009': 'Black',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(Y.cleanTitle(raw), want, raw);
});

test('cleanTitle laat echte titels met rust', () => {
  for (const title of [
    "The Final Episode (Let's Change Channel)",
    "Rollin' (Air Raid Vehicle)",
    'Numb / Encore',
    "(I Can't Get No) Satisfaction",
    'Live and Let Die',
    'Alive',
    'Part of Me - Part 2',
  ]) {
    assert.equal(Y.cleanTitle(title), title);
  }
});

test('isLive herkent live-opnames', () => {
  assert.equal(Y.isLive('Enter Sandman - Live'), true);
  assert.equal(Y.isLive('Alive (Live at Wembley)'), true);
  assert.equal(Y.isLive('Live and Let Die'), false);
  assert.equal(Y.isLive('Bohemian Rhapsody - Remastered 2011'), false);
});

test('norm maakt namen vergelijkbaar', () => {
  assert.equal(Y.norm('Motörhead'), 'motorhead');
  assert.equal(Y.norm('JAŸ-Z'), Y.norm('JAY‐Z'));
  assert.equal(Y.norm("Guns N' Roses"), Y.norm('Guns N’ Roses'));
  assert.equal(Y.norm('The Rolling Stones'), 'rolling stones');
  assert.equal(Y.norm('Simon & Garfunkel'), Y.norm('Simon and Garfunkel'));
  assert.equal(Y.norm('AC/DC'), 'ac dc');
});

test('titleMatches en artistMatches', () => {
  assert.equal(Y.titleMatches('Numb/Encore', 'Numb / Encore'), true);
  assert.equal(Y.titleMatches('Bohemian Rhapsody (live at Wembley)', 'Bohemian Rhapsody'), true);
  assert.equal(Y.titleMatches("The Final Episode (Let's Change the Channel)", "The Final Episode (Let's Change Channel)"), true);
  assert.equal(Y.titleMatches('Bohemian Rhapsody Medley', 'Bohemian Rhapsody'), false);

  assert.equal(Y.artistMatches(rec('x', 'Queen', '1975'), ['Queen']), true);
  assert.equal(Y.artistMatches(rec('x', 'Simon & Garfunkel', '1964'), ['Disturbed']), false);
  assert.equal(Y.artistMatches(rec('x', 'JAY‐Z', '2004'), ['JAŸ-Z', 'Linkin Park']), true);
  assert.equal(Y.artistMatches(rec('x', 'Prins', '1984', 'x', { aliases: ['Prince'] }), ['Prince']), true);
  assert.equal(Y.artistMatches(rec('x', 'Queen', '1975'), []), false);
});

test('songKey herkent dubbels', () => {
  assert.equal(Y.songKey('Toxicity', ['System Of A Down']), Y.songKey('Toxicity - Remastered', ['System of a Down', 'Gast']));
  assert.notEqual(Y.songKey('Toxicity', ['System Of A Down']), Y.songKey('Aerials', ['System Of A Down']));
});

test('yearOf', () => {
  assert.equal(Y.yearOf('1984-07-27'), 1984);
  assert.equal(Y.yearOf('1984'), 1984);
  assert.equal(Y.yearOf(''), null);
  assert.equal(Y.yearOf(null), null);
  assert.equal(Y.yearOf('0001'), null);
});

test('pickYear: vroegste passende opname', () => {
  const found = Y.pickYear(
    [
      rec('Bohemian Rhapsody', 'Queen', '1992-05-01', 'late'),
      rec('Bohemian Rhapsody', 'Queen', '1975-10-31', 'first'),
      rec('Bohemian Rhapsody', 'Andere Band', '1960', 'cover'),
      rec('Iets Anders', 'Queen', '1950', 'other'),
      rec('Bohemian Rhapsody', 'Queen', '', 'nodate'),
      rec('Bohemian Rhapsody', 'Queen', '0001', 'bogus'),
    ],
    'Bohemian Rhapsody',
    ['Queen'],
  );
  assert.equal(found.year, 1975);
  assert.equal(found.mbid, 'first');
  assert.equal(found.matches, 2);
  assert.equal(found.official, true);
  assert.equal(Y.pickYear([rec('A', 'B', '1990')], 'C', ['D']), null);
});

test('pickYear: bootlegs, live-albums en demo\'s tellen niet', () => {
  const studio = rec('Enter Sandman', 'Metallica', '1990', 'studio', {
    releases: [rel(null, 'Bootleg'), rel('1990', 'Bootleg'), rel('1991-08-12'), rel('2008-11-28'), rel('1990', 'Promotion')],
  });
  const live = rec('Enter Sandman', 'Metallica', '1978', 'live', { releases: [rel('1978', 'Bootleg', ['Live'])] });
  const officialLive = rec('Enter Sandman', 'Metallica', '1985', 'olive', { releases: [rel('1985', 'Official', ['Live'])] });
  const demo = rec('Enter Sandman', 'Metallica', '1989', 'demo', { releases: [rel('1989', 'Official', ['Demo'])] });
  const found = Y.pickYear([live, demo, officialLive, studio], 'Enter Sandman', ['Metallica']);
  assert.deepEqual([found.year, found.mbid, found.official], [1991, 'studio', true]);

  const onlyLive = rec('Zeldzaam', 'Band', '1999', 'l', { releases: [rel('1999', 'Official', ['Live'])] });
  const fallback = Y.pickYear([onlyLive], 'Zeldzaam', ['Band']);
  assert.deepEqual([fallback.year, fallback.official], [1999, false]);

  const comp = rec('Lied', 'Band', '1980', 'c', { releases: [rel('1980', 'Official', ['Compilation'])] });
  assert.equal(Y.pickYear([comp], 'Lied', ['Band']).year, 1980);
});

test('lookup: zoekt gericht naar oudere opnames', async () => {
  const calls = [];
  const search = async (query) => {
    calls.push(query);
    if (!query.includes('firstreleasedate')) return { recordings: [rec('Whole Lotta Love', 'Led Zeppelin', '1970', 'p1')], total: 600 };
    if (query.includes('TO 1969-12-31')) {
      // Het origineel staat ook op een live-compilatie: alleen zonder filter te vinden.
      if (query.includes('status:official')) return { recordings: [], total: 0 };
      return { recordings: [rec('Whole Lotta Love', 'Led Zeppelin', '1969-10-22', 'orig')], total: 1 };
    }
    return { recordings: [], total: 0 };
  };
  const found = await Y.lookup('Whole Lotta Love - 1990 Remaster', ['Led Zeppelin'], search);
  assert.deepEqual(found, { year: 1969, official: true, method: 'exact', mbid: 'orig' });
  assert.ok(calls[0].includes('recording:"Whole Lotta Love"'));
  assert.ok(!calls[0].includes('status:official'));
  assert.ok(calls[1].includes('status:official'));
  assert.ok(calls.at(-1).includes('TO 1968-12-31'));
  assert.equal(calls.length, 4);
});

test('lookup: oudere bootlegs vervangen geen officiële uitgave', async () => {
  const search = async (query) => {
    if (!query.includes('firstreleasedate')) return { recordings: [rec('Back in Black', 'AC/DC', '1980-07-25', 'studio')], total: 300 };
    return { recordings: [rec('Back in Black', 'AC/DC', '1978', 'boot', { releases: [rel('1978', 'Bootleg', ['Live'])] })], total: 1 };
  };
  const found = await Y.lookup('Back In Black', ['AC/DC'], search);
  assert.deepEqual([found.year, found.mbid], [1980, 'studio']);
});

test('lookup: studio-opname die niet op de eerste pagina staat', async () => {
  const calls = [];
  const search = async (query) => {
    calls.push(query);
    if (query.includes('firstreleasedate')) return { recordings: [], total: 0 };
    if (query.includes('status:official')) {
      return { recordings: [rec('Master of Puppets', 'Metallica', '1986', 'studio'), rec('Master of Puppets', 'Metallica', '2017', 'box')], total: 55 };
    }
    return {
      recordings: [
        rec('Master of Puppets', 'Metallica', '2017-11-10', 'box'),
        rec('Master of Puppets', 'Metallica', '2003', 'live', { releases: [rel('2003', 'Official', ['Live'])] }),
      ],
      total: 791,
    };
  };
  const found = await Y.lookup('Master Of Puppets', ['Metallica'], search);
  assert.deepEqual([found.year, found.mbid, found.official], [1986, 'studio', true]);
  assert.ok(calls[1].includes('NOT secondarytype:live'));
});

test('lookup: geen extra verzoek als alles gezien is, en niets gevonden', async () => {
  let calls = [];
  const one = async (query) => {
    calls.push(query);
    return { recordings: [rec('Prehistoric Dog', 'Red Fang', '2007')], total: 1 };
  };
  assert.equal((await Y.lookup('Prehistoric Dog', ['Red Fang'], one)).year, 2007);
  assert.equal(calls.length, 1);

  calls = [];
  const none = async (query) => {
    calls.push(query);
    return { recordings: [], total: 0 };
  };
  const found = await Y.lookup('Vreemd "Lied" (Demo Take)', ['Niemand'], none);
  assert.equal(found.year, null);
  assert.ok(calls.length >= 2);
  assert.ok(calls[0].includes('\\"Lied\\"'));
});

test('decide: vroegste van Spotify en MusicBrainz, met twijfels', () => {
  const t = { title: 'Bohemian Rhapsody - Remastered 2011', spotifyYear: 2011 };
  let r = Y.decide(t, { year: 1975, official: true, method: 'exact' });
  assert.deepEqual([r.year, r.source], [1975, 'musicbrainz']);
  assert.ok(r.doubts.some((d) => d.includes('Spotify zegt 2011')));

  r = Y.decide({ ...t, spotifyYear: 1975 }, { year: 1975, official: true, method: 'exact' });
  assert.deepEqual(r.doubts, []);
  r = Y.decide({ ...t, spotifyYear: 1975 }, { year: 1976, official: true, method: 'exact' });
  assert.deepEqual([r.year, r.source, r.doubts], [1975, 'spotify', []]);
  r = Y.decide({ ...t, spotifyYear: 1975 }, { year: 1992, official: true, method: 'exact' });
  assert.deepEqual([r.year, r.source, r.doubts.length], [1975, 'spotify', 1]);

  r = Y.decide(t, { year: null });
  assert.deepEqual([r.year, r.source], [2011, 'spotify']);
  assert.ok(r.doubts[0].includes('niet gevonden'));
  r = Y.decide({ title: 'X', spotifyYear: null }, null);
  assert.deepEqual([r.year, r.source], [null, 'onbekend']);

  r = Y.decide({ ...t, spotifyYear: 1975 }, { year: 1975, official: false, method: 'ruim' });
  assert.equal(r.doubts.length, 2);
  r = Y.decide({ title: 'Enter Sandman - Live', spotifyYear: 1991 }, { year: 1991, official: true, method: 'exact' });
  assert.deepEqual(r.doubts, ['live-opname']);
});

test('mbSearch: wacht tussen verzoeken, probeert opnieuw als de server bezet is en stopt op vraag', async () => {
  globalThis.__mtLookupInterval = 20;
  try {
    const times = [];
    let n = 0;
    const fetchFn = async (url) => {
      times.push(Date.now());
      n++;
      assert.ok(url.startsWith('https://musicbrainz.org/ws/2/recording?'));
      assert.ok(url.includes('fmt=json'));
      if (n === 1) return { ok: false, status: 503 };
      if (n === 2) throw new TypeError('netwerk weg');
      return { ok: true, status: 200, json: async () => ({ count: 7, recordings: [{ id: 'a' }] }) };
    };
    const out = await Y.mbSearch('recording:"x"', { fetchFn });
    assert.deepEqual(out, { recordings: [{ id: 'a' }], total: 7 });
    assert.equal(n, 3);
    assert.ok(times[1] - times[0] >= 20, 'pauze na een bezette server');

    // Een fout waar opnieuw proberen niet helpt.
    await assert.rejects(Y.mbSearch('q', { fetchFn: async () => ({ ok: false, status: 400 }) }), /400/);

    // Stoppen tijdens het wachten.
    const controller = new AbortController();
    const pending = Y.mbSearch('q', { fetchFn: async () => ({ ok: false, status: 503 }), signal: controller.signal });
    setTimeout(() => controller.abort(new Error('gestopt')), 30);
    await assert.rejects(pending, /gestopt/);
  } finally {
    delete globalThis.__mtLookupInterval;
  }
});
