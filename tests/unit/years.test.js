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

// ---------------------------------------------------------------- te vroege jaren
// Echte gevallen uit een playlist (november 2026), vereenvoudigd tot de uitgaven
// die ertoe doen. Zie tools/test_tracks.py voor dezelfde gevallen in Python.

/** Een uitgave met titel (en dus een eigen release group) en id. */
function relx(date, title, secondary = [], status = 'Official') {
  return { id: `${title}|${date}`, title, date, status, 'release-group': { id: `rg-${title}`, 'primary-type': 'Album', 'secondary-types': secondary } };
}

test('pickYear: een enkele fout gedateerde verzamelaar telt niet (Radar Love, Weekend!, I\'m Alive)', () => {
  // Radar Love: "The Best of Golden Earring" (1971) met de single van 1973 erop.
  const radar = rec('Radar Love', 'Golden Earring', '1971', 'radar', {
    releases: [relx('1971', 'The Best of Golden Earring', ['Compilation']), relx('1973', 'Radar Love'), relx('1973-06', 'Radar Love / The Song Is Over'), relx('1976', 'Golden Earring', ['Compilation'])],
  });
  let found = Y.pickYear([radar], 'Radar Love', ['Golden Earring']);
  assert.deepEqual([found.year, found.raw, found.official], [1973, 1971, true]);

  // Weekend!: twee jaren na elkaar met elk één verzamelaar, de single in 2003.
  const weekend = rec('Weekend (radio edit)', 'Scooter', '2001', 'wk', {
    releases: [relx('2001', 'Mädchen Soft+Crazy', ['Compilation']), relx('2002-08-08', 'Pepsi: More Music 2', ['Compilation']), relx('2003', 'Weekend!'), relx('2003', 'NOW 8', ['Compilation'])],
  });
  assert.equal(Y.pickYear([weekend], 'Weekend!', ['Scooter']).year, 2003);

  // I'm Alive: een opname staat alleen op "2000 Collection"; de andere opnames zijn van 2002.
  const alive = [
    rec("I'm Alive", 'Céline Dion', '2000', 'c2000', { releases: [relx('2000', '2000 Collection', ['Compilation'])] }),
    rec('I’m Alive', 'Céline Dion', '2002', 'single', { releases: [relx('2002', "I'm Alive")] }),
  ];
  found = Y.pickYear(alive, "I'm Alive", ['Céline Dion']);
  assert.deepEqual([found.year, found.mbid], [2002, 'single']);
});

test('pickYear: twee verschillende verzamelaars in hetzelfde jaar tellen wel (singles die MusicBrainz mist)', () => {
  // Pommelien Thijs – Ongewoon: single 2022 (niet bij MusicBrainz), album 2023.
  const ongewoon = rec('Ongewoon', 'Pommelien Thijs', '2022-06-10', 'o', {
    releases: [relx('2022-06-10', 'MNM Big Hits Summer 2022', ['Compilation']), relx('2022-08-26', 'Tien om te zien 2022', ['Compilation']), relx('2023-06-23', 'Per ongeluk')],
  });
  assert.equal(Y.pickYear([ongewoon], 'Ongewoon', ['Pommelien Thijs']).year, 2022);
});

test('pickYear: een remix, live-, instrumentale of karaokeversie telt niet voor het gewone nummer', () => {
  // Shape of You: "(DJ Inko remix)" op een uitgave "van 2015"; het nummer is van 2017.
  const recs = [
    rec('Shape of You (DJ Inko remix)', 'Ed Sheeran', '2015-01-30', 'inko', { releases: [relx('2015-01-30', 'Various Tracks')] }),
    rec('Shape of You (live at Taratata)', 'Ed Sheeran', '2016', 'live', { releases: [relx('2016', 'Divide Collector')] }),
    rec('Shape of You (instrumental)', 'Ed Sheeran', '2016', 'instr', { releases: [relx('2016', 'Shape of You instr')] }),
    { ...rec('Shape of You', 'Ed Sheeran', '2016', 'karaoke', { releases: [relx('2016', 'Karaoke Hits')] }), disambiguation: 'karaoke version' },
    rec('Shape of You', 'Ed Sheeran', '2017-01-06', 'orig', { releases: [relx('2017-01-06', 'Shape of You'), relx('2017-03-03', '÷')] }),
  ];
  const found = Y.pickYear(recs, 'Shape of You', ['Ed Sheeran']);
  assert.deepEqual([found.year, found.mbid], [2017, 'orig']);
  assert.equal(Y.otherVersion(recs[0], 'Shape of You'), true);
  assert.equal(Y.otherVersion(recs[4], 'Shape of You'), false);
  // Een live-opname zoeken: dan telt live wel, en de instrumentale versie nog altijd niet.
  const live = Y.pickYear(recs, 'Shape of You', ['Ed Sheeran'], { live: true });
  assert.deepEqual([live.year, live.mbid], [2016, 'live']);
});

test('pickYear: een losse vroegste uitgave met kort daarna meer uitgaven geeft een kandidaat (next)', () => {
  // The Real Slim Shady: één single "1999-12-31", het jaar daarna tientallen uitgaven.
  const slim = rec('The Real Slim Shady', 'Eminem', '1999-12-31', 's', {
    releases: [relx('1999-12-31', 'The Way I Am'), relx('2000', 'The Marshall Mathers LP'), relx('2000', 'The Real Slim Shady'), relx('2000-05', 'VIVA Summer Hits', ['Compilation'])],
  });
  const found = Y.pickYear([slim], 'The Real Slim Shady', ['Eminem']);
  assert.deepEqual([found.year, found.count, found.next], [1999, 1, 2000]);
  // Met meer dan één uitgave in het vroegste jaar: geen kandidaat.
  const hey = rec('Hey Jude', 'The Beatles', '1968', 'h', { releases: [relx('1968', 'Hey Jude'), relx('1968-08-26', 'Hey Jude US'), relx('1970', 'Hey Jude LP')] });
  assert.equal(Y.pickYear([hey], 'Hey Jude', ['The Beatles']).next, undefined);
});

test('decide: Spotify zegt precies het vroegste jaar van MusicBrainz (een nieuw nummer op een eigen best-of)', () => {
  // Krezip – Sweet Goodbyes: alleen op "Best Of" (2008), daarna verzamelaars uit 2009.
  const mb = { year: 2009, raw: 2008, count: 4, official: true, method: 'exact' };
  const r = Y.decide({ title: 'Sweet Goodbyes', spotifyYear: 2008 }, mb);
  assert.deepEqual([r.year, r.source, r.doubts], [2008, 'musicbrainz', []]);
});

test('decide: een eigen best-of telt niet als Wikidata het latere MusicBrainz-jaar zegt', () => {
  // Dolly Parton & Kenny Rogers – Islands in the Stream: Spotify heeft een fout gedateerde "Greatest Hits" (1982),
  // MusicBrainz 12 uitgaven in 1983, Wikidata 1983.
  const islands = { year: 1983, raw: 1982, count: 12, official: true, method: 'exact' };
  const r = Y.decide({ title: 'Islands in the Stream', spotifyYear: 1982 }, islands, { year: 1983 });
  assert.deepEqual([r.year, r.source, r.doubts], [1983, 'musicbrainz', []]);
  // Zonder Wikidata, als Wikidata niets kent of zelf het vroege jaar zegt: de regel blijft gelden.
  const mb = { year: 2009, raw: 2008, count: 4, official: true, method: 'exact' };
  const t = { title: 'Sweet Goodbyes', spotifyYear: 2008 };
  assert.equal(Y.decide(t, mb, undefined).year, 2008);
  assert.equal(Y.decide(t, mb, { year: null }).year, 2008);
  assert.equal(Y.decide(t, mb, { year: 2008 }).year, 2008);
});

// Zelfde gevallen als DecideThreeSources in tools/test_tracks.py.
const mbOf = (year, extra = {}) => ({ year, official: true, method: 'exact', raw: year, count: 5, ...extra });
const decided = (title, s, mb, w) => {
  const r = Y.decide({ title, spotifyYear: s }, mb, w === undefined ? undefined : { year: w });
  return [r.year, r.source, r.doubts];
};

test('decide: zegt Spotify precies de vroege uitgave (mb.next), dan heeft Wikidata een latere single', () => {
  // Clouseau – Daar gaat ze: album 1989 (Spotify en MusicBrainz), single 1990 (Wikidata en meer uitgaven).
  assert.deepEqual(decided('Daar Gaat Ze', 1989, mbOf(1989, { count: 1, next: 1990 }), 1990), [1989, 'musicbrainz', []]);
  // Simon & Garfunkel – The Sound of Silence (akoestisch): 1964; Wikidata heeft de single van 1965.
  assert.deepEqual(decided('The Sound of Silence - Acoustic Version', 1964, mbOf(1964, { count: 1, next: 1965 }), 1965), [1964, 'musicbrainz', []]);
  // Zegt Spotify later, dan blijft het een fout gedateerd album (Because of You, Can't Stop Loving You).
  assert.deepEqual(decided('Because of You', 2004, mbOf(2003, { count: 1, next: 2004 }), 2004), [2004, 'musicbrainz', []]);
  assert.deepEqual(decided("Can't Stop Loving You", 2002, mbOf(2001, { count: 1, next: 2002 }), 2002), [2002, 'musicbrainz', []]);
});

test('decide: zegt Wikidata precies het vroegste jaar van MusicBrainz (raw), dan telt die vroege uitgave', () => {
  // Fall Out Boy – Centuries: single 2014 (bij MusicBrainz maar één verzamelaar), album 2015.
  assert.deepEqual(decided('Centuries', 2015, mbOf(2015, { raw: 2014, count: 16 }), 2014), [2014, 'musicbrainz', []]);
  // Dropkick Murphys – Rose Tattoo: 2012; het album is van 2013.
  assert.deepEqual(decided('Rose Tattoo', 2013, mbOf(2013, { raw: 2012, count: 8 }), 2012), [2012, 'musicbrainz', []]);
  // Willy Sommers – Laat de zon in je hart: 2006; MusicBrainz 2007, Spotify een verzamelaar van 2015.
  assert.deepEqual(decided('Laat De Zon In Je Hart', 2015, mbOf(2007, { raw: 2006, count: 2 }), 2006), [2006, 'musicbrainz', []]);
  // Zonder Wikidata, of als Wikidata het latere jaar zegt, blijft de losse verzamelaar fout gedateerd
  // (Radar Love op "The Best of Golden Earring, 1971").
  assert.deepEqual(decided('Centuries', 2015, mbOf(2015, { raw: 2014, count: 16 }), undefined), [2015, 'musicbrainz', []]);
  assert.deepEqual(decided('Radar Love', 1973, mbOf(1973, { raw: 1971, count: 3 }), 1973), [1973, 'musicbrainz', []]);
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
  assert.deepEqual(found, { year: 1969, official: true, method: 'exact', mbid: 'orig', raw: 1969, count: 1 });
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

  // Een ruime zoekopdracht, alleen onofficiële uitgaven of een live-opname zijn
  // alleen nog een reden om na te kijken als de bronnen het oneens zijn.
  r = Y.decide({ ...t, spotifyYear: 1975 }, { year: 1975, official: false, method: 'ruim' });
  assert.deepEqual(r.doubts, []);
  r = Y.decide({ ...t, spotifyYear: 1990 }, { year: 1975, official: false, method: 'ruim', count: 0 });
  assert.equal(r.doubts.length, 3);
  r = Y.decide({ title: 'Enter Sandman - Live', spotifyYear: 1991 }, { year: 1991, official: true, method: 'exact' });
  assert.deepEqual(r.doubts, []);
  r = Y.decide({ title: 'Enter Sandman - Live', spotifyYear: 1999 }, { year: 1991, official: true, method: 'exact' });
  assert.deepEqual(r.doubts, ['Spotify zegt 1999, MusicBrainz 1991', 'live-opname']);
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
  assert.deepEqual(found, { year: 2002, official: true, method: 'exact', mbid: 'remix', raw: 2002, count: 1 });
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
