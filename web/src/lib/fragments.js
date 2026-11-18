// Muziek met fragmenten van Deezer (30 seconden, zonder account) op de gsm
// van de host: het geluid komt uit zijn browser. Zelfde vorm als useMusic
// (Spotify), zodat de schermen beide op dezelfde manier tonen.
//
// Het ophalen en afspelen zelf staat in ../fragment/ en weet niets van de
// host: een speler die meeluistert (lib/listen.js) gebruikt het ook.
//
// Spelers op afstand: de host geeft het adres van elk fragment door aan de
// server (`{ t: 'sound', action: 'play', trackId, url }`), en ook pauze en
// verder spelen. De server stuurt het alleen naar spelers die «Geluid op dit
// toestel» aanzetten (zie server/src/sound.js). Dat gebeurt ook als de host
// zelf geen geluid maakt: na een herlaad (nog niet aangetikt) of omdat hij
// koos voor «Geen geluid op dit toestel» (`local: 'mute'`, bv. in een stille
// ruimte; die keuze blijft bewaard voor dit spel).

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createFragmentPlayer, BLOCKED } from '../fragment/player.js';
import { fetchPreview } from '../fragment/deezer.js';
import { cleanFragments } from '../fragment/lists.js';
import { turnKey } from './music.js';
import { storage } from './session.js';

const DEVICE = Object.freeze({ id: 'fragment', name: 'Dit toestel', local: true });
// Geen geluid bij de host: alleen spelers met «Geluid op dit toestel» horen het.
const DEVICE_MUTE = Object.freeze({ id: 'fragment-mute', name: 'de gsm’s van de spelers', local: false });
const muteKey = (code) => `mt.mute.${code}`;
const TEST_MS = 8000;

let loading = null;

/** Het bronbestand met de ingebouwde lijsten, nagekeken (zie fragment/lists.js). */
export function loadFragments() {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}fragmenten.json`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`fragmenten.json: ${res.status}`);
        return res.json();
      })
      .then(cleanFragments)
      .catch((err) => {
        loading = null;
        throw new Error('De lijsten met fragmenten konden niet geladen worden. Probeer het opnieuw.', { cause: err });
      });
  }
  return loading;
}

export function useFragmentMusic({ enabled, view, send = () => false }) {
  const code = view?.code ?? null;
  // off: het geluid is nog niet ontgrendeld (of de browser weigerde); on: klaar;
  // mute: de host koos voor geen geluid op zijn toestel.
  const [local, setLocal] = useState(() => (code && storage.read(muteKey(code)) === true ? 'mute' : 'off'));
  const muteCode = useRef(code);
  if (muteCode.current !== code) {
    // Een ander spel: de keuze van dat spel.
    muteCode.current = code;
    const muted = code && storage.read(muteKey(code)) === true;
    if (muted && local !== 'mute') setLocal('mute');
    else if (!muted && local === 'mute') setLocal('off');
  }
  const localRef = useRef(local);
  localRef.current = local;
  const sendRef = useRef(send);
  sendRef.current = send;
  const [status, setStatus] = useState('idle'); // idle | starting | playing | paused | error
  const [error, setError] = useState('');
  // Wat de knop bij een fout doet: 'skip' (ander nummer) of 'replay'.
  const [errorAction, setErrorAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const key = turnKey(view);
  const trackId = key ? view.turn.trackId : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const trackRef = useRef(trackId);
  trackRef.current = trackId;
  const handled = useRef(null); // de beurt waarvoor deze pagina al startte
  const relayGen = useRef(0); // een nieuwere opvraging voor de spelers wint
  const refreshed = useRef(null); // de vraag om een vers adres die al beantwoord is
  const retried = useRef(null); // de beurt waarvoor het al één keer opnieuw probeerde na een wegval
  const startRef = useRef(null);

  const playerRef = useRef(null);
  if (!playerRef.current) {
    playerRef.current = createFragmentPlayer({
      onEvent: (e) => {
        // Het fragment viel weg terwijl het speelde: één keer opnieuw, dan een melding.
        if (e.type !== 'error' || e.trackId !== trackRef.current) return;
        if (retried.current === keyRef.current) {
          setStatus('error');
          setError(e.error.message);
          setErrorAction('skip');
          return;
        }
        retried.current = keyRef.current;
        startRef.current?.(e.trackId);
      },
    });
  }
  const player = playerRef.current;

  /** Het nummer dat nu loopt of net onthuld is (voor «Opnieuw afspelen» en voor de spelers). */
  const phase = view?.phase;
  const active = phase === 'playing' || phase === 'challenge' || phase === 'reveal';
  const currentTrackId = view?.turn?.trackId || view?.reveal?.card?.id || null;
  const currentRef = useRef(null);
  currentRef.current = active ? currentTrackId : null;

  /** Geeft het adres van het fragment van nu door aan de spelers die meeluisteren (via de server). */
  const relay = useCallback((id, url) => {
    if (!url || !id || id !== currentRef.current) return;
    sendRef.current({ t: 'sound', action: 'play', trackId: id, url });
  }, []);
  /** Pauze of verder spelen, ook voor wie meeluistert. */
  const relayState = useCallback((action) => {
    const id = currentRef.current;
    if (id) sendRef.current({ t: 'sound', action, trackId: id });
  }, []);

  /**
   * Zonder geluid hier: alleen het adres opvragen en doorgeven. Bij `mute`
   * meldt het een probleem zoals bij afspelen; zonder ontgrendeling (`off`)
   * zegt het niets: dan staat er al «Zet het geluid aan».
   */
  const relayOnly = useCallback(
    async (id) => {
      relayGen.current += 1;
      const gen = relayGen.current;
      const loud = localRef.current === 'mute';
      try {
        const url = await fetchPreview(id);
        if (gen !== relayGen.current) return false;
        relay(id, url);
        if (loud) setStatus('playing');
        return true;
      } catch (err) {
        if (gen !== relayGen.current || !loud) return false;
        setStatus('error');
        setError(err?.message || 'Het fragment speelt niet af.');
        setErrorAction(err?.kind === 'missing' ? 'skip' : 'replay');
        return false;
      }
    },
    [relay],
  );

  /** Start het fragment; meldt wat er misloopt. Een vervangen start zegt niets. */
  const start = useCallback(
    async (id) => {
      setStatus('starting');
      setError('');
      setErrorAction(null);
      if (localRef.current === 'mute') return relayOnly(id);
      relayGen.current += 1;
      try {
        await player.play(id);
        relay(id, player.urlFor(id));
        setStatus('playing');
        return true;
      } catch (err) {
        if (err?.stale) return false;
        if (err?.kind === 'blocked') {
          // De browser weigert hier het geluid, maar het adres is er: de anderen horen het wel.
          relay(id, player.urlFor(id));
          setLocal('off');
          setStatus('error');
          setError(BLOCKED);
          return false;
        }
        setStatus('error');
        setError(err?.message || 'Het fragment speelt niet af.');
        setErrorAction(err?.kind === 'missing' ? 'skip' : 'replay');
        return false;
      }
    },
    [player, relay, relayOnly],
  );
  startRef.current = start;

  const ready = enabled && (local === 'on' || local === 'mute');

  /**
   * «Zet het geluid aan»: één tik ontgrendelt het geluid. Loopt er een beurt,
   * dan begint het fragment daarvan meteen.
   */
  const chooseBrowser = useCallback(() => {
    if (code) storage.write(muteKey(code), null);
    setLocal('starting');
    localRef.current = 'starting';
    // Eerst en zonder await: de browser moet de tik nog zien.
    const unlocking = player.unlock();
    const k = keyRef.current;
    const id = trackRef.current;
    if (k && id) {
      handled.current = k;
      retried.current = null;
      setLocal('on');
      localRef.current = 'on';
      return start(id);
    }
    return unlocking.then((ok) => {
      setLocal(ok ? 'on' : 'off');
      if (ok) {
        setError((e) => (e === BLOCKED ? '' : e));
        setStatus((s) => (s === 'error' ? 'idle' : s));
      } else {
        setStatus('error');
        setError(BLOCKED);
      }
      return ok;
    });
  }, [player, start, code]);

  const sound = enabled ? view?.sound ?? null : null;
  const soundRef = useRef(sound);
  soundRef.current = sound;

  /** «Geen geluid op dit toestel»: de host maakt zelf geen geluid, de spelers die meeluisteren wel. */
  const chooseMute = useCallback(() => {
    if (code) storage.write(muteKey(code), true);
    player.stop();
    setLocal('mute');
    localRef.current = 'mute';
    setStatus('idle');
    setError('');
    setErrorAction(null);
    const k = keyRef.current;
    // Loopt er een beurt en heeft de server nog geen geluid, geef het dan nu door.
    if (enabled && k && trackRef.current && !soundRef.current) {
      handled.current = k;
      relayOnly(trackRef.current);
    }
  }, [player, code, enabled, relayOnly]);

  // Nieuwe beurt (of ander nummer) = nieuw fragment.
  useEffect(() => {
    if (!enabled || !key || handled.current === key || local === 'starting') return;
    handled.current = key;
    retried.current = null;
    if (local === 'on' || local === 'mute') {
      start(trackId);
      return;
    }
    // Het geluid hier staat (nog) uit: de spelers die meeluisteren, horen het
    // fragment toch. Heeft de server het al (de host herlaadde), dan niets: zo
    // begint het bij hen niet opnieuw.
    if (!soundRef.current) relayOnly(trackId);
  }, [enabled, local, key, trackId, start, relayOnly]);

  // Een speler die meeluistert, meldt dat het adres bij hem niet speelt
  // (misschien verlopen): vraag een vers adres en geef het door. De plaats in
  // het fragment blijft.
  const staleTag = sound?.stale ? `${sound.n}:${sound.r}` : null;
  useEffect(() => {
    const id = currentRef.current;
    if (!staleTag || !id || refreshed.current === staleTag) return;
    refreshed.current = staleTag;
    fetchPreview(id).then(
      (url) => {
        if (id === currentRef.current) sendRef.current({ t: 'sound', action: 'url', trackId: id, url });
      },
      () => {},
    );
  }, [staleTag]);

  // Spel afgelopen, terug in de wachtkamer of een andere bron gekozen: stil.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && (!active || !enabled)) {
      player.stop();
      setStatus('idle');
      setError('');
      setErrorAction(null);
    }
    wasActive.current = active && enabled;
  }, [active, enabled, player]);
  useEffect(() => {
    if (!enabled) player.stop();
  }, [enabled, player]);

  const replayRef = useRef(null);
  replayRef.current = { id: currentTrackId, key };

  /** «Opnieuw afspelen»: het fragment van nu, van voren, met een vers adres. */
  const replay = useCallback(() => {
    const { id, key: k } = replayRef.current;
    if (!id) return Promise.resolve(false);
    if (k) {
      handled.current = k;
      retried.current = null;
    }
    return start(id);
  }, [start]);

  const pause = useCallback(() => {
    player.pause();
    relayState('pause');
    setStatus('paused');
  }, [player, relayState]);

  const resume = useCallback(async () => {
    if (localRef.current === 'mute') {
      if (soundRef.current) {
        relayState('resume');
        setStatus('playing');
      } else await replay();
      return;
    }
    try {
      if (await player.resume()) {
        relayState('resume');
        setStatus('playing');
      } else await replay();
    } catch (err) {
      if (err?.kind === 'blocked') setLocal('off');
      setStatus('error');
      setError(err?.message || 'Het fragment speelt niet af.');
      setErrorAction(err?.kind === 'missing' ? 'skip' : 'replay');
    }
  }, [player, replay, relayState]);

  /** Geluidstest: een willekeurig fragment, een paar seconden. Niet tijdens een spel. */
  const test = useCallback(async () => {
    setBusy(true);
    try {
      const data = await loadFragments();
      if (data.tracks.length === 0) throw new Error('Er zijn nog geen fragmenten.');
      const pick = data.tracks[Math.floor(Math.random() * data.tracks.length)];
      if (await start(pick.id)) {
        await new Promise((r) => setTimeout(r, TEST_MS));
        // Begon intussen een spel, dan speelt dat al iets anders.
        if (player.trackId === pick.id && !keyRef.current) {
          player.stop();
          setStatus('idle');
        }
      }
    } catch (err) {
      setStatus('error');
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [player, start]);

  // Zonder geluid hier volgt de status wat de spelers die meeluisteren horen.
  let shownStatus = status;
  if (local === 'mute' && status !== 'error' && status !== 'starting') {
    shownStatus = sound ? (sound.playing ? 'playing' : 'paused') : 'idle';
  }

  const noop = useCallback(() => {}, []);
  return {
    kind: 'fragment',
    configured: true,
    loggedIn: false,
    devices: null,
    device: local === 'mute' ? DEVICE_MUTE : DEVICE,
    ready,
    browserSupported: false,
    local,
    chooseBrowser,
    chooseMute,
    status: shownStatus,
    error,
    errorAction,
    wrong: null,
    busy,
    currentTrackId,
    inGame: active,
    login: noop,
    logout: noop,
    refreshDevices: noop,
    chooseDevice: noop,
    replay,
    pause,
    resume,
    test,
  };
}
