// Muziek met fragmenten van Deezer (30 seconden, zonder account) op de gsm
// van de host: het geluid komt uit zijn browser. Zelfde vorm als useMusic
// (Spotify), zodat de schermen beide op dezelfde manier tonen.
//
// Het ophalen en afspelen zelf staat in ../fragment/ en weet niets van de
// host: later kan een andere gsm het ook gebruiken.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createFragmentPlayer, BLOCKED } from '../fragment/player.js';
import { cleanFragments } from '../fragment/lists.js';
import { turnKey } from './music.js';

const DEVICE = Object.freeze({ id: 'fragment', name: 'Dit toestel', local: true });
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

export function useFragmentMusic({ enabled, view }) {
  // off: het geluid is nog niet ontgrendeld (of de browser weigerde); on: klaar.
  const [local, setLocal] = useState('off');
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

  /** Start het fragment; meldt wat er misloopt. Een vervangen start zegt niets. */
  const start = useCallback(
    async (id) => {
      setStatus('starting');
      setError('');
      setErrorAction(null);
      try {
        await player.play(id);
        setStatus('playing');
        return true;
      } catch (err) {
        if (err?.stale) return false;
        if (err?.kind === 'blocked') {
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
    [player],
  );
  startRef.current = start;

  const ready = enabled && local === 'on';

  /**
   * «Zet het geluid aan»: één tik ontgrendelt het geluid. Loopt er een beurt,
   * dan begint het fragment daarvan meteen.
   */
  const chooseBrowser = useCallback(() => {
    setLocal('starting');
    // Eerst en zonder await: de browser moet de tik nog zien.
    const unlocking = player.unlock();
    const k = keyRef.current;
    const id = trackRef.current;
    if (k && id) {
      handled.current = k;
      retried.current = null;
      setLocal('on');
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
  }, [player, start]);

  // Nieuwe beurt (of ander nummer) = nieuw fragment.
  useEffect(() => {
    if (!ready || !key || handled.current === key) return;
    handled.current = key;
    retried.current = null;
    start(trackId);
  }, [ready, key, trackId, start]);

  // Spel afgelopen, terug in de wachtkamer of een andere bron gekozen: stil.
  const phase = view?.phase;
  const active = phase === 'playing' || phase === 'challenge' || phase === 'reveal';
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

  /** Het nummer dat nu loopt of net onthuld is (voor «Opnieuw afspelen»). */
  const currentTrackId = view?.turn?.trackId || view?.reveal?.card?.id || null;
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
    setStatus('paused');
  }, [player]);

  const resume = useCallback(async () => {
    try {
      if (await player.resume()) setStatus('playing');
      else await replay();
    } catch (err) {
      if (err?.kind === 'blocked') setLocal('off');
      setStatus('error');
      setError(err?.message || 'Het fragment speelt niet af.');
      setErrorAction(err?.kind === 'missing' ? 'skip' : 'replay');
    }
  }, [player, replay]);

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

  const noop = useCallback(() => {}, []);
  return {
    kind: 'fragment',
    configured: true,
    loggedIn: false,
    devices: null,
    device: DEVICE,
    ready,
    browserSupported: false,
    local,
    chooseBrowser,
    status,
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
