// De keuze van de host uit de ingebouwde lijsten met fragmenten: welke
// lijsten (samen) en welke periode. Alleen op de gsm van de host. De keuze
// blijft bewaard op dit toestel (ook voor een volgend spel); het rekenwerk
// staat in ../fragment/lists.js.
//
// De server krijgt, zoals altijd, gewoon de stapel (POST /deck) met als naam
// de keuze in gewone taal («Rock + Nederlandstalig, 1980–2000»); welke lijsten
// het waren, weet hij niet. Na elke wijziging gaat de stapel na een korte
// pauze opnieuw naar de server (een paar tikken na elkaar geven zo één
// verzoek), en «Start» wacht tot dat gebeurd is. Heeft de keuze minder dan
// het minimum van de server, dan gaat de oude stapel weg (`clearDeck`), zodat
// de anderen niet iets anders zien dan wat de host koos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { loadFragments } from './fragments.js';
import {
  deckForChoice,
  describeChoice,
  listsOf,
  normaliseChoice,
  periodOptions,
  setPeriod,
  toggleList,
  tracksOf,
  yearBounds,
} from '../fragment/lists.js';
import { MAX_DECK, MIN_DECK, deckNeed } from './deckplan.js';
import { storage } from './session.js';

export const CHOICE_KEY = 'mt.fragmentChoice';
const WAIT_MS = 300;

export function useFragmentChoice({ enabled, view, deck, send }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [raw, setRaw] = useState(() => storage.read(CHOICE_KEY));
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setLoadError('');
    loadFragments().then(setData, (err) => setLoadError(err.message));
  }, []);
  useEffect(() => {
    if (enabled && !data) load();
  }, [enabled, data, load]);

  const choice = useMemo(() => (data ? normaliseChoice(data, raw) : null), [data, raw]);
  const update = useCallback(
    (fn) => {
      if (!data) return;
      const next = fn(normaliseChoice(data, raw));
      storage.write(CHOICE_KEY, next);
      setRaw(next);
    },
    [data, raw],
  );

  const lists = useMemo(() => (data && choice ? listsOf(data, choice) : null), [data, choice]);
  const bounds = useMemo(() => (data ? yearBounds(data) : null), [data]);
  const options = useMemo(() => periodOptions(bounds), [bounds]);
  const total = useMemo(() => (data && choice ? tracksOf(data, choice).length : 0), [data, choice]);
  const name = data && choice ? describeChoice(data, choice) : '';
  const players = view?.players?.length ?? 1;
  const target = view?.settings?.target ?? 10;
  const need = deckNeed(players, target);
  const planned = Math.min(total, MAX_DECK);

  // Wat er op de server moet staan, en wat er staat.
  const wanted = !choice ? null : total >= MIN_DECK ? `${name}|${planned}` : 'clear';
  const playlist = view?.playlist?.source === 'fragment' ? view.playlist : null;
  const onServer = playlist ? `${playlist.name}|${playlist.count}` : 'clear';
  const synced = wanted != null && wanted === onServer;
  const phase = view?.phase ?? null;

  const sent = useRef(null); // wat de server aannam (de stand via de WebSocket kan even achterlopen)
  const failed = useRef(null); // wat mislukte: niet vanzelf opnieuw
  const busy = useRef(null);
  const timer = useRef(null);
  const latest = useRef(null);
  latest.current = { data, choice, wanted, synced, phase, enabled, deck, send };

  useEffect(() => {
    if (onServer !== sent.current) sent.current = null;
  }, [onServer]);

  const sync = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    while (busy.current) await busy.current;
    const s = latest.current;
    if (!s.enabled || s.phase !== 'lobby' || !s.wanted || s.synced) return;
    if (sent.current === s.wanted || failed.current === s.wanted) return;
    const key = s.wanted;
    const job = (async () => {
      if (key === 'clear') return s.send({ t: 'clearDeck' }) !== false;
      const { name: deckName, tracks } = deckForChoice(s.data, s.choice);
      return s.deck.sendList(deckName, tracks);
    })();
    busy.current = job;
    let ok = false;
    try {
      ok = await job;
    } finally {
      busy.current = null;
    }
    if (ok) sent.current = key;
    else failed.current = key;
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Een andere bron: kom je terug, dan gaat de keuze opnieuw naar de server.
      sent.current = null;
      failed.current = null;
      return undefined;
    }
    if (phase !== 'lobby' || !wanted || synced) return undefined;
    timer.current = setTimeout(sync, WAIT_MS);
    return () => clearTimeout(timer.current);
  }, [enabled, phase, wanted, synced, tick, sync]);

  /** Voor «Start»: stuurt een wijziging die nog wacht meteen, en zegt of de server de keuze heeft. */
  const flush = useCallback(async () => {
    await sync();
    while (busy.current) await busy.current;
    const s = latest.current;
    return Boolean(s.wanted && s.wanted !== 'clear' && (s.synced || sent.current === s.wanted));
  }, [sync]);

  /** «Opnieuw» na een mislukte upload. */
  const retry = useCallback(() => {
    failed.current = null;
    sync();
  }, [sync]);

  return {
    data,
    loadError,
    reload: load,
    choice,
    lists,
    bounds,
    options,
    total,
    planned,
    sampled: total > MAX_DECK,
    name,
    need,
    players,
    target,
    enough: total >= need,
    synced,
    toggle: (id) => update((c) => toggleList(data, c, id)),
    setFrom: (y) => update((c) => setPeriod(data, c, 'from', y)),
    setTo: (y) => update((c) => setPeriod(data, c, 'to', y)),
    clearPeriod: () => update((c) => ({ ...c, from: null, to: null })),
    flush,
    retry,
  };
}
