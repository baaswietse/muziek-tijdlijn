// Het zelfcontrolerende afspelen (web/src/lib/playback.js): de wachtrij met
// commando's, het vergelijken van nummers en het herstellen als er iets
// anders speelt dan verwacht. Spotify is hier een klein model in het geheugen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandQueue, createPlayback, judgePlayback, playsExpected, transient } from '../../web/src/lib/playback.js';

const later = () => new Promise((r) => setTimeout(r, 0));
/** Wacht tot `get()` iets geeft (bv. tot een commando echt loopt). */
async function until(get) {
  for (let i = 0; i < 100 && !get(); i++) await later();
  return get();
}

test('wachtrij: commando’s één voor één, in volgorde', async () => {
  const q = commandQueue();
  const order = [];
  const slow = q.run(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push('a');
  });
  const fast = q.run(async () => order.push('b'));
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['a', 'b']);
});

test('wachtrij: wat nog wacht van een vorige generatie, vervalt', async () => {
  const q = commandQueue();
  const order = [];
  let release;
  const first = q.run(() => new Promise((r) => (release = r)).then(() => order.push('oud-bezig')));
  const stale = q.run(async () => order.push('oud-wachtend'));
  await until(() => release);
  q.bump();
  const fresh = q.run(async () => order.push('nieuw'));
  release();
  await first;
  await assert.rejects(stale, (err) => err.stale === true);
  await fresh;
  assert.deepEqual(order, ['oud-bezig', 'nieuw']);
});

test('wachtrij: een lopend commando kan zien dat het verouderd is', async () => {
  const q = commandQueue();
  let seen = null;
  let started = false;
  const run = q.run(async (isCurrent) => {
    started = true;
    await later();
    seen = isCurrent();
  });
  await until(() => started);
  q.bump();
  await run;
  assert.equal(seen, false);
});

test('nummers vergelijken: zelfde ID, relinking (linked_from) en een gekende vervanger', () => {
  assert.equal(playsExpected('A', { trackId: 'A' }), true);
  assert.equal(playsExpected('A', { trackId: 'A2', linkedFrom: 'A' }), true);
  assert.equal(playsExpected('A', { trackId: 'A2' }, new Map([['A', 'A2']])), true);
  assert.equal(playsExpected('A', { trackId: 'B' }), false);
  assert.equal(playsExpected('A', null), false);
});

test('controle: het vorige nummer, een ander toestel, iets dat al lang speelt, of nog niets', () => {
  const previous = new Set(['OUD']);
  const base = { expected: 'NIEUW', previous, sinceMs: 1000 };
  assert.equal(judgePlayback({ ...base, state: { trackId: 'NIEUW', progressMs: 900 } }), 'ok');
  // Het vorige nummer dat door het herhalen net opnieuw begon: fout, ook al staat het vooraan.
  assert.equal(judgePlayback({ ...base, state: { trackId: 'OUD', progressMs: 200 } }), 'wrong');
  // Een onbekend nummer dat pas begon: een vervanger zonder melding.
  assert.equal(judgePlayback({ ...base, state: { trackId: 'X', progressMs: 800 } }), 'relinked');
  // Een onbekend nummer dat al minuten speelt: fout.
  assert.equal(judgePlayback({ ...base, state: { trackId: 'X', progressMs: 120_000 } }), 'wrong');
  // Gestart op 30 s: dan is 31 s nog «net begonnen».
  assert.equal(judgePlayback({ ...base, startMs: 30_000, state: { trackId: 'X', progressMs: 31_000 } }), 'relinked');
  assert.equal(judgePlayback({ ...base, deviceId: 'box', state: { trackId: 'NIEUW', deviceId: 'gsm', progressMs: 0 } }), 'wrong');
  assert.equal(judgePlayback({ ...base, state: null }), 'unknown');
});

test('opnieuw proberen alleen bij storingen, niet bij een fout die blijft', () => {
  assert.equal(transient({ status: 502 }), true);
  assert.equal(transient({ status: 429 }), true);
  assert.equal(transient({ timeout: true }), true);
  assert.equal(transient({ network: true }), true);
  assert.equal(transient({ status: 404, deviceGone: true }), false);
  assert.equal(transient({ status: 403 }), false);
  assert.equal(transient({ loginRequired: true }), false);
});

/**
 * Een klein Spotify-model: `now` is wat er speelt. `behave(trackId)` bepaalt
 * per startcommando wat er gebeurt: 'ok', 'ignore' (gelukt, maar het toestel
 * schakelt niet over), een fout ({ status }), of een ander gemeld nummer.
 */
function fakeSpotify({ playing = 'OUD', behave = () => 'ok' } = {}) {
  const sp = { now: { trackId: playing, progressMs: 100_000, isPlaying: true }, calls: [], sleeps: [] };
  sp.io = {
    async play(trackId) {
      sp.calls.push(['play', trackId]);
      const how = behave(trackId, sp.calls.filter((c) => c[0] === 'play').length);
      if (how && typeof how === 'object' && how.status) throw Object.assign(new Error('fout'), how);
      if (how === 'ignore') return;
      if (how && typeof how === 'object') sp.now = { isPlaying: true, progressMs: 0, ...how };
      else sp.now = { trackId, progressMs: 0, isPlaying: true };
    },
    async state() {
      sp.calls.push(['state']);
      return sp.now && { ...sp.now };
    },
    async repeat(mode) {
      sp.calls.push(['repeat', mode]);
    },
    async pause() {
      sp.calls.push(['pause']);
      if (sp.now) sp.now = { ...sp.now, isPlaying: false };
    },
    async resume() {
      sp.calls.push(['resume']);
      if (sp.now) sp.now = { ...sp.now, isPlaying: true };
    },
    deviceId: () => null,
  };
  sp.events = { statuses: [], errors: [], confirmed: [] };
  sp.on = {
    status: (s) => sp.events.statuses.push(s),
    error: (e) => sp.events.errors.push(e),
    confirmed: (k) => sp.events.confirmed.push(k),
  };
  sp.timing = { checks: [1, 1, 1], late: 0, sleep: (ms) => (sp.sleeps.push(ms), later()) };
  sp.plays = () => sp.calls.filter((c) => c[0] === 'play').map((c) => c[1]);
  return sp;
}

test('normale beurt: één startcommando, één controle, daarna pas herhalen', async () => {
  const sp = fakeSpotify();
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  assert.equal(await pb.start('NIEUW', { key: 'k1' }), true);
  assert.deepEqual(sp.calls, [['play', 'NIEUW'], ['state'], ['repeat', 'track']]);
  assert.deepEqual(sp.events.confirmed, ['k1']);
  assert.equal(sp.events.statuses.at(-1), 'playing');
});

test('«gelukt» maar het toestel schakelt niet over: opnieuw starten', async () => {
  const sp = fakeSpotify({ behave: (_, n) => (n === 1 ? 'ignore' : 'ok') });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  pb.remember('OUD');
  assert.equal(await pb.start('NIEUW', { key: 'k' }), true);
  assert.deepEqual(sp.plays(), ['NIEUW', 'NIEUW']);
  assert.equal(sp.now.trackId, 'NIEUW');
});

test('storing (502) bij het starten: vanzelf opnieuw, zonder dat het vorige nummer blijft', async () => {
  const sp = fakeSpotify({ behave: (_, n) => (n === 1 ? { status: 502 } : 'ok') });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  assert.equal(await pb.start('NIEUW', { key: 'k' }), true);
  assert.equal(sp.now.trackId, 'NIEUW');
  assert.deepEqual(sp.events.confirmed, ['k']);
});

test('te veel verzoeken (429): wacht zo lang als Spotify vraagt', async () => {
  const sp = fakeSpotify({ behave: (_, n) => (n === 1 ? { status: 429, retryAfter: 3 } : 'ok') });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  assert.equal(await pb.start('NIEUW'), true);
  assert.ok(sp.sleeps.includes(3000), `wachttijden: ${sp.sleeps}`);
});

test('het blijft het vorige nummer: begrensd opnieuw, dan stilzetten en waarschuwen', async () => {
  const sp = fakeSpotify({ behave: () => 'ignore' });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  pb.remember('OUD');
  assert.equal(await pb.start('NIEUW', { key: 'k' }), false);
  assert.deepEqual(sp.plays(), ['NIEUW', 'NIEUW', 'NIEUW']); // 1 + 2 pogingen
  assert.deepEqual(sp.calls.at(-1), ['pause']); // het vorige nummer klinkt niet verder
  assert.equal(sp.calls.some((c) => c[0] === 'repeat'), false);
  assert.deepEqual(sp.events.confirmed, []); // niet als gestart onthouden
  assert.equal(sp.events.statuses.at(-1), 'wrong');
  assert.deepEqual(sp.events.errors.at(-1), { wrong: true, unknown: false });
});

test('een fout die blijft (toestel weg): meteen melden, niet eindeloos proberen', async () => {
  const sp = fakeSpotify({ behave: () => ({ status: 404, deviceGone: true, message: 'weg' }) });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  assert.equal(await pb.start('NIEUW'), false);
  assert.deepEqual(sp.plays(), ['NIEUW']);
  assert.equal(sp.events.statuses.at(-1), 'error');
  assert.equal(sp.events.errors.at(-1).deviceGone, true);
});

test('relinking: een gemelde vervanger telt als juist, ook bij een latere controle', async () => {
  const sp = fakeSpotify({ behave: (id) => ({ trackId: `${id}-BE`, linkedFrom: id }) });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  assert.equal(await pb.start('NIEUW'), true);
  assert.deepEqual(sp.plays(), ['NIEUW']);
  assert.equal(await pb.check(), true);
  assert.deepEqual(sp.plays(), ['NIEUW']);
});

test('relinking zonder melding: het nieuwe ID wordt onthouden, geen vals alarm', async () => {
  const sp = fakeSpotify({ behave: (id) => ({ trackId: `${id}-BE` }) });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  pb.remember('OUD');
  assert.equal(await pb.start('NIEUW'), true);
  sp.now.progressMs = 200_000; // later in het nummer
  assert.equal(await pb.check(), true);
  assert.deepEqual(sp.plays(), ['NIEUW']);
  // Bij de volgende beurt is ook de vervanger een «vorig nummer».
  sp.io.play = async (id) => {
    sp.calls.push(['play', id]);
  };
  assert.equal(await pb.start('DERDE'), false);
});

test('twee beurten vlak na elkaar: niets van de eerste komt na het startcommando van de tweede', async () => {
  let hold;
  const sp = fakeSpotify();
  const play = sp.io.play;
  sp.io.play = async (id) => {
    if (id === 'A') await new Promise((r) => (hold = r));
    return play(id);
  };
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  const a = pb.start('A', { key: 'a' });
  await until(() => hold);
  const b = pb.start('B', { key: 'b' });
  hold();
  assert.equal(await a, false);
  assert.equal(await b, true);
  const firstB = sp.calls.findIndex((c) => c[0] === 'play' && c[1] === 'B');
  const after = sp.calls.slice(firstB);
  assert.equal(after.some((c) => c[1] === 'A'), false);
  // Het herhalen hoort alleen bij B, en komt na B.
  assert.deepEqual(sp.calls.filter((c) => c[0] === 'repeat'), [['repeat', 'track']]);
  assert.deepEqual(sp.events.confirmed, ['b']);
  assert.equal(sp.now.trackId, 'B');
});

test('een pauze van de vorige beurt die nog wacht, vervalt bij een nieuw nummer', async () => {
  let hold;
  const sp = fakeSpotify();
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  await pb.start('A');
  const state = sp.io.state;
  sp.io.state = async () => {
    await new Promise((r) => (hold = r));
    return state();
  };
  const check = pb.check();
  await until(() => hold);
  pb.pause();
  sp.io.state = state;
  const b = pb.start('B');
  hold();
  await check;
  assert.equal(await b, true);
  assert.equal(sp.calls.some((c) => c[0] === 'pause'), false);
  assert.equal(sp.now.isPlaying, true);
});

test('nakijken: verkeerd nummer wordt hersteld, «weet niet» laat het zoals het is', async () => {
  const sp = fakeSpotify();
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  await pb.start('A', { key: 'a' });
  sp.now = { trackId: 'OUD', progressMs: 3000, isPlaying: true }; // bv. een laat aangekomen commando
  assert.equal(await pb.check(), true);
  assert.equal(sp.now.trackId, 'A');
  sp.now = null;
  const before = sp.plays().length;
  assert.equal(await pb.check(), true);
  assert.equal(sp.plays().length, before);
  // Na herladen of een speler die terugkomt: «weet niet» mag wel opnieuw starten.
  assert.equal(await pb.check({ repairUnknown: true }), true);
  assert.equal(sp.plays().length, before + 1);
});

test('hervatten na een pauze: speelt er intussen iets anders, dan het juiste nummer', async () => {
  const sp = fakeSpotify();
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  await pb.start('A');
  await pb.pause();
  sp.now = { trackId: 'ANDER', progressMs: 5000, isPlaying: false };
  sp.io.resume = async () => sp.calls.push(['resume']);
  await pb.resume();
  assert.equal(sp.now.trackId, 'A');
  assert.equal(sp.events.statuses.at(-1), 'playing');
});

test('na het spel: herhalen uit en geen controles meer', async () => {
  const sp = fakeSpotify();
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  await pb.start('A');
  await pb.release();
  assert.deepEqual(sp.calls.at(-1), ['repeat', 'off']);
  assert.equal(pb.expected, null);
  assert.equal(await pb.check(), true);
});

test('overnemen na herladen: niet opnieuw starten als het klopt', async () => {
  const sp = fakeSpotify({ playing: 'A' });
  const pb = createPlayback(sp.io, sp.on, sp.timing);
  assert.equal(await pb.adopt('A', { key: 'a' }), true);
  assert.deepEqual(sp.plays(), []);
});
