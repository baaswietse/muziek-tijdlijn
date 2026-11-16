import { useEffect, useState } from 'preact/hooks';
import { Timeline, YearChips, slotLabel } from '../components/Timeline.jsx';
import { MusicPanel } from '../components/MusicPanel.jsx';
import { Rules } from '../components/Rules.jsx';

export function Game({ view, send, music, onLeave }) {
  const me = view.you;
  const isHost = me === view.hostId;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const playing = view.phase === 'playing';
  const finished = view.phase === 'finished';
  const reveal = view.reveal;
  const activeId = playing ? view.turn.playerId : reveal?.playerId;
  const active = byId.get(activeId);
  const mine = byId.get(me);
  const myTurn = playing && activeId === me;
  const target = view.settings.target;

  // Jouw voorlopige keuze: meteen zichtbaar bij jou, en via de server bij de rest.
  const turnKey = playing ? `${view.game}:${view.turn.number}:${activeId}` : '';
  const [pick, setPick] = useState(null);
  const [placing, setPlacing] = useState(false);
  useEffect(() => {
    setPick(myTurn ? view.turn.pendingIndex : null);
    setPlacing(false);
  }, [turnKey]);

  function choose(i) {
    setPick(i);
    send({ t: 'select', index: i });
  }

  function confirmPlace() {
    if (pick === null) return;
    if (send({ t: 'place', index: pick })) setPlacing(true);
  }

  const pendingIndex = playing ? (myTurn ? pick : view.turn.pendingIndex) : null;
  const canContinue = view.phase === 'reveal' && (me === reveal.playerId || isHost);

  return (
    <main class={`page game${myTurn && pick !== null ? ' has-bar' : ''}`}>
      {finished && <Winners view={view} byId={byId} />}

      {playing && (
        <section class={`now${myTurn ? ' mine' : ''}`} data-testid="turn-banner" data-active={activeId} data-mine={myTurn ? 'yes' : 'no'}>
          <div class="eq" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
          <div>
            <p class="now-who">{myTurn ? 'Jij bent aan de beurt' : `${active?.name ?? 'Iemand'} is aan de beurt`}</p>
            <p class="now-what">{myTurn ? 'Uit welk jaar is dit nummer? Kies een plaats op je tijdlijn.' : 'Luister mee. Waar zou jij het leggen?'}</p>
          </div>
        </section>
      )}

      {reveal && <Reveal reveal={reveal} name={reveal.playerId === me ? 'Jij' : byId.get(reveal.playerId)?.name ?? 'Iemand'} own={reveal.playerId === me} />}

      {view.phase === 'reveal' &&
        (canContinue ? (
          <button class="btn primary big" onClick={() => send({ t: 'next' })} data-testid="next-turn">
            Volgende beurt
          </button>
        ) : (
          <p class="muted center-text small">Wachten tot {byId.get(reveal.playerId)?.name ?? 'de speler'} of de host doorgaat…</p>
        ))}

      {finished && isHost && (
        <div class="row gap">
          <button class="btn primary big grow" onClick={() => send({ t: 'start' })} disabled={!music.ready} data-testid="play-again">
            Nog een spel
          </button>
          <button class="btn big" onClick={() => send({ t: 'lobby' })}>
            Wachtkamer
          </button>
        </div>
      )}
      {finished && !isHost && <p class="muted center-text small">De host kan een nieuw spel starten.</p>}

      {active && (
        <section class="card" data-testid="active-section" data-player={active.id}>
          <h2>
            {active.id === me ? 'Jouw tijdlijn' : `Tijdlijn van ${active.name}`}
            <Score n={active.timeline.length} target={target} />
          </h2>
          <Timeline
            testid="active-timeline"
            cards={active.timeline}
            pendingIndex={pendingIndex}
            onPick={myTurn && !placing ? choose : undefined}
            reveal={reveal && reveal.playerId === active.id ? reveal : undefined}
          />
        </section>
      )}

      {mine && (!active || active.id !== me) && (
        <section class="card" data-testid="my-section">
          <h2>
            Jouw tijdlijn
            <Score n={mine.timeline.length} target={target} />
          </h2>
          <Timeline testid="my-timeline" cards={mine.timeline} />
        </section>
      )}

      <section class="card">
        <h2>Iedereen</h2>
        <ul class="board" data-testid="board">
          {view.players
            .slice()
            .sort((a, b) => b.timeline.length - a.timeline.length)
            .map((p) => (
              <PlayerRow key={p.id} p={p} view={view} isActive={p.id === activeId && playing} isHost={isHost} send={send} />
            ))}
        </ul>
        <p class="muted small">
          Nog {view.deckLeft} nummers in de stapel{view.turn ? ` · beurt ${view.turn.number}` : ''}
        </p>
      </section>

      {isHost && <HostControls view={view} send={send} music={music} />}

      <Rules target={target} />
      <button class="btn link danger" onClick={() => confirm('Dit spel verlaten?') && onLeave()}>
        Verlaat het spel
      </button>

      {myTurn && pick !== null && (
        <div class="confirm-bar">
          <button class="btn primary big" onClick={confirmPlace} disabled={placing} data-testid="confirm-place">
            {placing ? 'Even geduld…' : `Leg het ${slotLabel(active.timeline, pick)}`}
          </button>
        </div>
      )}
    </main>
  );
}

function Score({ n, target }) {
  return (
    <span class="score" data-testid="score">
      {n} / {target}
    </span>
  );
}

function Reveal({ reveal, name, own }) {
  const { card, correct } = reveal;
  return (
    <section class={`reveal ${correct ? 'good' : 'bad'}`} data-testid="reveal" data-correct={correct ? 'yes' : 'no'} data-track={card.id}>
      <p class="reveal-verdict">
        {correct ? `Juist! ${name} houdt de kaart.` : `Fout. ${own ? 'Je bent' : `${name} is`} de kaart kwijt.`}
      </p>
      <p class="reveal-year">{card.year}</p>
      <p class="reveal-title">{card.title}</p>
      <p class="reveal-artist">{card.artist}</p>
      <a class="spotify-link" href={`https://open.spotify.com/track/${card.id}`} target="_blank" rel="noopener noreferrer">
        Open in Spotify
      </a>
    </section>
  );
}

function Winners({ view, byId }) {
  const names = view.winnerIds.map((id) => (id === view.you ? 'Jij' : byId.get(id)?.name)).filter(Boolean);
  const iWon = view.winnerIds.includes(view.you);
  let text;
  if (names.length === 0) text = 'Het spel is afgelopen.';
  else if (names.length === 1) text = iWon ? 'Jij wint!' : `${names[0]} wint!`;
  else text = `Gelijkspel: ${names.join(' en ')}`;
  return (
    <section class="winner" data-testid="winner" data-winners={view.winnerIds.join(',')}>
      <p class="winner-label">Spel afgelopen</p>
      <p class="winner-name">{text}</p>
    </section>
  );
}

function PlayerRow({ p, view, isActive, isHost, send }) {
  const [open, setOpen] = useState(false);
  const target = view.settings.target;
  return (
    <li class={`board-row${isActive ? ' active' : ''}${p.online ? '' : ' offline'}`} data-testid="board-row" data-player={p.id} data-count={p.timeline.length}>
      <button type="button" class="board-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class={`dot ${p.online ? 'on' : ''}`} aria-hidden="true" />
        <span class="person-name">{p.name}</span>
        {p.id === view.you && <span class="chip soft">jij</span>}
        {p.id === view.hostId && <span class="chip">host</span>}
        {!p.online && <span class="muted small">offline</span>}
        <span class="push score">
          {p.timeline.length} / {target}
        </span>
      </button>
      <div class="meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (p.timeline.length / target) * 100)}%` }} />
      </div>
      {open ? (
        <>
          <Timeline cards={p.timeline} />
          {isHost && p.id !== view.you && (
            <button class="btn link danger" onClick={() => confirm(`${p.name} uit het spel halen?`) && send({ t: 'remove', playerId: p.id })}>
              Haal {p.name} uit het spel
            </button>
          )}
        </>
      ) : (
        <YearChips cards={p.timeline} />
      )}
    </li>
  );
}

function HostControls({ view, send, music }) {
  const [settings, setSettings] = useState(false);
  const playing = view.phase === 'playing';
  const trackId = music.currentTrackId;
  const needsSetup = !music.ready;
  return (
    <section class="card host" data-testid="host-controls">
      <div class="row between">
        <h2>Host</h2>
        <span class="muted small" data-testid="host-music-status" data-status={music.status}>
          {needsSetup ? 'Muziek niet klaar' : MUSIC_STATUS[music.status] || `Speelt op «${music.device.name}»`}
        </span>
      </div>
      {music.error && (
        <p class="notice error" data-testid="host-music-error">
          {music.error}
        </p>
      )}
      <div class="host-grid">
        <button class="btn" disabled={!trackId || needsSetup} onClick={() => music.playTrack(trackId)} data-testid="replay">
          Opnieuw afspelen
        </button>
        {music.status === 'paused' ? (
          <button class="btn" disabled={needsSetup} onClick={music.resume}>
            Verder spelen
          </button>
        ) : (
          <button class="btn" disabled={needsSetup} onClick={music.pause}>
            Pauze
          </button>
        )}
        <button class="btn" disabled={!playing} onClick={() => send({ t: 'skipTrack' })} data-testid="skip-track">
          Ander nummer
        </button>
        <button class="btn" disabled={!playing} onClick={() => confirm('De beurt van deze speler overslaan?') && send({ t: 'skipTurn' })} data-testid="skip-turn">
          Sla beurt over
        </button>
      </div>
      <div class="row between">
        <button class="btn link" onClick={() => setSettings(!settings)} aria-expanded={settings || needsSetup}>
          {settings ? 'Verberg muziekinstellingen' : 'Muziekinstellingen'}
        </button>
        {view.phase !== 'finished' && (
          <button class="btn link danger" onClick={() => confirm('Dit spel stoppen en terug naar de wachtkamer?') && send({ t: 'lobby' })}>
            Stop dit spel
          </button>
        )}
      </div>
      {(settings || needsSetup) && <MusicPanel music={music} />}
    </section>
  );
}

const MUSIC_STATUS = {
  starting: 'Nummer wordt gestart…',
  paused: 'Gepauzeerd',
  error: 'Probleem met de muziek',
};
