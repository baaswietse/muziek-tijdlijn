// De host-rol doorgeven en overnemen (server/src/rules.js en room.js): wie
// host is, wanneer een ander het kan worden, en wat de host daarna nog mag.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../../server/src/rules.js';
import { GameError } from '../../server/src/rules.js';
import * as room from '../../server/src/room.js';
import * as sound from '../../server/src/sound.js';

const GRACE = 30_000;

function makeTracks(n, startYear = 1960) {
  return Array.from({ length: n }, (_, i) => ({ id: `track${String(i).padStart(3, '0')}`, artist: `A${i}`, title: `T${i}`, year: startYear + i }));
}

function newRoom(names = ['Ann', 'Bob', 'Cas']) {
  const state = rules.createRoom({ code: 'TEST', now: 0 });
  names.forEach((name, i) => rules.addPlayer(state, { id: `p${i}`, token: `token-${i}-xxxxxxxx`, name }));
  return state;
}

function throwsCode(fn, code) {
  assert.throws(fn, (err) => err instanceof GameError && err.code === code, `verwacht fout ${code}`);
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => err instanceof GameError && err.code === code, `verwacht fout ${code}`);
}

const all = new Set(['p0', 'p1', 'p2']);
const without = (...ids) => new Set([...all].filter((id) => !ids.includes(id)));

test('doorgeven: de host duidt een verbonden speler aan en wordt zelf een gewone speler', () => {
  const state = newRoom();
  assert.equal(state.hostId, 'p0');
  rules.setHost(state, 'p0', 'p1', { online: all });
  assert.equal(state.hostId, 'p1');
  assert.equal(state.players.length, 3, 'de oude host speelt gewoon mee');
  assert.equal(state.hostAwaySince, null);
  // De oude host kan niets meer wat alleen de host mag, de nieuwe wel.
  throwsCode(() => rules.setSettings(state, 'p0', { target: 5 }), 'HOST_ONLY');
  rules.setSettings(state, 'p1', { target: 5 });
  assert.equal(state.settings.target, 5);
  throwsCode(() => rules.setHost(state, 'p0', 'p2', { online: all }), 'HOST_ONLY');
});

test('doorgeven: niet aan jezelf, niet aan wie er niet is of niet verbonden is, en alleen door de host', () => {
  const state = newRoom();
  throwsCode(() => rules.setHost(state, 'p0', 'p0', { online: all }), 'NOT_ALLOWED');
  throwsCode(() => rules.setHost(state, 'p0', 'zzz', { online: all }), 'NOT_FOUND');
  throwsCode(() => rules.setHost(state, 'p0', 'p2', { online: without('p2') }), 'OFFLINE');
  throwsCode(() => rules.setHost(state, 'p1', 'p2', { online: all }), 'HOST_ONLY');
  throwsCode(() => rules.setHost(state, 'zzz', 'p2', { online: all }), 'NOT_IN_ROOM');
  assert.equal(state.hostId, 'p0');
});

test('doorgeven tijdens een spel: de beurt loopt door, alleen het track-ID gaat mee naar de nieuwe host', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(40), () => 0);
  const turn = { ...state.turn };
  const before = rules.viewFor(state, 'p1', all);
  assert.equal(before.turn.trackId, undefined);
  rules.setHost(state, 'p0', 'p1', { online: all });
  assert.equal(state.phase, 'playing');
  assert.equal(state.turn.card.id, turn.card.id, 'hetzelfde nummer');
  assert.equal(state.turn.number, turn.number);
  const now = rules.viewFor(state, 'p1', all);
  assert.equal(now.turn.trackId, turn.card.id, 'de nieuwe host krijgt het ID om af te spelen');
  assert.equal(rules.viewFor(state, 'p0', all).turn.trackId, undefined, 'de oude host niet meer');
  // Verder niets extra: geen titel, artiest of jaar, en ook geen stapel.
  const text = JSON.stringify(now);
  assert.ok(!text.includes(`"title":"${turn.card.title}"`));
  assert.ok(!text.includes('"deck":'));
  // Alles van de host gaat naar de nieuwe: ander nummer, beurt overslaan, stoppen.
  throwsCode(() => rules.skipTrack(state, 'p0'), 'HOST_ONLY');
  throwsCode(() => rules.skipTurn(state, 'p0'), 'HOST_ONLY');
  throwsCode(() => rules.backToLobby(state, 'p0'), 'HOST_ONLY');
  throwsCode(() => rules.removePlayer(state, 'p0', 'p2'), 'HOST_ONLY');
  rules.skipTrack(state, 'p1');
  // De nieuwe host kan de oude (nu een gewone speler) wel verwijderen, zichzelf niet.
  throwsCode(() => rules.removePlayer(state, 'p1', 'p1'), 'NOT_ALLOWED');
  rules.backToLobby(state, 'p1');
  assert.equal(state.phase, 'lobby');
});

test('bijhouden: sinds wanneer de host weg is, met de klok van de server', () => {
  const state = newRoom();
  assert.equal(rules.trackHost(state, all, 1000), false);
  assert.equal(rules.hostAwayFor(state, all, 1000), null);
  // Weg: de telling begint nu, en blijft staan bij een volgende keer kijken.
  assert.equal(rules.trackHost(state, without('p0'), 5000), true);
  assert.equal(state.hostAwaySince, 5000);
  assert.equal(rules.trackHost(state, without('p0'), 9000), false);
  assert.equal(rules.hostAwayFor(state, without('p0'), 9000), 4000);
  // Terug: weg is weg.
  assert.equal(rules.trackHost(state, all, 10_000), true);
  assert.equal(state.hostAwaySince, null);
  // Een oudere kamer (zonder het veld) of een wegvallen dat de server niet zag: de telling begint pas nu.
  delete state.hostAwaySince;
  assert.equal(rules.hostAwayFor(state, without('p0'), 50_000), 0);
  rules.trackHost(state, without('p0'), 50_000);
  assert.equal(state.hostAwaySince, 50_000);
});

test('overnemen: pas als de host de hele wachttijd weg is, en de eerste die het vraagt wordt host', () => {
  const state = newRoom();
  rules.trackHost(state, without('p0'), 0);
  const opts = (now) => ({ online: without('p0'), now, grace: GRACE });
  throwsCode(() => rules.takeHost(state, 'p1', opts(GRACE - 1)), 'HOST_WAIT');
  assert.equal(state.hostId, 'p0');
  rules.takeHost(state, 'p1', opts(GRACE));
  assert.equal(state.hostId, 'p1');
  assert.equal(state.hostAwaySince, null);
  // Cas tikt net na Bob: Bob is er, dus dat kan niet meer.
  throwsCode(() => rules.takeHost(state, 'p2', opts(GRACE + 10)), 'HOST_HERE');
  assert.equal(state.hostId, 'p1');
});

test('overnemen: niet zolang de host verbonden is, ook niet na lang wachten (geen kapen)', () => {
  const state = newRoom();
  rules.trackHost(state, without('p0'), 0);
  // De host komt terug voor de wachttijd om is: de telling vervalt.
  throwsCode(() => rules.takeHost(state, 'p1', { online: all, now: GRACE * 10, grace: GRACE }), 'HOST_HERE');
  assert.equal(state.hostAwaySince, null);
  // Weer weg: de wachttijd begint opnieuw, ook al was hij eerder al eens weg.
  rules.trackHost(state, without('p0'), GRACE * 10);
  throwsCode(() => rules.takeHost(state, 'p1', { online: without('p0'), now: GRACE * 10 + 1000, grace: GRACE }), 'HOST_WAIT');
  // Ziet de server het wegvallen pas bij de vraag zelf, dan begint de telling daar.
  const fresh = newRoom();
  throwsCode(() => rules.takeHost(fresh, 'p1', { online: without('p0'), now: 999_999, grace: GRACE }), 'HOST_WAIT');
  assert.equal(fresh.hostAwaySince, 999_999);
  // De host zelf, en wie niet in het spel zit, kunnen het niet.
  throwsCode(() => rules.takeHost(state, 'p0', { online: without('p1'), now: GRACE * 20, grace: GRACE }), 'NOT_ALLOWED');
  throwsCode(() => rules.takeHost(state, 'zzz', { online: without('p0'), now: GRACE * 20, grace: GRACE }), 'NOT_IN_ROOM');
});

test('overnemen: de oude host komt terug als gewone speler en kan niets meer van de host', () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(40), () => 0);
  rules.trackHost(state, without('p0'), 0);
  rules.takeHost(state, 'p2', { online: without('p0'), now: GRACE, grace: GRACE });
  rules.trackHost(state, all, GRACE + 5000);
  assert.equal(state.hostId, 'p2');
  assert.equal(state.hostAwaySince, null, 'de host (Cas) is er');
  const view = rules.viewFor(state, 'p0', all, { now: GRACE + 5000, grace: GRACE });
  assert.equal(view.hostId, 'p2');
  assert.equal(view.turn.trackId, undefined);
  throwsCode(() => rules.skipTrack(state, 'p0'), 'HOST_ONLY');
  throwsCode(() => rules.setHost(state, 'p0', 'p1', { online: all }), 'HOST_ONLY');
  // Overnemen kan hij ook niet: de host is er.
  throwsCode(() => rules.takeHost(state, 'p0', { online: all, now: GRACE * 5, grace: GRACE }), 'HOST_HERE');
});

test('stand: hoe lang de host weg is staat erin voor iedereen, zonder klokken te vergelijken', () => {
  const state = newRoom();
  assert.equal(rules.viewFor(state, 'p1', all, { now: 0, grace: GRACE }).hostAway, null);
  rules.trackHost(state, without('p0'), 1000);
  const v = rules.viewFor(state, 'p1', without('p0'), { now: 8000, grace: GRACE });
  assert.deepEqual(v.hostAway, { ms: 7000, grace: GRACE });
  assert.equal(v.players.find((p) => p.id === 'p0').online, false);
});

test('room: setHost en takeHost als acties, met de wachttijd van de server', async () => {
  const state = room.createRoomState('ABCD', 0);
  const host = room.join(state, 'Hanne');
  const bob = room.join(state, 'Bob');
  const cas = room.join(state, 'Cas');
  const ids = [host.playerId, bob.playerId, cas.playerId];
  const online = new Set(ids);
  const loadTracks = async () => makeTracks(40);
  // Doorgeven aan Bob, en Bob geeft het terug.
  await room.applyAction(state, host.playerId, { t: 'setHost', playerId: bob.playerId }, { loadTracks, online, now: 1 });
  assert.equal(state.hostId, bob.playerId);
  await rejects(room.applyAction(state, host.playerId, { t: 'setHost', playerId: cas.playerId }, { loadTracks, online, now: 2 }), 'HOST_ONLY');
  await room.applyAction(state, bob.playerId, { t: 'setHost', playerId: host.playerId }, { loadTracks, online, now: 3 });
  assert.equal(state.hostId, host.playerId);
  // De gedeelde jaartallen: alleen met de sleutel van de huidige host.
  assert.equal(room.authenticateHost(state, host.token), host.playerId);
  assert.throws(() => room.authenticateHost(state, bob.token), (e) => e.code === 'HOST_ONLY');

  // Hanne valt weg; Cas vraagt te vroeg, dan op tijd.
  const gone = new Set([bob.playerId, cas.playerId]);
  room.trackHost(state, gone, 10_000);
  await rejects(room.applyAction(state, cas.playerId, { t: 'takeHost' }, { loadTracks, online: gone, now: 12_000, grace: 5000 }), 'HOST_WAIT');
  await room.applyAction(state, cas.playerId, { t: 'takeHost' }, { loadTracks, online: gone, now: 15_000, grace: 5000 });
  assert.equal(state.hostId, cas.playerId);
  await rejects(room.applyAction(state, bob.playerId, { t: 'takeHost' }, { loadTracks, online: gone, now: 15_001, grace: 5000 }), 'HOST_HERE');
  // Zonder te weten wie verbonden is, neemt de server nooit over.
  await rejects(room.applyAction(state, bob.playerId, { t: 'takeHost' }, { loadTracks, now: 99_999 }), 'SERVER');
  // De eigen lijst: alleen de nieuwe host kan ze versturen.
  const own = makeTracks(12, 1980);
  assert.throws(() => room.setDeck(state, { token: host.token, name: 'X', tracks: own }), (e) => e.code === 'HOST_ONLY');
  room.setDeck(state, { token: cas.token, name: 'Van Cas', tracks: own });
  assert.equal(state.custom.name, 'Van Cas');
  // Elke speler houdt zijn eigen geheime sleutel.
  assert.equal(room.authenticate(state, host.token), host.playerId);
  assert.equal(room.authenticate(state, cas.token), cas.playerId);
});

test('room: het geluid voor wie meeluistert blijft bij het nummer, en alleen de nieuwe host bedient het', async () => {
  const state = room.createRoomState('ABCD', 0);
  const host = room.join(state, 'Hanne');
  const bob = room.join(state, 'Bob');
  const online = new Set([host.playerId, bob.playerId]);
  const deck = Array.from({ length: 20 }, (_, i) => ({ id: `dz-${100 + i}`, artist: `A${i}`, title: `T${i}`, year: 1970 + i }));
  room.setDeck(state, { token: host.token, name: 'Fragmenten', tracks: deck });
  await room.applyAction(state, host.playerId, { t: 'start' }, { loadTracks: async () => [], online, random: () => 0 });
  const trackId = state.turn.card.id;
  const url = 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/abc.mp3?hdnea=x';
  await room.applyAction(state, host.playerId, { t: 'sound', action: 'play', trackId, url }, { loadTracks: null, online, now: 1000 });
  const n = state.sound.n;
  await room.applyAction(state, host.playerId, { t: 'setHost', playerId: bob.playerId }, { loadTracks: null, online, now: 2000 });
  // Het geluid loopt door: Bob (nu host) ziet het in zijn stand, zonder adres; Hanne krijgt het adres als ze meeluistert.
  assert.deepEqual(room.view(state, bob.playerId, online, { now: 2000 }).sound, { n, playing: true, stale: false, r: 0 });
  assert.equal(room.view(state, host.playerId, online, { now: 2000 }).sound, undefined);
  assert.equal(room.soundMessage(state, host.playerId, true, 3000).sound.url, url);
  assert.equal(room.soundMessage(state, bob.playerId, true, 3000), null, 'de host krijgt geen geluidsbericht');
  // De oude host kan het geluid niet meer bedienen.
  await rejects(room.applyAction(state, host.playerId, { t: 'sound', action: 'pause', trackId }, { loadTracks: null, online, now: 3000 }), 'HOST_ONLY');
  await room.applyAction(state, bob.playerId, { t: 'sound', action: 'pause', trackId }, { loadTracks: null, online, now: 3000 });
  assert.equal(sound.currentSound(state).playing, false);
});

test('verbindingen: wie te lang niets stuurde, telt als weg', () => {
  assert.equal(room.alive(1000, 1000 + room.STALE_MS), true);
  assert.equal(room.alive(1000, 1001 + room.STALE_MS), false);
  assert.equal(room.alive(undefined, 1000), false);
  assert.equal(room.alive(0, 5000, 10_000), true);
  assert.equal(room.msSetting('4000', 30_000), 4000);
  assert.equal(room.msSetting('', 30_000), 30_000);
  assert.equal(room.msSetting(undefined, 30_000), 30_000);
  assert.equal(room.msSetting('rommel', 30_000), 30_000);
  assert.equal(room.msSetting('-5', 30_000), 30_000);
  assert.equal(rules.HOST_GRACE_MS, 30_000);
  assert.equal(room.HOST_GRACE_MS, 30_000, 'de servers lezen de standaardwaarde hier');
});

test('terug naar de wachtkamer omdat de muziek niet verder kon: de wachtkamer zegt het tot het volgende spel', async () => {
  const state = newRoom();
  rules.startGame(state, 'p0', makeTracks(40), () => 0);
  rules.setHost(state, 'p0', 'p1', { online: all });
  await room.applyAction(state, 'p1', { t: 'lobby', why: 'music' }, { loadTracks: async () => makeTracks(40), online: all });
  assert.equal(state.phase, 'lobby');
  assert.equal(rules.viewFor(state, 'p2', all).note, 'music');
  await room.applyAction(state, 'p1', { t: 'start' }, { loadTracks: async () => makeTracks(40), online: all });
  assert.equal(rules.viewFor(state, 'p2', all).note, null);
  // Een gewone stop zegt niets; een onbekende reden ook niet.
  await room.applyAction(state, 'p1', { t: 'lobby', why: 'iets' }, { loadTracks: null, online: all });
  assert.equal(rules.viewFor(state, 'p2', all).note, null);
});
