// Welke nummers er gespeeld worden: de standaardlijst van de site of een
// eigen Spotify-playlist van de host, of met fragmenten een of meer van de
// ingebouwde lijsten, eventueel binnen een periode. Alleen op de gsm van de host.

import { useState } from 'preact/hooks';
import { MAX_DECK as MAX, minutesLeft } from '../lib/deckplan.js';
import { periodText } from '../fragment/lists.js';

export function DeckPanel({ view, send, deck, choice, loggedIn, source = 'spotify' }) {
  if (source === 'fragment' && choice) return <FragmentLists deck={deck} choice={choice} />;
  return <SpotifyDeck view={view} send={send} deck={deck} loggedIn={loggedIn} />;
}

const nummers = (n) => (n === 1 ? '1 nummer' : `${n} nummers`);

/** Uitleg bij de hoofdlijst: welke lijsten ze uitzet, en welke je erbij kan aanvinken. */
function mainHelp(lists) {
  const main = lists.find((l) => l.main);
  if (!main) return '';
  const apart = lists.filter((l) => !l.main && !l.inMain).map((l) => `«${l.name}»`);
  if (apart.length === 0) return ` «${main.name}» bevat alles en zet de andere uit.`;
  const which = apart.length === 1 ? apart[0] : `${apart.slice(0, -1).join(', ')} en ${apart[apart.length - 1]}`;
  return ` «${main.name}» zet de andere uit, behalve ${which}: die kan je erbij aanvinken.`;
}

/**
 * Met fragmenten: vink een of meer lijsten van het spel aan en beperk
 * eventueel de periode. Wat dat geeft, staat er meteen onder. De keuze zelf
 * (bewaren, naar de server sturen) zit in lib/fragmentchoice.js.
 */
function FragmentLists({ deck, choice: c }) {
  if (c.held) {
    // Net host geworden: de stapel van de vorige host blijft, tot je zelf kiest.
    return (
      <section class="card" data-testid="deck-panel" data-source="fragment">
        <h2>Nummers</h2>
        <p class="deck-current" data-testid="deck-held">
          De vorige host koos «{c.held.name}» · {nummers(c.held.count)}. Daar speel je mee, tenzij je zelf kiest.
        </p>
        <button type="button" class="btn" onClick={c.release} data-testid="choice-own">
          Kies zelf lijsten
        </button>
      </section>
    );
  }
  const limited = c.choice && (c.choice.from != null || c.choice.to != null);
  const from = c.choice?.from ?? null;
  const to = c.choice?.to ?? null;
  return (
    <section class="card" data-testid="deck-panel" data-source="fragment">
      <h2>Nummers</h2>
      {!c.data && !c.loadError && <p class="muted small">Lijsten ophalen…</p>}
      {c.data && c.lists && (
        <>
          <p class="muted small">
            Vink een of meer lijsten aan: je speelt met alle nummers die in minstens één ervan zitten.
            {mainHelp(c.lists)}
          </p>
          {limited && (
            <p class="muted small" data-testid="count-period">
              Aantallen per lijst binnen de periode {periodText(c.choice)}.
            </p>
          )}
          <ul class="devices picks" data-testid="fragment-lists">
            {c.lists.map((l) => {
              const on = c.choice.lists.includes(l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    class={`device pick${on ? ' on' : ''}`}
                    data-testid={`list-${l.id}`}
                    onClick={() => c.toggle(l.id)}
                  >
                    <span class="pick-box" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    <span class="pick-text">
                      <span class="device-name">{l.name}</span>
                      <span class="muted small pick-count" data-testid={`count-${l.id}`}>
                        {nummers(l.count)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {c.bounds && (c.options.from.length > 0 || c.options.to.length > 0) && (
            <fieldset class="period" data-testid="period">
              <legend class="label">
                Periode <span class="muted">(nummers van {c.bounds.min} tot {c.bounds.max})</span>
              </legend>
              <div class="period-row">
                <label class="period-field">
                  <span>Van</span>
                  <select
                    class="input"
                    data-testid="period-from"
                    value={from ?? ''}
                    onChange={(e) => c.setFrom(e.currentTarget.value)}
                  >
                    <option value="">het begin</option>
                    {c.options.from
                      .filter((y) => to == null || y <= to)
                      .map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                  </select>
                </label>
                <label class="period-field">
                  <span>tot en met</span>
                  <select class="input" data-testid="period-to" value={to ?? ''} onChange={(e) => c.setTo(e.currentTarget.value)}>
                    <option value="">nu</option>
                    {c.options.to
                      .filter((y) => from == null || y >= from)
                      .map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {limited && (
                <button type="button" class="btn link" data-testid="period-clear" onClick={c.clearPeriod}>
                  Alle jaren
                </button>
              )}
            </fieldset>
          )}

          <div
            class={`deck-total${c.enough ? '' : ' short'}`}
            data-testid="deck-total"
            data-total={c.total}
            data-synced={c.synced ? 'yes' : 'no'}
            aria-live="polite"
          >
            <p class="deck-total-line">
              <strong class="deck-total-n" data-testid="deck-count">
                {c.total}
              </strong>{' '}
              {c.total === 1 ? 'nummer' : 'nummers'}
            </p>
            <p class="small deck-total-name" data-testid="deck-name">
              {c.name || 'Nog geen lijst gekozen'}
            </p>
            {c.sampled && (
              <p class="muted small" data-testid="deck-sample">
                Het spel kiest er willekeurig {MAX} uit.
              </p>
            )}
          </div>
          {!c.enough && (
            <p class="notice warn" data-testid="deck-short">
              {c.choice.lists.length === 0
                ? 'Vink minstens één lijst aan.'
                : c.total === 0
                  ? 'Geen nummers in deze periode. Kies een ruimere periode of andere lijsten.'
                  : `Te weinig nummers: voor ${c.players === 1 ? '1 speler' : `${c.players} spelers`} naar ${c.target} kaarten zijn er minstens ${c.need} nodig. Vink meer lijsten aan, kies een ruimere periode of speel naar minder kaarten.`}
            </p>
          )}
        </>
      )}
      {(c.loadError || deck.error) && (
        <p class="notice error" data-testid="deck-error">
          {c.loadError || deck.error}{' '}
          <button class="btn link" onClick={c.loadError ? c.reload : c.retry}>
            Opnieuw
          </button>
        </p>
      )}
    </section>
  );
}

function SpotifyDeck({ view, send, deck, loggedIn }) {
  const [open, setOpen] = useState(false);
  const playlist = view.playlist;
  const job = deck.job;

  function pick(p) {
    setOpen(false);
    deck.choose(p);
  }

  function openList() {
    setOpen(true);
    deck.loadPlaylists();
  }

  // Eerst wachten tot een upload die nog onderweg is, aangekomen is: anders
  // zet die de playlist na het wissen terug.
  async function useDefault() {
    if (await deck.reset()) send({ t: 'clearDeck' });
  }

  return (
    <section class="card" data-testid="deck-panel">
      <h2>Nummers</h2>
      <p class="deck-current" data-testid="deck-current">
        {playlist && playlist.source !== 'fragment' ? `Playlist «${playlist.name}» · ${playlist.count} nummers` : 'Standaardlijst van het spel'}
      </p>

      {job && <JobStatus job={job} deck={deck} />}
      {deck.result?.sampled && (
        <p class="muted small" data-testid="deck-sample">
          Deze playlist heeft {deck.result.total} nummers; het spel koos er willekeurig {MAX} uit en zoekt alleen daarvan het jaar op.
          Kies de playlist later opnieuw voor een andere greep.
        </p>
      )}

      {!deck.available ? (
        <p class="muted small">Een eigen playlist kiezen kan niet in de testmodus.</p>
      ) : !loggedIn ? (
        <p class="muted small">Log in bij Spotify (hierboven) om met een eigen playlist te spelen.</p>
      ) : (
        <div class="row gap">
          <button class="btn" onClick={openList} data-testid="deck-open">
            {job ? 'Kies een andere playlist' : 'Kies een playlist uit Spotify'}
          </button>
          {!playlist && !job && deck.last && (
            <button class="btn" onClick={() => deck.choose(deck.last)} data-testid="deck-last">
              Opnieuw «{deck.last.name}»
            </button>
          )}
          {(playlist || job) && (
            <button class="btn link" onClick={useDefault} data-testid="deck-default">
              Terug naar de standaardlijst
            </button>
          )}
        </div>
      )}

      {open && (
        <div class="deck-list" data-testid="deck-list">
          {deck.loading && <p class="muted small">Playlists ophalen…</p>}
          {deck.playlists && deck.playlists.length === 0 && (
            <p class="notice">Geen eigen playlists gevonden. Spotify laat alleen playlists lezen die je zelf maakte of waaraan je meewerkt.</p>
          )}
          {deck.playlists && deck.playlists.length > 0 && (
            <>
              <p class="muted small">Alleen playlists die je zelf maakte of waaraan je meewerkt; andere laat Spotify niet lezen.</p>
              <ul class="devices">
                {deck.playlists.map((p) => (
                  <li key={p.id}>
                    <button type="button" class="device" data-testid={`playlist-${p.id}`} onClick={() => pick(p)}>
                      <span class="device-name">{p.name}</span>
                      <span class="muted small">{p.total} nummers</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button class="btn link" onClick={() => setOpen(false)}>
            Sluit
          </button>
        </div>
      )}

      {deck.error && (
        <p class="notice error" data-testid="deck-error">
          {deck.error}
        </p>
      )}

      {deck.result && (
        <>
          {deck.result.note && <p class="notice warn">{deck.result.note}</p>}
          {deck.result.finished && deck.result.skipped > 0 && (
            <p class="muted small">
              {deck.result.skipped === 1 ? '1 nummer doet' : `${deck.result.skipped} nummers doen`} niet mee (geen jaartal gevonden).
            </p>
          )}
          {deck.result.doubts.length > 0 && <Doubts doubts={deck.result.doubts} onYear={deck.setYear} />}
        </>
      )}
    </section>
  );
}

/** Hoe ver het opzoeken staat, en of de host al kan starten. */
function JobStatus({ job, deck }) {
  if (job.phase === 'tracks') {
    return (
      <div class="deck-job" data-testid="deck-job">
        <p class="small">«{job.name}» lezen…</p>
        <button class="btn" onClick={deck.cancel}>
          Stop
        </button>
      </div>
    );
  }
  const need = deck.minDeck - job.ready;
  return (
    <div class="deck-job" data-testid="deck-job">
      <p class="small" data-testid="deck-progress">
        «{job.name}»: <strong>{job.ready}</strong> {job.ready === 1 ? 'nummer' : 'nummers'} klaar, nog {deck.left} op te zoeken
        {deck.left > 0 && <> (ongeveer {deck.minutes} min)</>}.
      </p>
      <progress value={job.done} max={Math.max(1, job.todo)} />
      {need <= 0 ? (
        <p class="notice ok small" data-testid="deck-can-start">
          Je kan al starten: dit spel speelt dan met <strong data-testid="deck-planned">{job.planned ?? job.ready}</strong> van de{' '}
          {job.total} nummers. Het opzoeken loopt door, ook tijdens het spel; wat erbij komt, doet mee vanaf het volgende spel.
          {job.untilFair > 0 ? (
            <span data-testid="deck-unbalanced">
              {' '}
              Start je nu, dan zitten er vooral nummers in die al gekend waren (zoals die uit de standaardlijst van het spel). Over
              ongeveer {minutesLeft(job.untilFair, job.seconds ?? 2)} min is het een evenwichtige greep uit je hele playlist.
            </span>
          ) : (
            <> Het is een evenwichtige greep uit de hele playlist.</>
          )}
        </p>
      ) : (
        <p class="muted small" data-testid="deck-need">
          Nog {need} {need === 1 ? 'nummer' : 'nummers'} met een jaartal nodig voor je kan starten.
        </p>
      )}
      <p class="muted small">
        Nieuwe nummers worden een voor een opgezocht bij MusicBrainz (dat laat 1 verzoek per seconde toe), met Wikidata erbij als
        derde bron. Dat is eenmalig, ook voor andere hosts: daarna zijn ze onthouden. Laat het spel open op deze gsm; na een herlaad gaat het verder.
      </p>
      <button class="btn" onClick={deck.cancel} data-testid="deck-stop">
        Stop met opzoeken
      </button>
    </div>
  );
}

/**
 * Kort wat elke bron zegt ("Spotify 2009 · MusicBrainz 2000 · Wikidata –"),
 * gevolgd door de twijfels die daar niet al in staan. Oudere items hebben
 * alleen de twijfels.
 */
function why(r) {
  const b = r.sources;
  if (!b) return r.doubts.join('; ');
  const year = (y) => y ?? '–';
  const parts = [`Spotify ${year(b.sp)}`, `MusicBrainz ${year(b.mb)}`];
  if ('wd' in b) parts.push(`Wikidata ${year(b.wd)}`);
  const rest = r.doubts.filter((d) => !/^(Spotify|MusicBrainz) zegt /.test(d));
  return [parts.join(' · '), ...rest].join('; ');
}

/** Jaartallen waar de bronnen het oneens zijn; de host kan ze verbeteren. */
function Doubts({ doubts, onYear }) {
  return (
    <details class="tips" data-testid="deck-doubts">
      <summary>
        {doubts.length === 1 ? '1 jaartal' : `${doubts.length} jaartallen`} om na te kijken (verklapt antwoorden)
      </summary>
      <p class="muted small">Klopt een jaar niet? Pas het aan; het wordt onthouden voor de volgende keer, ook voor andere hosts.</p>
      <ul class="doubts">
        {doubts.map((r) => (
          <li key={r.id}>
            <span class="doubt-text">
              <strong>{r.title}</strong> · {r.artist}
              <span class="muted small" data-testid={`doubt-why-${r.id}`}> — {why(r)}</span>
            </span>
            <input
              class="input year-input"
              type="number"
              inputMode="numeric"
              min="1900"
              max="2100"
              value={r.year ?? ''}
              aria-label={`Jaar van ${r.title}`}
              data-testid={`doubt-${r.id}`}
              onChange={(e) => onYear(r.id, e.currentTarget.value)}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
