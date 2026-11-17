// Rekenwerk voor een eigen playlist van de host, los van de browser zodat het
// met gewone unit-tests te controleren is: welke nummers meedoen, in welke
// volgorde ze opgezocht worden, wat er naar de server gaat en hoe lang het
// opzoeken nog duurt. Het opzoeken zelf staat in deck.js.

import { songKey } from './years.js';

/** Zoveel nummers mag een lijst hebben (LIMITS in server/src/rules.js). */
export const MAX_DECK = 500;
export const MIN_DECK = 10;

/** Fisher-Yates met een aangeleverde random-functie (0 <= r < 1). */
export function shuffled(items, random = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Hetzelfde nummer twee keer (album- en singleversie) geeft twee dezelfde kaarten: alleen het eerste telt. */
export function withoutDoubles(tracks) {
  const seen = new Set();
  return tracks.filter((t) => {
    const key = songKey(t.title, t.artists);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Welke nummers meedoen. Heeft de playlist meer dan `max` nummers, dan kiest
 * het spel er willekeurig `max` uit (een greep), en alleen daarvan wordt het
 * jaar opgezocht. De volgorde van de playlist blijft behouden.
 */
export function pickTracks(tracks, max = MAX_DECK, random = Math.random) {
  if (tracks.length <= max) return { tracks: tracks.slice(), sampled: false, total: tracks.length };
  const chosen = new Set(shuffled(tracks.map((_, i) => i), random).slice(0, max));
  return { tracks: tracks.filter((_, i) => chosen.has(i)), sampled: true, total: tracks.length };
}

/**
 * Volgorde om op te zoeken: eerst wat al gekend is (dat kost niets), daarna de
 * onbekende nummers in willekeurige volgorde. Start de host al voor alles
 * opgezocht is, dan is wat er klaar is een evenwichtige greep uit de hele
 * playlist, en niet alleen het begin ervan.
 */
export function lookupOrder(tracks, isKnown, random = Math.random) {
  const known = tracks.filter((t) => isKnown(t));
  const unknown = tracks.filter((t) => !isKnown(t));
  return [...known, ...shuffled(unknown, random)];
}

/** De lijst voor de server: alleen nummers met een jaartal, en alleen wat het spel nodig heeft. */
export function deckOf(rows, max = MAX_DECK) {
  return rows
    .filter((r) => r.year)
    .slice(0, max)
    .map((r) => ({ id: r.id, artist: r.artist, title: r.title, year: r.year }));
}

/**
 * De lijst voor de server zolang het opzoeken nog loopt: een evenwichtige
 * greep uit de playlist. Wat bij de start al gekend was (de standaardlijst van
 * het spel, de gedeelde lijst, eerder opgezocht) is geen willekeurige greep:
 * de standaardlijst is bv. rock en metal. Alles meenemen zou een vroeg spel
 * daar sterk naartoe trekken. Daarom gaan van de gekende nummers er maar
 * zoveel mee als het deel van de rest dat al opgezocht is, plus wat nodig is
 * om aan `need` te komen (genoeg voor een volledig spel). Welke gekende
 * nummers meegaan, bepaalt `rank` (een vaste willekeurige volgorde, zodat de
 * greep niet bij elke upload verandert).
 *
 * rows: [{ id, year, known }]; done/todo: opgezocht/op te zoeken bij de start.
 */
export function fairDeck(rows, { done, todo, finished, need, rank = new Map() }, max = MAX_DECK) {
  if (finished || !(todo > 0)) return deckOf(rows, max);
  const withYear = rows.filter((r) => r.year);
  const looked = withYear.filter((r) => !r.known);
  const known = withYear.filter((r) => r.known).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const share = Math.ceil((known.length * Math.min(done, todo)) / todo);
  const take = Math.min(known.length, Math.max(share, (need || MIN_DECK) - looked.length));
  return deckOf([...looked, ...known.slice(0, take)], max);
}

/**
 * Hoeveel nummers er nog opgezocht moeten worden voor de greep van fairDeck
 * ook evenwichtig is (en niet alleen aangevuld met gekende nummers om aan
 * `need` te komen). 0: nu al evenwichtig.
 */
export function lookupsUntilFair({ known, todo, done, need }) {
  if (!(todo > 0) || !(known > 0)) return 0;
  const lookups = Math.min(todo, Math.ceil(need / (1 + known / todo)));
  return Math.max(0, lookups - done);
}

/** Genoeg nummers voor een volledig spel: ruim twee kaarten per speler per kaart van het doel. */
export function deckNeed(players, target) {
  return Math.max(MIN_DECK, Math.max(1, players || 1) * (target || 10) * 2);
}

/**
 * Seconden per opgezocht nummer: gemeten in deze opzoeking zodra er een paar
 * gedaan zijn (een trage of drukke MusicBrainz telt zo mee), anders `fallback`.
 */
export function secondsPerLookup({ done, elapsedMs, fallback }) {
  if (done < 3 || !(elapsedMs > 0)) return fallback;
  return elapsedMs / 1000 / done;
}

/** Hoeveel minuten het opzoeken van `left` nummers nog ongeveer duurt (minstens 1). */
export function minutesLeft(left, seconds) {
  if (left <= 0) return 0;
  return Math.max(1, Math.round((left * seconds) / 60));
}

/**
 * Wanneer de lijst tijdens het opzoeken opnieuw naar de server mag: niet bij
 * elk nummer (dat zijn honderden verzoeken), maar ten vroegste `first` ms na
 * het begin en daarna hoogstens elke `every` ms. Geeft de wachttijd in ms.
 */
export function uploadWait({ now, startedAt, lastUpload, first, every }) {
  const earliest = Math.max(startedAt + first, lastUpload ? lastUpload + every : 0);
  return Math.max(0, earliest - now);
}

/** Mag de lijst nu naar de server? De server weigert een nieuwe lijst tijdens een spel. */
export function canSendDeck(phase) {
  return phase === 'lobby' || phase === 'finished';
}
