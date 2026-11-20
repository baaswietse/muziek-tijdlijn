// Fragmenten van Deezer: de ingebouwde lijsten, het opvragen van een adres,
// het afspelen (met een nagebootst <audio>-element) en hoe de server een
// lijst met fragmenten herkent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanFragments,
  deckForChoice,
  describeChoice,
  listsOf,
  normaliseChoice,
  periodOptions,
  periodText,
  setPeriod,
  toggleList,
  tracksOf,
  yearBounds,
} from '../../web/src/fragment/lists.js';
import { MIN_DECK, deckNeed } from '../../web/src/lib/deckplan.js';
import { FragmentError, deezerId, deezerLink, fetchPreview } from '../../web/src/fragment/deezer.js';
import { createFragmentPlayer, silentWav } from '../../web/src/fragment/player.js';
import { deckSource, normaliseTracks } from '../../server/src/tracks.js';
import * as rules from '../../server/src/rules.js';

const SOURCE = JSON.parse(readFileSync(new URL('../../web/public/fragmenten.json', import.meta.url), 'utf8'));

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const sample = {
  lists: [
    { id: 'alles', name: 'Alle hits' },
    { id: 'pop', name: 'Pop' },
    { id: 'nl', name: 'Nederlandstalig' },
  ],
  tracks: [
    { deezer: 1, artist: 'A', title: 'Een', year: 1990, lists: ['alles', 'pop'] },
    { deezer: 2, artist: 'B', title: 'Twee', year: 2001, lists: ['alles'] },
    { deezer: 2, artist: 'B', title: 'Dubbel', year: 2001, lists: ['alles'] }, // zelfde ID: weg
    { deezer: 'x3', artist: 'C', title: 'Fout ID', year: 2001, lists: ['alles'] },
    { deezer: 4, artist: 'D', title: 'Geen jaar', lists: ['alles'] },
    { deezer: 5, artist: 'E', title: 'Onbekende lijst', year: 1999, lists: ['bestaat-niet'] },
    { deezer: 6, artist: '', title: 'Geen artiest', year: 1999, lists: ['alles'] },
  ],
};

test('lijsten: alleen geldige nummers, elk ID één keer, als dz-ID', () => {
  const data = cleanFragments(sample);
  assert.deepEqual(
    data.tracks.map((t) => t.id),
    ['dz-1', 'dz-2'],
  );
  assert.deepEqual(data.tracks[0], { id: 'dz-1', artist: 'A', title: 'Een', year: 1990, lists: ['alles', 'pop'] });
});

test('lijsten: met hun aantal, een lege lijst niet; de lijst met alles vooraan', () => {
  assert.deepEqual(listsOf(cleanFragments(sample)), [
    { id: 'alles', name: 'Alle hits', count: 2, all: true },
    { id: 'pop', name: 'Pop', count: 1, all: false },
  ]);
  // Welke lijst alles bevat, volgt uit de nummers, niet uit het id of de volgorde.
  const other = cleanFragments({
    lists: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'Alles' },
    ],
    tracks: [
      { deezer: 1, artist: 'A', title: 'Een', year: 1990, lists: ['a', 'b'] },
      { deezer: 2, artist: 'B', title: 'Twee', year: 2001, lists: ['b'] },
    ],
  });
  assert.deepEqual(
    listsOf(other).map((l) => [l.id, l.all]),
    [
      ['b', true],
      ['a', false],
    ],
  );
});

/**
 * Een testbestand: 40 nummers (1961–2000) in «alles»; «oud» 1961–1980 (20),
 * «nieuw» 1975–1995 (21, overlapt met «oud»), «klein» 3 nummers, «leeg» niets.
 */
const BIG = cleanFragments({
  lists: [
    { id: 'alles', name: 'Alle hits' },
    { id: 'oud', name: 'Oud' },
    { id: 'nieuw', name: 'Nieuw' },
    { id: 'klein', name: 'Klein' },
    { id: 'leeg', name: 'Leeg' },
  ],
  tracks: Array.from({ length: 40 }, (_, i) => {
    const year = 1961 + i;
    const lists = ['alles'];
    if (year <= 1980) lists.push('oud');
    if (year >= 1975 && year <= 1995) lists.push('nieuw');
    if (year >= 1998) lists.push('klein');
    return { deezer: 100 + i, artist: `A${i}`, title: `T${i}`, year, lists };
  }),
});

test('keuze: lijsten samen, zonder dubbels', () => {
  const both = { lists: ['oud', 'nieuw'], from: null, to: null };
  const tracks = tracksOf(BIG, both);
  // 1961–1995: 20 + 21 - 6 die in beide zitten.
  assert.equal(tracks.length, 35);
  assert.equal(new Set(tracks.map((t) => t.id)).size, 35);
  assert.deepEqual([tracks[0].year, tracks.at(-1).year], [1961, 1995]);
  assert.equal(tracksOf(BIG, { lists: ['oud'], from: null, to: null }).length, 20);
  // Een lege keuze geeft niets.
  assert.deepEqual(tracksOf(BIG, { lists: [], from: null, to: null }), []);
  assert.deepEqual(tracksOf(BIG, null), []);
});

test('keuze: een periode, los van de lijsten, grenzen inbegrepen', () => {
  const tracks = tracksOf(BIG, { lists: ['oud', 'nieuw'], from: 1970, to: 1985 });
  assert.equal(tracks.length, 16);
  assert.ok(tracks.every((t) => t.year >= 1970 && t.year <= 1985));
  assert.equal(tracksOf(BIG, { lists: ['alles'], from: 1990, to: null }).length, 11);
  assert.equal(tracksOf(BIG, { lists: ['alles'], from: null, to: 1965 }).length, 5);
  // Een periode zonder nummers in die lijst.
  assert.equal(tracksOf(BIG, { lists: ['oud'], from: 1990, to: 1995 }).length, 0);
  // De aantallen per lijst volgen de periode; een lijst met 0 blijft staan.
  const counts = Object.fromEntries(listsOf(BIG, { from: 1990, to: 1995 }).map((l) => [l.id, l.count]));
  assert.deepEqual(counts, { alles: 6, oud: 0, nieuw: 6, klein: 0 });
});

test('keuze: de grenzen en stappen van de periode volgen uit de nummers', () => {
  assert.deepEqual(yearBounds(BIG), { min: 1961, max: 2000 });
  assert.equal(yearBounds({ lists: [], tracks: [] }), null);
  const o = periodOptions({ min: 1961, max: 2000 });
  assert.deepEqual(o.from, [1965, 1970, 1975, 1980, 1985, 1990, 1995, 2000]);
  assert.deepEqual(o.to, [1965, 1970, 1975, 1980, 1985, 1990, 1995]);
  // Begint het precies op een stap, dan is die stap bij «van» geen beperking.
  assert.deepEqual(periodOptions({ min: 1960, max: 1972 }), { from: [1965, 1970], to: [1960, 1965, 1970] });
  assert.deepEqual(periodOptions(null), { from: [], to: [] });
  assert.equal(periodText({ from: 1980, to: 2000 }), '1980–2000');
  assert.equal(periodText({ from: 1980, to: null }), 'vanaf 1980');
  assert.equal(periodText({ from: null, to: 2000 }), 'tot 2000');
  assert.equal(periodText({ from: 1985, to: 1985 }), '1985');
  assert.equal(periodText({}), '');
});

test('keuze: «Alle hits» aanvinken zet de rest uit, een andere lijst zet «Alle hits» uit', () => {
  let c = normaliseChoice(BIG, null);
  // Standaard: de lijst met alles, zonder periode.
  assert.deepEqual(c, { lists: ['alles'], from: null, to: null });
  c = toggleList(BIG, c, 'nieuw');
  assert.deepEqual(c.lists, ['nieuw']);
  c = toggleList(BIG, c, 'oud');
  // In de volgorde van het scherm.
  assert.deepEqual(c.lists, ['oud', 'nieuw']);
  c = toggleList(BIG, c, 'alles');
  assert.deepEqual(c.lists, ['alles']);
  // Uitvinken: niets meer gekozen (geen stille terugval).
  assert.deepEqual(toggleList(BIG, c, 'alles').lists, []);
  // Een lege of onbekende lijst kan je niet aanvinken.
  assert.equal(toggleList(BIG, c, 'leeg'), c);
  assert.equal(toggleList(BIG, c, 'bestaat-niet'), c);
  // Samen met andere (bv. een oude bewaarde keuze): alleen «Alle hits», en dat telt alles één keer.
  const mixed = normaliseChoice(BIG, { lists: ['oud', 'alles', 'nieuw'], from: null, to: null });
  assert.deepEqual(mixed.lists, ['alles']);
  assert.equal(tracksOf(BIG, { lists: ['oud', 'alles'], from: null, to: null }).length, 40);
});

test('keuze: een bewaarde keuze wordt nagekeken', () => {
  // Verdwenen lijsten vallen weg; blijft er niets over, dan de standaard.
  assert.deepEqual(normaliseChoice(BIG, { lists: ['weg', 'oud'], from: null, to: null }).lists, ['oud']);
  assert.deepEqual(normaliseChoice(BIG, { lists: ['weg'], from: 1970, to: null }), { lists: ['alles'], from: 1970, to: null });
  assert.deepEqual(normaliseChoice(BIG, { lists: ['leeg'] }).lists, ['alles']);
  // Een bewaarde lege keuze blijft leeg.
  assert.deepEqual(normaliseChoice(BIG, { lists: [] }).lists, []);
  // Rommel.
  assert.deepEqual(normaliseChoice(BIG, 'onzin'), { lists: ['alles'], from: null, to: null });
  assert.deepEqual(normaliseChoice(BIG, { lists: [3, null], from: '1980', to: 1990.5 }), { lists: ['alles'], from: null, to: null });
  // Buiten de jaren die er zijn, of op de rand: geen beperking.
  assert.deepEqual(normaliseChoice(BIG, { lists: ['oud'], from: 1961, to: 2000 }), { lists: ['oud'], from: null, to: null });
  assert.deepEqual(normaliseChoice(BIG, { lists: ['oud'], from: 1900, to: 2050 }), { lists: ['oud'], from: null, to: null });
  // «Van» na «tot»: geen periode.
  assert.deepEqual(normaliseChoice(BIG, { lists: ['oud'], from: 1990, to: 1980 }), { lists: ['oud'], from: null, to: null });
  // Zonder lijst met alles en zonder bewaarde keuze: niets gekozen.
  const noAll = cleanFragments({ lists: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], tracks: [
    { deezer: 1, artist: 'A', title: 'T', year: 1990, lists: ['x'] },
    { deezer: 2, artist: 'B', title: 'U', year: 1991, lists: ['y'] },
  ] });
  assert.deepEqual(normaliseChoice(noAll, null).lists, []);
});

test('keuze: «van» en «tot» instellen; kruisen ze, dan valt de andere grens weg', () => {
  let c = { lists: ['alles'], from: null, to: null };
  c = setPeriod(BIG, c, 'from', '1980');
  assert.deepEqual([c.from, c.to], [1980, null]);
  c = setPeriod(BIG, c, 'to', '1990');
  assert.deepEqual([c.from, c.to], [1980, 1990]);
  c = setPeriod(BIG, c, 'from', '1995');
  assert.deepEqual([c.from, c.to], [1995, null]);
  c = setPeriod(BIG, c, 'to', '1970');
  assert.deepEqual([c.from, c.to], [null, 1970]);
  c = setPeriod(BIG, c, 'to', '');
  assert.deepEqual([c.from, c.to], [null, null]);
});

test('keuze: de omschrijving in gewone taal past in wat de server bewaart', () => {
  assert.equal(describeChoice(BIG, { lists: ['oud', 'nieuw'], from: 1980, to: 2000 }), 'Oud + Nieuw, 1980–2000');
  assert.equal(describeChoice(BIG, { lists: ['alles'], from: null, to: null }), 'Alle hits');
  assert.equal(describeChoice(BIG, { lists: [], from: 1980, to: null }), '');
  const long = cleanFragments({
    lists: ['Rock', 'Nederlandstalig', 'Rustige pop en ballads', 'Dance', 'Pop'].map((name, i) => ({ id: `l${i}`, name })),
    tracks: [{ deezer: 1, artist: 'A', title: 'T', year: 1990, lists: ['l0', 'l1', 'l2', 'l3', 'l4'] }],
  });
  const all5 = { lists: ['l0', 'l1', 'l2', 'l3', 'l4'], from: 1980, to: 2000 };
  const text = describeChoice(long, all5);
  assert.ok(text.length <= 60, text);
  assert.equal(text, 'Rock + Nederlandstalig + 3 andere lijsten, 1980–2000');
  assert.equal(describeChoice(long, { lists: ['l0', 'l1'], from: null, to: null }), 'Rock + Nederlandstalig');
  assert.equal(describeChoice(long, all5, 35), 'Rock + 4 andere lijsten, 1980–2000');
  assert.ok(describeChoice(long, all5, 20).length <= 20);
});

test('keuze: genoeg voor een spel volgt deckNeed (spelers en doel)', () => {
  // 2 spelers naar 10 kaarten: 40 nodig; «Oud + Nieuw» (35) is te weinig, «Alle hits» (40) genoeg.
  assert.equal(deckNeed(2, 10), 40);
  assert.ok(tracksOf(BIG, { lists: ['oud', 'nieuw'], from: null, to: null }).length < deckNeed(2, 10));
  assert.ok(tracksOf(BIG, { lists: ['alles'], from: null, to: null }).length >= deckNeed(2, 10));
  // «Klein» (3) haalt zelfs het minimum van de server niet.
  assert.ok(tracksOf(BIG, { lists: ['klein'], from: null, to: null }).length < MIN_DECK);
});

test('keuze: de stapel is een willekeurige volgorde zonder dubbels, groot genoeg een greep van max', () => {
  const c = { lists: ['oud', 'nieuw'], from: null, to: null };
  const deck = deckForChoice(BIG, c, { random: seeded(3) });
  assert.equal(deck.name, 'Oud + Nieuw');
  assert.equal(deck.sampled, false);
  assert.equal(deck.total, 35);
  assert.equal(deck.tracks.length, 35);
  assert.equal(new Set(deck.tracks.map((t) => t.id)).size, 35);
  assert.notDeepEqual(
    deck.tracks.map((t) => t.id),
    tracksOf(BIG, c).map((t) => t.id),
  );
  // Wat naar de server gaat: geen lijst-tags.
  assert.deepEqual(Object.keys(deck.tracks[0]).sort(), ['artist', 'id', 'title', 'year']);
  const part = deckForChoice(BIG, { lists: ['alles'], from: null, to: null }, { max: 12, random: seeded(5) });
  assert.equal(part.sampled, true);
  assert.equal(part.total, 40);
  assert.equal(part.tracks.length, 12);
  assert.equal(new Set(part.tracks.map((t) => t.id)).size, 12);
  // De server neemt ze zo aan, en herkent ze als fragmenten.
  assert.equal(normaliseTracks(part.tracks).length, 12);
  assert.equal(deckSource(part.tracks), 'fragment');
  // Een lege keuze geeft een lege stapel.
  assert.deepEqual(deckForChoice(BIG, { lists: [], from: null, to: null }), { name: '', tracks: [], sampled: false, total: 0 });
});

test('keuze: de omschrijving gaat ongeschonden door de server', () => {
  const state = rules.createRoom({ code: 'ABCD', now: 0 });
  rules.addPlayer(state, { id: 'p0', token: 't0', name: 'Hanne' });
  const { name, tracks } = deckForChoice(BIG, { lists: ['oud', 'nieuw'], from: 1965, to: 1990 });
  rules.setDeck(state, 'p0', { name, tracks: normaliseTracks(tracks) });
  assert.deepEqual(rules.viewFor(state, 'p0').playlist, { name: 'Oud + Nieuw, 1965–1990', count: 26, source: 'fragment' });
});

test('bronbestand web/public/fragmenten.json: geldig, met de afgesproken lijsten', () => {
  const ids = SOURCE.lists.map((l) => l.id);
  assert.deepEqual(ids, ['alles', '2000', 'pop', 'rock', 'dance', 'nl', 'rustig']);
  const data = cleanFragments(SOURCE);
  // Elk nummer in het bestand is geldig (niets valt weg) en zit in «Alle hits».
  assert.equal(data.tracks.length, SOURCE.tracks.length);
  for (const t of data.tracks) assert.ok(t.lists.includes('alles'), `${t.title} zit niet in Alle hits`);
  for (const t of data.tracks) assert.equal(t.lists.includes('2000'), t.year >= 2000, `${t.title}: 2000 tot nu`);
  const shown = listsOf(data);
  for (const l of shown) assert.ok(l.count >= rules.LIMITS.minDeck, `${l.name} heeft te weinig nummers`);
  // Nederlandstalig en Rustige pop en ballads zijn nog leeg en worden dus niet getoond.
  for (const id of ['nl', 'rustig']) {
    const n = data.tracks.filter((t) => t.lists.includes(id)).length;
    assert.equal(shown.some((l) => l.id === id), n > 0);
  }
  // Geen dubbels: hetzelfde nummer van dezelfde artiest maar één keer.
  const songs = data.tracks.map((t) => `${t.artist.toLowerCase()}|${t.title.toLowerCase()}`);
  assert.equal(new Set(songs).size, songs.length);
});

test('deezerId en deezerLink: alleen voor dz-ID', () => {
  assert.equal(deezerId('dz-3135556'), '3135556');
  assert.equal(deezerId('4uLU6hMCjMI75M1A2tKUQC'), null);
  assert.equal(deezerId('dz-12a'), null);
  assert.equal(deezerLink('dz-3135556'), 'https://www.deezer.com/track/3135556');
  assert.equal(deezerLink('4uLU6hMCjMI75M1A2tKUQC'), null);
});

test('fetchPreview: vraagt het nummer op en geeft alleen het adres terug', async () => {
  const asked = [];
  const request = async (url) => {
    asked.push(url);
    return { id: 7, title: 'Geheim', artist: { name: 'Geheim' }, preview: 'https://cdnt-preview.dzcdn.net/x.mp3?hdnea=1' };
  };
  assert.equal(await fetchPreview('dz-7', { request }), 'https://cdnt-preview.dzcdn.net/x.mp3?hdnea=1');
  assert.deepEqual(asked, ['https://api.deezer.com/track/7']);
});

test('fetchPreview: niet bestaand, geen fragment, of geen dz-ID: "missing"', async () => {
  const cases = [
    async () => ({ error: { type: 'DataException', message: 'no data', code: 800 } }),
    async () => ({ id: 7, preview: '' }),
    async () => ({ id: 7, preview: 'http://onveilig/x.mp3' }),
  ];
  for (const request of cases) {
    await assert.rejects(fetchPreview('dz-7', { request }), (err) => err instanceof FragmentError && err.kind === 'missing');
  }
  await assert.rejects(fetchPreview('spotify-id', { request: cases[0] }), (err) => err.kind === 'missing');
});

test('fetchPreview: te veel verzoeken (code 4) wacht even en probeert opnieuw', async () => {
  let n = 0;
  const request = async () => (++n < 2 ? { error: { code: 4, message: 'Quota limit exceeded' } } : { preview: 'https://p/x.mp3' });
  assert.equal(await fetchPreview('dz-1', { request }), 'https://p/x.mp3');
  assert.equal(n, 2);
});

/** Een nagebootst <audio>-element: `behave(url)` zegt wat play() doet. */
function fakeAudio(behave = () => 'ok') {
  const listeners = {};
  const a = {
    src: '',
    loop: false,
    paused: true,
    currentTime: 0,
    error: null,
    plays: [],
    addEventListener(name, fn) {
      (listeners[name] ||= []).push(fn);
    },
    emit(name) {
      for (const fn of listeners[name] || []) fn();
    },
    play() {
      this.plays.push(this.src);
      const r = behave(this.src);
      if (r === 'ok') {
        this.paused = false;
        return Promise.resolve();
      }
      this.paused = true;
      const err = new Error(r);
      err.name = r;
      return Promise.reject(err);
    },
    pause() {
      this.paused = true;
    },
    load() {},
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
  };
  return a;
}

test('speler: ontgrendelen speelt een stil geluidje, daarna herhalend het fragment', async () => {
  const audio = fakeAudio();
  const fetch = async (id) => `https://p/${id}.mp3`;
  const p = createFragmentPlayer({ audio, fetch });
  assert.equal(await p.unlock(), true);
  assert.ok(audio.plays[0].startsWith('data:audio/wav;base64,'));
  assert.equal(p.unlocked, true);
  await p.play('dz-1');
  assert.equal(audio.src, 'https://p/dz-1.mp3');
  assert.equal(audio.loop, true);
  assert.equal(audio.paused, false);
  assert.equal(p.trackId, 'dz-1');
  p.pause();
  assert.equal(audio.paused, true);
  await p.resume();
  assert.equal(audio.paused, false);
  p.stop();
  assert.equal(audio.paused, true);
  assert.equal(p.trackId, null);
});

test('speler: de browser weigert geluid -> "blocked"', async () => {
  const audio = fakeAudio(() => 'NotAllowedError');
  const p = createFragmentPlayer({ audio, fetch: async () => 'https://p/x.mp3' });
  assert.equal(await p.unlock(), false);
  await assert.rejects(p.play('dz-1'), (err) => err.kind === 'blocked');
});

test('speler: een verlopen adres -> één keer een nieuw adres; blijft het mislukken -> "missing"', async () => {
  let n = 0;
  const fetch = async (id) => `https://p/${id}-${++n}.mp3`;
  const audio = fakeAudio((url) => (url.endsWith('-1.mp3') ? 'NotSupportedError' : 'ok'));
  const p = createFragmentPlayer({ audio, fetch });
  await p.play('dz-1');
  assert.equal(audio.src, 'https://p/dz-1-2.mp3');
  assert.equal(n, 2);

  const never = fakeAudio(() => 'NotSupportedError');
  const q = createFragmentPlayer({ audio: never, fetch: async () => 'https://p/weg.mp3' });
  await assert.rejects(q.play('dz-1'), (err) => err.kind === 'missing');
});

test('speler: een nieuwere start wint; de oudere speelt nooit meer', async () => {
  const audio = fakeAudio();
  let release;
  const slow = new Promise((r) => {
    release = r;
  });
  const fetch = (id) => (id === 'dz-1' ? slow.then(() => 'https://p/1.mp3') : Promise.resolve('https://p/2.mp3'));
  const p = createFragmentPlayer({ audio, fetch });
  const first = p.play('dz-1');
  await p.play('dz-2');
  release();
  await assert.rejects(first, (err) => err.stale === true);
  assert.equal(audio.src, 'https://p/2.mp3');
  assert.equal(p.trackId, 'dz-2');
});

test('speler: valt een spelend fragment weg, dan meldt hij dat (niet tijdens het starten)', async () => {
  const audio = fakeAudio();
  const events = [];
  const p = createFragmentPlayer({ audio, fetch: async () => 'https://p/x.mp3', onEvent: (e) => events.push(e) });
  audio.emit('error'); // voor er iets speelt: niets
  await p.play('dz-9');
  audio.emit('error');
  assert.equal(events.length, 1);
  assert.equal(events[0].trackId, 'dz-9');
  assert.equal(events[0].error.kind, 'missing');
});

test('silentWav: een geldig WAV-bestand', () => {
  const bin = Buffer.from(silentWav().split(',')[1], 'base64');
  assert.equal(bin.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bin.subarray(8, 12).toString(), 'WAVE');
  assert.equal(bin.length, 44 + 800);
});

test('server: dz-ID wordt aanvaard, een fout gevormd dz-ID niet', () => {
  const ok = normaliseTracks([
    { id: 'dz-123', artist: 'A', title: 'T', year: 1990 },
    { id: 'dz-12x', artist: 'A', title: 'T', year: 1990 },
    { id: 'dz-', artist: 'A', title: 'T', year: 1990 },
  ]);
  assert.deepEqual(
    ok.map((t) => t.id),
    ['dz-123'],
  );
  assert.equal(deckSource([{ id: 'dz-1' }, { id: '4uLU6hMCjMI75M1A2tKUQC' }]), 'spotify');
  assert.equal(deckSource([]), 'spotify');
});

test('server: een lijst met fragmenten heet zo in de stand, een playlist niet; de stapel werkt gewoon', () => {
  const state = rules.createRoom({ code: 'ABCD', now: 0 });
  rules.addPlayer(state, { id: 'p0', token: 't0', name: 'Hanne' });
  rules.addPlayer(state, { id: 'p1', token: 't1', name: 'Bob' });
  const deck = Array.from({ length: 20 }, (_, i) => ({ id: `dz-${100 + i}`, artist: `A${i}`, title: `T${i}`, year: 1960 + i }));
  rules.setDeck(state, 'p0', { name: 'Rock', tracks: normaliseTracks(deck) });
  assert.deepEqual(rules.viewFor(state, 'p0').playlist, { name: 'Rock', count: 20, source: 'fragment' });
  rules.startGame(state, 'p0', state.custom.tracks, seeded(9));
  const host = rules.viewFor(state, 'p0');
  const guest = rules.viewFor(state, 'p1');
  // Alleen de host krijgt het ID van het lopende fragment, zoals bij Spotify.
  assert.match(host.turn.trackId, /^dz-1\d\d$/);
  assert.equal(guest.turn.trackId, undefined);
  assert.ok(!JSON.stringify(guest).includes(host.turn.trackId));
  // Een gewone playlist blijft zoals ze was.
  rules.backToLobby(state, 'p0');
  rules.setDeck(state, 'p0', {
    name: 'Mijn playlist',
    tracks: normaliseTracks(deck.map((t, i) => ({ ...t, id: `spotify${String(i).padStart(15, '0')}` }))),
  });
  assert.deepEqual(rules.viewFor(state, 'p0').playlist, { name: 'Mijn playlist', count: 20 });
});
