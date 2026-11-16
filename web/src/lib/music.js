// Muziek op de gsm van de host: houdt bij of Spotify klaar is (ingelogd,
// toestel gekozen) en start vanzelf het nummer van elke nieuwe beurt.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { player } from '../spotify/index.js';
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
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const ready = enabled && loggedIn && Boolean(device);

  const fail = useCallback((err) => {
    if (err?.loginRequired) setLoggedIn(false);
    setStatus('error');
    setError(err?.message || 'Er liep iets mis met Spotify.');
  }, []);

  const chooseDevice = useCallback((d) => {
    const chosen = d ? { id: d.id, name: d.name } : null;
    storage.write(DEVICE, chosen);
    setDevice(chosen);
    setError('');
    setStatus('idle');
  }, []);

  const refreshDevices = useCallback(async () => {
    setBusy(true);
    try {
      const list = await player.devices();
      setDevices(list);
      setError('');
      // Spotify geeft een toestel soms een nieuw id; herken het aan zijn naam.
      const current = deviceRef.current;
      if (current && !list.some((d) => d.id === current.id)) {
        const same = list.find((d) => d.name === current.name);
        if (same) chooseDevice(same);
      }
      return list;
    } catch (err) {
      fail(err);
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

  // Nieuwe beurt = nieuw nummer. De sleutel wordt onthouden, zodat het nummer
  // niet opnieuw begint als de host de pagina herlaadt of even weg was.
  const trackId = view?.phase === 'playing' ? view.turn?.trackId : null;
  const key = trackId ? `${view.code}:${view.game}:${view.turn.number}:${trackId}` : null;
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
