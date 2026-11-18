// Welke nummers er gespeeld worden: de standaardlijst van de site of een
// eigen Spotify-playlist van de host. Alleen op de gsm van de host.

import { useState } from 'preact/hooks';
import { MAX_DECK as MAX, minutesLeft } from '../lib/deckplan.js';

export function DeckPanel({ view, send, deck, loggedIn }) {
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
        {playlist ? `Playlist «${playlist.name}» · ${playlist.count} nummers` : 'Standaardlijst van het spel'}
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
        Nieuwe nummers worden een voor een opgezocht bij MusicBrainz (dat laat 1 verzoek per seconde toe). Dat is eenmalig, ook voor
        andere hosts: daarna zijn ze onthouden. Laat het spel open op deze gsm; na een herlaad gaat het verder.
      </p>
      <button class="btn" onClick={deck.cancel} data-testid="deck-stop">
        Stop met opzoeken
      </button>
    </div>
  );
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
              <span class="muted small"> — {r.doubts.join('; ')}</span>
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
