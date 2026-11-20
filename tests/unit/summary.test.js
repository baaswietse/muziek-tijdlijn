// Het eindscherm: de tellers die de server bijhoudt (server/src/rules.js) en
// het overzicht met de prijzen dat de gsm ervan maakt (web/src/lib/summary.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../../server/src/rules.js';
import * as room from '../../server/src/room.js';
import { buildSummary, prizesFor, statLines, formatDuration, metaLine, winnerTitle, PRIZES } from '../../web/src/lib/summary.js';

function makeTracks(n, startYear = 1960) {
  return Array.from({ length: n }, (_, i) => ({ id: `track${String(i).padStart(3, '0')}`, artist: `A${i}`, title: `T${i}`, year: startYear + i }));
}
const zero = () => 0;

function newGame(names = ['Ann', 'Bob', 'Cas'], target = 10) {
  const state = rules.createRoom({ code: 'TEST', now: 0 });
  names.forEach((name, i) => rules.addPlayer(state, { id: `p${i}`, token: `token-${i}-xxxxxxxx`, name }));
  rules.setSettings(state, 'p0', { target });
  rules.startGame(state, 'p0', makeTracks(80), zero);
  return state;
}

function slots(state) {
  const p = rules.findPlayer(state, state.turn.playerId);
  const y = state.turn.card.year;
  const ok = [];
  const bad = [];
  for (let i = 0; i <= p.timeline.length; i++) (rules.isCorrectPlacement(p.timeline, y, i) ? ok : bad).push(i);
  return { ok, bad };
}

const statsOf = (state, id) => rules.viewFor(state, id).players.find((p) => p.id === id).stats;
const allStats = (state) => JSON.stringify(rules.viewFor(state, 'p0').players.map((p) => p.stats));
const BLANK = { placed: 0, correct: 0, bestStreak: 0, guessed: 0, betsWon: 0, betsLost: 0, bought: 0 };

function passAll(state) {
  for (const id of rules.waitingFor(state)) rules.passBet(state, id);
}

/** De speler aan beurt legt juist (of fout) en onthult; niemand zet in. */
function playTurn(state, correct = true) {
  const active = state.turn.playerId;
  const { ok, bad } = slots(state);
  const index = correct || !bad.length ? ok[0] : bad[0];
  rules.placeCard(state, active, index);
  if (state.phase === 'challenge') {
    passAll(state);
    rules.revealTurn(state, active);
  }
  return active;
}

test('tellers: leggen, reeks, raden, inzetten; niets verandert voor de onthulling', () => {
  const state = newGame();
  for (const p of state.players) assert.deepEqual(statsOf(state, p.id), BLANK);
  assert.deepEqual(rules.viewFor(state, 'p0').summary, { turns: 0, ms: null });

  // Beurt 1: juist. Tot de onthulling blijven alle tellers zoals ze waren.
  const a = state.turn.playerId;
  const before = allStats(state);
  rules.selectSlot(state, a, slots(state).ok[0]);
  rules.placeCard(state, a, slots(state).ok[0]);
  assert.equal(state.phase, 'challenge');
  passAll(state);
  assert.equal(allStats(state), before, 'tellers veranderen niet tijdens de beurt');
  rules.revealTurn(state, a);
  assert.deepEqual(statsOf(state, a), { ...BLANK, placed: 1, correct: 1, bestStreak: 1 });
  assert.equal(rules.viewFor(state, a).summary.turns, 1);

  // Het raad-token: geven, verplaatsen, terugnemen en weer geven.
  const [b, c] = state.players.filter((p) => p.id !== a).map((p) => p.id);
  rules.giveToken(state, a, b);
  assert.equal(statsOf(state, b).guessed, 1);
  rules.giveToken(state, a, c);
  assert.equal(statsOf(state, b).guessed, 0);
  assert.equal(statsOf(state, c).guessed, 1);
  rules.giveToken(state, a, null);
  assert.equal(statsOf(state, c).guessed, 0);
  rules.giveToken(state, c, c); // zelf opeisen
  assert.equal(statsOf(state, c).guessed, 1);
  rules.nextTurn(state, a);

  // Beurt 2: de speler aan beurt ligt fout, de volgende zet juist in en krijgt de kaart.
  const active2 = state.turn.playerId;
  const { ok, bad } = slots(state);
  rules.placeCard(state, active2, bad[0]);
  const bettor = state.players.find((p) => p.id !== active2).id;
  const beforeBet = allStats(state);
  rules.placeBet(state, bettor, ok[0]);
  assert.equal(allStats(state), beforeBet, 'een inzet telt pas bij de onthulling');
  passAll(state);
  rules.revealTurn(state, active2);
  assert.equal(statsOf(state, active2).placed, 1);
  assert.equal(statsOf(state, active2).correct, 0);
  assert.equal(statsOf(state, bettor).betsWon, 1);
  assert.equal(statsOf(state, bettor).betsLost, 0);
  rules.nextTurn(state, active2);

  // Beurt 3: juist, met een inzet die dus verloren is.
  const active3 = state.turn.playerId;
  const s3 = slots(state);
  rules.placeCard(state, active3, s3.ok[0]);
  const other = state.players.find((p) => p.id !== active3 && p.guessTokens > 0).id;
  const free = [...s3.ok, ...s3.bad].find((i) => i !== s3.ok[0]);
  const lostBefore = statsOf(state, other).betsLost;
  rules.placeBet(state, other, free);
  passAll(state);
  rules.revealTurn(state, active3);
  assert.equal(statsOf(state, other).betsLost, lostBefore + 1);
  assert.equal(rules.viewFor(state, 'p0').summary.turns, 3);
});

test('tellers: de langste reeks blijft staan na een fout', () => {
  const state = newGame(['Ann', 'Bob'], 20);
  const ann = state.turn.playerId;
  const bob = state.players.find((p) => p.id !== ann).id;
  // Ann: juist, juist, juist, fout, juist. Bob legt telkens juist.
  for (const correct of [true, true, true, false, true]) {
    assert.equal(playTurn(state, correct), ann);
    rules.nextTurn(state, ann);
    assert.equal(playTurn(state, true), bob);
    rules.nextTurn(state, bob);
  }
  const s = statsOf(state, ann);
  // Lag de foute beurt toch juist (geen foute plaats mogelijk), dan telt ze als juist.
  assert.equal(s.placed, 5);
  assert.ok(s.bestStreak >= 3);
  assert.equal(s.bestStreak, s.correct === 5 ? 5 : 3);
  assert.equal(statsOf(state, bob).bestStreak, 5);
});

test('tellers: een gekochte kaart telt als gekocht en als beurt, niet als gelegd', () => {
  const state = newGame();
  const a = state.turn.playerId;
  rules.findPlayer(state, a).guessTokens = 3;
  rules.buyCard(state, a);
  const s = statsOf(state, a);
  assert.equal(s.bought, 1);
  assert.equal(s.placed, 0);
  assert.equal(rules.viewFor(state, a).summary.turns, 1);
});

test('tellers: een overgeslagen beurt of ander nummer telt niet, ook de inzetten niet', () => {
  const state = newGame();
  const a = state.turn.playerId;
  const { ok, bad } = slots(state);
  rules.placeCard(state, a, ok[0]);
  const b = state.players.find((p) => p.id !== a).id;
  rules.placeBet(state, b, bad[0] ?? ok[1]);
  const before = allStats(state);
  rules.skipTrack(state, 'p0');
  assert.equal(allStats(state), before);
  rules.skipTurn(state, 'p0');
  assert.equal(allStats(state), before);
  assert.equal(rules.viewFor(state, 'p0').summary.turns, 0);
});

test('tellers: "Nog een spel" en de wachtkamer beginnen met lege tellers', () => {
  const state = newGame(['Ann', 'Bob'], 3);
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 50) {
    const active = playTurn(state, true);
    if (state.phase === 'reveal') {
      rules.giveToken(state, active, active);
      rules.nextTurn(state, active);
    }
  }
  assert.equal(state.phase, 'finished');
  rules.markTimes(state, 5000);
  assert.ok(statsOf(state, state.winnerIds[0]).correct >= 2);
  rules.startGame(state, 'p0', makeTracks(80), zero);
  for (const p of state.players) assert.deepEqual(statsOf(state, p.id), BLANK);
  assert.deepEqual(rules.viewFor(state, 'p0').summary, { turns: 0, ms: null });
  rules.backToLobby(state, 'p0');
  assert.equal(rules.viewFor(state, 'p0').summary, null);
});

test('tijd: begin bij de start, einde bij het afgelopen spel (klok van de server)', async () => {
  const state = rules.createRoom({ code: 'TEST', now: 0 });
  const a = room.join(state, 'Ann', 0);
  room.join(state, 'Bob', 0);
  const loadTracks = async () => makeTracks(80);
  await room.applyAction(state, a.playerId, { t: 'settings', target: 3 }, { loadTracks, now: 500 });
  await room.applyAction(state, a.playerId, { t: 'start' }, { loadTracks, random: zero, now: 1000 });
  assert.equal(state.stats.startedAt, 1000);
  assert.equal(rules.viewFor(state, a.playerId).summary.ms, null, 'tijdens het spel geen duur');
  let now = 1000;
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 50) {
    const active = state.turn.playerId;
    const { ok } = slots(state);
    now += 60_000;
    await room.applyAction(state, active, { t: 'place', index: ok[0] }, { loadTracks, now });
    if (state.phase === 'challenge') {
      for (const id of rules.waitingFor(state)) await room.applyAction(state, id, { t: 'pass' }, { loadTracks, now });
      await room.applyAction(state, active, { t: 'reveal' }, { loadTracks, now });
    }
    if (state.phase === 'reveal') await room.applyAction(state, active, { t: 'next' }, { loadTracks, now });
  }
  assert.equal(state.phase, 'finished');
  assert.equal(rules.viewFor(state, a.playerId).summary.ms, now - 1000);
  // Daarna (bv. het token nog geven) blijft het einde staan.
  await room.applyAction(state, a.playerId, { t: 'token', playerId: a.playerId }, { loadTracks, now: now + 99_000 });
  assert.equal(rules.viewFor(state, a.playerId).summary.ms, now - 1000);
});

test('een speler die halverwege verwijderd wordt, breekt het overzicht niet', () => {
  const state = newGame();
  const a = playTurn(state, true);
  rules.nextTurn(state, a);
  // De speler aan beurt wordt verwijderd terwijl een ander inzette.
  const active = state.turn.playerId === 'p0' ? null : state.turn.playerId;
  const victim = active ?? 'p2';
  if (active) {
    const { ok, bad } = slots(state);
    rules.placeCard(state, active, ok[0]);
    const bettor = state.players.find((p) => p.id !== active).id;
    rules.placeBet(state, bettor, bad[0] ?? ok[1]);
  }
  rules.removePlayer(state, 'p0', victim);
  const view = rules.viewFor(state, 'p0');
  assert.equal(view.players.length, 2);
  const s = buildSummary({ ...view, phase: 'finished', winnerIds: [victim, 'p0'] });
  assert.equal(s.complete, true);
  assert.equal(s.standings.length, 2);
  assert.ok(s.standings.every((p) => p.id !== victim));
  // Een winnaar-ID die er niet meer is, komt niet in de kop.
  assert.deepEqual(s.winners.map((w) => w.id), ['p0']);
});

test('een speler die laat instapt, heeft lege tellers en het overzicht blijft volledig', () => {
  const state = newGame();
  playTurn(state, true);
  rules.addPlayer(state, { id: 'late', token: 'token-late-xxxxxxx', name: 'Dirk' });
  assert.deepEqual(statsOf(state, 'late'), BLANK);
  assert.equal(buildSummary(rules.viewFor(state, 'p0')).complete, true);
});

test('een oud spel zonder cijfers (al bezig bij de uitrol): niets breekt, toon wat er is', () => {
  const state = newGame(['Ann', 'Bob'], 3);
  // Zo zag een kamer eruit voor deze versie.
  delete state.stats;
  for (const p of state.players) delete p.stats;
  let guard = 0;
  while (state.phase !== 'finished' && guard++ < 50) {
    const active = playTurn(state, true);
    rules.giveToken(state, active, active);
    if (state.phase === 'reveal') rules.nextTurn(state, active);
  }
  rules.markTimes(state, 1234);
  const view = rules.viewFor(state, 'p0');
  assert.equal(view.summary, null);
  assert.ok(view.players.every((p) => p.stats === null));
  const s = buildSummary(view);
  assert.equal(s.complete, false);
  assert.deepEqual(s.prizes, []);
  assert.equal(s.standings.length, 2);
  assert.equal(s.standings[0].id, state.winnerIds[0]);
  assert.equal(s.ms, null);
  assert.equal(metaLine(s), 'naar 3 kaarten');
  // Een speler die in zo'n spel laat instapt, maakt het niet "half volledig".
  const mixed = buildSummary({ ...view, players: [...view.players, { id: 'x', name: 'X', timeline: [], guessTokens: 2, stats: { ...BLANK } }] });
  assert.equal(mixed.complete, false);
  assert.deepEqual(mixed.prizes, []);
});

// ---------- prijzen en overzicht ----------

const P = (id, stats, extra = {}) => ({ id, name: id.toUpperCase(), stats: { ...BLANK, ...stats }, ...extra });

test('prijzen: alleen vanaf het minimum, met de juiste speler', () => {
  const prizes = prizesFor([
    P('ann', { bestStreak: 4, guessed: 1, betsWon: 0, betsLost: 1 }),
    P('bob', { bestStreak: 2, guessed: 3, betsWon: 2, betsLost: 2 }),
    P('cas', { bestStreak: 1 }),
  ]);
  assert.deepEqual(
    prizes.map((p) => [p.key, p.ids.join(','), p.value]),
    [
      ['streak', 'ann', 4],
      ['guess', 'bob', 3],
      ['sharp', 'bob', 2],
      ['gamble', 'bob', 4],
    ],
  );
  assert.equal(prizes[0].detail, '4 juist na elkaar');
  assert.equal(prizes[2].detail, '2 kaarten gewonnen met een token');
  // Onder het minimum: geen prijs.
  assert.deepEqual(prizesFor([P('ann', { bestStreak: 2, guessed: 1, betsWon: 1, betsLost: 1 }), P('bob', {})]), []);
});

test('prijzen: gelijke stand met twee wordt gedeeld, met drie valt ze weg', () => {
  const two = prizesFor([P('ann', { bestStreak: 3 }), P('bob', { bestStreak: 3 }), P('cas', { bestStreak: 1 })]);
  assert.deepEqual(two.map((p) => [p.key, p.ids]), [['streak', ['ann', 'bob']]]);
  assert.deepEqual(two[0].names, ['ANN', 'BOB']);
  const three = prizesFor([P('ann', { bestStreak: 3, guessed: 2 }), P('bob', { bestStreak: 3 }), P('cas', { bestStreak: 3 })]);
  assert.deepEqual(three.map((p) => p.key), ['guess']);
});

test('prijzen: een spel zonder tokens geeft geen tokenprijzen; alleen of zonder cijfers geen prijzen', () => {
  const prizes = prizesFor([P('ann', { placed: 6, correct: 6, bestStreak: 6 }), P('bob', { placed: 6, correct: 2, bestStreak: 1 })]);
  assert.deepEqual(prizes.map((p) => p.key), ['streak']);
  assert.deepEqual(prizesFor([P('ann', { bestStreak: 9 })]), []);
  assert.deepEqual(prizesFor([P('ann', { bestStreak: 9 }), { id: 'bob', name: 'Bob', stats: null }]), []);
  assert.equal(PRIZES.length, 4);
});

test('overzicht: winnaar eerst, dan kaarten en tokens, gedeelde plaats bij gelijke stand', () => {
  const card = { id: 'x', year: 2000 };
  const pl = (id, cards, tokens) => ({ id, name: id, timeline: Array(cards).fill(card), guessTokens: tokens, stats: { ...BLANK } });
  const view = {
    settings: { target: 5 },
    winnerIds: ['dirk'],
    summary: { turns: 23, ms: 31 * 60_000 },
    players: [pl('ann', 4, 1), pl('bob', 4, 1), pl('cas', 4, 3), pl('dirk', 5, 0), pl('eva', 2, 9)],
  };
  const s = buildSummary(view);
  assert.deepEqual(s.standings.map((p) => [p.id, p.rank]), [
    ['dirk', 1],
    ['cas', 2],
    ['ann', 3],
    ['bob', 3],
    ['eva', 5],
  ]);
  assert.equal(winnerTitle(s), 'dirk wint');
  assert.equal(metaLine(s), '31 min · 23 beurten · naar 5 kaarten');
  // Gelijkspel (stapel op): beide winnaars vooraan, allebei op de eerste plaats.
  const tie = buildSummary({ ...view, winnerIds: ['ann', 'cas'] });
  assert.deepEqual(tie.standings.slice(0, 2).map((p) => [p.id, p.rank]), [['cas', 1], ['ann', 1]]);
  assert.equal(winnerTitle(tie), 'Gelijkspel: cas en ann');
  assert.equal(winnerTitle(buildSummary({ ...view, winnerIds: [] })), 'Spel afgelopen');
});

test('cijfers per speler: alleen wat iets zegt', () => {
  assert.deepEqual(statLines(null), []);
  assert.deepEqual(statLines({ ...BLANK }), []);
  assert.deepEqual(
    statLines({ placed: 9, correct: 7, bestStreak: 4, guessed: 3, betsWon: 1, betsLost: 2, bought: 1 }).map((l) => l.text),
    ['7 van 9 juist gelegd', 'reeks van 4', '3× geraden', '1 kaart met een token', '2 tokens verloren', '1 kaart gekocht'],
  );
  assert.deepEqual(statLines({ ...BLANK, placed: 1, bestStreak: 1, correct: 1 }).map((l) => l.key), ['placed']);
});

test('duur', () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(20_000), 'minder dan een minuut');
  assert.equal(formatDuration(12 * 60_000 + 10_000), '12 min');
  assert.equal(formatDuration(65 * 60_000), '1 u 05 min');
});
