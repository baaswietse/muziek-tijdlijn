// De lijst met nummers voor het spel. Standaard speelt de server met de
// nagekeken lijst van de site (tracks.json). De host kan ook een eigen
// Spotify-playlist kiezen: dan leest zijn browser de nummers, zoekt de
// jaartallen op bij MusicBrainz en stuurt de lijst naar de server.
//
// Wat opgezocht is, deelt de server met alle hosts (de gedeelde lijst met
// jaartallen): een andere host, of dezelfde op een ander toestel, hoeft het
// dan niet opnieuw op te zoeken. Kent de server die lijst niet (een oudere
// server, of hij is even onbereikbaar), dan werkt alles zoals voordien met
// alleen de lokale cache en MusicBrainz.

import { useCallback, useRef, useState } from 'preact/hooks';
import { player } from '../spotify/index.js';
import { post } from './net.js';
import { storage } from './session.js';
import { REMIX_RULES, cleanTitle, decide, isRemix, lookup, mbSearch, songKey, yearOf } from './years.js';

// { [trackId]: { y: jaar, s: bron, d: [twijfels], r: regelversie voor remixes } }
// Oudere items hebben geen r; voor gewone nummers maakt dat niet uit.
const CACHE = 'mt.years.v1';
const LAST = 'mt.lastPlaylist'; // { id, name }
const MAX_DECK = 500;
const MIN_DECK = 10;
const SECONDS_PER_LOOKUP = 3;
const SHARED_IDS = 500; // zoveel nummers mag één leesverzoek vragen (server/src/yearlist.js)
const SHARED_WRITE = 200; // en zoveel per schrijfverzoek: ruim onder de grootte van een verzoek
const MANUAL = 'handmatig';

let builtin = null;

/**
 * Vraagt de gedeelde lijst op voor deze nummers: { id: { y, s, d, r } }.
 * null als de server ze niet kan geven; dan gaat alles verder zonder.
 */
async function sharedLookup(code, token, ids) {
  const years = {};
  try {
    for (let i = 0; i < ids.length; i += SHARED_IDS) {
      const res = await post(`/api/rooms/${code}/years/lookup`, { token, ids: ids.slice(i, i + SHARED_IDS) });
      if (!res || typeof res.years !== 'object' || res.years === null) return null;
      Object.assign(years, res.years);
    }
  } catch {
    return null; // oudere server (404), onbereikbaar of geen host meer: zonder verder
  }
  return years;
}

/** Stuurt jaartallen naar de gedeelde lijst. Mislukt dat, dan blijft alles gewoon lokaal. */
async function sharedSave(code, token, entries) {
  try {
    for (let i = 0; i < entries.length; i += SHARED_WRITE) {
      await post(`/api/rooms/${code}/years`, { token, entries: entries.slice(i, i + SHARED_WRITE) });
    }
  } catch {
    // Niet erg: de host heeft het jaar lokaal, en een volgende keer gaat het opnieuw mee.
  }
}

/** Een item voor de gedeelde lijst: alleen track-ID, jaar, bron, twijfels en regelversie. */
function shareable(id, e) {
  const out = { id, y: e.y ?? null, s: e.s, d: e.s === MANUAL ? [] : e.d || [] };
  if (e.r !== undefined) out.r = e.r;
  return out;
}

/** Jaartallen van de nagekeken standaardlijst: die hoeven niet opnieuw opgezocht. */
async function loadBuiltin() {
  if (builtin) return builtin;
  const map = new Map();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}tracks.json`);
    for (const t of await res.json()) if (t?.id && t.year) map.set(t.id, t.year);
  } catch {
    // Zonder standaardlijst wordt gewoon alles opgezocht.
  }
  builtin = map;
  return map;
}

export function useDeck({ code, token }) {
  const [playlists, setPlaylists] = useState(null); // null = nog niet opgevraagd
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState(null); // { name, phase, done, total, todo }
  const [result, setResult] = useState(null); // { name, count, skipped, doubts, note }
  const [error, setError] = useState('');
  const abort = useRef(null);
  const current = useRef(null); // { id, name, rows } van de laatst verwerkte playlist

  const available = typeof player.playlists === 'function';

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPlaylists(await player.playlists());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Stuurt de lijst naar de server. Alleen nummers met een jaartal tellen mee. */
  const upload = useCallback(
    async (note = '') => {
      const { name, rows } = current.current;
      const withYear = rows.filter((r) => r.year);
      const deck = withYear.slice(0, MAX_DECK).map((r) => ({ id: r.id, artist: r.artist, title: r.title, year: r.year }));
      if (deck.length < MIN_DECK) {
        throw new Error(`Deze playlist heeft maar ${deck.length} bruikbare nummers; er zijn er minstens ${MIN_DECK} nodig.`);
      }
      await post(`/api/rooms/${code}/deck`, { token, name, tracks: deck });
      setResult({
        name,
        count: deck.length,
        skipped: rows.length - deck.length,
        doubts: rows.filter((r) => r.doubts.length > 0 && r.source !== 'handmatig'),
        note,
      });
    },
    [code, token],
  );

  /** Leest een playlist, zoekt de ontbrekende jaartallen op en stuurt ze door. */
  const choose = useCallback(
    async (playlist) => {
      const controller = new AbortController();
      abort.current = controller;
      const { signal } = controller;
      setError('');
      setResult(null);
      setJob({ name: playlist.name, phase: 'tracks', done: 0, total: 0, todo: 0 });
      try {
        const raw = await player.playlistTracks(playlist.id);
        // Hetzelfde nummer twee keer (album- en singleversie) geeft twee dezelfde kaarten.
        const seen = new Set();
        const tracks = raw.filter((t) => {
          const key = songKey(t.title, t.artists);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const known = await loadBuiltin();
        const cache = storage.read(CACHE) || {};
        // De gedeelde lijst van de server, voor alles wat niet op de site staat.
        // null: de server kon niet antwoorden; dan zoals vroeger, zonder.
        const ask = tracks.filter((t) => !known.has(t.id)).map((t) => t.id);
        const shared = ask.length ? await sharedLookup(code, token, ask) : {};
        if (signal.aborted) throw signal.reason;
        // Remixes kregen vroeger meestal het jaar van het origineel. Wat zonder
        // de huidige regelversie (r) onthouden is (lokaal of op de server),
        // wordt één keer opnieuw opgezocht; gewone nummers blijven onthouden
        // zoals ze zijn, en een handmatige verbetering ook.
        const upToDate = (e, title) => e && (e.s === MANUAL || !isRemix(title) || e.r === REMIX_RULES);
        // `from` zegt waar het jaar vandaan kwam: dat bepaalt wat nog naar de server moet.
        const stored = ({ id, title }) => {
          if (cache[id]?.s === MANUAL) return { ...cache[id], from: 'eigen' }; // eigen verbetering gaat altijd voor
          if (known.has(id)) return { y: known.get(id), s: 'lijst', d: [], from: 'lijst' };
          if (upToDate(shared?.[id], title)) return { ...shared[id], from: 'server' };
          if (upToDate(cache[id], title)) return { ...cache[id], from: 'cache' };
          return null;
        };
        const todo = tracks.filter((t) => !stored(t)).length;
        setJob({ name: playlist.name, phase: 'years', done: 0, total: tracks.length, todo });

        const rows = [];
        const share = []; // wat de server nog niet (zo) heeft
        let failures = 0; // opeenvolgende mislukte opzoekingen
        let unreachable = 0;
        let looked = 0;
        for (const [i, t] of tracks.entries()) {
          if (signal.aborted) throw signal.reason;
          let entry = stored(t);
          if (!entry) {
            const spotifyYear = yearOf(t.spotifyDate);
            let mb = null;
            let failed = failures >= 2; // MusicBrainz ligt plat: niet bij elk nummer een minuut wachten
            if (!failed) {
              try {
                mb = await lookup(t.title, t.artists, (query) => mbSearch(query, { signal }));
                failures = 0;
              } catch (err) {
                if (signal.aborted) throw err;
                failures++;
                failed = true;
              }
            }
            const d = decide({ title: t.title, spotifyYear }, mb);
            entry = { y: d.year, s: d.source, d: d.doubts, r: REMIX_RULES };
            if (failed) {
              unreachable++;
              entry.d = ['MusicBrainz was niet bereikbaar; jaar van het Spotify-album', ...entry.d];
            } else {
              cache[t.id] = entry; // alleen echte antwoorden onthouden en delen
              share.push(shareable(t.id, entry));
              if (++looked % 5 === 0) storage.write(CACHE, cache);
            }
          } else if (entry.from === 'cache') {
            // Eerder in deze browser opgezocht, maar (nog) niet op de server:
            // zo gaat het werk van vroeger niet verloren.
            share.push(shareable(t.id, entry));
          } else if (entry.from === 'eigen' && shared?.[t.id]?.s !== MANUAL) {
            // Een eigen verbetering van vroeger. Een verbetering die al op de
            // server staat, kan nieuwer zijn (van een andere host): die blijft.
            share.push(shareable(t.id, entry));
          }
          rows.push({
            id: t.id,
            title: cleanTitle(t.title),
            artist: t.artists.join(', '),
            year: entry.y,
            source: entry.s,
            doubts: entry.d || [],
          });
          setJob((j) => (j ? { ...j, done: i + 1 } : j));
        }
        storage.write(CACHE, cache);
        current.current = { id: playlist.id, name: playlist.name, rows };
        setJob((j) => (j ? { ...j, phase: 'upload' } : j));
        // Alleen als de server de gedeelde lijst kent (de opvraging lukte).
        if (shared && share.length) await sharedSave(code, token, share);
        await upload(
          unreachable
            ? `MusicBrainz was niet bereikbaar voor ${unreachable} nummers; die kregen het jaar van het Spotify-album. Kies de playlist later opnieuw om ze alsnog op te zoeken.`
            : '',
        );
        storage.write(LAST, { id: playlist.id, name: playlist.name });
      } catch (err) {
        if (!signal.aborted) setError(err?.message || 'Er liep iets mis bij het lezen van de playlist.');
      } finally {
        setJob(null);
        abort.current = null;
      }
    },
    [code, token, upload],
  );

  const cancel = useCallback(() => {
    abort.current?.abort(new Error('gestopt'));
  }, []);

  /**
   * De host verbetert zelf een jaartal; dat wordt onthouden, meteen
   * doorgestuurd en ook gedeeld, zodat andere hosts het verbeterde jaar krijgen.
   */
  const setYear = useCallback(
    async (id, year) => {
      const y = Math.round(Number(year));
      const data = current.current;
      const row = data?.rows.find((r) => r.id === id);
      if (!row || !Number.isInteger(y) || y < 1900 || y > new Date().getFullYear() + 1) return;
      row.year = y;
      row.source = MANUAL;
      const cache = storage.read(CACHE) || {};
      cache[id] = { y, s: MANUAL, d: [] };
      storage.write(CACHE, cache);
      // Faalt de server hier, dan gaat de verbetering mee bij een volgende keuze van de playlist.
      const sharing = sharedSave(code, token, [shareable(id, cache[id])]);
      try {
        await upload();
      } catch (err) {
        setError(err.message);
      }
      await sharing;
    },
    [code, token, upload],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError('');
  }, []);

  return {
    available,
    playlists,
    loading,
    job,
    result,
    error,
    last: storage.read(LAST),
    /** Geschatte wachttijd in minuten voor de lopende opzoeking. */
    minutes: job ? Math.max(1, Math.round((job.todo * SECONDS_PER_LOOKUP) / 60)) : 0,
    loadPlaylists,
    choose,
    cancel,
    setYear,
    reset,
  };
}
