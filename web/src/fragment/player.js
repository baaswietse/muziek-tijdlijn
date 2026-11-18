// Speelt fragmenten van Deezer af in deze browser, met één <audio>-element.
// Los van Preact en van "ik ben de host": elke gsm die geluid moet maken, kan
// dit gebruiken.
//
// - Een browser speelt geen geluid zonder aanraking. `unlock()` moet je
//   aanroepen tijdens een tik (in de klik-handler zelf): het speelt een stil
//   geluidje op hetzelfde element, en daarna mag dat element ook zonder tik
//   spelen (ook op iPhone, zolang de pagina open blijft). Na een herlaad moet
//   het opnieuw.
// - Een fragment duurt 30 seconden en herhaalt (`loop`) tot er iets anders
//   moet spelen.
// - Het adres van het fragment wordt opgevraagd vlak voor het afspelen: de
//   handtekening erin verloopt na enkele uren. Speelt een adres niet (meer),
//   dan vraagt het één keer een nieuw adres; lukt dat ook niet, dan bestaat
//   het fragment niet (meer).
// - Elke start hoort bij een generatie: een oudere start die nog bezig is,
//   speelt nooit na een nieuwere.
// - De mediabediening van het toestel (vergrendelscherm, meldingen) krijgt
//   alleen de naam van het spel, nooit titel of artiest.

import { FragmentError, MISSING, OFFLINE, fetchPreview } from './deezer.js';

export const BLOCKED = 'Je browser liet het geluid niet toe. Tik op «Zet het geluid aan».';
const PLAY_TIMEOUT = 15_000;

/** Een start die door een nieuwere vervangen is. */
export class Superseded extends Error {
  constructor() {
    super('vervangen');
    this.stale = true;
  }
}

/** Een stil WAV-geluidje van 0,1 s (8 kHz, 8 bit): om het element te ontgrendelen. */
export function silentWav() {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // stilte
  let bin = '';
  new Uint8Array(buf).forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function errorOf(err) {
  if (err instanceof FragmentError || err?.stale) return err;
  if (err?.name === 'NotAllowedError') return new FragmentError(BLOCKED, 'blocked');
  if (err?.name === 'AbortError') return new Superseded();
  // NotSupportedError: het adres geeft geen geluid (verlopen, weg of geen mp3).
  return new FragmentError(MISSING, 'missing');
}

/**
 * `audio`: een eigen element (tests); standaard een nieuw, onzichtbaar in de pagina.
 * `onEvent({ type: 'error', error })`: het fragment viel weg terwijl het speelde.
 * `label`: wat de mediabediening van het toestel toont.
 */
export function createFragmentPlayer({ audio = null, fetch = fetchPreview, onEvent = () => {}, label = 'Muziek-tijdlijn' } = {}) {
  let el = audio;
  let unlocked = false;
  let generation = 0;
  let current = null; // { trackId, url } van wat er nu op het element staat
  let silent = null;

  function element() {
    if (el) return el;
    el = document.createElement('audio');
    el.preload = 'auto';
    el.setAttribute('data-testid', 'fragment-audio');
    el.hidden = true;
    document.body.append(el);
    return el;
  }

  function neutralMedia() {
    try {
      if ('mediaSession' in navigator && typeof window.MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new window.MediaMetadata({ title: label, artist: '', album: '' });
      }
    } catch {
      // Geen mediabediening: niets te verbergen.
    }
  }

  function attachErrors(a) {
    if (a.__mtWatched) return;
    a.__mtWatched = true;
    a.addEventListener('error', () => {
      // Alleen een fout van een fragment dat al speelde (niet van het stille
      // geluidje en niet tijdens een start: die handelt play() zelf af).
      if (!current?.started || a.__mtStarting) return;
      onEvent({ type: 'error', error: new FragmentError(MISSING, 'missing'), trackId: current.trackId });
    });
  }

  /** Speelt `url` op het element; faalt met een FragmentError (of Superseded). */
  async function playUrl(a, url, gen) {
    a.loop = true;
    if (a.src !== url) a.src = url;
    else a.currentTime = 0;
    a.__mtStarting = true;
    let timer;
    try {
      await Promise.race([
        a.play(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new FragmentError(OFFLINE, 'network')), PLAY_TIMEOUT);
        }),
      ]);
    } catch (err) {
      if (gen !== generation) throw new Superseded();
      throw errorOf(err);
    } finally {
      clearTimeout(timer);
      a.__mtStarting = false;
    }
    if (gen !== generation) throw new Superseded();
  }

  return {
    get unlocked() {
      return unlocked;
    },
    get trackId() {
      return current?.trackId ?? null;
    },
    get paused() {
      return el ? el.paused : true;
    },
    /** Het adres dat nu op het element staat (voor wie het doorgeeft aan spelers die meeluisteren). */
    get url() {
      return current?.url ?? null;
    },
    /** Het adres voor `trackId`, als dat er nu op staat (ook als het afspelen geweigerd werd). */
    urlFor(trackId) {
      return current?.trackId === trackId ? current.url : null;
    },
    /** Waar het element nu staat (s). */
    get position() {
      return el ? el.currentTime : 0;
    },
    /** De echte duur van het fragment (s), of NaN zolang die niet gekend is. */
    get duration() {
      return el ? el.duration : NaN;
    },

    /** Springt naar `seconds` (binnen de duur). Voor wie gelijk met de anderen speelt. */
    seek(seconds) {
      if (!el || !current) return;
      try {
        el.currentTime = Math.max(0, seconds);
      } catch {
        // Nog geen gegevens: dan speelt het van voren, een volgende controle zet het juist.
      }
    },

    /**
     * Ontgrendelt het geluid. Roep dit op in de klik-handler zelf, vóór elke
     * await. Geeft true als de browser geluid toelaat.
     */
    unlock() {
      const a = element();
      attachErrors(a);
      if (!silent) silent = silentWav();
      const playing = current && !a.paused;
      if (playing) {
        unlocked = true;
        return Promise.resolve(true);
      }
      a.loop = false;
      a.src = silent;
      current = null;
      let p;
      try {
        p = a.play();
      } catch (err) {
        return Promise.resolve(false);
      }
      return Promise.resolve(p).then(
        () => {
          unlocked = true;
          return true;
        },
        (err) => {
          // Een nieuwere start onderbrak het stille geluidje: het element mag dus al spelen.
          if (err?.name === 'AbortError') {
            unlocked = true;
            return true;
          }
          unlocked = false;
          return false;
        },
      );
    },

    /**
     * Speelt het fragment van `trackId` (`dz-…`) van voren af, herhalend.
     * Vraagt het adres altijd opnieuw op, behalve bij `reuse` (opnieuw
     * afspelen van hetzelfde fragment dat nog geldig is).
     */
    async play(trackId, { reuse = false } = {}) {
      generation += 1;
      const gen = generation;
      const a = element();
      attachErrors(a);
      if (!reuse || current?.trackId !== trackId || a.error) {
        // Wat er nog speelt, hoort bij een vorig nummer: meteen stil.
        a.pause();
        current = null;
        const url = await fetch(trackId);
        if (gen !== generation) throw new Superseded();
        current = { trackId, url };
      }
      neutralMedia();
      current.started = false;
      try {
        await playUrl(a, current.url, gen);
      } catch (err) {
        if (err.kind !== 'missing') throw err;
        // Misschien verlopen: één keer een nieuw adres vragen.
        const url = await fetch(trackId);
        if (gen !== generation) throw new Superseded();
        current = { trackId, url, started: false };
        a.removeAttribute('src');
        a.load();
        await playUrl(a, url, gen);
      }
      current.started = true;
      unlocked = true;
      return true;
    },

    pause() {
      if (el) el.pause();
    },

    /** Verder spelen waar het was. */
    async resume() {
      if (!el || !current) return false;
      try {
        await el.play();
      } catch (err) {
        throw errorOf(err);
      }
      return true;
    },

    /** Stil, en vergeet wat er speelde. Een start die nog bezig is, vervalt. */
    stop() {
      generation += 1;
      current = null;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    },
  };
}
