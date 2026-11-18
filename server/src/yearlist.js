// De gedeelde lijst met jaartallen: per Spotify-nummer het jaar dat de browser
// van een host opzocht (of zelf verbeterde), zodat een andere host op een ander
// toestel niet alles opnieuw bij MusicBrainz moet opzoeken. Met de titel en de
// artiest erbij (om de lijst te kunnen nakijken) en wat elke bron zei.
//
// Het adres van de server is publiek, dus alles wat binnenkomt wordt hier
// streng nagekeken en ingekort. Wie mag lezen en schrijven (alleen de host van
// een bestaand spel) controleert room.authenticateHost; dit bestand doet alleen
// de inhoud en het samenvoegen, zonder opslag, zodat Node en Cloudflare exact
// dezelfde regels volgen.

import { GameError } from './rules.js';
import { TRACK_ID } from './tracks.js';

/** Hoogstens zoveel nummers per opvraging en per schrijfverzoek. */
export const MAX_IDS = 500;
export const MAX_ENTRIES = 500;
/** Zoveel items per pagina van de export. */
export const EXPORT_PAGE = 500;
/** Grootste toegelaten verzoek (zoals bij een eigen lijst; ruim voor 500 nummers met titel). */
export const MAX_YEARS_BODY = 200_000;
/** Zoveel twijfels kan decide() in web/src/lib/years.js hoogstens geven. */
export const MAX_DOUBTS = 4;
export const MAX_DOUBT = 120;
/** Titel en artiest: zoals in een lijst van de host (server/src/tracks.js). */
export const MAX_TEXT = 120;
/** Bovengrens voor de lijst als geheel: een kwaadwillige host kan ze niet eindeloos vullen. */
export const MAX_ROWS = 200_000;

/**
 * De bronnen die web/src/lib/deck.js kent. 'lijst' (de nagekeken lijst van
 * de site) hoort er niet bij: die jaartallen staan al in tracks.json.
 */
export const SOURCES = ['musicbrainz', 'spotify', 'wikidata', 'onbekend', 'handmatig'];
export const MANUAL = 'handmatig';
/** De losse jaren per bron (veld b): Spotify-album, MusicBrainz, Wikidata. */
const SOURCE_YEARS = ['sp', 'mb', 'wd'];

// Zo begint de twijfel die deck.js toevoegt als MusicBrainz niet bereikbaar
// was. Zo'n jaar is alleen een noodoplossing: deck.js onthoudt het zelf ook
// niet, en de server neemt het nooit op, ook niet van een oudere app.
const UNREACHABLE = /^MusicBrainz was niet bereikbaar/i;

// Stuurtekens en onzichtbare tekens horen niet in een korte uitleg of titel.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

function maxYear(now) {
  return new Date(now).getFullYear() + 1;
}

/** Platte tekst: zonder stuurtekens, witruimte samengevoegd, ingekort. '' als er niets overblijft. */
function cleanText(text, max) {
  if (typeof text !== 'string') return '';
  return text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** Titel en artiest uit een item, als ze er (geldig) zijn. */
function label(raw) {
  const out = {};
  const title = cleanText(raw.title, MAX_TEXT);
  const artist = cleanText(raw.artist, MAX_TEXT);
  if (title) out.title = title;
  if (artist) out.artist = artist;
  return out;
}

/** De losse jaren per bron: { sp?, mb?, wd? }, elk een jaar of null. Ongeldig valt weg. */
function sourceYears(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of SOURCE_YEARS) {
    if (!(key in raw)) continue;
    const y = raw[key];
    if (y === null) out[key] = null;
    else if (Number.isInteger(y) && y >= 1900 && y <= maxYear(now)) out[key] = y;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Eén item zoals het opgeslagen wordt: { id, y, s, d, r?, b?, title?, artist? },
 * of null als het niet bruikbaar is. Alle andere velden vallen weg.
 */
export function normaliseEntry(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!TRACK_ID.test(id)) return null;
  const s = raw.s;
  if (!SOURCES.includes(s)) return null;

  // 'onbekend' betekent: nergens een jaar gevonden. Dat is ook nuttig om te
  // delen (anders zoekt de volgende host het opnieuw op), maar dan zonder jaar.
  let y = null;
  if (s === 'onbekend') {
    if (raw.y !== null && raw.y !== undefined) return null;
  } else {
    y = raw.y;
    if (!Number.isInteger(y) || y < 1900 || y > maxYear(now)) return null;
  }

  const d = [];
  if (s !== MANUAL && Array.isArray(raw.d)) {
    for (const text of raw.d) {
      if (typeof text !== 'string') continue;
      if (UNREACHABLE.test(text.trim())) return null;
      const clean = cleanText(text, MAX_DOUBT);
      if (clean && d.length < MAX_DOUBTS) d.push(clean);
    }
  }

  const entry = { id, y, s, d };
  // Regelversie (RULES in web/src/lib/years.js; tot 2 alleen voor remixes).
  // Oudere items hebben er geen.
  if (Number.isInteger(raw.r) && raw.r >= 1 && raw.r <= 1000) entry.r = raw.r;
  const b = sourceYears(raw.b, now);
  if (b) entry.b = b;
  Object.assign(entry, label(raw));
  return entry;
}

/**
 * Een item dat alleen titel en artiest aanvult van een nummer dat al in de
 * lijst staat (zonder bron): { id, title, artist, fill: true }, of null.
 */
export function normaliseFill(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.s !== undefined || raw.y !== undefined) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!TRACK_ID.test(id)) return null;
  const names = label(raw);
  if (!names.title && !names.artist) return null;
  return { id, ...names, fill: true };
}

/** { ids } uit een leesverzoek: geldige, unieke track-ID's. */
export function parseLookup(body) {
  const list = body?.ids;
  if (!Array.isArray(list)) throw new GameError('BAD_REQUEST', 'Ongeldig verzoek.');
  if (list.length > MAX_IDS) throw new GameError('TOO_MANY', `Hoogstens ${MAX_IDS} nummers per keer.`);
  const ids = [];
  const seen = new Set();
  for (const id of list) {
    if (typeof id !== 'string' || !TRACK_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids };
}

/**
 * { entries, skipped } uit een schrijfverzoek. Een ongeldig item wordt
 * overgeslagen; komt hetzelfde nummer twee keer voor, dan telt het laatste.
 * Een item zonder bron maar met titel of artiest vult alleen aan (normaliseFill).
 */
export function parseEntries(body, now = Date.now()) {
  const list = body?.entries;
  if (!Array.isArray(list)) throw new GameError('BAD_REQUEST', 'Ongeldig verzoek.');
  if (list.length > MAX_ENTRIES) throw new GameError('TOO_MANY', `Hoogstens ${MAX_ENTRIES} nummers per keer.`);
  const byId = new Map();
  let skipped = 0;
  for (const raw of list) {
    const entry = normaliseEntry(raw, now) ?? normaliseFill(raw);
    if (!entry) skipped++;
    else {
      if (byId.has(entry.id)) skipped++;
      byId.set(entry.id, entry);
    }
  }
  return { entries: [...byId.values()], skipped };
}

/**
 * { after, limit } uit een exportverzoek: het laatste track-ID van de vorige
 * pagina (of ''), en hoeveel items per pagina (1 tot EXPORT_PAGE, standaard EXPORT_PAGE).
 */
export function parseExport(body) {
  const after = body?.after ?? '';
  if (after !== '' && (typeof after !== 'string' || !TRACK_ID.test(after))) throw new GameError('BAD_REQUEST', 'Ongeldig verzoek.');
  const limit = body?.limit ?? EXPORT_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_PAGE) throw new GameError('BAD_REQUEST', 'Ongeldig verzoek.');
  return { after, limit };
}

/**
 * Samenvoegen van één nummer. Geeft het nieuwe item terug, of null als het
 * bestaande blijft staan.
 *  - Een handmatige verbetering wint altijd: van een automatisch resultaat en
 *    van een oudere handmatige verbetering.
 *  - Een automatisch resultaat overschrijft nooit een handmatige verbetering.
 *  - Een nieuwer automatisch resultaat vervangt een ouder, behalve als het met
 *    oudere regels gemaakt is (lagere r) dan wat er al staat: een oudere app
 *    mag het werk van een nieuwere niet terugdraaien.
 *  - Titel, artiest en de jaren per bron blijven staan als het nieuwe item ze
 *    niet heeft (een oudere site stuurt ze niet mee).
 *  - Alleen aanvullen (fill): titel en artiest komen erbij als ze ontbreken;
 *    jaar en bron veranderen nooit, en een onbekend nummer komt er niet bij.
 *  - Niets veranderd: null, zodat er niets geschreven hoeft te worden.
 */
export function mergeEntry(old, incoming) {
  if (!incoming) return null;
  if (incoming.fill) {
    if (!old) return null;
    const next = { ...old };
    if (!old.title && incoming.title) next.title = incoming.title;
    if (!old.artist && incoming.artist) next.artist = incoming.artist;
    return same(old, next) ? null : next;
  }
  let next = incoming;
  if (old) {
    if (incoming.s !== MANUAL) {
      if (old.s === MANUAL) return null;
      if ((incoming.r ?? 0) < (old.r ?? 0)) return null;
    }
    next = { ...incoming };
    for (const key of ['b', 'title', 'artist']) if (next[key] === undefined && old[key] !== undefined) next[key] = old[key];
    if (same(old, next)) return null;
  }
  return next;
}

function same(a, b) {
  return (
    a.y === b.y &&
    a.s === b.s &&
    (a.r ?? null) === (b.r ?? null) &&
    a.d.length === b.d.length &&
    a.d.every((t, i) => t === b.d[i]) &&
    (a.title ?? '') === (b.title ?? '') &&
    (a.artist ?? '') === (b.artist ?? '') &&
    JSON.stringify(a.b ?? null) === JSON.stringify(b.b ?? null)
  );
}

/**
 * Voegt nieuwe items samen met wat er al is (`existing`: Map id -> item).
 * Geeft de items terug die geschreven moeten worden. Een nieuw nummer komt er
 * alleen bij zolang de lijst niet vol is (`free`: aantal vrije plaatsen).
 */
export function mergeEntries(existing, entries, free = Infinity) {
  const changed = [];
  let room = free;
  for (const entry of entries) {
    const old = existing.get(entry.id) ?? null;
    if (!old && room <= 0) continue;
    const next = mergeEntry(old, entry);
    if (!next) continue;
    if (!old) room--;
    changed.push(next);
  }
  return changed;
}

/**
 * Het antwoord op een leesverzoek: alleen wat de app nodig heeft (geen titel;
 * `named` zegt of titel en artiest er al zijn, zodat de app ze kan aanvullen).
 */
export function publicEntry(entry) {
  const out = { y: entry.y, s: entry.s, d: entry.d };
  if (entry.r !== undefined && entry.r !== null) out.r = entry.r;
  if (entry.b) out.b = entry.b;
  if (entry.title && entry.artist) out.named = true;
  return out;
}

/** Eén item in de export: alles wat bewaard is, met het tijdstip van de laatste wijziging (ms). */
export function exportEntry(entry) {
  const out = { id: entry.id, y: entry.y, s: entry.s, d: entry.d };
  if (entry.r !== undefined && entry.r !== null) out.r = entry.r;
  if (entry.b) out.b = entry.b;
  if (entry.title) out.title = entry.title;
  if (entry.artist) out.artist = entry.artist;
  out.at = Number.isInteger(entry.at) ? entry.at : null;
  return out;
}

/**
 * Eén pagina van de export uit items die al op ID gesorteerd zijn en na
 * `after` komen (hoogstens limit + 1, om te weten of er nog meer is):
 * { entries, next } met next het ID om de volgende pagina mee te vragen, of null.
 */
export function exportPage(sortedAfter, limit = EXPORT_PAGE) {
  const page = sortedAfter.slice(0, limit).map(exportEntry);
  const next = sortedAfter.length > limit && page.length ? page[page.length - 1].id : null;
  return { entries: page, next };
}
