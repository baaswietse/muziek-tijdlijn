// Muziek op de gsm van de host: houdt bij of Spotify klaar is (ingelogd,
// toestel gekozen) en start vanzelf het nummer van elke nieuwe beurt. Het
// starten zelf (één commando tegelijk, nakijken wat er echt speelt, opnieuw
// proberen) staat in playback.js.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { player } from '../spotify/index.js';
import { SpotifyError } from '../spotify/connect.js';
import {
  BROWSER_PLAYER_NAME,
  browserPlayerState,
  pauseBrowserPlayer,
  preloadBrowserPlayer,
  startBrowserPlayer,
  stopBrowserPlayer,
} from '../spotify/browser-player.js';
import { Stale, createPlayback, playsExpected } from './playback.js';
import { storage } from './session.js';

const DEVICE = 'mt.device';
const LAST_PLAYED = 'mt.lastPlayed';
const LOCAL_GONE = 'Het geluid op dit toestel is weggevallen. Tik op «Dit toestel» om het weer aan te zetten.';
// Zo lang mag de speler in de browser weg zijn voor het spel hem als
// weggevallen beschouwt: Spotify verbindt hem vaak vanzelf opnieuw.
const LOCAL_GRACE = 8000;
// Zo vaak per beurt grijpt het spel zelf in als de speler in de browser een
// ander nummer meldt; daarna alleen nog een waarschuwing.
const MAX_REPAIRS = 3;

/** De sleutel van een lopende beurt: kamer, spel, beurt en nummer (of null). */
export function turnKey(view) {
  const running = view?.phase === 'playing' || view?.phase === 'challenge';
  const trackId = running ? view.turn?.trackId : null;
  return trackId ? `${view.code}:${view.game}:${view.turn.number}:${trackId}` : null;
}

export function useMusic({ enabled, view }) {
  const [loggedIn, setLoggedIn] = useState(() => player.isLoggedIn());
  const [devices, setDevices] = useState(null); // null = nog niet opgevraagd
  const [device, setDevice] = useState(() => storage.read(DEVICE));
  const [status, setStatus] = useState('idle'); // idle | starting | playing | paused | error | wrong
  const [error, setError] = useState('');
  // Speelt er iets anders dan het nummer van deze beurt: 'wrong' (een ander
  // nummer) of 'unknown' (Spotify meldt niet wat er speelt). Nooit welk nummer.
  const [wrong, setWrong] = useState(null);
  const [busy, setBusy] = useState(false);
  // De speler in deze browser zelf: off | starting | on. Na herladen is hij
  // weg, ook al staat «dit toestel» nog als keuze bewaard.
  const [local, setLocal] = useState('off');
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Afspelen in de browser bestaat alleen bij de echte Spotify-laag.
  const browserSupported = player.kind === 'connect';
  const ready = enabled && loggedIn && Boolean(device) && (!device.local || local === 'on');

  const fail = useCallback((err) => {
    if (err?.loginRequired) setLoggedIn(false);
    setStatus('error');
    setWrong(null);
    setError(err?.message || 'Er liep iets mis met Spotify.');
  }, []);

  /** `keepStatus`: hetzelfde toestel met een nieuw id; wat er speelt, loopt gewoon door. */
  const chooseDevice = useCallback((d, { keepStatus = false } = {}) => {
    const chosen = d ? { id: d.id, name: d.name, ...(d.local ? { local: true } : {}) } : null;
    if (!chosen?.local) {
      // Een ander toestel gekozen: de speler in de browser is niet meer nodig.
      stopBrowserPlayer();
      setLocal('off');
    }
    storage.write(DEVICE, chosen);
    deviceRef.current = chosen;
    setDevice(chosen);
    if (keepStatus) return;
    setError('');
    setWrong(null);
    setStatus('idle');
  }, []);

  const playbackRef = useRef(null);
  const keyRef = useRef(null); // de sleutel van de lopende beurt, als er afgespeeld kan worden
  const lostTimer = useRef(null);
  const repairs = useRef({ key: null, count: 0 });

  /** De host kiest «dit toestel»: start de Spotify-speler in deze browser. */
  const chooseBrowser = useCallback(async () => {
    setLocal('starting');
    setError('');
    clearTimeout(lostTimer.current);
    try {
      const { id } = await startBrowserPlayer({
        onLost: () => {
          // Even weg: vaak komt hij vanzelf terug (onBack). Pas na een tijdje
          // geeft het spel het op en zet het stil wat er nog speelt, zodat het
          // vorige nummer niet blijft herhalen terwijl het spel verder gaat.
          clearTimeout(lostTimer.current);
          lostTimer.current = setTimeout(() => {
            pauseBrowserPlayer();
            setLocal('off');
            setStatus('error');
            setError(LOCAL_GONE);
          }, LOCAL_GRACE);
        },
        onBack: (newId) => {
          clearTimeout(lostTimer.current);
          // Opnieuw klaar, soms met een ander id: dat id gebruiken en nakijken
          // of het nummer van deze beurt nog speelt (zo niet: opnieuw starten).
          chooseDevice({ id: newId, name: 'Dit toestel', local: true }, { keepStatus: true });
          setLocal('on');
          setError((e) => (e === LOCAL_GONE ? '' : e));
          if (keyRef.current) playbackRef.current?.check({ repairUnknown: true });
        },
        onState: (state) => {
          // De speler meldt zelf een ander nummer dan verwacht (bv. het vorige
          // nummer dat opnieuw begint): nakijken en zo nodig herstellen.
          const pb = playbackRef.current;
          const expected = pb?.expected;
          const k = keyRef.current;
          // Tijdens het starten kijkt playback.js zelf na; die meldingen tellen niet.
          if (statusRef.current === 'starting' || statusRef.current === 'paused') return;
          if (!expected || !k || expected.key !== k || !state?.trackId || playsExpected(expected.trackId, state)) return;
          if (repairs.current.key !== k) repairs.current = { key: k, count: 0 };
          repairs.current.count += 1;
          pb.check({ repair: repairs.current.count <= MAX_REPAIRS });
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
      if (!quiet) setError('');
      // Spotify geeft een toestel soms een nieuw id; herken het aan zijn naam.
      const current = deviceRef.current;
      if (current && !current.local && !list.some((d) => d.id === current.id)) {
        const same = list.find((d) => d.name === current.name);
        if (same) chooseDevice(same, { keepStatus: true });
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
    playbackRef.current?.forget();
    stopBrowserPlayer();
    setLocal('off');
    player.logout();
    setLoggedIn(false);
    setDevices(null);
    setStatus('idle');
    setWrong(null);
    setError('');
  }, []);

  /**
   * Eén startcommando naar het gekozen toestel; zoekt het toestel één keer
   * opnieuw op als het weg is. `isCurrent()`: hoort dit nog bij het verwachte
   * nummer? Zo niet, dan stopt het: een verouderd commando mag nooit na een
   * nieuwer komen.
   */
  const playOn = useCallback(
    async (trackId, opts, isCurrent = () => true) => {
      const current = deviceRef.current;
      if (!current) throw new SpotifyError('Kies eerst een toestel om op af te spelen.');
      try {
        await player.play(trackId, current.id, opts);
      } catch (err) {
        if (err?.deviceGone && current.local) {
          // Een pas gestarte speler in de browser is soms nog niet bekend bij
          // Spotify: even wachten en opnieuw proberen voor we opgeven.
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise((r) => setTimeout(r, 700));
            if (!isCurrent()) throw new Stale();
            const now = deviceRef.current;
            if (!now?.local) throw err;
            try {
              await player.play(trackId, now.id, opts);
              return;
            } catch (again) {
              if (!again?.deviceGone) throw again;
            }
          }
          setLocal('off');
          throw new SpotifyError(LOCAL_GONE, { deviceGone: true });
        }
        if (err?.deviceGone) {
          const list = await player.devices();
          if (!isCurrent()) throw new Stale();
          setDevices(list.filter((d) => d.name !== BROWSER_PLAYER_NAME));
          const same = list.find((d) => d.name === current.name && d.id !== current.id);
          if (same) {
            chooseDevice(same, { keepStatus: true });
            await player.play(trackId, same.id, opts);
            return;
          }
        }
        throw err;
      }
    },
    [chooseDevice],
  );
  const playOnRef = useRef(playOn);
  playOnRef.current = playOn;

  // De afspeelregeling (wachtrij, controle na het starten): één per pagina.
  if (!playbackRef.current) {
    playbackRef.current = createPlayback(
      {
        play: (trackId, opts, isCurrent) => playOnRef.current(trackId, opts, isCurrent),
        async state() {
          const current = deviceRef.current;
          if (current?.local) {
            // De speler in deze browser zegt zelf wat hij speelt: geen verzoek nodig.
            const own = await browserPlayerState();
            if (own) return own;
          }
          return player.state ? player.state(current?.id) : null;
        },
        repeat: async (mode) => player.repeat?.(mode, deviceRef.current?.id),
        pause: () => player.pause(deviceRef.current?.id),
        resume: () => player.resume(deviceRef.current?.id),
        deviceId: () => deviceRef.current?.id || null,
      },
      {
        status: setStatus,
        error: (err) => {
          if (!err) {
            setError('');
            setWrong(null);
          } else if (err.wrong) {
            setWrong(err.unknown ? 'unknown' : 'wrong');
            setError('');
          } else {
            setWrong(null);
            if (err.loginRequired) setLoggedIn(false);
            setError(err.message || 'Er liep iets mis met Spotify.');
          }
        },
        confirmed: (key) => {
          if (key) storage.write(LAST_PLAYED, key);
        },
      },
      player.timing,
    );
  }
  const playback = playbackRef.current;

  const pause = useCallback(() => playback.pause(), [playback]);
  const resume = useCallback(() => playback.resume(), [playback]);

  /** Geluidstest: een willekeurig nummer uit de lijst, een paar seconden. Niet tijdens een spel. */
  const test = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}tracks.json`, { cache: 'no-store' });
      const tracks = await res.json();
      if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('tracks.json is leeg.');
      const pick = tracks[Math.floor(Math.random() * tracks.length)];
      const ok = await playback.start(pick.id, { key: null, positionMs: 30_000 });
      if (ok) {
        await new Promise((r) => setTimeout(r, 8000));
        // Begon intussen een spel, dan vervalt dit: de wachtrij slaat het over.
        await playback
          .run(async () => {
            await player.pause(deviceRef.current?.id).catch(() => {});
            playback.forget();
            setStatus('idle');
          })
          .catch(() => {});
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [playback, fail]);

  // Toestellen ophalen zodra de host ingelogd is.
  useEffect(() => {
    if (enabled && loggedIn && devices === null) refreshDevices();
  }, [enabled, loggedIn, devices, refreshDevices]);

  // De speler voor «dit toestel» alvast laden, zodat hij klaar is bij de tik.
  useEffect(() => {
    if (enabled && loggedIn && browserSupported) preloadBrowserPlayer().catch(() => {});
  }, [enabled, loggedIn, browserSupported]);

  // Nieuwe beurt = nieuw nummer. Pas als Spotify bevestigt dat het speelt,
  // wordt de sleutel onthouden (mt.lastPlayed): herlaadt de host daarna, dan
  // begint het niet opnieuw, maar kijkt het spel wel na of het nog klopt.
  // In de tussenfase (tokens inzetten) loopt dezelfde beurt verder: dezelfde
  // sleutel, dus het nummer start niet opnieuw.
  const key = turnKey(view);
  const trackId = key ? view.turn.trackId : null;
  keyRef.current = ready ? key : null;
  const handled = useRef(null); // de laatste beurt waarvoor deze pagina iets deed

  // De host opent vaak even de Spotify-app om een toestel zichtbaar te maken en
  // komt dan terug: ververs de lijst op dat moment vanzelf. Tijdens een beurt
  // kijkt het spel dan ook na of het nummer van deze beurt nog speelt (één
  // verzoek; niets als het klopt).
  useEffect(() => {
    if (!enabled || !loggedIn) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refreshDevices({ quiet: true });
      const s = statusRef.current;
      if (keyRef.current && playback.expected?.key === keyRef.current && (s === 'playing' || s === 'wrong')) playback.check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, loggedIn, refreshDevices, playback]);

  // Speelt de browser zelf, dan viel het geluid weg bij het herladen of met de
  // speler. Zet de host «dit toestel» weer aan tijdens een beurt, begin het
  // nummer dan opnieuw. (Bij een nieuwe beurt doet het effect hieronder dat.)
  const localWasOn = useRef(false);
  useEffect(() => {
    const turnedOn = local === 'on' && !localWasOn.current;
    localWasOn.current = local === 'on';
    if (turnedOn && ready && key && (handled.current === key || storage.read(LAST_PLAYED) === key)) {
      handled.current = key;
      repairs.current = { key, count: 0 };
      playback.start(trackId, { key });
    }
  }, [local, ready, key, trackId, playback]);

  useEffect(() => {
    if (!key) return;
    if (!ready) {
      // Een nieuwe beurt, maar het spel kan niet afspelen (speler in de
      // browser weg, uitgelogd, geen toestel). Wat er dan nog klinkt, is het
      // vorige nummer: speelt de browser zelf, dan zet het spel dat stil.
      if (handled.current !== key && playback.expected) {
        playback.forget();
        if (deviceRef.current?.local) pauseBrowserPlayer();
      }
      return;
    }
    if (handled.current === key) return;
    const reloaded = handled.current === null;
    handled.current = key;
    repairs.current = { key, count: 0 };
    const last = storage.read(LAST_PLAYED);
    if (reloaded && last === key) {
      // Herladen tijdens de beurt: het nummer werd al bevestigd. Niet opnieuw
      // starten, wel één keer nakijken of het nog speelt.
      playback.adopt(trackId, { key });
      return;
    }
    // Het nummer van de vorige beurt (ook van voor een herlaad) telt bij het
    // nakijken als «vorig nummer».
    if (typeof last === 'string') playback.remember(last.split(':').pop());
    playback.start(trackId, { key });
  }, [ready, key, trackId, playback]);

  // Spel afgelopen of terug in de wachtkamer: Spotify weer normaal zetten.
  const phase = view?.phase;
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const active = phase === 'playing' || phase === 'challenge' || phase === 'reveal';
    if (wasPlaying.current && !active) {
      if (deviceRef.current) playback.release();
      else playback.forget();
      setWrong(null);
    }
    wasPlaying.current = active;
  }, [enabled, phase, playback]);

  // Deze gsm is geen host meer (de rol doorgegeven of overgenomen) of koos een
  // andere bron: wat hij nog liet spelen, zet hij stil. De nieuwe host start
  // het nummer van de beurt zelf, op zijn eigen toestel.
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    const lost = wasEnabled.current && !enabled;
    wasEnabled.current = enabled;
    if (!lost || !playback.expected) return;
    const id = deviceRef.current?.id;
    playback.forget();
    handled.current = null;
    if (deviceRef.current?.local) pauseBrowserPlayer();
    else if (loggedIn) Promise.resolve().then(() => player.pause(id)).catch(() => {});
    setStatus('idle');
    setWrong(null);
  }, [enabled, playback, loggedIn]);

  /** Het nummer dat nu loopt of net onthuld is (voor «Opnieuw afspelen»). */
  const currentTrackId = view?.turn?.trackId || view?.reveal?.card?.id || null;
  const replayRef = useRef(null);
  replayRef.current = { trackId: currentTrackId, key };

  /**
   * «Opnieuw afspelen» en «Start het juiste nummer»: het nummer van nu, van
   * voren. Het nummer wordt pas bij de tik gelezen, zodat een knop van een
   * vorige weergave nooit het nummer van de vorige beurt start.
   */
  const replay = useCallback(() => {
    const { trackId: id, key: k } = replayRef.current;
    if (!id) return Promise.resolve(false);
    if (k) {
      handled.current = k;
      repairs.current = { key: k, count: 0 };
    }
    return playback.start(id, { key: k });
  }, [playback]);

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
    wrong,
    busy,
    currentTrackId,
    inGame: phase === 'playing' || phase === 'challenge' || phase === 'reveal',
    login,
    logout,
    refreshDevices,
    chooseDevice,
    replay,
    pause,
    resume,
    test,
  };
}
