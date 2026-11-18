// De ingebouwde lijsten met fragmenten (web/public/fragmenten.json). Zuivere
// functies, zodat ze met gewone unit-tests na te kijken zijn.
//
// Het bronbestand: { lists: [{ id, name }], tracks: [{ deezer, artist, title,
// year, lists: [id, …] }] }. Een lijst toevoegen = een item in `lists` en het
// id bij de nummers die erin horen; een nummer wijzigen = die ene regel.
// Een lege lijst wordt niet getoond.

import { MAX_DECK, pickTracks, shuffled } from '../lib/deckplan.js';

const MAX_TEXT = 120;

/** Houdt alleen geldige nummers over, elk Deezer-ID één keer: [{ id: 'dz-…', artist, title, year, lists }]. */
export function cleanFragments(raw) {
  const lists = (Array.isArray(raw?.lists) ? raw.lists : [])
    .filter((l) => l && typeof l.id === 'string' && l.id && typeof l.name === 'string' && l.name.trim())
    .map((l) => ({ id: l.id, name: l.name.trim().slice(0, 60) }));
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

/** De lijsten die de host kan kiezen, met hun aantal nummers; lege lijsten niet. */
export function listsOf(data) {
  return data.lists
    .map((l) => ({ ...l, count: data.tracks.filter((t) => t.lists.includes(l.id)).length }))
    .filter((l) => l.count > 0);
}

/**
 * De nummers van één lijst zoals ze naar de server gaan ({ id, artist, title,
 * year }), in willekeurige volgorde. Meer dan `max` (wat de server toelaat):
 * dan een willekeurige greep, zoals bij een grote playlist.
 */
export function deckFor(data, listId, { max = MAX_DECK, random = Math.random } = {}) {
  const all = data.tracks
    .filter((t) => t.lists.includes(listId))
    .map(({ id, artist, title, year }) => ({ id, artist, title, year }));
  const { tracks, sampled, total } = pickTracks(all, max, random);
  return { tracks: shuffled(tracks, random), sampled, total };
}
