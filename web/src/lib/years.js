// Zoekt het jaar van de eerste release van een nummer op bij MusicBrainz,
// rechtstreeks vanuit de browser van de host. Dezelfde regels als het script
// tools/tracks.py: alleen officiële studio-uitgaven tellen, want bootlegs,
// live-albums en demo's zijn vaak fout of veel te vroeg gedateerd.
//
// Dit bestand gebruikt niets van de browser behalve fetch, zodat de regels
// ook met gewone unit-tests te controleren zijn.

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

/** Haalt versie-aanduidingen van een Spotify-titel af. */
export function cleanTitle(title) {
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

export function isLive(title) {
  const raw = String(title ?? '').trim();
  const clean = cleanTitle(raw);
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
  let a = norm(cleanTitle(candidate));
  let b = norm(wanted);
  if (a && a === b) return true;
  a = normLoose(cleanTitle(candidate));
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

/** Vroegste datum van een officiële studio-uitgave met deze opname. */
export function officialDate(recording) {
  let best = null;
  for (const release of recording.releases || []) {
    if (String(release.status || '').toLowerCase() !== 'official') continue;
    const types = ((release['release-group'] || {})['secondary-types'] || []).map((t) => String(t).toLowerCase());
    if (types.some((t) => SKIP_TYPES.has(t))) continue;
    const d = release.date;
    if (yearOf(d) === null) continue;
    if (best === null || String(d) < best) best = String(d);
  }
  return best;
}

/**
 * Kiest uit zoekresultaten het jaar van de opname die echt past. Een officiële
 * studio-uitgave gaat altijd voor; pas als die er niet is, telt de vroegste
 * datum van eender welke uitgave (official: false).
 */
export function pickYear(recordings, title, artists) {
  let best = null;
  let count = 0;
  for (const rec of recordings || []) {
    if (!titleMatches(rec.title || '', title) || !artistMatches(rec, artists)) continue;
    const official = officialDate(rec);
    const date = official || rec['first-release-date'];
    const year = yearOf(date);
    if (year === null) continue;
    count++;
    const rank = (official ? 0 : 1) * 10000 + year;
    if (best === null || rank < best.rank) {
      best = { rank, year, date, official: Boolean(official), mbid: rec.id };
    }
  }
  if (best) best.matches = count;
  return best;
}

function better(current, other) {
  if (!current) return other;
  if (other && other.rank < current.rank) {
    other.matches = Math.max(current.matches || 0, other.matches || 0);
    return other;
  }
  return current;
}

function lucenePhrase(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function words(text) {
  const list = String(text).match(/[\p{L}\p{N}]+/gu);
  return list ? list.join(' AND ') : '""';
}

const STUDIO_FILTER = ' AND status:official AND NOT secondarytype:live AND NOT secondarytype:demo';

/**
 * Zoekt het eerste releasejaar. `search(query)` geeft { recordings, total }.
 * Resultaat: { year, official, method, mbid } of { year: null }.
 */
export async function lookup(title, artists, search) {
  const wanted = cleanTitle(title);
  const primary = (artists || [])[0] || '';
  const queries = [['exact', `recording:${lucenePhrase(wanted)} AND artist:${lucenePhrase(primary)}`]];
  const loose = wanted.replace(PARENS_RE, ' ').trim();
  if (loose && norm(loose) !== norm(wanted)) {
    queries.push(['zonder haakjes', `recording:${lucenePhrase(loose)} AND artist:${lucenePhrase(primary)}`]);
  }
  queries.push(['ruim', `recording:(${words(wanted)}) AND artist:(${words(primary)})`]);

  for (const [method, query] of queries) {
    const first = await search(query);
    let found = pickYear(first.recordings, wanted, artists);
    if (first.total > first.recordings.length) {
      // Bekende nummers hebben honderden opnames (live, bootlegs); de eerste
      // honderd zijn niet noodzakelijk de oudste. Vraag gericht naar officiële
      // studio-uitgaven: dat zijn er hooguit enkele tientallen.
      const studio = `(${query})${STUDIO_FILTER}`;
      found = better(found, pickYear((await search(studio)).recordings, wanted, artists));
      // Een opname met een vroegere officiële uitgave heeft ook een vroegere
      // 'eerste release'. Kijk dus of er vóór het gevonden jaar nog iets zit.
      for (let i = 0; i < 5 && found; i++) {
        const before = ` AND firstreleasedate:[1900-01-01 TO ${found.year - 1}-12-31]`;
        const older = await search(`(${query})${before}`);
        let improved = better(found, pickYear(older.recordings, wanted, artists));
        if (older.total > older.recordings.length) {
          improved = better(improved, pickYear((await search(studio + before)).recordings, wanted, artists));
        }
        if (improved === found) break;
        found = improved;
      }
    }
    if (!found) continue;
    return { year: found.year, official: found.official, method, mbid: found.mbid };
  }
  return { year: null, method: 'niets gevonden' };
}

/**
 * Kiest het jaar voor één nummer uit wat Spotify en MusicBrainz zeggen.
 * `doubts` somt op waarom het jaar best nagekeken wordt.
 */
export function decide({ title, spotifyYear }, mb) {
  const mbYear = mb?.year ?? null;
  const doubts = [];
  let year;
  let source;
  if (mbYear && spotifyYear) {
    // Het vroegste van de twee: een album kan niet voor de eerste release liggen.
    [year, source] = mbYear <= spotifyYear ? [mbYear, 'musicbrainz'] : [spotifyYear, 'spotify'];
    if (Math.abs(mbYear - spotifyYear) > 1) doubts.push(`Spotify zegt ${spotifyYear}, MusicBrainz ${mbYear}`);
  } else if (mbYear) {
    [year, source] = [mbYear, 'musicbrainz'];
  } else if (spotifyYear) {
    [year, source] = [spotifyYear, 'spotify'];
    doubts.push('niet gevonden bij MusicBrainz; jaar van het Spotify-album');
  } else {
    [year, source] = [null, 'onbekend'];
    doubts.push('geen jaar gevonden');
  }
  if (mbYear && mb.method === 'ruim') doubts.push('alleen via een ruime zoekopdracht gevonden');
  if (mbYear && mb.official === false) doubts.push('alleen live-, demo- of onofficiële uitgaven gevonden');
  if (isLive(title)) doubts.push('live-opname');
  return { year, source, spotifyYear: spotifyYear ?? null, mbYear, doubts };
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
