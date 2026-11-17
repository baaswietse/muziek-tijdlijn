// Welke nummers er gespeeld worden: de standaardlijst van de site of een
// eigen Spotify-playlist van de host. Alleen op de gsm van de host.

import { useState } from 'preact/hooks';

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

  function useDefault() {
    deck.reset();
    send({ t: 'clearDeck' });
  }

  return (
    <section class="card" data-testid="deck-panel">
      <h2>Nummers</h2>
      <p class="deck-current" data-testid="deck-current">
        {playlist ? `Playlist «${playlist.name}» · ${playlist.count} nummers` : 'Standaardlijst van het spel'}
      </p>

      {job ? (
        <div class="deck-job" data-testid="deck-job">
          <p class="small">
            {job.phase === 'tracks' && `«${job.name}» lezen…`}
            {job.phase === 'years' && `«${job.name}»: jaartallen opzoeken, ${job.done} van ${job.total}`}
            {job.phase === 'upload' && `«${job.name}» doorsturen…`}
          </p>
          <progress value={job.done} max={Math.max(1, job.total)} />
          {job.phase === 'years' && job.todo > 0 && (
            <p class="muted small">
              {job.todo} nummers zijn nieuw en worden opgezocht bij MusicBrainz: ongeveer {deck.minutes} min. Dat is eenmalig, ook voor
              andere hosts: daarna zijn ze onthouden. Laat dit scherm open. De spelers kunnen intussen binnenkomen.
            </p>
          )}
          <button class="btn" onClick={deck.cancel}>
            Stop
          </button>
        </div>
      ) : !deck.available ? (
        <p class="muted small">Een eigen playlist kiezen kan niet in de testmodus.</p>
      ) : !loggedIn ? (
        <p class="muted small">Log in bij Spotify (hierboven) om met een eigen playlist te spelen.</p>
      ) : (
        <div class="row gap">
          <button class="btn" onClick={openList} data-testid="deck-open">
            Kies een playlist uit Spotify
          </button>
          {!playlist && deck.last && (
            <button class="btn" onClick={() => deck.choose(deck.last)} data-testid="deck-last">
              Opnieuw «{deck.last.name}»
            </button>
          )}
          {playlist && (
            <button class="btn link" onClick={useDefault} data-testid="deck-default">
              Terug naar de standaardlijst
            </button>
          )}
        </div>
      )}

      {open && !job && (
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

      {deck.result && !job && (
        <>
          {deck.result.note && <p class="notice warn">{deck.result.note}</p>}
          {deck.result.skipped > 0 && (
            <p class="muted small">
              {deck.result.skipped === 1 ? '1 nummer doet' : `${deck.result.skipped} nummers doen`} niet mee (geen jaartal
              gevonden, of meer dan 500 nummers).
            </p>
          )}
          {deck.result.doubts.length > 0 && <Doubts doubts={deck.result.doubts} onYear={deck.setYear} />}
        </>
      )}
    </section>
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
