// «Geluid op dit toestel» voor een speler die geen host is: om op afstand mee
// te spelen. Alleen als de host met fragmenten van Deezer speelt; met Spotify
// blijft het geluid bij de host.
//
// - De keuze blijft bewaard op deze gsm, voor dit spel (`mt.listen.<code>`).
//   Standaard uit.
// - Staat ze aan, dan vraagt de gsm de server om het geluid
//   (`{ t: 'listen', on: true }`, bij elke verbinding opnieuw). De server
//   stuurt dan alleen het adres van het fragment en waar het staat
//   (`{ t: 'sound', sound: { n, url, playing, pos } }`), nooit het nummer zelf.
//   Deze browser spreekt de API van Deezer dus niet aan: hij speelt alleen dat
//   adres.
// - Gelijk lopen: zie ../fragment/sync.js. Bij elk bericht en om de paar
//   seconden kijkt de gsm na of hij nog gelijk loopt, en springt hij bij als
//   het meer dan een paar tienden verschilt.
// - Een browser speelt geen geluid zonder aanraking: de keuze aanzetten is die
//   aanraking. Na een herlaad, of als de browser het toch weigert, staat er op
//   het spelscherm een knop om het geluid weer aan te zetten.
// - Speelt het fragment hier niet, dan ziet alleen deze speler dat, met
//   «Probeer opnieuw». Is het adres misschien verlopen, dan vraagt de gsm (via
//   de server) de host om een vers adres; komt dat, dan probeert hij vanzelf
//   opnieuw.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createFragmentPlayer } from '../fragment/player.js';
import { FragmentError } from '../fragment/deezer.js';
import { expectedPosition, needsSeek, wrap } from '../fragment/sync.js';
import { storage } from './session.js';

const keyFor = (code) => `mt.listen.${code}`;
const CHECK_EVERY = 5000;

export const LISTEN_BLOCKED = 'Je browser liet het geluid niet toe. Tik op «Zet het geluid aan».';
export const LISTEN_LOCKED = 'Het geluid op dit toestel staat nog uit.';
export const LISTEN_FAILED = 'Het fragment speelt niet op dit toestel.';
export const LISTEN_OFFLINE = 'Het fragment laadt niet: controleer je verbinding.';

/**
 * `incoming`: het laatste geluidsbericht van de server ({ sound, receivedAt })
 * of null; `latency()`: hoe lang een bericht onderweg is (s).
 */
export function useListen({ view, send, net, incoming, latency }) {
  const code = view?.code ?? null;
  const isHost = Boolean(view && view.you === view.hostId);
  // Alleen voor spelers die geen host zijn, en alleen bij een spel met fragmenten.
  const available = Boolean(view) && !isHost && view.playlist?.source === 'fragment';

  const [wanted, setWantedState] = useState(() => (code ? storage.read(keyFor(code)) === true : false));
  const wantedCode = useRef(code);
  if (wantedCode.current !== code) {
    // Een ander spel: de keuze van dat spel.
    wantedCode.current = code;
    const w = code ? storage.read(keyFor(code)) === true : false;
    if (w !== wanted) setWantedState(w);
  }
  const [local, setLocal] = useState('off'); // off: nog niet ontgrendeld (of geweigerd); on: mag spelen
  const [status, setStatus] = useState('idle'); // idle | waiting | starting | playing | paused | error
  const [error, setError] = useState('');

  const active = available && wanted;
  const activeRef = useRef(active);
  activeRef.current = active;
  const unlocked = useRef(false);
  const msgRef = useRef(incoming);
  msgRef.current = incoming;
  const latencyRef = useRef(latency);
  latencyRef.current = latency;
  // Wat het element nu speelt of probeerde: { n, url, failed, idle }.
  const playing = useRef(null);
  const reported = useRef(new Set());
  const sendRef = useRef(send);
  sendRef.current = send;

  const playerRef = useRef(null);
  if (!playerRef.current) {
    playerRef.current = createFragmentPlayer({
      // Het adres komt van de server, nooit van Deezer zelf.
      fetch: async () => {
        const url = msgRef.current?.sound?.url;
        if (!url) throw new FragmentError(LISTEN_FAILED, 'missing');
        return url;
      },
      onEvent: (e) => {
        if (e.type === 'error') failed(e.error);
      },
    });
  }
  const player = playerRef.current;

  function failed(err) {
    const cur = playing.current;
    if (cur) playing.current = { ...cur, failed: true };
    setStatus('error');
    if (err?.kind === 'blocked') {
      unlocked.current = false;
      setLocal('off');
      setError(LISTEN_BLOCKED);
      return;
    }
    setError(err?.kind === 'network' ? LISTEN_OFFLINE : LISTEN_FAILED);
    // Misschien verlopen: één keer per adres de host om een vers adres vragen.
    const tag = cur ? `${cur.n}:${cur.url}` : null;
    if (err?.kind === 'missing' && tag && !reported.current.has(tag)) {
      reported.current.add(tag);
      sendRef.current({ t: 'soundFail', n: cur.n });
    }
  }

  /** Zet het element op de plaats waar het nu hoort te staan (en pauzeert of speelt verder). */
  async function sync() {
    const msg = msgRef.current;
    const s = msg?.sound;
    const cur = playing.current;
    if (!s || !cur || cur.n !== s.n || cur.failed || cur.idle) return;
    const duration = player.duration;
    if (!s.playing) {
      if (!player.paused) player.pause();
      if (needsSeek(player.position, s.pos, duration)) player.seek(wrap(s.pos, duration));
      setStatus('paused');
      return;
    }
    if (player.paused) {
      try {
        await player.resume();
      } catch (err) {
        failed(err);
        return;
      }
    }
    const expected = expectedPosition(s, { receivedAt: msg.receivedAt, now: performance.now(), latency: latencyRef.current?.() ?? 0 });
    if (needsSeek(player.position, expected, player.duration)) player.seek(wrap(expected, player.duration));
    setStatus('playing');
  }

  /** Volgt het laatste bericht van de server. `force`: opnieuw beginnen (Probeer opnieuw). */
  const apply = useCallback(async (force = false) => {
    if (!activeRef.current || !unlocked.current) return;
    const s = msgRef.current?.sound ?? null;
    if (!s) {
      // Niets te horen (nog geen fragment, of de host vraagt een ander nummer).
      if (playing.current) player.stop();
      playing.current = null;
      setStatus('waiting');
      setError('');
      return;
    }
    const cur = playing.current;
    const fresh = force || !cur || cur.n !== s.n || cur.idle || (cur.failed && cur.url !== s.url);
    if (!fresh) {
      await sync();
      return;
    }
    if (!s.playing) {
      // Gepauzeerd bij de host: nog niets laden, pas bij verder spelen.
      player.stop();
      playing.current = { n: s.n, url: s.url, failed: false, idle: true };
      setStatus('paused');
      setError('');
      return;
    }
    playing.current = { n: s.n, url: s.url, failed: false, idle: false };
    setStatus('starting');
    setError('');
    try {
      await player.play(`n${s.n}`);
    } catch (err) {
      if (err?.stale) return;
      if (playing.current?.n === s.n && playing.current?.url === s.url) failed(err);
      return;
    }
    if (playing.current?.n !== s.n) return;
    unlocked.current = true;
    setLocal('on');
    await sync();
  }, [player]);

  // Elk nieuw bericht van de server.
  useEffect(() => {
    apply(false);
  }, [incoming, apply]);

  // Om de paar seconden nakijken of het nog gelijk loopt.
  useEffect(() => {
    if (status !== 'playing') return undefined;
    const timer = setInterval(() => sync(), CHECK_EVERY);
    return () => clearInterval(timer);
  }, [status]);

  // De server zeggen dat deze verbinding geluid wil (bij elke nieuwe verbinding opnieuw).
  const told = useRef(false);
  useEffect(() => {
    if (net !== 'online') return;
    if (active) {
      send({ t: 'listen', on: true });
      told.current = true;
    } else if (told.current) {
      send({ t: 'listen', on: false });
      told.current = false;
    }
  }, [active, net, send]);

  // Uit (of geen spel met fragmenten meer): stil.
  useEffect(() => {
    if (active) return;
    player.stop();
    playing.current = null;
    setStatus('idle');
    setError('');
  }, [active, player]);

  /**
   * Aanzetten, of na een herlaad het geluid weer aanzetten. Roep dit op in de
   * klik-handler zelf: de tik ontgrendelt het geluid.
   */
  const turnOn = useCallback(() => {
    const unlocking = player.unlock();
    if (code) storage.write(keyFor(code), true);
    setWantedState(true);
    activeRef.current = available;
    unlocked.current = true;
    setLocal('on');
    setError('');
    if (msgRef.current?.sound) {
      apply(true);
    } else {
      setStatus('waiting');
    }
    return unlocking.then((ok) => {
      if (ok || playing.current) return ok;
      unlocked.current = false;
      setLocal('off');
      setStatus('error');
      setError(LISTEN_BLOCKED);
      return ok;
    });
  }, [player, code, available, apply]);

  const turnOff = useCallback(() => {
    if (code) storage.write(keyFor(code), null);
    setWantedState(false);
  }, [code]);

  /** «Probeer opnieuw»: hetzelfde adres (of een intussen vers adres), op de juiste plaats. */
  const retry = useCallback(() => {
    // Ook dit is een tik: het element mag daarna zeker spelen.
    player.unlock();
    unlocked.current = true;
    setLocal('on');
    return apply(true);
  }, [player, apply]);

  return {
    available,
    wanted,
    active,
    local,
    status,
    error,
    hasSound: Boolean(incoming?.sound),
    turnOn,
    turnOff,
    retry,
  };
}
