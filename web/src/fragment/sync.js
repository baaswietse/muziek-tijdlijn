// Gelijk lopen met de anderen: waar het fragment nu hoort te staan op een gsm
// die meeluistert. Zuivere functies, zodat ze met unit-tests na te kijken zijn.
//
// De server stuurt `pos`: de plaats in het fragment (seconden sinds het
// begin) op het moment dat hij het bericht maakte, volgens zijn eigen klok.
// De gsm telt daar de tijd sinds ontvangst bij (met zijn eigen
// `performance.now()`, een klok die alleen vooruit loopt) en de geschatte tijd
// dat het bericht onderweg was. Zo worden nooit de klokken van twee toestellen
// met elkaar vergeleken; een gsm waarvan de klok een uur verkeerd staat, loopt
// toch gelijk.

/** Zo lang duurt een fragment als de echte duur nog niet gekend is. */
export const FRAGMENT_SECONDS = 30;
/** Zoveel mag het verschillen voor de gsm bijspringt (een sprong hoor je). */
export const TOLERANCE = 0.35;

/**
 * Waar het fragment staat op `now` (ms, `performance.now()` van deze gsm), in
 * seconden sinds het begin (kan groter zijn dan de duur: het herhaalt).
 * `receivedAt`: wanneer het bericht aankwam (zelfde klok); `latency`: hoe lang
 * het onderweg was (s).
 */
export function expectedPosition(sound, { receivedAt, now, latency = 0 }) {
  const pos = Number(sound?.pos) || 0;
  if (!sound?.playing) return Math.max(0, pos);
  return Math.max(0, pos + latency + Math.max(0, now - receivedAt) / 1000);
}

/** De plaats binnen één herhaling: `seconds` modulo de duur (30 s als die niet gekend is). */
export function wrap(seconds, duration) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : FRAGMENT_SECONDS;
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return s % d;
}

/**
 * Hoe ver `current` (plaats in het element) van `expected` ligt, rekening
 * houdend met het herhalen: 29,9 s en 0,1 s liggen bij een fragment van 30 s
 * maar 0,2 s uit elkaar.
 */
export function drift(current, expected, duration) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : FRAGMENT_SECONDS;
  const diff = Math.abs(wrap(current, d) - wrap(expected, d));
  return Math.min(diff, d - diff);
}

/** Moet de gsm bijspringen? */
export function needsSeek(current, expected, duration, tolerance = TOLERANCE) {
  return drift(current, expected, duration) > tolerance;
}
