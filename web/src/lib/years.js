// Zoekt het jaar van de eerste release van een nummer op bij MusicBrainz,
// rechtstreeks vanuit de browser van de host. Dezelfde regels als het script
// tools/tracks.py: alleen officiële studio-uitgaven tellen, want bootlegs,
// live-albums en demo's zijn vaak fout of veel te vroeg gedateerd.
//
// Dit bestand gebruikt niets van de browser behalve fetch, zodat de regels
// ook met gewone unit-tests te controleren zijn.

/**
 * Versie van de regels om een jaar te kiezen (veld `r` in de lokale cache en
 * de gedeelde lijst). Tot versie 2 ging het alleen over remixes; vanaf 3 over
 * alle regels: MusicBrainz strenger gelezen en Wikidata als derde bron.
 * Resultaten van oudere regels met een twijfel worden opnieuw beoordeeld, en
 * remixes van vóór versie 2 opnieuw opgezocht (zie deck.js). Verhoog dit als
 * de regels veranderen.
 */
export const RULES = 3;
/** Vanaf deze versie kregen remixes het jaar van de remix zelf. */
export const REMIX_RULES = 2;

const MB_URL = 'https://musicbrainz.org/ws/2/recording';
const MB_MIN_INTERVAL = 1100; // MusicBrainz laat hoogstens 1 verzoek per seconde toe
const MB_TRIES = 6;

// ---------------------------------------------------------------- titels

// Toevoegingen die niets over het nummer zelf zeggen, zoals "- Remastered 2011".
const VERSION =
  'remaster(?:ed)?|re-?master(?:ed)?|mono|stereo|single|radio|album|edit|version|versie|mix|' +
  'bonus|deluxe|anniversary|live|soundtrack|motion picture|re-?record(?:ed|ing)?|acoustic|' +
  'demo|explicit|clean|feat\\.?|featuring|ft\\.?|original';
const VERSION_RE = new RegExp(`\\b(?:${VERSION})\\b`, 'i');
const PAREN_TAIL_RE = /\s*[([]([^)\]]*)[)\]]\s*$/;
const PARENS_RE = /[([][^)\]]*[)\]]/g;

// Een remix is een andere opname met een eigen releasedatum: de spelers horen
// de remix, dus telt het jaar van de remix. Alleen uitdrukkelijke remix-woorden
// tellen; "Extended Mix", "Club Mix" of "Radio Edit" zijn gewoon het origineel.
const REMIX_RE = /\b(?:remix(?:ed)?|rmx|re-?work(?:ed)?|bootleg|mash-?up|refix)\b/i;
// Woorden in een remix-aanduiding die niets over de remix zelf zeggen:
// "JXL Radio Edit Remix" en "JXL remix" zijn dezelfde remix.
const REMIX_NOISE = new Set([
  'radio', 'edit', 'single', 'version', 'versie', 'album', 'explicit', 'clean',
  'mono', 'stereo', 'remaster', 'remastered', 'by', 'the',
]);
const REMIX_SYNONYMS = { remixed: 'remix', rmx: 'remix', reworked: 'rework' };
const FEAT_RE = /\s*[([]?\s*\b(?:feat\.?|featuring|ft\.)(?:\s.*)?$/i;

/** Haalt versie-aanduidingen weg, ook een remix-aanduiding die "edit" of "mix" bevat. */
function stripVersions(title) {
  let t = String(title ?? '').trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    // "Titel - Remastered 2011" / "Titel - Live at ..."
    const cut = t.lastIndexOf(' - ');
    if (cut > 0) {
      const head = t.slice(0, cut).trim();
      const tail = t.slice(cut + 3);
      if (head && (VERSION_RE.test(tail) || /^\d{4}$/.test(tail.trim()))) t = head;
    }
    // "Titel (2011 Remaster)" / "Titel [feat. X]"
    const m = PAREN_TAIL_RE.exec(t);
    if (m && VERSION_RE.test(m[1]) && t.slice(0, m.index).trim()) t = t.slice(0, m.index).trim();
    if (t === before) break;
  }
  return t;
}

/**
 * Splitst een remix-titel in het nummer en de remix-aanduiding:
 * "Roses - Imanbek Remix" en "Roses (feat. X) [Imanbek Remix]" geven allebei
 * { base: 'Roses', remix: 'Imanbek Remix' }. Geen remix: null.
 * Versie-aanduidingen achter de remix ("- Radio Edit") vallen eerst weg.
 */
export function remixParts(title) {
  let t = String(title ?? '').trim();
  for (let i = 0; i < 6; i++) {
    const before = t;
    const cut = t.lastIndexOf(' - ');
    if (cut > 0) {
      const head = t.slice(0, cut).trim();
      const tail = t.slice(cut + 3);
      if (head && REMIX_RE.test(tail)) return { base: stripVersions(head), remix: tidyRemix(tail) };
      if (head && (VERSION_RE.test(tail) || /^\d{4}$/.test(tail.trim()))) t = head;
    }
    const m = PAREN_TAIL_RE.exec(t);
    const head = m ? t.slice(0, m.index).trim() : '';
    if (m && head && REMIX_RE.test(m[1])) return { base: stripVersions(head), remix: tidyRemix(m[1]) };
    if (m && head && VERSION_RE.test(m[1])) t = head;
    if (t === before) break;
  }
  return null;
}

/** "X Remix (feat. Y)" → "X Remix": gastartiesten horen niet bij de naam van de remix. */
function tidyRemix(text) {
  return String(text).replace(FEAT_RE, '').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isRemix(title) {
  return remixParts(title) !== null;
}

/**
 * Vergelijkbare vorm van een remix: het nummer en de woorden van de remix,
 * zonder "radio edit" en dergelijke en los van de volgorde ("Remix by X" = "X Remix").
 */
export function remixKey(title) {
  const parts = remixParts(title);
  if (!parts) return null;
  return `${norm(parts.base)}|${remixWords(parts.remix).sort().join(' ')}`;
}

function remixWords(remix) {
  const text = String(remix).replace(/\bre-(work|mix)/gi, 're$1').replace(/\bmash-up\b/gi, 'mashup');
  return norm(text)
    .split(' ')
    .map((w) => REMIX_SYNONYMS[w] || w)
    .filter((w) => w && !REMIX_NOISE.has(w));
}

/** Haalt versie-aanduidingen van een Spotify-titel af; een remix-aanduiding blijft staan. */
export function cleanTitle(title) {
  const parts = remixParts(title);
  if (parts) return `${parts.base} (${parts.remix})`;
  return stripVersions(title);
}

/** Een heropname van de artiest zelf, zoals "Love Story (Taylor's Version)". */
export function isRerecording(title) {
  return /\b(?:taylor['’]s version|re-?record(?:ed|ing)?)\b/i.test(String(title ?? ''));
}

export function isLive(title) {
  const raw = String(title ?? '').trim();
  const clean = stripVersions(raw);
  return clean !== raw && /\blive\b/i.test(raw.slice(clean.length));
}

/** Vergelijkbare vorm: zonder accenten, hoofdletters en leestekens. */
export function norm(text) {
  let t = String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
  t = t.toLowerCase().replace(/&/g, ' and ');
  t = t.replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.replace(/^the /, '');
}

/** Zoals norm(), maar ook zonder alles tussen haakjes. */
export function normLoose(text) {
  return norm(String(text ?? '').replace(PARENS_RE, ' '));
}

export function titleMatches(candidate, wanted) {
  // Een remix past alleen bij dezelfde remix: nooit bij het origineel of bij
  // een andere remix van hetzelfde nummer. De losse terugval hieronder (alles
  // tussen haakjes weg) zou ze net allemaal gelijk maken.
  const remix = remixKey(wanted);
  if (remix) return remixKey(candidate) === remix;
  // Gewone nummers: zoals altijd (stripVersions is de vroegere cleanTitle).
  let a = norm(stripVersions(candidate));
  let b = norm(wanted);
  if (a && a === b) return true;
  a = normLoose(stripVersions(candidate));
  b = normLoose(wanted);
  return Boolean(a) && a === b;
}

export function artistMatches(recording, artists) {
  const wanted = new Set((artists || []).filter(Boolean).map(norm));
  if (wanted.size === 0) return false;
  const names = new Set();
  let joined = '';
  for (const credit of recording['artist-credit'] || []) {
    names.add(norm(credit.name || ''));
    const artist = credit.artist || {};
    names.add(norm(artist.name || ''));
    for (const alias of artist.aliases || []) names.add(norm(alias.name || ''));
    joined += (credit.name || '') + (credit.joinphrase || '');
  }
  names.add(norm(joined));
  names.delete('');
  // De eerste artiest van Spotify moet in de credits zitten.
  return names.has(norm(artists[0])) || [...wanted].every((w) => names.has(w));
}

/** Sleutel om dubbels te herkennen: zelfde titel en eerste artiest. */
export function songKey(title, artists) {
  return `${norm(cleanTitle(title))}|${norm((artists || [''])[0])}`;
}

// ---------------------------------------------------------------- jaartallen

export function yearOf(date) {
  const m = /^(\d{4})/.exec(String(date ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= new Date().getFullYear() + 1 ? y : null;
}

// Uitgaven die niets zeggen over wanneer een nummer uitkwam.
const SKIP_TYPES = new Set(['live', 'demo', 'interview', 'audiobook', 'audio drama', 'dj-mix', 'mixtape/street', 'spokenword']);
// Een opname met een van deze woorden in de titel of de toelichting is een
// andere versie dan het gewone nummer (tenzij de titel van Spotify ze ook heeft).
const OTHER_VERSION_RE = /\b(?:instrumental|karaoke|a ?cappella|acapella|demo)\b/i;
// In de toelichting niet "demo": die staat er soms ook bij de echte single (Enter Sandman).
const NOTE_VERSION_RE = /\b(?:instrumental|karaoke|a ?cappella|acapella)\b/i;
/** Een losse vroegste uitgave mag hoogstens zoveel jaar vóór een jaar met meer uitgaven liggen (zie pickYear). */
const LONE_WINDOW = 3;

/** Officiële studio-uitgaven met een datum van deze opname: [{ date, year, id, group, compilation }]. */
function studioReleases(recording) {
  const out = [];
  for (const release of recording.releases || []) {
    if (String(release.status || '').toLowerCase() !== 'official') continue;
    const group = release['release-group'] || {};
    const types = (group['secondary-types'] || []).map((t) => String(t).toLowerCase());
    if (types.some((t) => SKIP_TYPES.has(t))) continue;
    const date = release.date;
    const year = yearOf(date);
    if (year === null) continue;
    const id = release.id || `${recording.id}|${date}|${release.title || ''}`;
    out.push({ date: String(date), year, id, group: group.id || release.title || id, compilation: types.includes('compilation') });
  }
  return out;
}

/** Vroegste datum van een officiële studio-uitgave met deze opname. */
export function officialDate(recording) {
  let best = null;
  for (const r of studioReleases(recording)) if (best === null || r.date < best) best = r.date;
  return best;
}

/**
 * Is deze opname een andere versie dan wat gezocht wordt? Een remix, live-
 * opname, instrumentale versie, karaoke of demo telt niet voor het gewone
 * nummer: zo'n opname heeft een eigen (vaak latere, soms fout gedateerde) uitgave.
 * Voorbeeld: "Shape of You (DJ Inko remix)" op een verzamelaar "uit 2015".
 */
export function otherVersion(recording, wanted, { live = false } = {}) {
  const title = String(recording.title || '');
  const note = String(recording.disambiguation || '');
  if (!remixKey(wanted) && remixKey(title)) return true;
  if (!live && (isLive(title) || /\blive\b/i.test(note))) return true;
  const extra = `${title.slice(stripVersions(title).length)} ${(title.match(PARENS_RE) || []).join(' ')}`;
  return (OTHER_VERSION_RE.test(extra) || NOTE_VERSION_RE.test(note)) && !OTHER_VERSION_RE.test(wanted);
}

/**
 * Kiest uit zoekresultaten het jaar van de eerste release. Alle passende
 * opnames samen (dezelfde opname staat in MusicBrainz vaak meer dan eens):
 *  - Alleen officiële studio-uitgaven tellen. Zijn er geen, dan de vroegste
 *    datum van eender welke uitgave (official: false).
 *  - Een jaar met alleen verzamelaars telt pas vanaf twee verschillende
 *    verzamelaars: een enkele verzamelaar is in MusicBrainz vaak fout gedateerd
 *    (Radar Love op "The Best of Golden Earring, 1971"; de single is van 1973).
 *  - `raw`: het vroegste jaar zonder die regel (decide gebruikt het als Spotify
 *    precies dat jaar zegt: een nieuw nummer op een eigen best-of).
 *  - `next`: is het gekozen jaar maar één uitgave, en liggen er kort daarna
 *    meer, dan is dat latere jaar een kandidaat (een fout gedateerd album, maar
 *    ook een echte vroege single). decide kiest met Wikidata.
 *  - `count`: zoveel verschillende uitgaven in het gekozen jaar.
 */
export function pickYear(recordings, title, artists, { live = false } = {}) {
  const releases = [];
  let matches = 0;
  let fallback = null; // { year, date, mbid } zonder officiële studio-uitgave
  const seen = new Set();
  for (const rec of recordings || []) {
    if (!titleMatches(rec.title || '', title) || !artistMatches(rec, artists)) continue;
    if (otherVersion(rec, title, { live })) continue;
    if (rec.id && seen.has(rec.id)) continue;
    if (rec.id) seen.add(rec.id);
    const studio = studioReleases(rec);
    if (studio.length) {
      matches++;
      for (const r of studio) releases.push({ ...r, mbid: rec.id });
      continue;
    }
    const date = rec['first-release-date'];
    const year = yearOf(date);
    if (year === null) continue;
    matches++;
    if (!fallback || year < fallback.year) fallback = { year, date, mbid: rec.id };
  }
  if (!releases.length) {
    if (!fallback) return null;
    return { year: fallback.year, date: fallback.date, official: false, mbid: fallback.mbid, matches, raw: fallback.year, count: 0 };
  }
  // Per jaar: verschillende uitgaven, en of er iets anders dan een verzamelaar bij is.
  const years = new Map();
  for (const r of releases) {
    if (!years.has(r.year)) years.set(r.year, { ids: new Set(), groups: new Set(), other: false, first: r });
    const y = years.get(r.year);
    y.ids.add(r.id);
    if (r.compilation) y.groups.add(r.group);
    else y.other = true;
    if (r.date < y.first.date) y.first = r;
  }
  const sorted = [...years.keys()].sort((a, b) => a - b);
  const raw = sorted[0];
  const year = sorted.find((y) => years.get(y).other || years.get(y).groups.size >= 2) ?? raw;
  const count = years.get(year).ids.size;
  const found = { year, date: years.get(year).first.date, official: true, mbid: years.get(year).first.mbid, matches, raw, count };
  if (count === 1) {
    const next = sorted.find((y) => y > year && y <= year + LONE_WINDOW && years.get(y).ids.size >= 2);
    if (next) found.next = next;
  }
  return found;
}

function lucenePhrase(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function words(text) {
  const list = String(text).match(/[\p{L}\p{N}]+/gu);
  return list ? list.join(' AND ') : '""';
}

const STUDIO_FILTER = ' AND status:official AND NOT secondarytype:live AND NOT secondarytype:demo';

/** Het resultaat van lookup: alleen wat decide en de cache nodig hebben. */
function result(found, method) {
  const out = { year: found.year, official: found.official, method, mbid: found.mbid, raw: found.raw, count: found.count };
  if (found.next) out.next = found.next;
  return out;
}

/**
 * Zoekt het eerste releasejaar. `search(query)` geeft { recordings, total }.
 * Resultaat: { year, official, method, mbid, raw, count, next? } of { year: null }
 * (zie pickYear).
 */
export async function lookup(title, artists, search) {
  const wanted = cleanTitle(title);
  const primary = (artists || [])[0] || '';
  const remix = remixParts(title);
  const live = isLive(title);
  const queries = [];
  if (remix) {
    // MusicBrainz schrijft een remix meestal als "Titel (X remix)", soms met
    // "radio edit" erbij. Zoek dus op het nummer als geheel en de woorden van
    // de remix los; titleMatches kiest daarna streng de juiste remix.
    const extra = words(remixWords(remix.remix).join(' '));
    queries.push(['exact', `recording:${lucenePhrase(remix.base)} AND recording:(${extra}) AND artist:${lucenePhrase(primary)}`]);
    queries.push(['ruim', `recording:(${words(remix.base)} AND ${extra}) AND artist:(${words(primary)})`]);
  } else {
    queries.push(['exact', `recording:${lucenePhrase(wanted)} AND artist:${lucenePhrase(primary)}`]);
    const loose = wanted.replace(PARENS_RE, ' ').trim();
    if (loose && norm(loose) !== norm(wanted)) {
      queries.push(['zonder haakjes', `recording:${lucenePhrase(loose)} AND artist:${lucenePhrase(primary)}`]);
    }
    queries.push(['ruim', `recording:(${words(wanted)}) AND artist:(${words(primary)})`]);
  }

  for (const [method, query] of queries) {
    // Alle opnames die deze zoekopdracht opleverde, over alle pagina's heen:
    // pickYear kijkt naar alle uitgaven samen.
    const pool = [];
    const pick = (recordings) => {
      pool.push(...(recordings || []));
      return pickYear(pool, wanted, artists, { live });
    };
    const first = await search(query);
    let found = pick(first.recordings);
    if (first.total > first.recordings.length) {
      // Bekende nummers hebben honderden opnames (live, bootlegs); de eerste
      // honderd zijn niet noodzakelijk de oudste.
      const studio = `(${query})${STUDIO_FILTER}`;
      if (!found?.official) {
        // Geen officiële studio-uitgave op de eerste pagina: vraag er gericht
        // naar. Dat zijn er hooguit enkele tientallen.
        found = pick((await search(studio)).recordings);
      }
      // Een opname met een vroegere officiële uitgave heeft ook een vroegere
      // 'eerste release'. Kijk dus of er vóór het gevonden jaar nog iets zit.
      // `seen`: alle opnames met een eerste release vóór dat jaar zijn al
      // bekeken (een volledige pagina). Ligt een officieel jaar daar niet na,
      // dan kan er niets vroegers meer bestaan en is een verzoek overbodig.
      let seen = null;
      for (let i = 0; i < 5 && found; i++) {
        if (found.official && seen !== null && found.year <= seen) break;
        const before = ` AND firstreleasedate:[1900-01-01 TO ${found.year - 1}-12-31]`;
        const older = await search(`(${query})${before}`);
        let improved = pick(older.recordings);
        if (older.total > older.recordings.length) {
          improved = pick((await search(studio + before)).recordings);
        } else {
          seen = found.year;
        }
        const same = improved.year === found.year && improved.official === found.official;
        found = improved;
        if (same) break;
      }
    }
    if (!found) continue;
    return result(found, method);
  }
  return { year: null, method: 'niets gevonden' };
}

const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 1;

/**
 * Kiest het jaar voor één nummer uit wat Spotify (het jaar van het album),
 * MusicBrainz (lookup) en Wikidata (wdPick in wikidata.js) zeggen.
 * `wd`: undefined als Wikidata niet gevraagd is of niet antwoordde (dan zoals
 * met twee bronnen), { year: null } als Wikidata niets kent.
 *
 * Twee bronnen die het eens zijn (hoogstens een jaar verschil) winnen van de
 * derde. Alleen als er geen overeenstemming is, blijft er twijfel (`doubts`).
 * In detail, afgeleid uit 287 nagekeken nummers:
 *  - MusicBrainz en Spotify eens: het vroegste van de twee, want een album
 *    kan niet voor de eerste release liggen. Zegt Wikidata precies hetzelfde
 *    jaar als MusicBrainz, dan dat jaar (Spotify een jaar te vroeg).
 *  - Oneens: Wikidata beslist als het bij precies een van de twee past.
 *    Ligt Wikidata nog vroeger dan beide, dan Wikidata, met twijfel.
 *    Zonder beslissing: heeft MusicBrainz meerdere uitgaven in zijn jaar en
 *    ligt dat vóór Spotify (een remaster of verzamelaar), dan MusicBrainz;
 *    anders het vroegste, met twijfel.
 *  - Een losse vroegste uitgave bij MusicBrainz met kort daarna meer
 *    uitgaven (mb.next): zegt Wikidata dat latere jaar (of later), dan is de
 *    vroege uitgave fout gedateerd (een album "van 2003" dat in 2004 uitkwam).
 *    Een echte vroege single heeft in Wikidata haar eigen, vroege datum.
 *    Alleen met een Spotify-jaar erbij (dat kan de vroege uitgave nog
 *    bevestigen): Wikidata heeft vaak de datum van een latere single.
 *  - Zegt Spotify precies het vroegste jaar dat MusicBrainz kent (ook een
 *    jaar met maar één verzamelaar), dan telt dat: een nieuw nummer op een
 *    eigen best-of.
 *  - Remixes, live-opnames en heropnames: Wikidata beschrijft meestal het
 *    origineel en telt dan niet mee. Een remix krijgt nooit het jaar van het
 *    origineel.
 * `b`: wat elke bron zei ({ sp, mb, wd }; wd ontbreekt als Wikidata niet meetelde).
 */
export function decide({ title, spotifyYear }, mb, wd) {
  const s = spotifyYear ?? null;
  const remix = isRemix(title);
  const own = !remix && !isLive(title) && !isRerecording(title); // Wikidata telt mee
  const asked = own && wd !== undefined && wd !== null;
  const w = asked ? (wd.year ?? null) : null;
  let m = mb?.year ?? null;
  if (m !== null && s !== null && mb.next && w !== null && w >= mb.next) m = mb.next;
  if (m !== null && s !== null && mb.raw && mb.raw === s && mb.raw < m) m = mb.raw;
  const strong = m === (mb?.year ?? null) && (mb?.count ?? 0) >= 2;

  let year = null;
  let doubt = '';
  if (m !== null && s !== null) {
    if (near(m, s)) year = w === m && s !== m ? m : Math.min(m, s);
    else if (near(w, m) && !near(w, s)) year = m;
    else if (near(w, s) && !near(w, m)) year = s;
    else {
      const both = `Spotify zegt ${s}, MusicBrainz ${m}${asked ? `, Wikidata ${w ?? 'niets'}` : ''}`;
      if (w !== null && w < Math.min(m, s) - 1) [year, doubt] = [w, both];
      else if (strong && m < s && (w === null || w > m)) year = m;
      else [year, doubt] = [Math.min(m, s), both];
    }
  } else if (m !== null) {
    if (w !== null && !near(w, m)) [year, doubt] = [Math.min(m, w), `MusicBrainz zegt ${m}, Wikidata ${w}`];
    else year = m;
  } else if (s !== null) {
    // Ook bij een remix: nooit het jaar van het origineel, dat hoort niet bij wat de spelers horen.
    const why = remix ? 'remix niet gevonden bij MusicBrainz; jaar van het Spotify-album' : 'niet gevonden bij MusicBrainz; jaar van het Spotify-album';
    if (near(w, s)) year = Math.min(s, w);
    else if (w !== null) [year, doubt] = [Math.min(s, w), `niet gevonden bij MusicBrainz; Spotify zegt ${s}, Wikidata ${w}`];
    else [year, doubt] = [s, why];
  } else if (w !== null) {
    [year, doubt] = [w, 'alleen Wikidata kent een jaar'];
  } else {
    doubt = 'geen jaar gevonden';
  }

  const source = year === null ? 'onbekend' : year === m ? 'musicbrainz' : year === s ? 'spotify' : 'wikidata';
  const doubts = doubt ? [doubt] : [];
  if (doubt) {
    // Wat de twijfel groter maakt; zonder twijfel doet het er niet toe.
    if (m !== null && mb.method === 'ruim') doubts.push('alleen via een ruime zoekopdracht gevonden');
    if (m !== null && mb.official === false) doubts.push('alleen live-, demo- of onofficiële uitgaven gevonden');
    if (isLive(title)) doubts.push('live-opname');
  }
  const b = { sp: s, mb: m };
  if (asked) b.wd = w;
  return { year, source, spotifyYear: s, mbYear: m, wdYear: w, doubts, b };
}

// ---------------------------------------------------------------- MusicBrainz

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
 * Eén zoekopdracht bij MusicBrainz, met de verplichte pauze tussen verzoeken
 * en opnieuw proberen als de server bezet is.
 */
export async function mbSearch(query, { signal, fetchFn = fetch } = {}) {
  // Haakje voor de tests: daar is de pauze niet nodig.
  const interval = globalThis.__mtLookupInterval ?? MB_MIN_INTERVAL;
  let wait = Math.max(interval, 200) * 2;
  for (let attempt = 1; ; attempt++) {
    const pause = interval - (Date.now() - lastCall);
    if (pause > 0) await sleep(pause, signal);
    lastCall = Date.now();
    let res = null;
    try {
      res = await fetchFn(`${MB_URL}?${new URLSearchParams({ query, fmt: 'json', limit: '100' })}`, {
        headers: { Accept: 'application/json' },
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    if (res?.ok) {
      const data = await res.json();
      const recordings = data.recordings || [];
      return { recordings, total: Number(data.count ?? recordings.length) };
    }
    // Bezet (503), te snel (429) of netwerk weg: wachten en opnieuw.
    const retry = !res || [429, 500, 502, 503, 504].includes(res.status);
    if (!retry || attempt >= MB_TRIES) {
      throw new Error(res ? `MusicBrainz gaf een fout (${res.status}).` : 'MusicBrainz is niet bereikbaar.');
    }
    await sleep(wait, signal);
    wait = Math.min(wait * 2, 30_000);
  }
}
