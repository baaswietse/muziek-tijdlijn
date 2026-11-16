import { useMemo } from 'preact/hooks';
import { inviteUrl } from '../lib/session.js';
import { qrPath } from '../lib/qr.js';
import { MusicPanel } from '../components/MusicPanel.jsx';
import { Rules } from '../components/Rules.jsx';

export function Lobby({ view, send, music, onLeave, notify }) {
  const isHost = view.you === view.hostId;
  const url = inviteUrl(view.code);
  const qr = useMemo(() => qrPath(url), [url]);
  const target = view.settings.target;

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Muziek-tijdlijn', text: `Doe mee met code ${view.code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        notify('Link gekopieerd.');
      }
    } catch {
      // delen geannuleerd
    }
  }

  return (
    <main class="page">
      <section class="card invite">
        <p class="label">Laat de anderen deze code scannen of intikken</p>
        <div class="invite-body">
          <svg class="qr" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label={`QR-code om mee te doen met ${view.code}`} data-testid="qr">
            <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
          <div class="invite-side">
            <span class="big-code" data-testid="big-code">{view.code}</span>
            <button class="btn" onClick={share}>
              Deel de link
            </button>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>
          Spelers <span class="count">{view.players.length}</span>
        </h2>
        <ul class="people" data-testid="lobby-players">
          {view.players.map((p) => (
            <li key={p.id} class={p.online ? '' : 'offline'} data-testid="lobby-player">
              <span class={`dot ${p.online ? 'on' : ''}`} aria-hidden="true" />
              <span class="person-name">{p.name}</span>
              {p.id === view.hostId && <span class="chip">host</span>}
              {p.id === view.you && <span class="chip soft">jij</span>}
              {!p.online && <span class="muted small">offline</span>}
              {isHost && p.id !== view.you && (
                <button class="btn link danger push" onClick={() => confirm(`${p.name} uit het spel halen?`) && send({ t: 'remove', playerId: p.id })}>
                  Verwijder
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <>
          <MusicPanel music={music} />
          <section class="card">
            <h2>Spel</h2>
            <div class="row between">
              <span>Winnen bij</span>
              <span class="stepper">
                <button class="btn round" aria-label="Minder kaarten" disabled={target <= 3} onClick={() => send({ t: 'settings', target: target - 1 })}>
                  −
                </button>
                <strong data-testid="target">{target} kaarten</strong>
                <button class="btn round" aria-label="Meer kaarten" disabled={target >= 20} onClick={() => send({ t: 'settings', target: target + 1 })}>
                  +
                </button>
              </span>
            </div>
            <button class="btn primary big" disabled={!music.ready} onClick={() => send({ t: 'start' })} data-testid="start-game">
              Start het spel
            </button>
            {!music.ready && <p class="muted small center-text">Stel eerst de muziek in.</p>}
          </section>
        </>
      ) : (
        <section class="card center-text">
          <p class="waiting" data-testid="waiting">Wachten tot de host het spel start…</p>
          <p class="muted small">Je speelt naar {target} kaarten.</p>
        </section>
      )}

      <Rules target={target} />
      <button class="btn link danger" onClick={() => confirm('Dit spel verlaten?') && onLeave()}>
        Verlaat het spel
      </button>
    </main>
  );
}
