// De lijst met nummers voor het spel. Standaard speelt de server met de
// nagekeken lijst van de site (tracks.json). De host kan ook een eigen
// Spotify-playlist kiezen: dan leest zijn browser de nummers, zoekt de
// jaartallen op bij MusicBrainz en stuurt de lijst naar de server.
//
// Wat al gekend is (een eigen verbetering, tracks.json, de gedeelde lijst op
// de server, de lokale cache) is er meteen. De rest wordt op de achtergrond
// opgezocht, in willekeurige volgorde: de host kan starten zodra er genoeg
// nummers een jaartal hebben, en het opzoeken loopt door in de wachtkamer en
// tijdens het spel. Wat er tijdens een spel bijkomt, gaat pas tussen twee
// spellen naar de server (de server weigert een nieuwe lijst tijdens een
// spel), dus het doet mee vanaf het volgende spel. Na een herlaad gaat het
// opzoeken verder waar het was (mt.deckJob).
//
// Wat opgezocht is, deelt de server met alle hosts (de gedeelde lijst met
// jaartallen): een andere host, of dezelfde op een ander toestel, hoeft het
// dan niet opnieuw op te zoeken. Kent de server die lijst niet (een oudere
// server, of hij is even onbereikbaar), dan werkt alles zoals voordien met
// alleen de lokale cache en MusicBrainz.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { player } from '../spotify/index.js';
import { post } from './net.js';
import { storage } from './session.js';
import { REMIX_RULES, cleanTitle, decide, isRemix, lookup, mbSearch, yearOf } from './years.js';
import {
  MIN_DECK,
  canSendDeck,
  deckNeed,
  fairDeck,
  lookupOrder,
  lookupsUntilFair,
  minutesLeft,
  pickTracks,
  secondsPerLookup,
  shuffled,
  uploadWait,
  withoutDoubles,
} from './deckplan.js';

// { [trackId]: { y: jaar, s: bron, d: [twijfels], r: regelversie voor remixes } }
// Oudere items hebben geen r; voor gewone nummers maakt dat niet uit.
const CACHE = 'mt.years.v1';
const LAST = 'mt.lastPlaylist'; // { id, name }
// Een opzoeking die nog bezig is, om na een herlaad verder te gaan:
// { code, id, name, tracks: [{ id, title, artists, spotifyDate }], sampled, total,
//   known: [track-ID's die bij de start al gekend waren, in willekeurige volgorde],
//   done: true als er niets meer op te zoeken valt maar de lijst nog niet op de server staat }
// Ze blijft bewaard tot de volledige lijst op de server staat: eindigt het
// opzoeken tijdens een spel en herlaadt de host daarna, dan gaat de lijst na
// het spel toch nog mee (anders speelde het volgende spel weer met de kleine
// lijst van het eerste, en dus met dezelfde nummers).
const JOB = 'mt.deckJob';
const SECONDS_PER_LOOKUP = 2; // schatting tot er in deze opzoeking een paar gemeten zijn
const SHARED_IDS = 500; // zoveel nummers mag één leesverzoek vragen (server/src/yearlist.js)
const SHARED_WRITE = 200; // en zoveel per schrijfverzoek: ruim onder de grootte van een verzoek
const SHARE_EVERY = 20; // tussentijds delen met de server, per zoveel opgezochte nummers
const UPLOAD_FIRST = 5000; // de lijst gaat ten vroegste zo lang na het begin naar de server
const UPLOAD_EVERY = 20_000; // en daarna hoogstens om de zoveel ms, tot alles opgezocht is
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

function stopped(kind) {
  const err = new Error('gestopt');
  err.kind = kind; // 'stop': de host tikte op Stop; 'replace': andere lijst; 'leave': ander spel
  return err;
}

const rowOf = (t, entry, known = false) => ({
  id: t.id,
  title: cleanTitle(t.title),
  artist: t.artists.join(', '),
  year: entry.y,
  source: entry.s,
  doubts: entry.d || [],
  known,
});

export function useDeck({ code, token, phase, players = 1, target = 10 }) {
  const [playlists, setPlaylists] = useState(null); // null = nog niet opgevraagd
  const [loading, setLoading] = useState(false);
  // { name, phase: 'tracks' | 'years', total, todo, done, ready, sampled, playlistTotal, seconds }
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null); // { name, count, skipped, doubts, note, sampled, total }
  const [error, setError] = useState('');
  const run = useRef(null); // de opzoeking die nu loopt: { controller }
  // De laatst gekozen playlist: { id, name, rows, sampled, total, note, dirty, lastUpload, startedAt, timer, finished }
  const current = useRef(null);
  const phaseRef = useRef(phase);
  const sending = useRef(Promise.resolve());
  // Genoeg nummers voor een volledig spel met deze spelers: zoveel gaan er
  // zeker mee, ook als het opzoeken nog niet ver is.
  const needRef = useRef(deckNeed(players, target));
  needRef.current = deckNeed(players, target);

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

  /** Toont wat er nu klaar is: aantal, twijfels om na te kijken, wat niet meedoet. */
  const refresh = useCallback((data) => {
    if (data !== current.current) return;
    const { rows } = data;
    setResult({
      name: data.name,
      count: rows.filter((r) => r.year).length,
      skipped: rows.filter((r) => !r.year).length,
      doubts: rows.filter((r) => r.doubts.length > 0 && r.source !== MANUAL),
      note: data.note || '',
      sampled: data.sampled,
      total: data.total,
      finished: data.finished,
    });
  }, []);

  /**
   * Stuurt de lijst naar de server, één verzoek tegelijk. Tijdens een spel
   * kan dat niet: dan blijft ze `dirty` en gaat ze mee zodra het spel gedaan
   * is (zie het effect op `phase` hieronder). `quiet`: te weinig nummers is
   * dan geen fout, maar gewoon nog niet.
   */
  /** De bewaarde opzoeking van deze lijst is afgehandeld. */
  const forgetJob = useCallback(
    (data) => {
      const saved = storage.read(JOB);
      if (saved?.code === code && saved.id === data.id) storage.write(JOB, null);
    },
    [code],
  );

  const sendDeck = useCallback(
    (data, { quiet = false } = {}) => {
      const step = sending.current.catch(() => {}).then(async () => {
        if (!data || data !== current.current) return false;
        if (!canSendDeck(phaseRef.current)) {
          data.dirty = true;
          return false;
        }
        const deck = fairDeck(data.rows, { ...data, need: needRef.current });
        // Te weinig nummers: dan valt er na een herlaad ook niets af te maken.
        if (deck.length < MIN_DECK) {
          if (data.finished) forgetJob(data);
          if (quiet) return false;
          throw new Error(`Deze playlist heeft maar ${deck.length} bruikbare nummers; er zijn er minstens ${MIN_DECK} nodig.`);
        }
        data.dirty = false;
        try {
          await post(`/api/rooms/${code}/deck`, { token, name: data.name, tracks: deck });
        } catch (err) {
          data.dirty = true;
          throw err;
        }
        data.lastUpload = Date.now();
        storage.write(LAST, { id: data.id, name: data.name });
        // De volledige lijst staat op de server: niets meer om na een herlaad af te maken.
        if (data.finished) forgetJob(data);
        return true;
      });
      sending.current = step;
      return step;
    },
    [code, token, forgetJob],
  );

  /** Plant een tussentijdse upload tijdens het opzoeken (niet bij elk nummer). */
  const schedule = useCallback(
    (data) => {
      if (data.timer) return;
      const wait = uploadWait({ now: Date.now(), startedAt: data.startedAt, lastUpload: data.lastUpload, first: UPLOAD_FIRST, every: UPLOAD_EVERY });
      data.timer = setTimeout(() => {
        data.timer = null;
        if (data.dirty) sendDeck(data, { quiet: true }).catch(() => {});
      }, wait);
    },
    [sendDeck],
  );

  const stopRun = useCallback((kind) => {
    const r = run.current;
    if (!r) return;
    run.current = null;
    r.controller.abort(stopped(kind));
  }, []);

  /**
   * Leest de nummers (of neemt ze uit een bewaarde opzoeking), neemt wat al
   * gekend is en zoekt de rest op de achtergrond op.
   */
  const start = useCallback(
    async (spec, { resume = false } = {}) => {
      const controller = new AbortController();
      const me = { controller };
      run.current = me;
      const { signal } = controller;
      const mine = () => run.current === me;
      const update = (fn) => mine() && setJob((j) => (j ? fn(j) : j));
      let data = null;
      let share = []; // wat de server nog niet (zo) heeft
      let shared = null;
      setError('');
      if (!resume) setResult(null);
      setJob({ name: spec.name, phase: 'tracks', total: 0, todo: 0, done: 0, ready: 0 });
      try {
        let tracks = spec.tracks;
        let sampled = Boolean(spec.sampled);
        let total = spec.total ?? tracks?.length ?? 0;
        if (!tracks) {
          const picked = pickTracks(withoutDoubles(await player.playlistTracks(spec.id)));
          ({ tracks, sampled, total } = picked);
        }
        if (signal.aborted) throw signal.reason;
        const known = await loadBuiltin();
        // De gedeelde lijst van de server, voor alles wat niet op de site staat.
        // null: de server kon niet antwoorden; dan zoals vroeger, zonder.
        const ask = tracks.filter((t) => !known.has(t.id)).map((t) => t.id);
        shared = ask.length ? await sharedLookup(code, token, ask) : {};
        if (signal.aborted) throw signal.reason;
        const cache = storage.read(CACHE) || {};
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
        // Eerst wat gekend is, dan de onbekende nummers in willekeurige volgorde.
        // Bij verdergaan na een herlaad ligt die volgorde al vast.
        if (!resume) tracks = lookupOrder(tracks, (t) => Boolean(stored(t)));
        // Wat bij de start al gekend was, met een vaste willekeurige volgorde:
        // daaruit komt de evenwichtige greep zolang er nog opgezocht wordt.
        const knownIds = Array.isArray(spec.known) ? spec.known : shuffled(tracks.filter((t) => stored(t)).map((t) => t.id));
        const atStart = new Set(knownIds);
        const rank = new Map(knownIds.map((id, i) => [id, i]));
        // Na het opzoeken (of na Stop) herladen: niets meer opzoeken, alleen de lijst nog doorsturen.
        const nothingLeft = resume && spec.done === true;

        const rows = [];
        const todo = [];
        let todoAtStart = 0; // op te zoeken bij de start van de opzoeking (voor de evenwichtige greep)
        for (const t of tracks) {
          const entry = stored(t);
          if (!atStart.has(t.id)) todoAtStart++;
          if (!entry) {
            if (!nothingLeft) todo.push(t);
            continue;
          }
          if (entry.from === 'cache') {
            // Eerder in deze browser opgezocht, maar (nog) niet op de server:
            // zo gaat het werk van vroeger niet verloren.
            share.push(shareable(t.id, entry));
          } else if (entry.from === 'eigen' && shared?.[t.id]?.s !== MANUAL) {
            // Een eigen verbetering van vroeger. Een verbetering die al op de
            // server staat, kan nieuwer zijn (van een andere host): die blijft.
            share.push(shareable(t.id, entry));
          }
          rows.push(rowOf(t, entry, atStart.has(t.id)));
        }
        const job = { code, id: spec.id, name: spec.name, tracks, sampled, total, known: knownIds };
        if (todo.length) storage.write(JOB, job);
        else if (nothingLeft) storage.write(JOB, { ...job, done: true });
        data = {
          id: spec.id,
          name: spec.name,
          rows,
          size: tracks.length,
          sampled,
          total,
          note: '',
          dirty: true,
          lastUpload: 0,
          startedAt: Date.now(),
          timer: null,
          finished: false,
          done: todoAtStart - todo.length,
          todo: todoAtStart,
          rank,
        };
        current.current = data;
        const ready = () => rows.filter((r) => r.year).length;
        // Zoveel nummers speelt een spel dat nu start (de evenwichtige greep).
        const planned = () => fairDeck(rows, { ...data, need: needRef.current }).length;
        // Nog zoveel op te zoeken voor die greep evenwichtig is (zie lookupsUntilFair).
        const untilFair = () => lookupsUntilFair({ known: atStart.size, todo: data.todo, done: data.done, need: needRef.current });
        const startedAt = Date.now();
        if (mine()) {
          setJob({ name: spec.name, phase: 'years', total: tracks.length, todo: todo.length, done: 0, ready: ready(), planned: planned(), untilFair: untilFair(), sampled, playlistTotal: total, seconds: SECONDS_PER_LOOKUP });
        }
        refresh(data);
        if (todo.length) schedule(data);

        let failures = 0; // opeenvolgende mislukte opzoekingen
        let unreachable = 0;
        for (const [i, t] of todo.entries()) {
          if (signal.aborted) throw signal.reason;
          const spotifyYear = yearOf(t.spotifyDate);
          let mb = null;
          let failed = failures >= 2; // MusicBrainz ligt plat: niet bij elk nummer een minuut wachten
          if (!failed) {
            try {
              mb = await lookup(t.title, t.artists, (query) => mbSearch(query, { signal }));
              failures = 0;
            } catch (err) {
              if (signal.aborted) throw signal.reason;
              failures++;
              failed = true;
            }
          }
          const d = decide({ title: t.title, spotifyYear }, mb);
          const entry = { y: d.year, s: d.source, d: d.doubts, r: REMIX_RULES };
          if (failed) {
            unreachable++;
            entry.d = ['MusicBrainz was niet bereikbaar; jaar van het Spotify-album', ...entry.d];
          } else {
            // Alleen echte antwoorden onthouden en delen. Opnieuw lezen: de host
            // kan intussen zelf een jaar verbeterd hebben (setYear).
            const latest = storage.read(CACHE) || {};
            if (latest[t.id]?.s !== MANUAL) {
              latest[t.id] = entry;
              storage.write(CACHE, latest);
              share.push(shareable(t.id, entry));
            }
          }
          rows.push(rowOf(t, entry));
          data.done += 1;
          if (shared && share.length >= SHARE_EVERY) sharedSave(code, token, share.splice(0));
          data.dirty = true;
          schedule(data);
          const seconds = secondsPerLookup({ done: i + 1, elapsedMs: Date.now() - startedAt, fallback: SECONDS_PER_LOOKUP });
          update((j) => ({ ...j, done: i + 1, ready: ready(), planned: planned(), untilFair: untilFair(), seconds }));
          refresh(data);
        }

        // Alles opgezocht. De opzoeking blijft bewaard (als «klaar») tot de
        // lijst op de server staat; zie JOB.
        clearTimeout(data.timer);
        data.timer = null;
        if (todo.length) storage.write(JOB, { ...job, done: true });
        data.finished = true;
        data.note = unreachable
          ? `MusicBrainz was niet bereikbaar voor ${unreachable} nummers; die kregen het jaar van het Spotify-album. Kies de playlist later opnieuw om ze alsnog op te zoeken.`
          : '';
        refresh(data);
        // Alleen als de server de gedeelde lijst kent (de opvraging lukte).
        if (shared && share.length) await sharedSave(code, token, share.splice(0));
        await sendDeck(data);
      } catch (err) {
        const kind = signal.aborted ? signal.reason?.kind : null;
        if (data) {
          clearTimeout(data.timer);
          data.timer = null;
        }
        if (kind !== 'leave') {
          // Wat al opgezocht is, blijft geldig: delen met de server.
          if (shared && share.length) sharedSave(code, token, share.splice(0));
        }
        if (kind === 'stop' && data) {
          // De host stopt het opzoeken: wat al klaar is, blijft (als het genoeg
          // is). Ook dit wacht tot het op de server staat (zie JOB).
          const saved = storage.read(JOB);
          storage.write(JOB, saved ? { ...saved, done: true } : null);
          data.finished = true;
          const left = data.size - data.rows.length;
          data.note = `Opzoeken gestopt: ${left} nummers zijn niet opgezocht. Kies de playlist opnieuw om ze alsnog op te zoeken.`;
          refresh(data);
          sendDeck(data, { quiet: true }).catch(() => {});
        } else if (!kind) {
          storage.write(JOB, null);
          if (mine()) setError(err?.message || 'Er liep iets mis bij het lezen van de playlist.');
        }
      } finally {
        if (mine()) {
          run.current = null;
          setJob(null);
        } else if (!run.current) {
          setJob(null);
        }
      }
    },
    [code, token, refresh, schedule, sendDeck],
  );

  /** Kiest een playlist: een opzoeking die nog loopt, stopt eerst. */
  const choose = useCallback(
    (playlist) => {
      stopRun('replace');
      storage.write(JOB, null);
      if (current.current) clearTimeout(current.current.timer);
      current.current = null;
      return start({ id: playlist.id, name: playlist.name });
    },
    [start, stopRun],
  );

  /** Stop: niet verder opzoeken. Wat al klaar is, blijft. */
  const cancel = useCallback(() => stopRun('stop'), [stopRun]);

  // Na een herlaad: een opzoeking voor dit spel gaat verder. Een ander spel
  // (de host maakte een nieuw): die oude opzoeking vervalt.
  useEffect(() => {
    if (!code || !token) return undefined;
    const saved = storage.read(JOB);
    if (saved && saved.code !== code) storage.write(JOB, null);
    else if (saved && Array.isArray(saved.tracks) && !run.current) start(saved, { resume: true });
    return () => {
      stopRun('leave');
      if (current.current) clearTimeout(current.current.timer);
      current.current = null;
      setResult(null);
    };
  }, [code, token]);

  // Tussen twee spellen (wachtkamer, of na de laatste kaart) gaat wat er
  // tijdens het spel bijkwam alsnog naar de server.
  useEffect(() => {
    phaseRef.current = phase;
    const data = current.current;
    if (data?.dirty && canSendDeck(phase)) sendDeck(data, { quiet: true }).catch(() => {});
  }, [phase, sendDeck]);

  /** Vlak voor de start: de lijst met alles wat er nu klaar is, staat zeker op de server. */
  const flush = useCallback(async () => {
    const data = current.current;
    if (!data) return;
    clearTimeout(data.timer);
    data.timer = null;
    try {
      if (data.dirty) await sendDeck(data, { quiet: true });
      else await sending.current;
    } catch {
      // Lukt het niet, dan start het spel met de lijst die de server al had.
    }
    if (run.current && !data.finished) schedule(data);
  }, [sendDeck, schedule]);

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
      refresh(data);
      // Faalt de server hier, dan gaat de verbetering mee bij een volgende keuze van de playlist.
      const sharing = sharedSave(code, token, [shareable(id, cache[id])]);
      clearTimeout(data.timer);
      data.timer = null;
      try {
        await sendDeck(data, { quiet: !data.finished });
      } catch (err) {
        setError(err.message);
      }
      if (run.current && !data.finished) schedule(data);
      await sharing;
    },
    [code, token, refresh, schedule, sendDeck],
  );

  /** Terug naar de standaardlijst: een opzoeking die nog loopt, stopt. */
  // Geeft een promise: pas als die klaar is (en true geeft), mag de standaardlijst gevraagd
  // worden. Een upload van de playlist die al onderweg is (bv. na een
  // verbetering), kan niet meer terug; kwam die na het wissen aan, dan stond
  // de playlist weer op de server. Uploads die nog wachten, slaan zichzelf over
  // (current is dan leeg).
  const reset = useCallback(async () => {
    stopRun('replace');
    storage.write(JOB, null);
    if (current.current) clearTimeout(current.current.timer);
    current.current = null;
    setResult(null);
    setError('');
    await sending.current.catch(() => {});
    // Koos de host intussen al een (andere) playlist, dan geldt die.
    return !current.current && !run.current;
  }, [stopRun]);

  const left = job?.phase === 'years' ? job.todo - job.done : 0;
  return {
    available,
    playlists,
    loading,
    job,
    result,
    error,
    last: storage.read(LAST),
    /** Nog op te zoeken nummers en de geschatte tijd daarvoor in minuten. */
    left,
    minutes: job ? minutesLeft(left, job.seconds ?? SECONDS_PER_LOOKUP) : 0,
    /** Kan de host starten? Zonder opzoeking altijd; tijdens een opzoeking zodra er genoeg nummers klaar zijn. */
    canStart: !job || (job.phase === 'years' && job.ready >= MIN_DECK),
    minDeck: MIN_DECK,
    loadPlaylists,
    choose,
    cancel,
    flush,
    setYear,
    reset,
  };
}
