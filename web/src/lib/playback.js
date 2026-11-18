// Zelfcontrolerend afspelen, los van Preact en van Spotify zodat het met
// gewone unit-tests na te kijken is.
//
// Waarom: Spotify voert player-commando's niet gegarandeerd in volgorde uit,
// een toestel kan "gelukt" antwoorden zonder over te schakelen, en een
// commando kan mislukken of pas laat aankomen. Speelt er dan nog het nummer
// van de vorige beurt (met herhalen begint het gewoon opnieuw), dan leggen de
// spelers een ander nummer dan ze horen. Daarom:
// - gaan alle commando's één voor één, in volgorde, door één wachtrij;
// - hoort elk commando bij een "generatie" (het verwachte nummer). Een nieuw
//   nummer verhoogt de generatie; wat nog van een oudere generatie wacht,
//   wordt overgeslagen en kan dus nooit na het nieuwe startcommando komen;
// - kijkt het spel na het starten na wat er echt speelt, probeert begrensd
//   opnieuw en meldt het anders aan de host;
// - telt een nummer pas als gestart als dat bevestigd is.

/** Een fout die zegt dat het commando bij een oude generatie hoort. */
export class Stale extends Error {
  constructor() {
    super('verouderd');
    this.stale = true;
  }
}

/**
 * Wachtrij die commando's één voor één uitvoert. `run(fn, gen)`: wacht tot
 * alles ervoor klaar is; is de generatie intussen veranderd, dan wordt `fn`
 * niet meer uitgevoerd (de promise faalt met Stale).
 */
export function commandQueue() {
  let tail = Promise.resolve();
  let generation = 0;
  return {
    get generation() {
      return generation;
    },
    /** Een nieuw verwacht nummer (of geen meer): wat nog wacht, vervalt. */
    bump() {
      generation += 1;
      return generation;
    },
    run(fn, gen = generation) {
      const step = tail.then(() => {
        if (gen !== generation) throw new Stale();
        return fn(() => gen === generation);
      });
      tail = step.catch(() => {});
      return step;
    },
  };
}

/**
 * Speelt `state` (wat Spotify of de speler in de browser meldt) het verwachte
 * nummer? Houdt rekening met "track relinking": Spotify kan een andere versie
 * van hetzelfde nummer spelen (ander track-ID), en meldt het gevraagde dan in
 * `linkedFrom`. `aliases`: eerder vastgestelde vervangers per verwacht ID.
 */
export function playsExpected(expected, state, aliases = new Map()) {
  if (!expected || !state?.trackId) return false;
  if (state.trackId === expected || state.linkedFrom === expected) return true;
  return aliases.get(expected) === state.trackId;
}

/**
 * Beoordeelt één controle na het starten:
 * - 'ok': het verwachte nummer speelt (eventueel een gemelde vervanger);
 * - 'relinked': een onbekend nummer dat net na ons commando van voren begon:
 *   zo goed als zeker een vervanger zonder melding (geen vorig nummer van het
 *   spel, en het begon pas toen wij het vroegen);
 * - 'wrong': iets anders speelt (een vorig nummer, een ander toestel, iets
 *   dat al lang speelde);
 * - 'unknown': Spotify meldt (nog) niets.
 *
 * `previous`: track-ID's die het spel eerder liet spelen (en wat er toen echt
 * speelde). `sinceMs`: tijd sinds het startcommando; `startMs`: de plaats in het
 * nummer waar het startte. `deviceId`: het gekozen
 * toestel (leeg = niet nakijken).
 */
export function judgePlayback({ expected, state, previous = new Set(), aliases = new Map(), sinceMs = 0, startMs = 0, deviceId = null, slackMs = 4000 }) {
  if (!state || !state.trackId) return 'unknown';
  if (deviceId && state.deviceId && state.deviceId !== deviceId) return 'wrong';
  if (playsExpected(expected, state, aliases)) return 'ok';
  if (previous.has(state.trackId) || (state.linkedFrom && previous.has(state.linkedFrom))) return 'wrong';
  const fresh = typeof state.progressMs === 'number' && state.progressMs <= startMs + sinceMs + slackMs;
  return fresh ? 'relinked' : 'wrong';
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fouten waarbij nog eens proberen zin heeft: storing, te veel verzoeken, geen antwoord. */
export function transient(err) {
  if (!err || err.loginRequired || err.deviceGone) return false;
  return err.timeout || err.network || err.status === 429 || err.status >= 500;
}

/**
 * De afspeelregeling voor één host. `io`:
 *   play(trackId, opts, isCurrent)  start een nummer (gooit SpotifyError)
 *   state()                         wat er nu speelt: { trackId, linkedFrom, deviceId, isPlaying, progressMs } of null
 *   repeat(mode)                    herhaalstand ('track' of 'off'); fouten worden genegeerd
 *   pause(), resume()
 *   deviceId()                      het gekozen toestel, om na te kijken waar het speelt
 * `on`: callbacks status(s), error(err|null), confirmed(key).
 * `timing`: { checks: [ms...] wachttijden tussen de controles na een start,
 *            late: ms tot de nacontrole, retries: extra startpogingen }.
 */
export function createPlayback(io, on = {}, timing = {}) {
  const checks = timing.checks ?? [700, 1500, 2500];
  const late = timing.late ?? 8000;
  const retries = timing.retries ?? 2;
  const sleep = timing.sleep ?? wait;
  const queue = commandQueue();
  const previous = new Set(); // vroegere nummers van het spel (en wat er toen echt speelde)
  const aliases = new Map(); // verwacht ID -> ID dat Spotify er echt voor speelt
  let expected = null; // { key, trackId, positionMs }
  let lateTimer = null;

  const status = (s) => on.status?.(s);
  const error = (e) => on.error?.(e);

  /** Kijkt een paar keer na wat er speelt; geeft 'ok' | 'wrong' | 'unknown'. */
  async function verify(trackId, sentAt, isCurrent, delays, startMs = 0, allowRelink = true) {
    let verdict = 'unknown';
    for (const ms of delays) {
      await sleep(ms);
      if (!isCurrent()) throw new Stale();
      let state = null;
      try {
        state = await io.state();
      } catch (err) {
        if (err?.loginRequired) throw err;
        state = null; // nakijken mislukte: telt als «weet niet»
      }
      if (!isCurrent()) throw new Stale();
      verdict = judgePlayback({ expected: trackId, state, previous, aliases, sinceMs: Date.now() - sentAt, startMs, deviceId: io.deviceId?.() });
      if (verdict === 'relinked') {
        // Alleen vlak na ons eigen startcommando kan een onbekend nummer een
        // vervanger zijn; bij een latere controle is het gewoon fout.
        if (!allowRelink) return 'wrong';
        aliases.set(trackId, state.trackId);
        return 'ok';
      }
      if (verdict === 'ok') return 'ok';
    }
    return verdict;
  }

  /**
   * Start het verwachte nummer en kijkt het na; binnen de wachtrij. Lukt het
   * niet, dan wordt wat er speelt stilgezet: liever stilte dan een nummer dat
   * de spelers voor het nummer van deze beurt houden (bv. het vorige, dat door
   * het herhalen gewoon opnieuw begint).
   */
  async function ensure(isCurrent) {
    let verdict;
    try {
      verdict = await tryStart(isCurrent);
    } catch (err) {
      if (!err?.stale && isCurrent()) await io.pause().catch(() => {});
      throw err;
    }
    if (verdict === 'wrong' && isCurrent()) await io.pause().catch(() => {});
    return verdict;
  }

  async function tryStart(isCurrent) {
    const target = expected;
    let lastErr = null;
    let verdict = 'unknown';
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!isCurrent()) throw new Stale();
      const sentAt = Date.now();
      try {
        await io.play(target.trackId, { positionMs: target.positionMs }, isCurrent);
        lastErr = null;
      } catch (err) {
        if (err?.stale) throw err;
        lastErr = err;
        if (!transient(err)) break;
        // Te veel verzoeken: wacht zoals Spotify vraagt (begrensd), anders even.
        await sleep(err.status === 429 ? Math.min(10_000, (err.retryAfter || 2) * 1000) : 1000 * (attempt + 1));
        continue;
      }
      verdict = await verify(target.trackId, sentAt, isCurrent, checks, target.positionMs);
      if (verdict === 'ok') return 'ok';
    }
    if (lastErr) throw lastErr;
    return verdict; // 'wrong' of 'unknown' na alle pogingen
  }

  function scheduleLateCheck(gen) {
    clearTimeout(lateTimer);
    if (!late) return;
    lateTimer = setTimeout(() => {
      // Een commando dat Spotify pas laat uitvoert (of een toestel dat later
      // terugvalt) wordt zo toch nog opgemerkt: één extra controle per beurt.
      queue
        .run(async (isCurrent) => {
          const verdict = await verify(expected.trackId, Date.now(), isCurrent, [0], 0, false);
          if (verdict === 'wrong') {
            const again = await ensure(isCurrent);
            finish(again);
          }
        }, gen)
        .catch((err) => {
          if (!err?.stale) fail(err);
        });
    }, late);
  }

  function finish(verdict) {
    if (verdict === 'ok') {
      error(null);
      status('playing');
      on.confirmed?.(expected.key);
      return true;
    }
    status('wrong');
    error({ wrong: true, unknown: verdict === 'unknown' });
    return false;
  }

  function fail(err) {
    status('error');
    error(err);
  }

  /** Onthoudt wat er speelde, zodat een latere controle het als «vorig nummer» herkent. */
  function remember(trackId) {
    if (!trackId) return;
    previous.add(trackId);
    const alias = aliases.get(trackId);
    if (alias) previous.add(alias);
  }

  return {
    get expected() {
      return expected;
    },
    /** Kent een nummer van vroeger (bv. na herladen): telt als «vorig nummer». */
    remember,
    /**
     * Speel `trackId` voor `key`. Alles wat nog van vroeger in de wachtrij
     * staat, vervalt. Geeft een promise met true (bevestigd) of false.
     */
    start(trackId, { key = trackId, positionMs = 0 } = {}) {
      if (expected && expected.trackId !== trackId) remember(expected.trackId);
      expected = { key, trackId, positionMs };
      clearTimeout(lateTimer);
      const gen = queue.bump();
      status('starting');
      error(null);
      return queue
        .run(async (isCurrent) => {
          const verdict = await ensure(isCurrent);
          // Herhalen pas na een bevestigde start, en alleen voor dit nummer:
          // een herhaalcommando kan zo nooit een nieuwer startcommando kruisen.
          if (verdict === 'ok' && isCurrent()) await io.repeat('track').catch(() => {});
          if (!isCurrent()) throw new Stale();
          const ok = finish(verdict);
          if (ok) scheduleLateCheck(gen);
          return ok;
        }, gen)
        .catch((err) => {
          if (err?.stale) return false;
          fail(err);
          return false;
        });
    },
    /**
     * Kijkt na of het verwachte nummer nog speelt (na herladen, terug op het
     * scherm, de speler in de browser meldt een ander nummer). Zo niet: opnieuw
     * starten, van voren.
     */
    check({ repair = true, repairUnknown = false } = {}) {
      if (!expected) return Promise.resolve(true);
      const gen = queue.generation;
      return queue
        .run(async (isCurrent) => {
          const verdict = await verify(expected.trackId, Date.now(), isCurrent, [0], 0, false);
          if (verdict === 'ok') return true;
          // Meldt Spotify niets (bv. lang gepauzeerd), dan niet zomaar starten.
          if (verdict === 'unknown' && !repairUnknown) return true;
          if (!repair) return finish(verdict);
          status('starting');
          const again = await ensure(isCurrent);
          if (again === 'ok' && isCurrent()) await io.repeat('track').catch(() => {});
          if (!isCurrent()) throw new Stale();
          return finish(again);
        }, gen)
        .catch((err) => {
          if (err?.stale) return false;
          fail(err);
          return false;
        });
    },
    pause() {
      return queue
        .run(async () => {
          await io.pause();
          status('paused');
        })
        .catch((err) => {
          if (!err?.stale) fail(err);
        });
    },
    /** Verder spelen; speelt er intussen iets anders, dan het verwachte nummer opnieuw. */
    resume() {
      return queue
        .run(async (isCurrent) => {
          if (!expected) {
            await io.resume();
            status('playing');
            return;
          }
          const sentAt = Date.now();
          await io.resume();
          // Bij hervatten begint het nummer niet van voren: een onbekend nummer is dan fout.
          let verdict = await verify(expected.trackId, sentAt, isCurrent, [checks[0]], 0, false);
          if (verdict !== 'ok') verdict = await ensure(isCurrent);
          finish(verdict);
        })
        .catch((err) => {
          if (!err?.stale) fail(err);
        });
    },
    /**
     * Neemt een nummer over dat al eerder bevestigd werd (bv. na herladen),
     * zonder het opnieuw te starten, en kijkt na of het nog speelt.
     */
    adopt(trackId, { key = trackId, positionMs = 0 } = {}) {
      if (expected && expected.trackId !== trackId) remember(expected.trackId);
      expected = { key, trackId, positionMs };
      clearTimeout(lateTimer);
      queue.bump();
      return this.check();
    },
    /** Geen verwacht nummer meer (spel gedaan, wachtkamer): herhalen uit. */
    release() {
      if (expected) remember(expected.trackId);
      expected = null;
      clearTimeout(lateTimer);
      queue.bump();
      return queue.run(() => io.repeat('off').catch(() => {})).catch(() => {});
    },
    /** Vergeet het verwachte nummer zonder iets naar Spotify te sturen. */
    forget() {
      if (expected) remember(expected.trackId);
      expected = null;
      clearTimeout(lateTimer);
      queue.bump();
    },
    /** Een los commando (bv. de geluidstest) in de wachtrij; vervalt bij een nieuw nummer. */
    run(fn) {
      return queue.run(fn);
    },
  };
}
