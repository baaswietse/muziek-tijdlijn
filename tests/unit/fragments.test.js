// Fragmenten van Deezer: de ingebouwde lijsten, het opvragen van een adres,
// het afspelen (met een nagebootst <audio>-element) en hoe de server een
// lijst met fragmenten herkent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanFragments, deckFor, listsOf } from '../../web/src/fragment/lists.js';
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

test('lijsten: met hun aantal, een lege lijst niet', () => {
  assert.deepEqual(listsOf(cleanFragments(sample)), [
    { id: 'alles', name: 'Alle hits', count: 2 },
    { id: 'pop', name: 'Pop', count: 1 },
  ]);
});

test('lijsten: een stapel is een willekeurige volgorde zonder dubbels, groot genoeg een greep van max', () => {
  const big = {
    lists: [{ id: 'alles', name: 'Alles' }],
    tracks: Array.from({ length: 30 }, (_, i) => ({ deezer: 100 + i, artist: 'A', title: `T${i}`, year: 1960 + i, lists: ['alles'] })),
  };
  const data = cleanFragments(big);
  const all = deckFor(data, 'alles', { random: seeded(3) });
  assert.equal(all.sampled, false);
  assert.equal(all.tracks.length, 30);
  assert.equal(new Set(all.tracks.map((t) => t.id)).size, 30);
  assert.notDeepEqual(
    all.tracks.map((t) => t.id),
    data.tracks.map((t) => t.id),
  );
  // Wat naar de server gaat: geen lijst-tags.
  assert.deepEqual(Object.keys(all.tracks[0]).sort(), ['artist', 'id', 'title', 'year']);
  const part = deckFor(data, 'alles', { max: 12, random: seeded(5) });
  assert.equal(part.sampled, true);
  assert.equal(part.total, 30);
  assert.equal(part.tracks.length, 12);
  assert.equal(new Set(part.tracks.map((t) => t.id)).size, 12);
  // De server neemt ze zo aan, en herkent ze als fragmenten.
  assert.equal(normaliseTracks(part.tracks).length, 12);
  assert.equal(deckSource(part.tracks), 'fragment');
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
  rules.startGame(state, 'p0', [], seeded(9));
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
