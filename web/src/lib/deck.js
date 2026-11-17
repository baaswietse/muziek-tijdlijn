// De lijst met nummers voor het spel. Standaard speelt de server met de
// nagekeken lijst van de site (tracks.json). De host kan ook een eigen
// Spotify-playlist kiezen: dan leest zijn browser de nummers, zoekt de
// jaartallen op bij MusicBrainz en stuurt de lijst naar de server.

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

let builtin = null;

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
        const stored = ({ id, title }) => {
          if (cache[id]?.s === 'handmatig') return cache[id]; // eigen verbetering gaat altijd voor
          if (known.has(id)) return { y: known.get(id), s: 'lijst', d: [] };
          // Remixes kregen vroeger meestal het jaar van het origineel. Wat zonder
          // de huidige regelversie (r) onthouden is, wordt één keer opnieuw
          // opgezocht; gewone nummers blijven onthouden zoals ze zijn.
          if (cache[id] && isRemix(title) && cache[id].r !== REMIX_RULES) return null;
          return cache[id] || null;
        };
        const todo = tracks.filter((t) => !stored(t)).length;
        setJob({ name: playlist.name, phase: 'years', done: 0, total: tracks.length, todo });

        const rows = [];
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
              cache[t.id] = entry; // alleen echte antwoorden onthouden
              if (++looked % 5 === 0) storage.write(CACHE, cache);
            }
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
    [upload],
  );

  const cancel = useCallback(() => {
    abort.current?.abort(new Error('gestopt'));
  }, []);

  /** De host verbetert zelf een jaartal; dat wordt onthouden en meteen doorgestuurd. */
  const setYear = useCallback(
    async (id, year) => {
      const y = Math.round(Number(year));
      const data = current.current;
      const row = data?.rows.find((r) => r.id === id);
      if (!row || !Number.isInteger(y) || y < 1900 || y > new Date().getFullYear() + 1) return;
      row.year = y;
      row.source = 'handmatig';
      const cache = storage.read(CACHE) || {};
      cache[id] = { y, s: 'handmatig', d: [] };
      storage.write(CACHE, cache);
      try {
        await upload();
      } catch (err) {
        setError(err.message);
      }
    },
    [upload],
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
