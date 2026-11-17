// Tests voor wat er gebeurt als iemand een uitnodigingslink opent (web/src/lib/invite.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { afterJoinError, codeFromHash, decideInvite, hostOf } from '../../web/src/lib/invite.js';

const A = { code: 'AAAA', token: 'tok-a', playerId: 'p1', name: 'Bob' };

test('codeFromHash: enkel #/j/ met vier letters, altijd in hoofdletters', () => {
  assert.equal(codeFromHash('#/j/abcd'), 'ABCD');
  assert.equal(codeFromHash('#/j/WXYZ'), 'WXYZ');
  assert.equal(codeFromHash(''), '');
  assert.equal(codeFromHash(undefined), '');
  assert.equal(codeFromHash('#/j/ABC'), '');
  assert.equal(codeFromHash('#/j/ABCDE'), '');
  assert.equal(codeFromHash('#/j/AB1D'), '');
  assert.equal(codeFromHash('#/x/ABCD'), '');
});

test('geen link: niets te doen', () => {
  assert.deepEqual(decideInvite({ code: '', session: A, knownName: 'Bob', host: false }), { action: 'none' });
  assert.deepEqual(decideInvite({ code: '', session: null }), { action: 'none' });
});

test('geen sessie: met gekende naam meteen meedoen, anders om een naam vragen', () => {
  assert.deepEqual(decideInvite({ code: 'BBBB', session: null, knownName: 'Sam' }), { action: 'join', name: 'Sam', from: null });
  assert.deepEqual(decideInvite({ code: 'BBBB', session: null, knownName: '  Sam ' }), { action: 'join', name: 'Sam', from: null });
  assert.deepEqual(decideInvite({ code: 'BBBB', session: null, knownName: '' }), { action: 'ask-name', from: null });
  assert.deepEqual(decideInvite({ code: 'BBBB', session: null, knownName: '   ' }), { action: 'ask-name', from: null });
  assert.deepEqual(decideInvite({ code: 'BBBB', session: null }), { action: 'ask-name', from: null });
});

test('link naar de eigen ruimte: gewoon verder, ook als host of als host-zijn onbekend is', () => {
  for (const host of [true, false, null]) {
    assert.deepEqual(decideInvite({ code: 'AAAA', session: A, knownName: 'Bob', host }), { action: 'stay' });
  }
});

test('gast in een ander spel: meteen meedoen onder de naam uit de sessie', () => {
  assert.deepEqual(decideInvite({ code: 'BBBB', session: A, knownName: 'Iets anders', host: false }), {
    action: 'join',
    name: 'Bob',
    from: 'AAAA',
  });
  // Sessie zonder naam: dan de gekende naam, en anders vragen.
  const noName = { ...A, name: '' };
  assert.deepEqual(decideInvite({ code: 'BBBB', session: noName, knownName: 'Sam', host: false }), {
    action: 'join',
    name: 'Sam',
    from: 'AAAA',
  });
  assert.deepEqual(decideInvite({ code: 'BBBB', session: noName, knownName: '', host: false }), {
    action: 'ask-name',
    from: 'AAAA',
  });
});

test('host van een ander spel: eerst vragen', () => {
  assert.deepEqual(decideInvite({ code: 'BBBB', session: A, knownName: 'Sam', host: true }), {
    action: 'confirm',
    name: 'Bob',
    from: 'AAAA',
  });
  // Ook zonder naam eerst vragen; de naam komt na het overstappen.
  assert.deepEqual(decideInvite({ code: 'BBBB', session: { ...A, name: undefined }, host: true }), {
    action: 'confirm',
    name: '',
    from: 'AAAA',
  });
});

test('nog niet geweten of je host bent: wachten in plaats van te gokken', () => {
  assert.deepEqual(decideInvite({ code: 'BBBB', session: A, knownName: 'Bob', host: null }), { action: 'wait' });
  assert.deepEqual(decideInvite({ code: 'BBBB', session: A, knownName: 'Bob' }), { action: 'wait' });
});

test('hostOf: de status van de server gaat voor, daarna het bewaarde veld', () => {
  const view = (code, you, hostId) => ({ code, you, hostId });
  assert.equal(hostOf(null, view('AAAA', 'p1', 'p1')), null);
  // Oude sessie zonder veld en nog geen status: onbekend.
  assert.equal(hostOf(A, null), null);
  assert.equal(hostOf(A, view('AAAA', 'p1', 'p1')), true);
  assert.equal(hostOf(A, view('AAAA', 'p1', 'p2')), false);
  assert.equal(hostOf({ ...A, host: true }, null), true);
  assert.equal(hostOf({ ...A, host: false }, null), false);
  assert.equal(hostOf({ ...A, host: true }, view('AAAA', 'p1', 'p2')), false);
  // Een status van een ander spel (nog van voor een wissel) telt niet.
  assert.equal(hostOf(A, view('CCCC', 'p1', 'p1')), null);
  assert.equal(hostOf({ ...A, host: false }, view('CCCC', 'p1', 'p1')), false);
});

test('afterJoinError: opgeven als een andere naam niet helpt, anders het instapscherm', () => {
  for (const code of ['NO_ROOM', 'ROOM_FULL', 'DECK_EMPTY', 'NO_SERVER']) assert.equal(afterJoinError(code), 'give-up', code);
  for (const code of ['NAME_TAKEN', 'NAME_REQUIRED', 'OFFLINE', 'SERVER', undefined]) assert.equal(afterJoinError(code), 'form', String(code));
});
