import { useEffect, useRef, useState } from 'preact/hooks';
import { Timeline, YearChips, slotLabel } from '../components/Timeline.jsx';
import { MusicPanel } from '../components/MusicPanel.jsx';
import { Rules } from '../components/Rules.jsx';

export function Game({ view, send, music, deck, onLeave }) {
  const me = view.you;
  const isHost = me === view.hostId;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const playing = view.phase === 'playing';
  // Tussenfase: de plaats ligt vast, anderen kunnen nog een token inzetten.
  const challenge = view.phase === 'challenge';
  const finished = view.phase === 'finished';
  const reveal = view.reveal;
  const activeId = playing || challenge ? view.turn.playerId : reveal?.playerId;
  const active = byId.get(activeId);
  const mine = byId.get(me);
  const myTurn = playing && activeId === me;
  const target = view.settings.target;

  // Wat er tijdens het spel bij de eigen playlist bijkwam, eerst naar de server.
  async function playAgain() {
    await deck?.flush();
    send({ t: 'start' });
  }

  // Jouw voorlopige keuze: meteen zichtbaar bij jou, en via de server bij de rest.
  // De fase hoort erbij: na "Ander nummer" in de tussenfase begint je keuze opnieuw.
  const turnKey = playing || challenge ? `${view.phase}:${view.game}:${view.turn.number}:${activeId}` : view.phase;
  const [pick, setPick] = useState(null);
  const [placing, setPlacing] = useState(false);
  // Waar jij een token wil inzetten: eerst aantikken, dan bevestigen.
  const [betPick, setBetPick] = useState(null);
  // Hoe het bevestigen loopt: null (nog niet getikt), 'sending' (onderweg),
  // 'offline' (geen verbinding) of 'slow' (de server antwoordde niet).
  const [betSend, setBetSend] = useState(null);
  // Na de onthulling: 'picked' (aangetikt, niet bevestigd) of 'sent' (bevestigd,
  // maar niet aangekomen) als je token niet ingezet raakte. Dat zegt het scherm
  // dan, want je hebt het nog.
  const [missed, setMissed] = useState(null);
  const unconfirmed = useRef(null);
  useEffect(() => {
    const left = unconfirmed.current;
    const counted = view.reveal && (view.reveal.bets ?? []).some((b) => b.playerId === me);
    setMissed(left && view.reveal && !counted ? left : null);
    setPick(myTurn ? view.turn.pendingIndex : null);
    setPlacing(false);
    setBetPick(null);
    setBetSend(null);
  }, [turnKey]);

  const bets = challenge ? view.turn.bets : [];
  const myBet = bets.find((b) => b.playerId === me);
  const taken = new Set(challenge ? [view.turn.placedIndex, ...bets.map((b) => b.index)] : []);
  // Zijn alle andere plaatsen al bezet, dan valt er niets meer in te zetten.
  const slotsFull = challenge && taken.size >= (active?.timeline.length ?? 0) + 1;
  const hasTokens = (mine?.guessTokens ?? 0) > 0;
  const canBet = challenge && activeId !== me && !myBet && hasTokens && !slotsFull;
  // Nam iemand anders jouw plaats net in, dan vervalt je keuze.
  const betChoice = canBet && betPick !== null && !taken.has(betPick) ? betPick : null;
  const myTokens = mine?.guessTokens ?? 0;
  // Loopt na het effect hierboven: onthoudt of er bij de vorige weergave nog een
  // keuze openstond, zodat dat effect bij de onthulling weet wat er wegviel.
  useEffect(() => {
    unconfirmed.current = betChoice === null ? null : betSend ? 'sent' : 'picked';
  });
  // Komt er geen antwoord op je inzet, dan zegt het scherm dat na even.
  useEffect(() => {
    if (betSend !== 'sending') return undefined;
    const timer = setTimeout(() => setBetSend('slow'), BET_TIMEOUT);
    return () => clearTimeout(timer);
  }, [betSend]);
  // De bevestigknop staat bij de gekozen plaats; schuif hem zo nodig in beeld,
  // boven de plek waar meldingen onderaan verschijnen.
  useEffect(() => {
    if (betChoice === null) return;
    const btn = document.querySelector('[data-testid="confirm-bet"]');
    if (!btn) return;
    const room = window.innerHeight - 120;
    const { bottom } = btn.getBoundingClientRect();
    if (bottom > room) window.scrollBy(0, bottom - room);
  }, [betChoice]);
  const nameOf = (id) => (id === me ? 'jij' : byId.get(id)?.name ?? 'iemand');
  // Namen bij de gaten: wie zette waar in (en na de onthulling: juist of fout).
  const marks = (challenge ? bets : reveal?.bets ?? []).map((b) => ({
    ...b,
    name: b.playerId === me ? 'Jij' : byId.get(b.playerId)?.name ?? 'Iemand',
  }));

  function choose(i) {
    setPick(i);
    send({ t: 'select', index: i });
  }

  function chooseBet(i) {
    setBetPick(i);
    setBetSend(null);
  }

  function confirmBet() {
    if (betChoice === null || betSend === 'sending') return;
    // Lukt het versturen niet, dan blijft je keuze staan en zegt het scherm waarom.
    setBetSend(send({ t: 'challenge', index: betChoice }) ? 'sending' : 'offline');
  }

  function revealNow() {
    if (betChoice !== null && !confirm('Je token is nog niet ingezet. Toch onthullen?')) return;
    send({ t: 'reveal' });
  }

  function confirmPlace() {
    if (pick === null) return;
    if (send({ t: 'place', index: pick })) setPlacing(true);
  }

  const pendingIndex = playing ? (myTurn ? pick : view.turn.pendingIndex) : challenge ? betChoice : null;
  const canContinue = view.phase === 'reveal' && (me === reveal.playerId || isHost);
  // Het token geven mag wie ook mag doorgaan, en ook nog na de beslissende
  // kaart; de anderen kunnen het alleen voor zichzelf opeisen.
  const canGiveToken = Boolean(reveal) && (me === reveal.playerId || isHost);

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

      {challenge && (
        <ChallengeBanner
          view={view}
          onReveal={revealNow}
          activeName={nameOf(activeId)}
          canReveal={activeId === me || isHost}
          canBet={canBet}
          myBet={myBet}
          tokens={myTokens}
          slotsFull={slotsFull && activeId !== me && !myBet && hasTokens}
          picking={betChoice !== null}
        />
      )}

      {reveal && (
        <Reveal
          reveal={reveal}
          name={reveal.playerId === me ? 'Jij' : byId.get(reveal.playerId)?.name ?? 'Iemand'}
          own={reveal.playerId === me}
          tokenName={reveal.guessTokenTo ? (reveal.guessTokenTo === me ? 'jou' : byId.get(reveal.guessTokenTo)?.name) : null}
          cardTo={reveal.cardTo ? (reveal.cardTo === me ? 'Jij krijgt' : `${byId.get(reveal.cardTo)?.name ?? 'Iemand'} krijgt`) : null}
          myBet={reveal.bets.find((b) => b.playerId === me)}
          myTokens={myTokens}
        />
      )}

      {reveal && missed && (
        <p class="notice warn" role="status" data-testid="bet-missed" data-reason={missed}>
          {missed === 'sent'
            ? 'Je token raakte niet tot bij de server en is niet ingezet.'
            : 'Je token is niet ingezet: je had een plaats aangetikt maar niet bevestigd.'}{' '}
          Je hebt nog <strong>{tokenText(myTokens)}</strong>.
        </p>
      )}

      {reveal && (canGiveToken ? <TokenPicker view={view} send={send} /> : <TokenClaim view={view} send={send} />)}

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
          <button class="btn primary big grow" onClick={playAgain} disabled={!music.ready} data-testid="play-again">
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
            onPick={myTurn && !placing ? choose : canBet ? chooseBet : undefined}
            reveal={reveal && reveal.playerId === active.id ? reveal : undefined}
            lockedIndex={challenge ? view.turn.placedIndex : null}
            lockedText={`Hier legde ${activeId === me ? 'je' : active.name} het nummer`}
            betPick={
              betChoice === null
                ? undefined
                : {
                    state: betSend ?? 'picked',
                    title: betSend === 'sending' ? 'Token wordt ingezet…' : 'Nog niet ingezet',
                    hint: betSend === 'sending' ? 'Even geduld.' : 'Je token is pas ingezet als je op de knop tikt.',
                    action: (
                      <>
                        {(betSend === 'offline' || betSend === 'slow') && (
                          <p class="notice error" role="alert" data-testid="bet-error">
                            {betSend === 'offline'
                              ? 'Geen verbinding: je token is nog niet ingezet. Tik opnieuw zodra je weer verbonden bent.'
                              : 'Je token is nog niet ingezet: de server gaf geen antwoord. Tik opnieuw.'}
                          </p>
                        )}
                        <button
                          type="button"
                          class="btn primary big"
                          onClick={confirmBet}
                          disabled={betSend === 'sending'}
                          data-testid="confirm-bet"
                        >
                          {betSend === 'sending' ? 'Even geduld…' : `Zet token ${slotLabel(active.timeline, betChoice)}`}
                        </button>
                      </>
                    ),
                  }
            }
            blocked={taken}
            marks={marks}
          />
        </section>
      )}

      {mine && (!active || active.id !== me) && (
        <section class="card" data-testid="my-section">
          <h2>
            Jouw tijdlijn
            <Score n={mine.timeline.length} target={target} />
          </h2>
          <Timeline testid="my-timeline" cards={mine.timeline} freshId={reveal?.cardTo === me ? reveal.card.id : null} />
        </section>
      )}

      <section class="card">
        <h2>Iedereen</h2>
        <ul class="board" data-testid="board">
          {view.players
            .slice()
            .sort((a, b) => b.timeline.length - a.timeline.length)
            .map((p) => (
              <PlayerRow key={p.id} p={p} view={view} isActive={p.id === activeId && (playing || challenge)} isHost={isHost} send={send} />
            ))}
        </ul>
        <p class="muted small">
          Nog {view.deckLeft} nummers in de stapel{view.turn ? ` · beurt ${view.turn.number}` : ''}
        </p>
      </section>

      {isHost && <HostControls view={view} send={send} music={music} deck={deck} />}

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

// Zolang wacht je token op een antwoord van de server.
const BET_TIMEOUT = 5000;

const tokenText = (n) => `${n} ${n === 1 ? 'token' : 'tokens'}`;

function Score({ n, target }) {
  return (
    <span class="score" data-testid="score">
      {n} / {target}
    </span>
  );
}

/**
 * Tussenfase na het leggen. De speler aan beurt en de host kunnen onthullen;
 * wie een token heeft, kan het inzetten op een andere plaats.
 */
function ChallengeBanner({ view, onReveal, activeName, canReveal, canBet, myBet, tokens, slotsFull, picking }) {
  const mineTurn = view.turn.playerId === view.you;
  const who = activeName[0].toUpperCase() + activeName.slice(1);
  const count = <strong data-testid="my-tokens">{tokenText(tokens)}</strong>;
  let text;
  if (mineTurn) text = 'Wie een token heeft, kan nog een andere plaats kiezen. Tik op Onthul als iedereen klaar is.';
  else if (myBet) text = <>Je zette een token in en hebt nog {count}. Wachten tot {activeName} of de host onthult…</>;
  else if (canBet) text = <>Ligt {activeName} fout? Tik een andere plaats aan en zet er een token in. Je hebt {count}.</>;
  else if (slotsFull) text = <>Alle andere plaatsen zijn al bezet. Je houdt je {count}. Wachten op de onthulling…</>;
  else text = `${who} legde het nummer. Wie een token heeft, kan nog inzetten. Wachten op de onthulling…`;
  return (
    <section class="now challenge" data-testid="challenge-banner" data-active={view.turn.playerId} data-can-bet={canBet ? 'yes' : 'no'}>
      <div class="grow">
        <p class="now-who">{mineTurn ? 'Je kaart ligt vast' : myBet ? 'Token ingezet' : canBet ? 'Token inzetten?' : 'Even wachten'}</p>
        <p class="now-what">{text}</p>
        {/* Heb je zelf een plaats aangetikt, dan is bevestigen bij die plaats de hoofdknop. */}
        {canReveal && (
          <button class={`btn${picking ? '' : ' primary'} big challenge-reveal`} onClick={onReveal} data-testid="reveal-now">
            Onthul
          </button>
        )}
      </div>
    </section>
  );
}

function Reveal({ reveal, name, own, tokenName, cardTo, myBet, myTokens }) {
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
      {reveal.bets.length > 0 && !correct && (
        <p class="reveal-token" data-testid="reveal-card-to" data-player={reveal.cardTo ?? ''}>
          {cardTo ? `${cardTo} de kaart dankzij een token.` : 'Geen enkele inzet lag juist.'}
        </p>
      )}
      {reveal.bets.length > 0 && correct && <p class="reveal-token">De ingezette tokens zijn verloren.</p>}
      {myBet && (
        <p class="reveal-token" data-testid="reveal-my-bet" data-correct={myBet.correct ? 'yes' : 'no'}>
          Jouw token lag {myBet.correct ? 'juist' : 'fout'}. Een ingezet token ben je altijd kwijt: je hebt nog {tokenText(myTokens)}.
        </p>
      )}
      {tokenName && (
        <p class="reveal-token" data-testid="reveal-token" data-player={reveal.guessTokenTo}>
          Token voor {tokenName}
        </p>
      )}
    </section>
  );
}

/**
 * Wie artiest en nummer als eerste juist raadde (hardop aan tafel), krijgt het
 * token van deze beurt. Raadvolgorde: eerst wie aan de beurt was, dan de
 * volgenden in beurtvolgorde. Nog eens tikken neemt het terug.
 */
function TokenPicker({ view, send }) {
  const players = view.players;
  const start = Math.max(0, players.findIndex((p) => p.id === view.reveal.playerId));
  const order = players.slice(start).concat(players.slice(0, start));
  const given = view.reveal.guessTokenTo ?? null;
  return (
    <section class="guess" data-testid="token-picker" aria-labelledby="guess-title">
      <p class="guess-title" id="guess-title">
        Wie raadde artiest en nummer?
      </p>
      <div class="guess-list">
        {order.map((p) => {
          const on = p.id === given;
          return (
            <button
              key={p.id}
              type="button"
              class={`guess-btn${on ? ' on' : ''}`}
              aria-pressed={on ? 'true' : 'false'}
              onClick={() => send({ t: 'token', playerId: on ? null : p.id })}
              data-testid="token-button"
              data-player={p.id}
            >
              {on && <span aria-hidden="true">✓ </span>}
              {p.id === view.you ? 'Ikzelf' : p.name}
            </button>
          );
        })}
      </div>
      <p class="muted small">{given ? 'Tik nog eens om het token terug te nemen.' : 'Niemand? Dan geef je geen token.'}</p>
    </section>
  );
}

/** Voor de andere spelers: het token van deze beurt voor zichzelf opeisen. */
function TokenClaim({ view, send }) {
  const given = view.reveal.guessTokenTo ?? null;
  if (given && given !== view.you) return null;
  const mine = given === view.you;
  return (
    <section class="guess" data-testid="token-claim">
      <button
        type="button"
        class={`btn${mine ? '' : ' primary'}`}
        onClick={() => send({ t: 'token', playerId: mine ? null : view.you })}
        data-testid={mine ? 'token-unclaim' : 'token-claim-button'}
      >
        {mine ? 'Toch niet' : 'Ik raadde artiest en nummer'}
      </button>
      <p class="muted small">{mine ? 'Het token van deze beurt is voor jou.' : 'Als eerste juist geraden? Eis dan het token op.'}</p>
    </section>
  );
}

/** Aantal tokens als gewone tekst ("2 tokens"), zodat het ook zonder kleur leest. */
function Tokens({ n }) {
  return (
    <span class={`tokens push${n ? '' : ' none'}`} data-testid="token-count" data-count={n}>
      {n} {n === 1 ? 'token' : 'tokens'}
    </span>
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
      <TokenSummary view={view} />
    </section>
  );
}

/**
 * Op het eindscherm: wie nog hoeveel tokens heeft (de 2 van de start plus wat
 * hij verdiende, min wat hij inzette). Een nieuw spel begint weer met 2.
 */
function TokenSummary({ view }) {
  const withTokens = view.players
    .filter((p) => (p.guessTokens ?? 0) > 0)
    .sort((a, b) => b.guessTokens - a.guessTokens);
  return (
    <p class="winner-tokens" data-testid="winner-tokens">
      {withTokens.length === 0
        ? 'Niemand heeft nog tokens over.'
        : `Tokens over: ${withTokens.map((p) => `${p.id === view.you ? 'jij' : p.name} ${p.guessTokens}`).join(' · ')}`}
    </p>
  );
}

function PlayerRow({ p, view, isActive, isHost, send }) {
  const [open, setOpen] = useState(false);
  const target = view.settings.target;
  return (
    <li class={`board-row${isActive ? ' active' : ''}${p.online ? '' : ' offline'}`} data-testid="board-row" data-player={p.id} data-count={p.timeline.length} data-tokens={p.guessTokens ?? 0}>
      <button type="button" class="board-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class={`dot ${p.online ? 'on' : ''}`} aria-hidden="true" />
        <span class="person-name">{p.name}</span>
        {p.id === view.you && <span class="chip soft">jij</span>}
        {p.id === view.hostId && <span class="chip">host</span>}
        {!p.online && <span class="muted small">offline</span>}
        <Tokens n={p.guessTokens ?? 0} />
        <span class="score">
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

function HostControls({ view, send, music, deck }) {
  const [settings, setSettings] = useState(false);
  // Ook in de tussenfase loopt de beurt nog: overslaan kan dan ook.
  const playing = view.phase === 'playing' || view.phase === 'challenge';
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
      {deck?.job?.phase === 'years' && (
        <p class="muted small" data-testid="deck-background">
          Jaartallen opzoeken voor «{deck.job.name}»: {deck.job.ready} klaar, nog {deck.left} te gaan
          {deck.left > 0 && <> (ongeveer {deck.minutes} min)</>}. Wat erbij komt, doet mee vanaf het volgende spel.
        </p>
      )}
    </section>
  );
}

const MUSIC_STATUS = {
  starting: 'Nummer wordt gestart…',
  paused: 'Gepauzeerd',
  error: 'Probleem met de muziek',
};
