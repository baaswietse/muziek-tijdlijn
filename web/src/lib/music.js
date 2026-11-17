// Muziek op de gsm van de host: houdt bij of Spotify klaar is (ingelogd,
// toestel gekozen) en start vanzelf het nummer van elke nieuwe beurt.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { player } from '../spotify/index.js';
import { BROWSER_PLAYER_NAME, preloadBrowserPlayer, startBrowserPlayer, stopBrowserPlayer } from '../spotify/browser-player.js';
import { storage } from './session.js';

const DEVICE = 'mt.device';
const LAST_PLAYED = 'mt.lastPlayed';

export function useMusic({ enabled, view }) {
  const [loggedIn, setLoggedIn] = useState(() => player.isLoggedIn());
  const [devices, setDevices] = useState(null); // null = nog niet opgevraagd
  const [device, setDevice] = useState(() => storage.read(DEVICE));
  const [status, setStatus] = useState('idle'); // idle | starting | playing | paused | error
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // De speler in deze browser zelf: off | starting | on. Na herladen is hij
  // weg, ook al staat «dit toestel» nog als keuze bewaard.
  const [local, setLocal] = useState('off');
  const deviceRef = useRef(device);
  deviceRef.current = device;

  // Afspelen in de browser bestaat alleen bij de echte Spotify-laag.
  const browserSupported = player.kind === 'connect';
  const ready = enabled && loggedIn && Boolean(device) && (!device.local || local === 'on');

  const fail = useCallback((err) => {
    if (err?.loginRequired) setLoggedIn(false);
    setStatus('error');
    setError(err?.message || 'Er liep iets mis met Spotify.');
  }, []);

  const chooseDevice = useCallback((d) => {
    const chosen = d ? { id: d.id, name: d.name, ...(d.local ? { local: true } : {}) } : null;
    if (!chosen?.local) {
      // Een ander toestel gekozen: de speler in de browser is niet meer nodig.
      stopBrowserPlayer();
      setLocal('off');
    }
    storage.write(DEVICE, chosen);
    setDevice(chosen);
    setError('');
    setStatus('idle');
  }, []);

  /** De host kiest «dit toestel»: start de Spotify-speler in deze browser. */
  const chooseBrowser = useCallback(async () => {
    setLocal('starting');
    setError('');
    try {
      const { id } = await startBrowserPlayer({
        onLost: () => {
          setLocal('off');
          setStatus('error');
          setError('Het geluid op dit toestel is weggevallen. Tik op «Dit toestel» om het weer aan te zetten.');
        },
        onError: (err) => fail(err),
      });
      chooseDevice({ id, name: 'Dit toestel', local: true });
      setLocal('on');
    } catch (err) {
      setLocal('off');
      fail(err);
    }
  }, [chooseDevice, fail]);

  /** Haalt de lijst met toestellen op. `quiet`: fouten niet tonen (automatisch verversen). */
  const refreshDevices = useCallback(async (opts) => {
    const quiet = opts?.quiet === true;
    setBusy(true);
    try {
      // De speler in deze browser staat apart bovenaan en hoort niet in de lijst.
      const list = (await player.devices()).filter((d) => d.name !== BROWSER_PLAYER_NAME);
      setDevices(list);
      setError('');
      // Spotify geeft een toestel soms een nieuw id; herken het aan zijn naam.
      const current = deviceRef.current;
      if (current && !current.local && !list.some((d) => d.id === current.id)) {
        const same = list.find((d) => d.name === current.name);
        if (same) chooseDevice(same);
      }
      return list;
    } catch (err) {
      if (!quiet) fail(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [chooseDevice, fail]);

  const login = useCallback(async () => {
    setError('');
    try {
      await player.login(); // de echte laag verlaat hier de pagina
      setLoggedIn(player.isLoggedIn());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const logout = useCallback(() => {
    stopBrowserPlayer();
    setLocal('off');
    player.logout();
    setLoggedIn(false);
    setDevices(null);
    setStatus('idle');
    setError('');
  }, []);

  /** Speelt een nummer; zoekt het toestel één keer opnieuw op als het weg is. */
  const playTrack = useCallback(
    async (trackId, opts) => {
      const current = deviceRef.current;
      if (!current) return fail({ message: 'Kies eerst een toestel om op af te spelen.' });
      setStatus('starting');
      setError('');
      try {
        await player.play(trackId, current.id, opts);
        setStatus('playing');
      } catch (err) {
        if (err?.deviceGone && current.local) {
          // Een pas gestarte speler in de browser is soms nog niet bekend bij
          // Spotify: even wachten en opnieuw proberen voor we opgeven.
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise((r) => setTimeout(r, 700));
            if (deviceRef.current?.id !== current.id) return;
            try {
              await player.play(trackId, current.id, opts);
              setStatus('playing');
              return;
            } catch (again) {
              if (!again?.deviceGone) return fail(again);
            }
          }
          setLocal('off');
          return fail({ message: 'Het geluid op dit toestel is weggevallen. Tik op «Dit toestel» om het weer aan te zetten.' });
        }
        if (err?.deviceGone) {
          try {
            const list = await player.devices();
            setDevices(list);
            const same = list.find((d) => d.name === current.name && d.id !== current.id);
            if (same) {
              chooseDevice(same);
              await player.play(trackId, same.id, opts);
              setStatus('playing');
              return;
            }
          } catch (again) {
            return fail(again);
          }
        }
        fail(err);
      }
    },
    [chooseDevice, fail],
  );

  const pause = useCallback(async () => {
    try {
      await player.pause(deviceRef.current?.id);
      setStatus('paused');
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const resume = useCallback(async () => {
    try {
      await player.resume(deviceRef.current?.id);
      setStatus('playing');
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  /** Geluidstest: een willekeurig nummer uit de lijst, een paar seconden. */
  const test = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}tracks.json`, { cache: 'no-store' });
      const tracks = await res.json();
      if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('tracks.json is leeg.');
      const pick = tracks[Math.floor(Math.random() * tracks.length)];
      await playTrack(pick.id, { positionMs: 30_000 });
      await new Promise((r) => setTimeout(r, 8000));
      await player.pause(deviceRef.current?.id).catch(() => {});
      setStatus((s) => (s === 'playing' ? 'idle' : s));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [playTrack, fail]);

  // Toestellen ophalen zodra de host ingelogd is.
  useEffect(() => {
    if (enabled && loggedIn && devices === null) refreshDevices();
  }, [enabled, loggedIn, devices, refreshDevices]);

  // De speler voor «dit toestel» alvast laden, zodat hij klaar is bij de tik.
  useEffect(() => {
    if (enabled && loggedIn && browserSupported) preloadBrowserPlayer().catch(() => {});
  }, [enabled, loggedIn, browserSupported]);

  // De host opent vaak even de Spotify-app om een toestel zichtbaar te maken en
  // komt dan terug: ververs de lijst op dat moment vanzelf.
  useEffect(() => {
    if (!enabled || !loggedIn) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshDevices({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, loggedIn, refreshDevices]);

  // Nieuwe beurt = nieuw nummer. De sleutel wordt onthouden, zodat het nummer
  // niet opnieuw begint als de host de pagina herlaadt of even weg was.
  const trackId = view?.phase === 'playing' ? view.turn?.trackId : null;
  const key = trackId ? `${view.code}:${view.game}:${view.turn.number}:${trackId}` : null;

  // Speelt de browser zelf, dan viel het geluid weg bij het herladen. Zet de
  // host «dit toestel» weer aan tijdens een beurt, begin het nummer dan opnieuw.
  // (Bij een beurt die nog niet gestart was, doet het effect hieronder dat.)
  const localWasOn = useRef(false);
  useEffect(() => {
    const turnedOn = local === 'on' && !localWasOn.current;
    localWasOn.current = local === 'on';
    if (turnedOn && ready && key && storage.read(LAST_PLAYED) === key) playTrack(trackId);
  }, [local, ready, key, trackId, playTrack]);

  useEffect(() => {
    if (!ready || !key) return;
    if (storage.read(LAST_PLAYED) === key) return;
    storage.write(LAST_PLAYED, key);
    playTrack(trackId);
  }, [ready, key, trackId, playTrack]);

  // Spel afgelopen of terug in de wachtkamer: Spotify weer normaal zetten.
  const phase = view?.phase;
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const active = phase === 'playing' || phase === 'reveal';
    if (wasPlaying.current && !active && deviceRef.current) player.release(deviceRef.current.id);
    wasPlaying.current = active;
  }, [enabled, phase]);

  /** Het nummer dat nu loopt of net onthuld is (voor "opnieuw afspelen"). */
  const currentTrackId = view?.turn?.trackId || view?.reveal?.card?.id || null;

  return {
    kind: player.kind,
    configured: player.configured(),
    loggedIn,
    devices,
    device,
    ready,
    browserSupported,
    local,
    chooseBrowser,
    status,
    error,
    busy,
    currentTrackId,
    login,
    logout,
    refreshDevices,
    chooseDevice,
    playTrack,
    pause,
    resume,
    test,
  };
}
