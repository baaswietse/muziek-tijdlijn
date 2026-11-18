// Geluid op het toestel van een speler (alleen met fragmenten): de controle
// van het adres, wie het krijgt, wat de host mag, en waar het fragment staat
// voor wie later aanhaakt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as room from '../../server/src/room.js';
import * as rules from '../../server/src/rules.js';
import { normaliseTracks } from '../../server/src/tracks.js';
import { MAX_REFRESH, MAX_URL, checkPreviewUrl, positionAt } from '../../server/src/sound.js';
import { FRAGMENT_SECONDS, drift, expectedPosition, needsSeek, wrap } from '../../web/src/fragment/sync.js';

const URL1 = 'https://cdnt-preview.dzcdn.net/api/1/1/2/a/6/0/2a6dd8f8a7e1f0b1e41b8f2d7e0c9bb1.mp3?hdnea=exp=1700000000~acl=/api/1/1/2/a/6/0/2a6dd8f8a7e1f0b1e41b8f2d7e0c9bb1*~data=user_id=0,application_id=42~hmac=abc123';
const URL2 = 'https://cdnt-preview.dzcdn.net/api/1/1/f/0/0/0/f000000000000000000000000000000f.mp3?hdnea=exp=1700009999~hmac=def456';

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Een spel met fragmenten: host p0, gasten p1 en p2, de eerste beurt loopt. */
async function fragmentGame() {
  const state = rules.createRoom({ code: 'ABCD', now: 0 });
  rules.addPlayer(state, { id: 'p0', token: 'token-host-0', name: 'Hanne' });
  rules.addPlayer(state, { id: 'p1', token: 'token-gast-1', name: 'Bob' });
  rules.addPlayer(state, { id: 'p2', token: 'token-gast-2', name: 'Cas' });
  const deck = Array.from({ length: 20 }, (_, i) => ({ id: `dz-${900100 + i}`, artist: `Artiest ${i}`, title: `Titel ${i}`, year: 1960 + i }));
  rules.setDeck(state, 'p0', { name: 'Test', tracks: normaliseTracks(deck) });
  await room.applyAction(state, 'p0', { t: 'start' }, { loadTracks: async () => [], random: seeded(3), now: 1000 });
  return state;
}

const act = (state, who, msg, now) => room.applyAction(state, who, msg, { loadTracks: async () => [], random: seeded(5), now });
const card = (state) => state.turn.card.id;

test('adres: alleen https naar de servers van de Deezer-fragmenten, begrensd', () => {
  assert.equal(checkPreviewUrl(URL1), URL1);
  assert.equal(checkPreviewUrl('https://cdns-preview-d.dzcdn.net/stream/c-deadbeef-1.mp3'), 'https://cdns-preview-d.dzcdn.net/stream/c-deadbeef-1.mp3');
  for (const bad of [
    'http://cdnt-preview.dzcdn.net/a.mp3', // geen https
    'https://evil.example/a.mp3',
    'https://cdnt-preview.dzcdn.net.evil.example/a.mp3',
    'https://evilcdnt-preview.dzcdn.net/a.mp3',
    'https://api.deezer.com/track/3135556', // de API zelf: niet het geluidsbestand
    'https://www.dzcdn.net/a.mp3',
    'https://cdnt-preview.dzcdn.net:8443/a.mp3', // poort
    'https://user:pw@cdnt-preview.dzcdn.net/a.mp3',
    'https://cdnt-preview.dzcdn.net/a.mp3#x',
    'HTTPS://CDNT-PREVIEW.DZCDN.NET/a.mp3',
    'https:\\\\cdnt-preview.dzcdn.net/a.mp3',
    ' https://cdnt-preview.dzcdn.net/a.mp3',
    'https://cdnt-preview.dzcdn.net/a b.mp3',
    'https://cdnt-preview.dzcdn.net/a.mp3"><script>',
    'javascript:alert(1)',
    'data:audio/mpeg;base64,AAAA',
    `https://cdnt-preview.dzcdn.net/${'a'.repeat(MAX_URL)}.mp3`,
    '',
    null,
    42,
    { url: URL1 },
  ]) {
    assert.equal(checkPreviewUrl(bad), null, String(bad).slice(0, 60));
  }
});

test('alleen de host geeft een adres door, en alleen voor het nummer van de lopende beurt', async () => {
  const state = await fragmentGame();
  const id = card(state);
  // Een gast kan het niet.
  await assert.rejects(act(state, 'p1', { t: 'sound', action: 'play', trackId: id, url: URL1 }, 2000), { code: 'HOST_ONLY' });
  assert.equal(state.sound ?? null, null);
  // Een slecht adres wordt geweigerd.
  await assert.rejects(act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: 'https://evil.example/a.mp3' }, 2000), { code: 'BAD_URL' });
  // Een ander nummer (een bericht dat te laat aankwam, of verzonnen): niets.
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: 'dz-1', url: URL1 }, 2000);
  assert.equal(state.sound ?? null, null);
  // Het juiste nummer: bewaard, met de klok van de server.
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: URL1 }, 2000);
  assert.deepEqual(
    { ...state.sound },
    { trackId: id, url: URL1, n: 1, playing: true, offset: 0, anchor: 2000, stale: false, refreshes: 0 },
  );
  // Buiten een beurt (wachtkamer) kan het niet.
  await act(state, 'p0', { t: 'lobby' }, 3000);
  assert.equal(state.sound, null);
  await assert.rejects(act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: URL1 }, 3000), { code: 'BAD_PHASE' });
});

test('wie het adres krijgt: alleen een gast die meeluistert, nooit in de gewone stand', async () => {
  const state = await fragmentGame();
  const id = card(state);
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: URL1 }, 2000);
  // p1 luistert mee, p2 niet, de host krijgt het nooit (hij heeft het zelf).
  assert.deepEqual(room.soundMessage(state, 'p1', true, 2500), { t: 'sound', sound: { n: 1, url: URL1, playing: true, pos: 0.5 } });
  assert.equal(room.soundMessage(state, 'p2', false, 2500), null);
  assert.equal(room.soundMessage(state, 'p0', true, 2500), null);
  assert.equal(room.soundMessage(state, 'p9', true, 2500), null); // geen speler (meer)
  // In het bericht: geen track-ID, titel, artiest of jaar.
  const msg = JSON.stringify(room.soundMessage(state, 'p1', true, 2500));
  const c = state.turn.card;
  for (const secret of [c.id, c.id.slice(3), c.title, c.artist, `"year"`]) assert.ok(!msg.includes(secret), secret);
  // De gewone stand van een gast: geen adres en geen geluid.
  for (const p of ['p1', 'p2']) {
    const v = JSON.stringify(room.view(state, p, new Set(['p0', 'p1', 'p2'])));
    assert.ok(!v.includes('dzcdn'), p);
    assert.ok(!v.includes('"sound"'), p);
  }
  // De host ziet alleen dat er geluid is (zonder adres).
  assert.deepEqual(room.view(state, 'p0', new Set()).sound, { n: 1, playing: true, stale: false, r: 0 });
  assert.ok(!JSON.stringify(room.view(state, 'p0', new Set())).includes('dzcdn'));
});

test('plaats in het fragment: pauze, verder, opnieuw, en wie later aanhaakt', async () => {
  const state = await fragmentGame();
  const id = card(state);
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: URL1 }, 10_000);
  // Wie 12,5 s later aanhaakt, valt in op 12,5 s (de gsm rekent zelf modulo de duur).
  assert.equal(room.soundMessage(state, 'p1', true, 22_500).sound.pos, 12.5);
  assert.equal(room.soundMessage(state, 'p1', true, 10_000 + 47_000).sound.pos, 47);
  // Pauze op 20 s: blijft daar staan.
  await act(state, 'p0', { t: 'sound', action: 'pause', trackId: id }, 30_000);
  assert.deepEqual(room.soundMessage(state, 'p1', true, 90_000).sound, { n: 1, url: URL1, playing: false, pos: 20 });
  // Nog eens pauze verandert niets.
  await act(state, 'p0', { t: 'sound', action: 'pause', trackId: id }, 95_000);
  assert.equal(room.soundMessage(state, 'p1', true, 99_000).sound.pos, 20);
  // Verder: vanaf 20 s.
  await act(state, 'p0', { t: 'sound', action: 'resume', trackId: id }, 100_000);
  assert.equal(room.soundMessage(state, 'p1', true, 101_500).sound.pos, 21.5);
  assert.equal(room.view(state, 'p0', new Set()).sound.playing, true);
  // Opnieuw afspelen: een nieuwe start (n), van voren.
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: URL2 }, 200_000);
  assert.deepEqual(room.soundMessage(state, 'p1', true, 200_250).sound, { n: 2, url: URL2, playing: true, pos: 0.25 });
  // positionAt kijkt nooit terug in de tijd (een klok die even achterloopt).
  assert.equal(positionAt({ playing: true, offset: 3, anchor: 5000 }, 4000), 3);
});

test('ander nummer, volgende beurt of einde: het geluid vervalt', async () => {
  const state = await fragmentGame();
  const first = card(state);
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: first, url: URL1 }, 2000);
  await act(state, 'p0', { t: 'skipTrack' }, 3000);
  assert.notEqual(card(state), first);
  assert.equal(state.sound, null);
  assert.deepEqual(room.soundMessage(state, 'p1', true, 3000), { t: 'sound', sound: null });
  assert.equal(room.view(state, 'p0', new Set()).sound, null);
  // Een bericht voor het overgeslagen nummer doet niets meer.
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: first, url: URL1 }, 3100);
  assert.equal(state.sound, null);
  // Tijdens de onthulling blijft het fragment spelen (zelfde nummer).
  const second = card(state);
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: second, url: URL2 }, 4000);
  state.turn.bets = [];
  state.turn.passes = [];
  state.phase = 'reveal';
  state.reveal = { playerId: state.turn.playerId, card: state.turn.card, index: 0, correct: true, bets: [] };
  state.turn = null;
  await act(state, 'p0', { t: 'token', playerId: null }, 5000);
  assert.equal(room.soundMessage(state, 'p1', true, 6000).sound.url, URL2);
  // Pauze kan ook tijdens de onthulling.
  await act(state, 'p0', { t: 'sound', action: 'pause', trackId: second }, 6000);
  assert.equal(room.soundMessage(state, 'p1', true, 9000).sound.playing, false);
  // Volgende beurt: weg.
  await act(state, 'p0', { t: 'next' }, 7000);
  assert.equal(state.sound, null);
});

test('een verlopen adres: de gast meldt het, de host vraagt een vers (begrensd), de plaats blijft', async () => {
  const state = await fragmentGame();
  const id = card(state);
  await act(state, 'p0', { t: 'sound', action: 'play', trackId: id, url: URL1 }, 1000);
  // De host kan zichzelf niets melden; een oude start telt niet.
  assert.equal(room.soundFailed(state, 'p0', 1), false);
  assert.equal(room.soundFailed(state, 'p1', 7), false);
  assert.equal(room.soundFailed(state, 'p1', 1), true);
  assert.deepEqual(room.view(state, 'p0', new Set()).sound, { n: 1, playing: true, stale: true, r: 1 });
  // Al gevraagd: niet nog eens.
  assert.equal(room.soundFailed(state, 'p2', 1), false);
  // Het verse adres: zelfde start, zelfde plaats.
  await act(state, 'p0', { t: 'sound', action: 'url', trackId: id, url: URL2 }, 5000);
  assert.deepEqual(room.soundMessage(state, 'p1', true, 5000).sound, { n: 1, url: URL2, playing: true, pos: 4 });
  assert.equal(room.view(state, 'p0', new Set()).sound.stale, false);
  // Ook dat verse adres moet aan de regels voldoen.
  await assert.rejects(act(state, 'p0', { t: 'sound', action: 'url', trackId: id, url: 'https://evil.example/x.mp3' }, 5100), { code: 'BAD_URL' });
  // Hoogstens MAX_REFRESH keer per start: geen eindeloze verzoeken bij Deezer.
  for (let i = 1; i < MAX_REFRESH; i++) {
    assert.equal(room.soundFailed(state, 'p1', 1), true);
    await act(state, 'p0', { t: 'sound', action: 'url', trackId: id, url: URL1 }, 6000 + i);
  }
  assert.equal(room.soundFailed(state, 'p1', 1), false);
});

test('gsm: waar het fragment hoort te staan, zonder klokken van twee toestellen te vergelijken', () => {
  // Bericht: 12 s ver, kwam aan op performance.now() = 50 000 (de klok van de gsm zelf maakt niet uit).
  const s = { n: 1, url: URL1, playing: true, pos: 12 };
  assert.equal(expectedPosition(s, { receivedAt: 50_000, now: 50_000 }), 12);
  assert.equal(expectedPosition(s, { receivedAt: 50_000, now: 53_500 }), 15.5);
  // Met de tijd die het bericht onderweg was (de helft van een ping).
  assert.equal(expectedPosition(s, { receivedAt: 50_000, now: 50_000, latency: 0.08 }), 12.08);
  // Gepauzeerd: blijft staan.
  assert.equal(expectedPosition({ ...s, playing: false }, { receivedAt: 50_000, now: 90_000, latency: 0.08 }), 12);
  // Herhalen: binnen de echte duur, of 30 s als die nog niet gekend is.
  assert.equal(FRAGMENT_SECONDS, 30);
  assert.equal(wrap(47, NaN), 17);
  assert.equal(wrap(47, 30), 17);
  assert.equal(wrap(3.75, 1.5), 0.75);
  assert.equal(wrap(-2, 30), 0);
  // Verschil rond het herhalen: 29,9 en 0,1 liggen dicht bij elkaar.
  assert.ok(Math.abs(drift(29.9, 0.1, 30) - 0.2) < 1e-9);
  assert.equal(needsSeek(29.9, 30.1, 30), false);
  assert.equal(needsSeek(10, 10.3, 30), false);
  assert.equal(needsSeek(10, 11, 30), true);
  assert.equal(needsSeek(0, 15, 30), true);
});
