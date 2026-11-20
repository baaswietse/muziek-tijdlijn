import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildSummary, metaLine, statLines, joinNames } from '../lib/summary.js';
import { summaryPng, shareOrDownload } from '../lib/shareimage.js';

// Het overzicht op het eindscherm, in de pagina zelf (onder de uitleg): de
// winnaar, hoe lang het duurde, de prijzen, de eindstand met per speler een
// paar cijfers, en «Deel het resultaat». De hoofdknop (Nog een spel) blijft in
// de zwevende balk; niets hier staat daarvoor in de weg.

const tokenText = (n) => `${n} ${n === 1 ? 'token' : 'tokens'}`;

export function Summary({ view, onShow }) {
  const s = useMemo(() => buildSummary(view), [view]);
  const me = view.you;
  const label = (p) => (p.id === me ? 'Jij' : p.name);
  const iWon = s.winners.some((w) => w.id === me);
  let headline;
  if (s.winners.length === 0) headline = 'Spel afgelopen';
  else if (s.winners.length === 1) headline = iWon ? 'Jij wint!' : `${s.winners[0].name} wint!`;
  else headline = `Gelijkspel: ${joinNames(s.winners.map(label))}`;
  const meta = metaLine(s);
  return (
    <section class="summary" id="overzicht" data-testid="summary" data-complete={s.complete ? 'yes' : 'no'} aria-labelledby="summary-title">
      <h2 class="visually-hidden" id="summary-title">
        Overzicht van het spel
      </h2>
      <div class="summary-winner" data-testid="summary-winner" data-winners={s.winners.map((w) => w.id).join(',')}>
        <Star />
        <p class="summary-winner-label">{s.winners.length > 1 ? 'Gelijkspel' : 'Winnaar'}</p>
        <p class="summary-winner-name">{headline}</p>
        {s.winners.length > 0 && (
          <p class="summary-winner-sub">
            {s.winners.length > 1 ? 'elk ' : 'met '}
            {s.winners[0].cards} {s.winners[0].cards === 1 ? 'kaart' : 'kaarten'}
          </p>
        )}
      </div>
      {meta && (
        <p class="summary-meta" data-testid="summary-meta" data-turns={s.turns ?? ''} data-ms={s.ms ?? ''}>
          {meta}
        </p>
      )}

      {s.prizes.length > 0 && (
        <ul class="summary-prizes" data-testid="summary-prizes" aria-label="Prijzen">
          {s.prizes.map((prize) => (
            <li key={prize.key} class="summary-prize" data-testid="summary-prize" data-prize={prize.key} data-players={prize.ids.join(',')} data-value={prize.value}>
              <Star small />
              <span>
                <strong>{prize.title}:</strong> {joinNames(prize.ids.map((id, i) => (id === me ? 'jij' : prize.names[i])))}
{' '}
                <span class="summary-prize-detail">· {prize.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 class="summary-head">Eindstand</h3>
      <ol class="summary-list" data-testid="summary-list">
        {s.standings.map((p) => {
          const st = p.stats;
          const lines = statLines(st);
          return (
            <li
              key={p.id}
              class={`summary-row${p.winner ? ' won' : ''}`}
              data-testid="summary-row"
              data-player={p.id}
              data-rank={p.rank}
              data-cards={p.cards}
              data-tokens={p.tokens}
              {...(st
                ? {
                    'data-placed': st.placed,
                    'data-correct': st.correct,
                    'data-streak': st.bestStreak,
                    'data-guessed': st.guessed,
                    'data-bets-won': st.betsWon,
                    'data-bets-lost': st.betsLost,
                    'data-bought': st.bought,
                  }
                : {})}
            >
              <button
                type="button"
                class="summary-row-head"
                onClick={() => onShow(p.id)}
                aria-label={`${p.rank}. ${p.name}${p.id === me ? ' (jij)' : ''}: ${p.cards} kaarten, ${tokenText(p.tokens)}. Toon de tijdlijn.`}
              >
                <span class="summary-rank" aria-hidden="true">
                  {p.rank}.
                </span>
                <span class="summary-name">
                  <span class="person-name">{p.name}</span>
                  {p.id === me && <span class="chip soft">jij</span>}
                </span>
                <span class="summary-tokens" aria-hidden="true">
                  <span class="coin" /> {p.tokens}
                </span>
                <span class="summary-cards" aria-hidden="true">
                  {p.cards}
                  <span class="summary-of"> / {s.target}</span>
                </span>
              </button>
              {lines.length > 0 && (
                <p class="summary-stats" data-testid="summary-stats">
                  {lines.map((l, i) => (
                    <span key={l.key} data-stat={l.key}>
                      {i > 0 && <span aria-hidden="true"> · </span>}
                      {l.text}
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p class="muted small">Tik op een naam om die tijdlijn te zien.</p>
      {!s.complete && (
        <p class="muted small" data-testid="summary-partial">
          Van dit spel zijn geen cijfers bijgehouden: het liep al voor de laatste versie van de server.
        </p>
      )}
      <ShareButton summary={s} />
    </section>
  );
}

/**
 * «Deel het resultaat»: de afbeelding wordt al gemaakt zodra het overzicht er
 * staat (en opnieuw als het verandert), zodat het deelmenu meteen na de tik
 * kan openen.
 */
function ShareButton({ summary }) {
  const key = JSON.stringify(summary);
  const ready = useRef({ key: null, blob: null });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    setStatus(null);
    const make = () =>
      summaryPng(summary)
        .then((blob) => {
          if (!gone) ready.current = { key, blob };
        })
        .catch(() => {});
    // Even laten wachten: eerst het scherm tekenen.
    const timer = setTimeout(make, 150);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [key]);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const blob = ready.current.key === key && ready.current.blob ? ready.current.blob : await summaryPng(summary);
      ready.current = { key, blob };
      const how = await shareOrDownload(blob, { title: 'Muziek-tijdlijn' });
      setStatus(how);
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  const text = {
    shared: 'Gedeeld.',
    downloaded: 'De afbeelding staat bij je downloads.',
    error: 'De afbeelding maken lukte niet.',
  }[status];
  return (
    <div class="summary-share">
      <button type="button" class="btn" onClick={share} disabled={busy} data-testid="share-result">
        <ShareIcon /> {busy ? 'Even geduld…' : 'Deel het resultaat'}
      </button>
      {text && (
        <p class="muted small" role="status" data-testid="share-status" data-status={status}>
          {text}
        </p>
      )}
    </div>
  );
}

function Star({ small = false }) {
  const s = small ? 18 : 28;
  return (
    <svg class={small ? 'summary-star small' : 'summary-star'} width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="currentColor" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 13V3M6 7l4-4 4 4M4 11v5h12v-5" />
    </svg>
  );
}
