// De ingebouwde lijsten met fragmenten (web/public/fragmenten.json) en de
// keuze van de host daaruit: een of meer lijsten samen, eventueel beperkt tot
// een periode. Zuivere functies, zodat ze met gewone unit-tests na te kijken
// zijn.
//
// Het bronbestand: { lists: [{ id, name }], tracks: [{ deezer, artist, title,
// year, lists: [id, …] }] }. Een lijst toevoegen = een item in `lists` en het
// id bij de nummers die erin horen; een nummer wijzigen = die ene regel.
// Een lege lijst wordt niet getoond.
//
// De keuze: { lists: [id, …], from: jaar | null, to: jaar | null }. Het spel
// speelt met elk nummer dat in minstens één van de lijsten zit (elk één keer)
// en waarvan het jaar tussen `from` en `to` ligt (grenzen inbegrepen; null =
// geen grens).
//
// De hoofdlijst («Alle hits») staat in het bronbestand met `"main": true` bij
// de lijst; is er geen enkele zo aangeduid, dan is het een lijst waarin álle
// nummers zitten. Ze bevat niet per se alles: kinderliedjes zitten er niet
// in, zodat een gewoon spel geen «Bumba» speelt. Een lijst die helemaal in
// de hoofdlijst zit (Rock, Disco …), voegt er niets aan toe: de ene aanvinken
// zet de andere uit. Een lijst met nummers buiten de hoofdlijst («Kinderen en
// tekenfilms») kan je er wel bij aanvinken.

import { MAX_DECK, pickTracks, shuffled } from '../lib/deckplan.js';

const MAX_TEXT = 120;
/** Zo lang mag de naam van een lijst op de server zijn (LIMITS.maxDeckName in server/src/rules.js). */
export const MAX_NAME = 60;
/** De stappen in de keuzes «van» en «tot». */
export const YEAR_STEP = 5;

/** Houdt alleen geldige nummers over, elk Deezer-ID één keer: [{ id: 'dz-…', artist, title, year, lists }]. */
export function cleanFragments(raw) {
  const lists = (Array.isArray(raw?.lists) ? raw.lists : [])
    .filter((l) => l && typeof l.id === 'string' && l.id && typeof l.name === 'string' && l.name.trim())
    .map((l) => ({ id: l.id, name: l.name.trim().slice(0, 60), ...(l.main === true ? { main: true } : {}) }));
  const known = new Set(lists.map((l) => l.id));
  const seen = new Set();
  const tracks = [];
  for (const t of Array.isArray(raw?.tracks) ? raw.tracks : []) {
    const dz = String(t?.deezer ?? '');
    const year = Number(t?.year);
    const artist = String(t?.artist ?? '').trim().slice(0, MAX_TEXT);
    const title = String(t?.title ?? '').trim().slice(0, MAX_TEXT);
    if (!/^[0-9]{1,20}$/.test(dz) || seen.has(dz)) continue;
    if (!Number.isInteger(year) || year < 1000 || year > 2200 || !artist || !title) continue;
    const tags = (Array.isArray(t.lists) ? t.lists : []).filter((x) => known.has(x));
    if (tags.length === 0) continue;
    seen.add(dz);
    tracks.push({ id: `dz-${dz}`, artist, title, year, lists: tags });
  }
  return { lists, tracks };
}

const inPeriod = (t, { from = null, to = null } = {}) => (from == null || t.year >= from) && (to == null || t.year <= to);

/** Het id van de hoofdlijst (zie bovenaan), of null. Alleen een lijst met nummers telt. */
export function mainListId(data) {
  const used = (id) => data.tracks.some((t) => t.lists.includes(id));
  const marked = data.lists.find((l) => l.main && used(l.id));
  if (marked) return marked.id;
  if (data.tracks.length === 0) return null;
  const full = data.lists.find((l) => data.tracks.every((t) => t.lists.includes(l.id)));
  return full ? full.id : null;
}

/**
 * De lijsten die de host kan kiezen; lege lijsten niet. `count`: hoeveel
 * nummers ze heeft binnen de periode (zonder periode: alle). `main`: de
 * hoofdlijst; die staat vooraan. `inMain`: alle nummers van de lijst zitten
 * ook in de hoofdlijst (samen aanvinken voegt dan niets toe).
 */
export function listsOf(data, period = {}) {
  const mainId = mainListId(data);
  const inMainList = (t) => mainId != null && t.lists.includes(mainId);
  const shown = [];
  for (const l of data.lists) {
    const mine = data.tracks.filter((t) => t.lists.includes(l.id));
    if (mine.length === 0) continue;
    const { main: _marked, ...rest } = l;
    const main = l.id === mainId;
    shown.push({ ...rest, count: mine.filter((t) => inPeriod(t, period)).length, main, inMain: !main && mainId != null && mine.every(inMainList) });
  }
  return [...shown.filter((l) => l.main), ...shown.filter((l) => !l.main)];
}

/** Laat lijsten weg die niets toevoegen omdat de hoofdlijst ook gekozen is. */
function withoutRedundant(shown, ids) {
  const main = shown.find((l) => l.main);
  if (!main || !ids.includes(main.id)) return ids;
  const redundant = new Set(shown.filter((l) => l.inMain).map((l) => l.id));
  return ids.filter((id) => !redundant.has(id));
}

/** Het vroegste en het laatste jaar van alle nummers, of null zonder nummers. */
export function yearBounds(data) {
  if (data.tracks.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const t of data.tracks) {
    min = Math.min(min, t.year);
    max = Math.max(max, t.year);
  }
  return { min, max };
}

/**
 * De jaren in de keuzes «van» en «tot», in stappen van `step` (1960, 1965,
 * …). «Van het begin» en «tot nu» (geen grens) staan er niet bij: dat is null.
 * Bij «van» alleen jaren na het vroegste jaar, bij «tot» alleen jaren voor het
 * laatste; anders is het geen beperking.
 */
export function periodOptions(bounds, step = YEAR_STEP) {
  if (!bounds) return { from: [], to: [] };
  const years = [];
  for (let y = Math.ceil(bounds.min / step) * step; y <= bounds.max; y += step) years.push(y);
  return { from: years.filter((y) => y > bounds.min), to: years.filter((y) => y < bounds.max) };
}

/** De periode in gewone taal: «1980–2000», «vanaf 1980», «tot 2000», «1985», of '' zonder beperking. */
export function periodText({ from = null, to = null } = {}) {
  if (from != null && to != null) return from === to ? String(from) : `${from}–${to}`;
  if (from != null) return `vanaf ${from}`;
  if (to != null) return `tot ${to}`;
  return '';
}

/**
 * Maakt van een (bewaarde, misschien verouderde) keuze een geldige: alleen
 * lijsten die er (nog) zijn en niet leeg zijn, in de volgorde van het scherm;
 * een lijst met alle nummers alleen; een periode binnen de jaren die er zijn,
 * met «van» niet na «tot». Naast de hoofdlijst alleen lijsten die er iets aan
 * toevoegen. Zonder bewaarde keuze, of als geen enkele bewaarde lijst nog
 * bestaat: de hoofdlijst (als die er is). Een bewaarde lege keuze (de host
 * vinkte alles uit) blijft leeg.
 */
export function normaliseChoice(data, raw) {
  const shown = listsOf(data);
  const asked = Array.isArray(raw?.lists) ? raw.lists : null;
  let lists = asked ? shown.filter((l) => asked.includes(l.id)) : [];
  if (!asked || (asked.length > 0 && lists.length === 0)) lists = shown.filter((l) => l.main);
  const ids = withoutRedundant(shown, lists.map((l) => l.id));

  // «Van» het vroegste jaar of vroeger, of «tot» het laatste of later, is geen beperking.
  const bounds = yearBounds(data);
  const ok = (v) => Number.isInteger(v) && bounds != null;
  let from = ok(raw?.from) && raw.from > bounds.min && raw.from <= bounds.max ? raw.from : null;
  let to = ok(raw?.to) && raw.to >= bounds.min && raw.to < bounds.max ? raw.to : null;
  if (from != null && to != null && from > to) {
    from = null;
    to = null;
  }
  return { lists: ids, from, to };
}

/**
 * Een lijst aan- of uitvinken. De hoofdlijst aanvinken zet de lijsten uit die
 * erin zitten; zo'n lijst aanvinken zet de hoofdlijst uit. Een lijst met
 * nummers buiten de hoofdlijst blijft er gewoon naast staan.
 */
export function toggleList(data, choice, id) {
  const shown = listsOf(data);
  const list = shown.find((l) => l.id === id);
  if (!list) return choice;
  let lists;
  if (choice.lists.includes(id)) lists = choice.lists.filter((x) => x !== id);
  else if (list.inMain) {
    const mainIds = new Set(shown.filter((l) => l.main).map((l) => l.id));
    lists = [...choice.lists.filter((x) => !mainIds.has(x)), id];
  } else lists = withoutRedundant(shown, [...choice.lists, id]);
  return { ...choice, lists: shown.map((l) => l.id).filter((x) => lists.includes(x)) };
}

/** Een nieuwe grens «van» (`which` = 'from') of «tot» ('to'); null = geen grens. Kruisen ze, dan valt de andere weg. */
export function setPeriod(data, choice, which, value) {
  const v = value == null || value === '' ? null : Number(value);
  const next = { ...choice, [which]: Number.isInteger(v) ? v : null };
  if (next.from != null && next.to != null && next.from > next.to) next[which === 'from' ? 'to' : 'from'] = null;
  return normaliseChoice(data, next);
}

/** De nummers van de keuze: in minstens één gekozen lijst, binnen de periode, elk één keer (in de volgorde van het bestand). */
export function tracksOf(data, choice) {
  const lists = new Set(choice?.lists ?? []);
  if (lists.size === 0) return [];
  return data.tracks.filter((t) => t.lists.some((x) => lists.has(x)) && inPeriod(t, choice));
}

/**
 * De keuze in gewone taal, hoogstens `max` tekens (zoveel bewaart de server):
 * «Rock + Nederlandstalig, 1980–2000». Te lang, dan «Rock + 3 andere lijsten,
 * 1980–2000». Zonder lijsten: ''.
 */
export function describeChoice(data, choice, max = MAX_NAME) {
  const byId = new Map(data.lists.map((l) => [l.id, l.name]));
  const names = (choice?.lists ?? []).map((id) => byId.get(id)).filter(Boolean);
  if (names.length === 0) return '';
  const period = periodText(choice ?? {});
  const tail = period ? `, ${period}` : '';
  const fits = (s) => (s + tail).length <= max;
  let lists = names.join(' + ');
  if (!fits(lists)) {
    lists = '';
    for (let k = names.length - 1; k >= 1 && !lists; k--) {
      const rest = names.length - k;
      const s = `${names.slice(0, k).join(' + ')} + ${rest} ${rest === 1 ? 'andere lijst' : 'andere lijsten'}`;
      if (fits(s)) lists = s;
    }
    if (!lists) lists = `${names.length} lijsten`;
  }
  return (lists + tail).slice(0, max);
}

/**
 * De stapel voor de server ({ id, artist, title, year }, zonder lijsten), in
 * willekeurige volgorde, met de naam. Meer dan `max` nummers (wat de server
 * toelaat): een willekeurige greep, zoals bij een grote playlist. `total`:
 * hoeveel nummers de keuze heeft.
 */
export function deckForChoice(data, choice, { max = MAX_DECK, random = Math.random } = {}) {
  const all = tracksOf(data, choice).map(({ id, artist, title, year }) => ({ id, artist, title, year }));
  const { tracks, sampled, total } = pickTracks(all, max, random);
  return { name: describeChoice(data, choice), tracks: shuffled(tracks, random), sampled, total };
}
