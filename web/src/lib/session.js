// Wat de browser onthoudt, zodat je na een vergrendeld scherm, een herlaad of
// de omweg langs Spotify terug in hetzelfde spel zit.

import { codeFromHash } from './invite.js';

const KEY = 'mt.session';

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Privémodus of opslag vol: het spel werkt dan nog, maar onthoudt niets.
  }
}

/**
 * { code, token, playerId, name, host } of null. `host` (true als deze gsm het
 * spel maakte) ontbreekt in sessies van voor dat veld bestond.
 */
export function loadSession() {
  const s = read(KEY);
  return s && s.code && s.token ? s : null;
}

export function saveSession(session) {
  write(KEY, session);
}

export function loadName() {
  return read('mt.name') || '';
}

export function saveName(name) {
  write('mt.name', name);
}

export const storage = { read, write };

/** Testmodus zonder Spotify: zet aan met ?mock=1, uit met ?mock=0. */
export function detectMock() {
  const p = new URLSearchParams(location.search);
  if (p.get('mock') === '1') write('mt.mock', true);
  if (p.get('mock') === '0') write('mt.mock', null);
  return read('mt.mock') === true;
}

/** Code uit een uitnodigingslink (#/j/ABCD). */
export function inviteCode() {
  return codeFromHash(location.hash);
}

/** Haalt de uitnodiging uit de adresbalk, zodat ze niet nog eens meetelt. */
export function clearInvite() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

export function inviteUrl(code) {
  return `${location.origin}${import.meta.env.BASE_URL}#/j/${code}`;
}
