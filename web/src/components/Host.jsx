// De host-rol: doorgeven (de host duidt een andere speler aan) en overnemen
// (de host is al een tijd weg; een andere speler wordt host). De server
// beslist: hij kijkt zelf na of de host lang genoeg weg is (zie
// server/src/rules.js, takeHost).

import { useEffect, useState } from 'preact/hooks';

/**
 * Hoe lang (ms) nog tot een andere speler host kan worden, gerekend vanaf wat
 * de server zei (`view.hostAway`: { ms, grace }) en de tijd sinds die stand
 * aankwam (`view.at`, klok van deze gsm). null als de host er is.
 */
export function hostWaitLeft(view, now = performance.now()) {
  const away = view?.hostAway;
  if (!away) return null;
  const since = typeof view.at === 'number' ? Math.max(0, now - view.at) : 0;
  return Math.max(0, away.grace - away.ms - since);
}

/** Kan deze speler nu host worden? Telt zelf af en tekent opnieuw als de wachttijd om is. */
function useCanTakeOver(view) {
  const left = view.you === view.hostId ? null : hostWaitLeft(view);
  const [, tick] = useState(0);
  useEffect(() => {
    if (left === null || left <= 0) return undefined;
    const timer = setTimeout(() => tick((n) => n + 1), left + 50);
    return () => clearTimeout(timer);
  }, [left === null, view.at]);
  return left !== null && left <= 0;
}

/**
 * «De host is weg»: alleen als de host al de hele wachttijd niet verbonden is
 * (een korte haper of een vergrendeld scherm lokt niets uit). Wie het eerst
 * op «Word host» tikt, wordt host; niets gebeurt vanzelf.
 */
export function HostAway({ view, send, net = 'online', game = false }) {
  const ready = useCanTakeOver(view);
  if (!ready || net !== 'online') return null;
  const host = view.players.find((p) => p.id === view.hostId);
  const name = host?.name ?? 'De host';
  return (
    <section class={`host-away${game ? ' in-game' : ''}`} role="alert" data-testid="host-away">
      <p class="host-away-title">De host is weg</p>
      <p class="host-away-text">
        {name} is al een tijd niet verbonden. Zonder host speelt er geen muziek en kan niemand het spel sturen. Word jij host? Dan
        bedien jij de muziek en het spel. Komt {name} terug, dan speelt die gewoon mee.
      </p>
      <button type="button" class="btn primary" onClick={() => send({ t: 'takeHost' })} data-testid="take-host">
        Word host
      </button>
    </section>
  );
}

/** De vraag bij «Maak host»: wat er verandert, voor beide. */
export function handOverQuestion(name, inGame) {
  return inGame
    ? `${name} host maken? ${name} bedient dan de muziek en het spel; jij speelt gewoon mee als gewone speler.`
    : `${name} host maken? ${name} kiest dan de muziek en start het spel; jij wordt een gewone speler.`;
}

/**
 * In het menu van de host (tijdens het spel): de rol doorgeven aan een andere
 * speler die verbonden is, na een bevestiging.
 */
export function HandOver({ view, send, onDone }) {
  const others = view.players.filter((p) => p.id !== view.you);
  if (others.length === 0) return null;
  return (
    <details class="menu-remove" data-testid="hand-over">
      <summary>Geef de host-rol door</summary>
      <p class="muted small">
        Moet je weg, of is je batterij bijna leeg? Een andere speler neemt dan de muziek en het spel over. Jij speelt gewoon mee, en
        kan daarna ook het spel verlaten.
      </p>
      <div class="menu-remove-list">
        {others.map((p) => (
          <button
            key={p.id}
            type="button"
            class="btn link"
            disabled={!p.online}
            onClick={() => {
              if (!confirm(handOverQuestion(p.name, true))) return;
              send({ t: 'setHost', playerId: p.id });
              onDone?.();
            }}
            data-testid="make-host"
            data-player={p.id}
          >
            Maak {p.name} host{p.online ? '' : ' (niet verbonden)'}
          </button>
        ))}
      </div>
    </details>
  );
}
