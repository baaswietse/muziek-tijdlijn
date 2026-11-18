// Wikidata als derde bron voor het jaar van een nummer, rechtstreeks vanuit de
// browser van de host (de zoekdienst query.wikidata.org laat dat toe: CORS *).
// Vrije gegevens (CC0), zonder account of sleutel.
//
// Eén verzoek zoekt tot 25 titels tegelijk: de zoekmachine van Wikidata vindt
// per titel de items met dat label (hoofdletters maken niet uit), en geeft per
// item de uitvoerders, de labels, de publicatiedatums en de soort (lied,
// single, album, ...). Welk item bij een nummer past (titel en uitvoerder), en
// welk jaar dat is, beslist wdPick hieronder, in de browser.
//
// Wikidata beschrijft meestal het oorspronkelijke nummer, en een lied-item
// draagt vaak de datum van de single (soms een jaar na het album). Daarom
// beslist het alleen mee in decide() (years.js), nooit alleen, en niet bij
// remixes, live-opnames en heropnames.
//
// Dit bestand gebruikt niets van de browser behalve fetch, zodat het met
// gewone unit-tests te controleren is. tools/tracks.py doet hetzelfde.

import { cleanTitle, isLive, isRemix, isRerecording, norm, normLoose, remixParts, yearOf } from './years.js';

export const WD_URL = 'https://query.wikidata.org/sparql';
/** Zoveel titels per verzoek. */
export const WD_BATCH = 25;
const WD_MIN_INTERVAL = 1100; // hoogstens 1 verzoek per seconde, ook al mag er meer
const WD_TRIES = 3;
const WD_MAX_WAIT = 60_000; // langer wachten op Retry-After is het niet waard: dan zonder Wikidata

// Soorten items die een album, video of film zijn, niet het nummer zelf.
const NOT_SONG = new Set(['Q482994', 'Q208569', 'Q222910', 'Q209939', 'Q169930', 'Q193977', 'Q4176708', 'Q24672043', 'Q1056693', 'Q10590726', 'Q11424', 'Q5398426']);
// Lied, single, muziekwerk: een item dat ook zo'n soort heeft, telt wel.
const SONG = new Set(['Q7366', 'Q134556', 'Q105543609']);
const SEP = '\u001f';

/** Moet Wikidata voor dit nummer gevraagd worden? Niet voor remixes, live-opnames en heropnames. */
export function wdUseful(title) {
  return !isRemix(title) && !isLive(title) && !isRerecording(title);
}

/** De titel zoals Wikidata hem gezocht wordt: zonder versie-aanduidingen, in kleine letters. */
export function wdTitle(title) {
  const remix = remixParts(title);
  const t = remix ? remix.base : cleanTitle(title);
  return t.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Wat er voor een titel gezocht wordt: de titel, en zonder haakjes als die er
 * zijn ("heaven must be missing an angel (pt. 1)" heet in Wikidata zonder "(pt. 1)").
 */
export function wdSearches(title) {
  const q = wdTitle(title);
  const loose = q.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return [];
  return loose && loose !== q ? [q, loose] : [q];
}

function literal(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/** De SPARQL-vraag voor een lijst titels (zie bovenaan). */
export function wdQuery(titles) {
  const values = titles.map(literal).join(' ');
  return `SELECT ?q ?item
  (GROUP_CONCAT(DISTINCT ?lab; separator="\\u001f") AS ?labels)
  (GROUP_CONCAT(DISTINCT ?pl; separator="\\u001f") AS ?performers)
  (GROUP_CONCAT(DISTINCT STR(?d); separator=" ") AS ?dates)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?ty), "entity/"); separator=" ") AS ?types)
WHERE {
  VALUES ?q { ${values} }
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" ; wikibase:endpoint "www.wikidata.org" ;
                    mwapi:search ?q ; mwapi:language "en" ; mwapi:limit "20" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P175 ?p .
  ?p rdfs:label ?pl . FILTER(LANG(?pl) IN ("en", "mul"))
  ?item rdfs:label ?lab . FILTER(LANG(?lab) IN ("en", "mul", "nl"))
  OPTIONAL { ?item wdt:P577 ?d }
  OPTIONAL { ?item wdt:P31 ?ty }
} GROUP BY ?q ?item`;
}

let lastCall = 0;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('gestopt'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('gestopt'));
    });
  });
}

/**
 * Eén verzoek naar Wikidata voor een lijst titels: [{ q, item, labels, performers, dates, types }].
 * Een POST met een gewoon formulier: zo vraagt de browser niets vooraf (CORS).
 */
export async function wdSearch(titles, { signal, fetchFn = fetch, interval } = {}) {
  const gap = interval ?? globalThis.__mtLookupInterval ?? WD_MIN_INTERVAL;
  let wait = Math.max(gap, 500) * 2;
  for (let attempt = 1; ; attempt++) {
    const pause = gap - (Date.now() - lastCall);
    if (pause > 0) await sleep(pause, signal);
    lastCall = Date.now();
    let res = null;
    try {
      res = await fetchFn(WD_URL, {
        method: 'POST',
        headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query: wdQuery(titles), format: 'json' }).toString(),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    if (res?.ok) {
      const data = await res.json();
      return (data?.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v?.value ?? ''])));
    }
    const retry = !res || [429, 500, 502, 503, 504].includes(res.status);
    if (!retry || attempt >= WD_TRIES) {
      throw new Error(res ? `Wikidata gaf een fout (${res.status}).` : 'Wikidata is niet bereikbaar.');
    }
    // Te veel verzoeken: Wikidata zegt hoe lang te wachten. Te lang: dan maar zonder.
    const after = Number(res?.headers?.get?.('retry-after'));
    const ms = Number.isFinite(after) && after > 0 ? after * 1000 : wait;
    if (ms > WD_MAX_WAIT) throw new Error('Wikidata vraagt te lang te wachten.');
    await sleep(ms, signal);
    wait = Math.min(wait * 2, 30_000);
  }
}

/**
 * Het jaar volgens Wikidata voor één nummer, uit de rijen van wdSearch:
 * { year, items } met year null als geen item past. Een item past als een van
 * zijn labels de titel is en een van zijn uitvoerders een artiest van Spotify;
 * albums, video's en films tellen niet. Het jaar: de vroegste publicatiedatum.
 */
export function wdPick(track, rows) {
  const searched = new Set(wdSearches(track.title));
  const base = remixParts(track.title)?.base ?? cleanTitle(track.title);
  const want = norm(base);
  const loose = normLoose(base);
  const artists = new Set((track.artists || []).filter(Boolean).map(norm));
  let year = null;
  let items = 0;
  for (const r of rows || []) {
    if (!searched.has(r.q)) continue;
    const labels = String(r.labels || '').split(SEP);
    // Zonder haakjes vergelijken mag, maar niet als het label een live- of remixversie is.
    if (!labels.some((l) => norm(l) === want || (loose && normLoose(l) === loose && !isLive(l) && !isRemix(l)))) continue;
    const performers = String(r.performers || '').split(SEP).map(norm);
    if (!performers.some((p) => p && artists.has(p))) continue;
    const types = String(r.types || '').split(' ').filter(Boolean);
    if (types.some((t) => NOT_SONG.has(t)) && !types.some((t) => SONG.has(t))) continue;
    items++;
    for (const d of String(r.dates || '').split(' ')) {
      const y = yearOf(d);
      if (y !== null && (year === null || y < year)) year = y;
    }
  }
  return { year, items };
}

/**
 * Zoekt het Wikidata-jaar van een lijst nummers op, in blokken van WD_BATCH
 * titels. `onResult(id, { year, items })` voor elk nummer zodra zijn blok
 * binnen is. Geeft een Map id -> resultaat. Faalt een blok (Wikidata
 * onbereikbaar of te druk), dan stopt het: wat al binnen is blijft, de rest
 * heeft geen Wikidata-jaar (decide werkt dan zoals zonder Wikidata).
 * `failed` in het resultaat zegt of dat gebeurde.
 */
export async function wdLookup(tracks, { signal, fetchFn, interval, onResult } = {}) {
  const out = new Map();
  // Alle zoektermen één keer, in de volgorde van de nummers; een nummer is
  // klaar zodra het blok met zijn laatste zoekterm binnen is.
  const titles = [];
  const index = new Map();
  const todo = [];
  for (const t of tracks) {
    if (!t?.id || !wdUseful(t.title)) continue;
    const qs = wdSearches(t.title);
    if (!qs.length) continue;
    for (const q of qs) {
      if (!index.has(q)) {
        index.set(q, titles.length);
        titles.push(q);
      }
    }
    todo.push({ t, last: Math.max(...qs.map((q) => index.get(q))) });
  }
  const rows = [];
  for (let i = 0; i < titles.length; i += WD_BATCH) {
    try {
      rows.push(...(await wdSearch(titles.slice(i, i + WD_BATCH), { signal, fetchFn, interval })));
    } catch (err) {
      if (signal?.aborted) throw err;
      out.failed = true;
      break;
    }
    for (const item of todo) {
      if (item.done || item.last >= i + WD_BATCH) continue;
      item.done = true;
      const found = wdPick(item.t, rows);
      out.set(item.t.id, found);
      onResult?.(item.t.id, found);
    }
  }
  return out;
}
