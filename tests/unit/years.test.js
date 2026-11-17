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

/**
 * Een nagebootste MusicBrainz die zich gedraagt als de echte: de filters op
 * eerste release en studio-uitgave werken, en er komt hoogstens `limit`
 * opnames per pagina terug, met het totale aantal treffers.
 */
function index(recordings, { limit = 100, calls = [] } = {}) {
  return async (query) => {
    calls.push(query);
    let list = recordings;
    const to = /firstreleasedate:\[1900-01-01 TO (\d{4})-12-31\]/.exec(query);
    if (to) list = list.filter((r) => Y.yearOf(r['first-release-date']) !== null && Y.yearOf(r['first-release-date']) <= Number(to[1]));
    if (query.includes('status:official')) {
      // Zoals bij MusicBrainz telt dit per opname: één live-uitgave sluit ze al uit.
      const types = (r) => r.releases.flatMap((x) => x['release-group']['secondary-types'].map((t) => t.toLowerCase()));
      list = list.filter((r) => r.releases.some((x) => x.status === 'Official') && !types(r).some((t) => t === 'live' || t === 'demo'));
    }
    return { recordings: list.slice(0, limit), total: list.length };
  };
}

/** `n` live-opnames van een nummer, tussen `from` en `to`. */
function lives(title, artist, n, from, to) {
  return Array.from({ length: n }, (_, i) => {
    const year = String(from + (i % (to - from + 1)));
    return rec(title, artist, year, `live${i}`, { releases: [rel(year, 'Official', ['Live'])] });
  });
}

test('lookup: zoekt gericht naar oudere opnames', async () => {
  const calls = [];
  // Het origineel staat ook op een live-compilatie: alleen zonder studio-filter te vinden.
  const orig = rec('Whole Lotta Love', 'Led Zeppelin', '1969-10-22', 'orig', { releases: [rel('1969-10-22'), rel('1975', 'Official', ['Compilation', 'Live'])] });
  const search = index([rec('Whole Lotta Love', 'Led Zeppelin', '1970', 'p1'), ...lives('Whole Lotta Love', 'Led Zeppelin', 150, 1971, 2010), orig], { calls });
  const found = await Y.lookup('Whole Lotta Love - 1990 Remaster', ['Led Zeppelin'], search);
  assert.deepEqual(found, { year: 1969, official: true, method: 'exact', mbid: 'orig' });
  // Al een officiële uitgave op de eerste pagina (1970): meteen de oudere opnames
  // vragen. Die pagina is volledig, dus vroeger dan 1969 kan er niets meer zijn.
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('recording:"Whole Lotta Love"'));
  assert.ok(!calls[0].includes('status:official'));
  assert.ok(calls[1].includes('TO 1969-12-31'));
  assert.ok(!calls[1].includes('status:official'));
});

test('lookup: een officiële uitgave op de eerste pagina en een volledige pagina oudere opnames: klaar', async () => {
  const calls = [];
  const search = index(
    [
      rec('Lied', 'Band', '2001', 'heruitgave'),
      ...lives('Lied', 'Band', 120, 1990, 2020),
      rec('Lied', 'Band', '1975', 'orig'),
      rec('Lied', 'Band', '1972', 'boot', { releases: [rel('1972', 'Bootleg')] }),
    ],
    { calls },
  );
  // Vroeger 3 verzoeken: eerste pagina, studio-filter, ouder dan 1975.
  const found = await Y.lookup('Lied', ['Band'], search);
  assert.deepEqual([found.year, found.mbid, found.official], [1975, 'orig', true]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('TO 2000-12-31'));
});

test('lookup: zonder officiële uitgave op de eerste pagina blijft de studio-filter nodig', async () => {
  const calls = [];
  const search = index([rec('Ander lied', 'Band', '2001', 'ander'), ...lives('Lied', 'Band', 300, 1990, 2020), rec('Lied', 'Band', '1995', 'studio')], {
    calls,
  });
  const found = await Y.lookup('Lied', ['Band'], search);
  assert.deepEqual([found.year, found.mbid, found.official], [1995, 'studio', true]);
  assert.ok(calls[1].includes('NOT secondarytype:live'));
  assert.ok(!calls[1].includes('firstreleasedate'));
});

test('lookup: een officieel jaar na de bekeken jaren wordt nog nagekeken', async () => {
  // Een bootleg uit 1975 op de eerste pagina; een opname die eerst als bootleg
  // (1970) en pas in 1980 officieel uitkwam; en een die in 1977 officieel
  // uitkwam. Beide staan ook op een live-album: de studio-filter mist ze.
  const calls = [];
  const search = index(
    [
      rec('Lied', 'Band', '1975', 'boot75', { releases: [rel('1975', 'Bootleg')] }),
      ...lives('Lied', 'Band', 150, 1990, 2020),
      rec('Lied', 'Band', '1970', 'laat', { releases: [rel('1970', 'Bootleg'), rel('1980', 'Official', ['Compilation']), rel('1985', 'Official', ['Live'])] }),
      rec('Lied', 'Band', '1977', 'orig', { releases: [rel('1977'), rel('1990', 'Official', ['Live'])] }),
    ],
    { calls },
  );
  const found = await Y.lookup('Lied', ['Band'], search);
  // Officieel gaat voor op onofficieel; alle opnames vóór 1980 zijn bekeken: 1977.
  assert.deepEqual([found.year, found.mbid, found.official], [1977, 'orig', true]);
  assert.ok(calls.some((q) => q.includes('TO 1979-12-31')));
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
  // Zoals "Master of Puppets": honderden opnames, de eerste honderd zijn allemaal
  // live of heruitgaven, en ook vóór 2017 zijn er te veel om te overzien.
  const calls = [];
  const search = index(
    [
      rec('Master of Puppets', 'Metallica', '2017-11-10', 'box'),
      rec('Master of Puppets', 'Metallica', '2003', 'live', { releases: [rel('2003', 'Official', ['Live'])] }),
      ...lives('Master of Puppets', 'Metallica', 300, 1987, 2016),
      rec('Master of Puppets', 'Metallica', '1986', 'studio'),
    ],
    { calls },
  );
  const found = await Y.lookup('Master Of Puppets', ['Metallica'], search);
  assert.deepEqual([found.year, found.mbid, found.official], [1986, 'studio', true]);
  assert.ok(calls.some((q) => q.includes('NOT secondarytype:live') && q.includes('TO 2016-12-31')));
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

// ---------------------------------------------------------------- remixes
// Titels zoals Spotify en MusicBrainz ze echt schrijven (nagekeken in november 2026).

test('remixParts: alleen uitdrukkelijke remix-woorden maken een remix', () => {
  const remixes = {
    'A Little Less Conversation - JXL Radio Edit Remix': ['A Little Less Conversation', 'JXL Radio Edit Remix'],
    'Brimful of Asha - Norman Cook Remix Single Version': ['Brimful of Asha', 'Norman Cook Remix Single Version'],
    'Roses - Imanbek Remix': ['Roses', 'Imanbek Remix'],
    'Roses (Imanbek Remix)': ['Roses', 'Imanbek Remix'],
    'Ignition - Remix': ['Ignition', 'Remix'],
    'Titel (feat. Y) [X Remix]': ['Titel', 'X Remix'],
    'Titel - X Remix - Radio Edit': ['Titel', 'X Remix'],
    'Titel - X Remix (feat. Y)': ['Titel', 'X Remix'],
    'Titel (X Remix) - 2011 Remaster': ['Titel', 'X Remix'],
    'Titel - X Rmx': ['Titel', 'X Rmx'],
    'Titel - X Re-Work': ['Titel', 'X Re-Work'],
    'Titel (X Bootleg)': ['Titel', 'X Bootleg'],
    'Titel - Mash-Up': ['Titel', 'Mash-Up'],
    'Titel - X Refix': ['Titel', 'X Refix'],
    'Titel (Remixed by X)': ['Titel', 'Remixed by X'],
  };
  for (const [raw, [base, remix]] of Object.entries(remixes)) {
    assert.deepEqual(Y.remixParts(raw), { base, remix }, raw);
    assert.equal(Y.isRemix(raw), true, raw);
  }
  for (const title of [
    'Smalltown Boy - Extended Mix',
    'Blue Monday - Club Mix',
    'One More Time - Radio Edit',
    'Help! - 2009 Stereo Mix',
    'Heroes - Single Version',
    'Something - Remastered 2011',
    'Bohemian Rhapsody',
    'Remix',
    'Mixed Emotions',
    'Remix to Ignition',
  ]) {
    assert.equal(Y.isRemix(title), false, title);
  }
});

test('cleanTitle: de remix-aanduiding blijft, andere toevoegingen niet', () => {
  assert.equal(Y.cleanTitle('Roses - Imanbek Remix'), 'Roses (Imanbek Remix)');
  assert.equal(Y.cleanTitle('A Little Less Conversation - JXL Radio Edit Remix'), 'A Little Less Conversation (JXL Radio Edit Remix)');
  assert.equal(Y.cleanTitle('Titel (feat. Y) [X Remix]'), 'Titel (X Remix)');
  assert.equal(Y.cleanTitle('Smalltown Boy - Extended Mix'), 'Smalltown Boy');
  assert.equal(Y.cleanTitle('One More Time - Radio Edit'), 'One More Time');
  // Een remix en het origineel zijn geen dubbel.
  assert.notEqual(Y.songKey('Roses - Imanbek Remix', ['SAINt JHN']), Y.songKey('Roses', ['SAINt JHN']));
  assert.equal(Y.songKey('Roses - Imanbek Remix', ['SAINt JHN']), Y.songKey('Roses (Imanbek Remix)', ['SAINt JHN']));
  assert.equal(Y.isLive('Titel (X Remix) - Live'), true);
  assert.equal(Y.isLive('Roses - Imanbek Remix'), false);
});

test('titleMatches: een remix past alleen bij dezelfde remix', () => {
  const jxl = Y.cleanTitle('A Little Less Conversation - JXL Radio Edit Remix');
  assert.equal(Y.titleMatches('A Little Less Conversation (JXL radio edit remix)', jxl), true);
  assert.equal(Y.titleMatches('A Little Less Conversation [JXL radio edit remix]', jxl), true);
  assert.equal(Y.titleMatches('A Little Less Conversation (JXL remix)', jxl), true);
  assert.equal(Y.titleMatches('A Little Less Conversation', jxl), false);
  assert.equal(Y.titleMatches('A Little Less Conversation (vs JXL)', jxl), false);
  assert.equal(Y.titleMatches('A Little Less Conversation (JXL radio edit remix) (Elvis vs JXL)', jxl), false);

  const asha = Y.cleanTitle('Brimful of Asha - Norman Cook Remix Single Version');
  assert.equal(Y.titleMatches('Brimful of Asha (Norman Cook remix)', asha), true);
  assert.equal(Y.titleMatches('Brimful of Asha (The Norman Cook remix, single version)', asha), true);
  assert.equal(Y.titleMatches('Brimful of Asha (Norman Cook remix extended version)', asha), false);
  assert.equal(Y.titleMatches('Brimful of Asha (Norman Cook extended mix)', asha), false);
  assert.equal(Y.titleMatches('Brimful of Asha', asha), false);

  const ignition = Y.cleanTitle('Ignition - Remix');
  assert.equal(Y.titleMatches('Ignition (remix)', ignition), true);
  assert.equal(Y.titleMatches('Ignition - Remix', ignition), true);
  assert.equal(Y.titleMatches('Ignition (remix) (album version)', ignition), true);
  assert.equal(Y.titleMatches('Ignition (remix) (instrumental)', ignition), false);
  assert.equal(Y.titleMatches('Ignition (Slang Tech remix)', ignition), false);
  assert.equal(Y.titleMatches('Ignition', ignition), false);

  const roses = Y.cleanTitle('Roses (feat. Iemand) [Imanbek Remix]');
  assert.equal(Y.titleMatches('Roses (Imanbek remix)', roses), true);
  assert.equal(Y.titleMatches('Roses (Imanbek remix radio edit)', Y.cleanTitle('Roses - Imanbek Remix - Radio Edit')), true);
  assert.equal(Y.titleMatches('Roses (Remix by Imanbek)', roses), true);
  assert.equal(Y.titleMatches('Roses (Andere remix)', roses), false);
  assert.equal(Y.titleMatches('Roses', roses), false);

  // Gewone nummers: zoals vroeger, ook als MusicBrainz een remix teruggeeft.
  assert.equal(Y.titleMatches('Smalltown Boy (extended mix)', Y.cleanTitle('Smalltown Boy - Extended Mix')), true);
  assert.equal(Y.titleMatches('Roses (Imanbek remix)', 'Roses'), true);
});

test('lookup: een remix zoekt de remix, niet het oudere origineel', async () => {
  const calls = [];
  // Zoals bij MusicBrainz: "Elvis Presley vs. JXL" als twee credits.
  const remix = rec('A Little Less Conversation (JXL radio edit remix)', 'Elvis Presley', '2002-06-10', 'remix');
  remix['artist-credit'] = [
    { name: 'Elvis Presley', joinphrase: ' vs. ', artist: { name: 'Elvis Presley' } },
    { name: 'JXL', artist: { name: 'Junkie XL' } },
  ];
  const search = async (query) => {
    calls.push(query);
    return {
      recordings: [
        rec('A Little Less Conversation', 'Elvis Presley', '1968', 'orig'),
        rec('A Little Less Conversation (JXL remix)', 'Elvis Presley', '2007', 'later'),
        remix,
      ],
      total: 3,
    };
  };
  const found = await Y.lookup('A Little Less Conversation - JXL Radio Edit Remix', ['Elvis Presley', 'JXL'], search);
  assert.deepEqual(found, { year: 2002, official: true, method: 'exact', mbid: 'remix' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'recording:"A Little Less Conversation" AND recording:(jxl AND remix) AND artist:"Elvis Presley"');
});

test('lookup en decide: een onbekende remix krijgt het jaar van het Spotify-album', async () => {
  const calls = [];
  const search = async (query) => {
    calls.push(query);
    return { recordings: [rec('Roses', 'SAINt JHN', '2016', 'orig'), rec('Roses (Imanbek remix)', 'SAINt JHN', '2019', 'imanbek')], total: 2 };
  };
  const title = 'Roses - Bestaat Niet Remix';
  const mb = await Y.lookup(title, ['SAINt JHN'], search);
  assert.equal(mb.year, null);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith('recording:(Roses AND bestaat AND niet AND remix)'));

  const r = Y.decide({ title, spotifyYear: 2021 }, mb);
  assert.deepEqual([r.year, r.source], [2021, 'spotify']);
  assert.deepEqual(r.doubts, ['remix niet gevonden bij MusicBrainz; jaar van het Spotify-album']);

  // Gevonden: zoals bij elk nummer het vroegste van de twee, met twijfel bij meer dan een jaar verschil.
  const found = Y.decide({ title: 'Roses - Imanbek Remix', spotifyYear: 2020 }, { year: 2019, official: true, method: 'exact' });
  assert.deepEqual([found.year, found.source, found.doubts], [2019, 'musicbrainz', []]);
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
