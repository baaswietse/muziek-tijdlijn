import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Timeline, YearChips, slotLabel } from '../components/Timeline.jsx';
import { step, useSlotDrag } from '../lib/drag.js';
import { MusicPanel } from '../components/MusicPanel.jsx';
import { deezerId, deezerLink } from '../fragment/deezer.js';
import { Rules } from '../components/Rules.jsx';
import { ListenAlert, ListenButton, ListenHint, ListenToggle } from '../components/Listen.jsx';
import { MockChip, NetBanner, NetDot } from '../components/Status.jsx';
import { HandOver, HostAway } from '../components/Host.jsx';

// Het spelscherm: één ding per moment. Bovenaan een balk met de stand en het
// menu, daaronder één regel uitleg, dan één tijdlijn, en onderaan de zwevende
// balk met de knop die je nu nodig hebt. Alles wat je niet elke beurt nodig
// hebt (stand, hostbediening, spelregels) zit achter één tik in een paneel.

export function Game({ view, send, music, listen = null, deck, net = 'online', onLeave }) {
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

  // Welke beurt dit is; blijft staan tijdens de onthulling (dan is er geen `turn`).
  const turnNo = useRef(null);
  if (view.turn) turnNo.current = `${view.game}:${view.turn.number}`;

  // Welk paneel open is: null, 'stand' of 'menu'.
  const [panel, setPanel] = useState(null);
  // Muziekinstellingen open in het menu.
  const [settings, setSettings] = useState(false);
  // Wiens tijdlijn je bekijkt (null = die waarop nu gespeeld wordt).
  const [viewId, setViewId] = useState(null);

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
  // Waar jij een token wil inzetten: eerst kiezen, dan bevestigen.
  const [betPick, setBetPick] = useState(null);
  // Hoe het bevestigen loopt: null (nog niet getikt), 'sending' (onderweg),
  // 'offline' (geen verbinding) of 'slow' (de server antwoordde niet).
  const [betSend, setBetSend] = useState(null);
  // Na de onthulling: 'picked' (gekozen, niet bevestigd) of 'sent' (bevestigd,
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
    // Een nieuwe beurt (of de onthulling): terug naar de tijdlijn die telt.
    setViewId(null);
  }, [turnKey]);

  const bets = challenge ? view.turn.bets : [];
  const myBet = bets.find((b) => b.playerId === me);
  // Op wie het onthullen nog wacht (inzetten of passen), en of jij al paste.
  const waiting = challenge ? view.turn.waiting ?? [] : [];
  const blocked = waiting.length > 0;
  const myPassed = challenge && (view.turn.passes ?? []).includes(me);
  const taken = new Set(challenge ? [view.turn.placedIndex, ...bets.map((b) => b.index)] : []);
  // Zijn alle andere plaatsen al bezet, dan valt er niets meer in te zetten.
  const slotsFull = challenge && taken.size >= (active?.timeline.length ?? 0) + 1;
  const myTokens = mine?.guessTokens ?? 0;
  const hasTokens = myTokens > 0;
  const canBet = challenge && activeId !== me && !myBet && !myPassed && hasTokens && !slotsFull;
  // Nam iemand anders jouw plaats net in, dan vervalt je keuze.
  const betChoice = canBet && betPick !== null && !taken.has(betPick) ? betPick : null;
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
  const nameOf = (id) => (id === me ? 'jij' : byId.get(id)?.name ?? 'iemand');
  // Namen bij de gaten: wie zette waar in (en na de onthulling: juist of fout).
  const marks = (challenge ? bets : reveal?.bets ?? []).map((b) => ({
    ...b,
    name: b.playerId === me ? 'Jij' : byId.get(b.playerId)?.name ?? 'Iemand',
  }));

  function confirmBet() {
    if (betChoice === null || betSend === 'sending') return;
    // Lukt het versturen niet, dan blijft je keuze staan en zegt het scherm waarom.
    setBetSend(send({ t: 'challenge', index: betChoice }) ? 'sending' : 'offline');
  }

  function confirmPlace() {
    if (pick === null) return;
    if (send({ t: 'place', index: pick })) setPlacing(true);
  }

  const canContinue = view.phase === 'reveal' && (me === reveal.playerId || isHost);
  const waitNames = waiting.map((id) => (id === me ? 'jou' : byId.get(id)?.name ?? 'iemand'));
  const waitText = `Nog wachten op ${joinNames(waitNames)}.`;

  // De hoofdknop van de beurt staat altijd op dezelfde plek: in de zwevende
  // balk onderaan. Na elkaar: leggen, je eigen keuze in de tussenfase (een
  // host die moet kiezen, kiest eerst), onthullen, de volgende beurt en op
  // het einde (voor de host) een nieuw spel.
  let action = null;
  if (myTurn) {
    action = {
      kind: 'place',
      testid: 'confirm-place',
      label: placing ? 'Even geduld…' : pick === null ? 'Kies eerst een plaats' : `Leg het ${slotLabel(active.timeline, pick)}`,
      onClick: confirmPlace,
      disabled: placing || pick === null,
    };
  } else if (canBet) {
    // Een plaats gekozen? Dan is bevestigen bij die plaats de hoofdknop.
    action = {
      kind: 'pass',
      testid: 'pass-bet',
      label: 'Ik zet geen token in',
      onClick: () => send({ t: 'pass' }),
      secondary: betChoice !== null,
      note: blocked ? waitText : null,
    };
  } else if (challenge && (activeId === me || isHost)) {
    action = {
      kind: 'reveal',
      testid: 'reveal-now',
      label: 'Onthul',
      onClick: () => send({ t: 'reveal' }),
      disabled: blocked,
      note: blocked ? waitText : null,
    };
  } else if (canContinue) {
    action = { kind: 'next', testid: 'next-turn', label: 'Volgende beurt', onClick: () => send({ t: 'next' }) };
  } else if (finished && isHost) {
    action = { kind: 'again', testid: 'play-again', label: 'Nog een spel', onClick: playAgain, disabled: !music.ready };
  }
  // Op wie er gewacht wordt, staat één keer op het scherm: bij de knop als die
  // erop wacht, anders in de uitlegregel.
  const waitInBar = Boolean(action?.note);

  // Het token geven mag wie ook mag doorgaan, en ook nog na de beslissende
  // kaart; de anderen kunnen het alleen voor zichzelf opeisen.
  const canGiveToken = Boolean(reveal) && (me === reveal.playerId || isHost);

  // Welke tijdlijn er staat: standaard die van wie aan de beurt is (of was).
  const mainId = active?.id ?? me;
  const shownId = viewId && byId.has(viewId) ? viewId : mainId;
  const shown = byId.get(shownId);
  const views = [];
  if (active) views.push({ id: active.id, label: active.id === me ? 'Mijn tijdlijn' : `Tijdlijn van ${active.name}`, testid: active.id === me ? 'view-mine' : 'view-active' });
  if (mine && active?.id !== me) views.push({ id: me, label: 'Mijn tijdlijn', testid: 'view-mine' });
  if (shown && !views.some((v) => v.id === shown.id)) views.push({ id: shown.id, label: shown.name, testid: 'view-other' });

  // Zelf iets leggen: je kaart op je eigen beurt, of je token in de tussenfase.
  // Het stuk ligt eerst in de houder boven de zwevende balk en gaat met slepen
  // of met de knoppen omhoog/omlaag naar een plaats op de tijdlijn die er staat.
  const onActive = Boolean(shown) && shown.id === activeId;
  const placeKind = myTurn && !placing && onActive ? 'card' : canBet && onActive ? 'token' : null;
  const placeIndex = placeKind === 'card' ? pick : placeKind === 'token' ? betChoice : null;
  const placeCards = active?.timeline ?? [];
  const placeBlocked = placeKind === 'token' ? taken : null;
  const placeName = (i) => (i === null ? 'in de houder' : slotLabel(placeCards, i));
  const listRef = useRef(null);
  // Na een tik op omhoog/omlaag: de focus blijft op die knop, ook al staat het
  // stuk nu ergens anders, en het stuk blijft in beeld.
  const refocus = useRef(null);
  const [announce, setAnnounce] = useState('');

  function moveTo(i) {
    if (placeKind === 'card') {
      setPick(i);
      // De voorlopige keuze gaat naar de server, zodat de anderen zien waar je twijfelt.
      send({ t: 'select', index: i });
      setAnnounce(i === null ? 'De kaart ligt weer in de houder.' : `De kaart ligt nu ${placeName(i)}.`);
    } else if (placeKind === 'token') {
      setBetPick(i);
      setBetSend(null);
      setAnnounce(i === null ? 'Je token ligt weer in de houder.' : `Je token ligt nu ${placeName(i)}, nog niet ingezet.`);
    }
  }

  function moveStep(dir) {
    const next = step(placeIndex, dir, placeCards.length, placeBlocked);
    if (next === undefined) return;
    refocus.current = dir;
    moveTo(next);
  }

  const drag = useSlotDrag({
    listRef,
    count: placeCards.length,
    index: placeIndex,
    blocked: placeBlocked,
    enabled: Boolean(placeKind) && betSend !== 'sending',
    onDrop: moveTo,
    labelFor: placeName,
    // Verandert de tijdlijn onder de vinger (nieuwe beurt, iemand zet in), dan stopt de sleep.
    resetKey: `${turnKey}:${placeKind}:${placeCards.length}:${[...taken].join(',')}`,
  });
  // Verbinding weg: een lopende sleep stopt, de kaart gaat terug waar ze lag.
  useEffect(() => {
    if (net !== 'online') drag.cancel();
  }, [net]);

  useLayoutEffect(() => {
    const dir = refocus.current;
    if (!dir) return;
    refocus.current = null;
    const piece = document.querySelector('[data-testid="drag-card"], [data-testid="drag-token"]');
    if (!piece) return;
    const btn = piece.closest('[data-row], .holder')?.querySelector(`[data-testid="move-${dir}"]`);
    (btn && !btn.disabled ? btn : piece).focus({ preventScroll: true });
  });

  // Wat je nu moet kunnen aantikken op de tijdlijn (de pijltjes en «Zet token
  // hier») ligt nooit onder de bovenbalk, de balk «Verbinding kwijt», een
  // melding of de zwevende balk. Opnieuw nagekeken bij alles wat het kan
  // verschuiven of bedekken: een andere keuze, de foutmelding bij het token,
  // de verbinding, een melding die verschijnt, een ander schermformaat. Niet
  // tijdens het slepen, en niet als de speler zelf scrollt.
  const clearKey = `${placeKind}:${placeIndex}:${betSend}:${net}:${shownId}`;
  useLayoutEffect(() => {
    if (placeKind && placeIndex !== null && !drag.ghost) keepClear();
  }, [clearKey]);
  useEffect(() => {
    if (!placeKind) return undefined;
    const app = document.querySelector('.app') ?? document.body;
    const check = () => placeIndex !== null && !document.documentElement.classList.contains('dragging') && keepClear();
    const observer = new MutationObserver(check);
    observer.observe(app, { childList: true });
    window.addEventListener('resize', check);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [placeKind, placeIndex]);

  const moveProps = {
    upTo: placeKind ? step(placeIndex, 'up', placeCards.length, placeBlocked) : undefined,
    downTo: placeKind ? step(placeIndex, 'down', placeCards.length, placeBlocked) : undefined,
    name: placeName,
    onStep: moveStep,
    disabled: betSend === 'sending',
  };
  const piece = (where) =>
    placeKind === 'card' ? (
      <DragCard index={placeIndex} name={placeName} where={where} onPointerDown={drag.onPointerDown} move={moveProps} />
    ) : (
      <DragToken index={placeIndex} name={placeName} onPointerDown={drag.onPointerDown} move={moveProps} sending={betSend === 'sending'} />
    );

  const timelineProps = { cards: shown?.timeline ?? [] };
  if (onActive) {
    Object.assign(timelineProps, {
      testid: 'active-timeline',
      pendingIndex: playing ? (myTurn ? pick : view.turn.pendingIndex) : null,
      pendingText: myTurn ? 'Hier leg je het nummer' : `${active.name} twijfelt hier`,
      reveal: reveal && reveal.playerId === active.id ? reveal : undefined,
      lockedIndex: challenge ? view.turn.placedIndex : null,
      lockedText: `Hier legde ${activeId === me ? 'je' : active.name} het nummer`,
      marks,
    });
    if (placeKind) {
      timelineProps.place = {
        listRef,
        index: placeIndex,
        row:
          placeKind === 'card' ? (
            <li key="pick" class="tl-pick-row" data-row data-pick data-slot={placeIndex} data-testid="pending-card">
              {piece('timeline')}
            </li>
          ) : (
            <BetPick key="pick" index={placeIndex} name={placeName} betSend={betSend} onConfirm={confirmBet}>
              {piece('timeline')}
            </BetPick>
          ),
      };
    }
  } else if (shown) {
    timelineProps.testid = shown.id === me ? 'my-timeline' : 'other-timeline';
    timelineProps.freshId = reveal?.cardTo === shown.id ? reveal.card.id : null;
  }

  // De houder boven de knop in de zwevende balk: daar ligt het stuk zolang er
  // geen plaats gekozen is, en daar sleep je het terug om niet te kiezen.
  const holder = placeKind && (
    <div class={`holder${placeIndex === null ? '' : ' empty'}`} ref={drag.holderRef} data-testid="card-holder">
      {placeIndex === null ? (
        piece('holder')
      ) : (
        <p class="holder-empty">
          {placeKind === 'card' ? 'Sleep de kaart hierheen om opnieuw te kiezen' : 'Sleep je token hierheen om het niet in te zetten'}
        </p>
      )}
    </div>
  );

  // Een nieuwe host zonder Spotify: dit spel stoppen en in de wachtkamer met
  // fragmenten verder (een Spotify-lijst kan niet met fragmenten spelen).
  function toFragments() {
    if (!confirm('Dit spel stoppen en terug naar de wachtkamer? Daar kies je een lijst met fragmenten en start je een nieuw spel.')) return;
    music.setSource('fragment');
    send({ t: 'lobby', why: 'music' });
    setPanel(null);
  }

  // Van het menu naar de muziekinstellingen (bv. vanuit een melding op het scherm).
  function openSettings() {
    setSettings(true);
    setPanel('menu');
  }

  return (
    <main class="page game">
      <header class="topbar game-top">
        <button
          type="button"
          class="stand-btn"
          onClick={() => setPanel('stand')}
          aria-expanded={panel === 'stand'}
          aria-haspopup="dialog"
          data-testid="stand-open"
        >
          <span class="stand-mine">
            {mine?.timeline.length ?? 0} / {target}
            <span class="stand-unit"> kaarten</span>
          </span>
          <span class="stand-tokens">{tokenText(myTokens)}</span>
          <span class="stand-label">
            <span class="stand-word">Stand</span> <Chevron dir="down" />
          </span>
        </button>
        <MockChip short />
        <NetDot net={net} />
        {/* Geluid op dit toestel (alleen een speler die geen host is, bij fragmenten): altijd in beeld, één tik. */}
        {!isHost && listen && <ListenButton listen={listen} />}
        <button
          type="button"
          class="icon-btn"
          onClick={() => setPanel('menu')}
          aria-label="Menu"
          aria-expanded={panel === 'menu'}
          aria-haspopup="dialog"
          data-testid="menu-open"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="4" cy="10" r="1.6" fill="currentColor" />
            <circle cx="10" cy="10" r="1.6" fill="currentColor" />
            <circle cx="16" cy="10" r="1.6" fill="currentColor" />
          </svg>
        </button>
        {/* In de bovenbalk: blijft in beeld en ligt over niets heen. */}
        {net !== 'online' && <NetBanner />}
      </header>

      <Headline
        view={view}
        me={me}
        active={active}
        myTurn={myTurn}
        nameOf={nameOf}
        canBet={canBet}
        myBet={myBet}
        myPassed={myPassed}
        slotsFull={slotsFull && activeId !== me && !myBet && !myPassed && hasTokens}
        tokens={myTokens}
        waitText={blocked && !waitInBar ? waitText : null}
        canContinue={canContinue}
        holdKey={turnNo.current}
      >
        {myTurn && !placing && <BuyCard key={turnKey} tokens={myTokens} cards={mine.timeline.length} target={target} send={send} />}
        {challenge && isHost && blocked && (
          <ForceReveal key={turnKey} send={send} waitNames={waitNames} picking={betChoice !== null} />
        )}
      </Headline>

      {/* Vaste plek voor een probleem met de muziek: de host ziet het altijd,
          niet alleen in het menu. Staat het menu open, dan staat het daar. */}
      {isHost && panel !== 'menu' && (
        <MusicAlert music={music} onSettings={openSettings} onSkip={() => send({ t: 'skipTrack' })} onFragments={toFragments} />
      )}
      {/* De host is al een tijd weg: een andere speler kan host worden. */}
      {!isHost && <HostAway view={view} send={send} net={net} game />}
      {/* Voor een speler met «Geluid op dit toestel»: alleen als het hier niet speelt. */}
      {!isHost && listen && <ListenAlert listen={listen} />}
      {/* Eén keer per spel, als het geluid hier uit staat terwijl er een fragment loopt. */}
      {!isHost && listen && (
        <ListenHint key={`${view.code}:${view.game}`} listen={listen} code={view.code} game={view.game} turn={playing || challenge ? turnNo.current : null} />
      )}

      {views.length > 1 && (
        <div class="view-switch" role="group" aria-label="Welke tijdlijn">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              class={`tab${v.id === shownId ? ' on' : ''}`}
              aria-pressed={v.id === shownId ? 'true' : 'false'}
              onClick={() => setViewId(v.id === mainId ? null : v.id)}
              data-testid={v.testid}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {shown && (
        <section class="tl-zone" data-testid="timeline-section" data-player={shown.id} aria-label={views.find((v) => v.id === shownId)?.label ?? 'Tijdlijn'}>
          <Timeline {...timelineProps} />
        </section>
      )}

      {reveal && (
        <OutcomeSheet outcomeKey={`${view.game}:${reveal.card.id}:${view.phase}`} summary={`${reveal.card.year} · ${reveal.card.title}`}>
          {finished && <Winners view={view} byId={byId} />}
          <Reveal
            reveal={reveal}
            name={reveal.playerId === me ? 'Jij' : byId.get(reveal.playerId)?.name ?? 'Iemand'}
            own={reveal.playerId === me}
            tokenName={reveal.guessTokenTo ? (reveal.guessTokenTo === me ? 'jou' : byId.get(reveal.guessTokenTo)?.name) : null}
            cardTo={reveal.cardTo ? (reveal.cardTo === me ? 'Jij krijgt' : `${byId.get(reveal.cardTo)?.name ?? 'Iemand'} krijgt`) : null}
            myBet={reveal.bets.find((b) => b.playerId === me)}
            myTokens={myTokens}
            buyerTokens={byId.get(reveal.playerId)?.guessTokens ?? 0}
          />
          {missed && (
            <p class="notice warn" role="status" data-testid="bet-missed" data-reason={missed}>
              {missed === 'sent'
                ? 'Je token raakte niet tot bij de server en is niet ingezet.'
                : 'Je token is niet ingezet: je had een plaats gekozen maar niet bevestigd.'}{' '}
              Je hebt nog <strong>{tokenText(myTokens)}</strong>.
            </p>
          )}
          {canGiveToken ? <TokenPicker view={view} send={send} /> : <TokenClaim view={view} send={send} />}
          {finished && isHost && (
            <button type="button" class="btn link" onClick={() => send({ t: 'lobby' })} data-testid="to-lobby">
              Terug naar de wachtkamer
            </button>
          )}
        </OutcomeSheet>
      )}
      {finished && !reveal && (
        <OutcomeSheet outcomeKey={`${view.game}:end`} summary="Spel afgelopen">
          <Winners view={view} byId={byId} />
          {isHost && (
            <button type="button" class="btn link" onClick={() => send({ t: 'lobby' })} data-testid="to-lobby">
              Terug naar de wachtkamer
            </button>
          )}
        </OutcomeSheet>
      )}

      <Sheet open={panel === 'stand'} onClose={() => setPanel(null)} title="Stand" testid="stand">
        <ul class="board" data-testid="board">
          {view.players
            .slice()
            .sort((a, b) => b.timeline.length - a.timeline.length)
            .map((p) => (
              <PlayerRow
                key={p.id}
                p={p}
                view={view}
                isActive={p.id === activeId && (playing || challenge)}
                onShow={() => {
                  setViewId(p.id === mainId ? null : p.id);
                  setPanel(null);
                }}
              />
            ))}
        </ul>
        <p class="muted small">Tik op een naam om die tijdlijn te zien.</p>
        <p class="muted small" data-testid="deck-left">
          {view.turn ? `Beurt ${view.turn.number} · ` : ''}nog {view.deckLeft} nummers in de stapel
        </p>
      </Sheet>

      <Sheet open={panel === 'menu'} onClose={() => setPanel(null)} title="Menu" testid="menu">
        <p class="menu-meta">
          Spel{' '}
          <span class="chip code" data-testid="room-code">
            {view.code}
          </span>
          {isHost && (
            <>
              {' · '}
              <span data-testid="host-music-status" data-status={music.status}>
                {!music.ready ? 'Muziek niet klaar' : MUSIC_STATUS[music.status] || `Speelt op «${music.device.name}»`}
              </span>
            </>
          )}
        </p>
        {isHost && (
          <HostMenu
            view={view}
            send={send}
            music={music}
            deck={deck}
            open={panel === 'menu'}
            settings={settings}
            setSettings={setSettings}
            close={() => setPanel(null)}
          />
        )}
        <div class="menu-group">
          <p class="menu-label">Voor iedereen</p>
          {!isHost && listen && <ListenToggle listen={listen} />}
          <Rules target={target} />
          {/* De host verlaat een lopend spel niet: dan zat de rest zonder muziek en
              zonder host. Hij geeft eerst de rol door (en is dan een gewone speler
              die kan vertrekken), of stopt het spel. */}
          {isHost && view.players.length > 1 && (
            <p class="muted small" data-testid="host-leave-hint">
              Wil je vertrekken? Geef eerst de host-rol door (hierboven); daarna kan je het spel verlaten.
            </p>
          )}
          {!isHost && (
            <button type="button" class="menu-row danger" onClick={() => confirm('Dit spel verlaten?') && onLeave()}>
              Verlaat het spel
            </button>
          )}
        </div>
      </Sheet>

      {action && <ActionBar action={action} actionKey={`${action.kind}:${turnKey}`} holder={holder} />}

      {/* Wat je sleept: een kopie die de vinger volgt (verplaatst met transform). */}
      {drag.ghost && (
        <div
          class={`drag-ghost${placeKind === 'token' ? ' token' : ''}`}
          ref={drag.ghostRef}
          style={{ left: `${drag.ghost.left}px`, top: `${drag.ghost.top}px`, width: `${drag.ghost.width}px`, height: `${drag.ghost.height}px` }}
          data-testid="drag-ghost"
          aria-hidden="true"
        >
          {placeKind === 'token' ? (
            <>
              <Coin /> Je token
            </>
          ) : (
            <>
              <span class="tl-year">?</span>
              <span class="tl-title">Het nummer</span>
            </>
          )}
        </div>
      )}
      <p class="visually-hidden" aria-live="polite" data-testid="announce">
        {announce}
      </p>
    </main>
  );
}

// Zolang wacht je token op een antwoord van de server.
const BET_TIMEOUT = 5000;

// Zolang reageert een nieuwe hoofdknop niet: een dubbele tik doet zo nooit
// twee stappen (bv. onthullen en meteen de volgende beurt).
const ACTION_COOLDOWN = 900;

/** Hoogte van de zwevende balk onderaan (0 als er geen is). */
const barHeight = () => document.querySelector('[data-testid="action-bar"]')?.offsetHeight ?? 0;

/**
 * Het vrije stuk van het scherm: onder de bovenbalk (en de balk «Verbinding
 * kwijt» eronder), boven de zwevende balk en een melding die erboven staat.
 */
const TOAST_RISE = 12;

function clearZone() {
  const bottoms = [...document.querySelectorAll('.game-top, .game-top .banner')].map((el) => el.getBoundingClientRect().bottom);
  const top = Math.max(0, ...bottoms) + 8;
  let bottom = window.innerHeight - barHeight() - 8;
  const toast = document.querySelector('[data-testid="toast"]');
  // Een nieuwe melding schuift nog 12px omhoog (animatie `rise`): reken met waar ze eindigt.
  if (toast) bottom = Math.min(bottom, toast.getBoundingClientRect().top - TOAST_RISE - 8);
  return { top, bottom };
}

/**
 * Schuift de pagina zo dat het gekozen stuk op de tijdlijn met zijn knoppen
 * (de pijltjes en, bij een token, «Zet token hier») in het vrije stuk ligt.
 * Past het er niet helemaal in, dan gaat de onderkant (de bevestigknop) voor.
 */
function keepClear() {
  const row = document.querySelector('.timeline [data-pick]');
  if (!row) return;
  // Van de pijltjes (de bovenste knoppen) tot de bevestigknop.
  const head = row.querySelector('.mv') ?? row;
  const last = row.querySelector('[data-testid="confirm-bet"]') ?? head;
  const { top, bottom } = clearZone();
  const t = head.getBoundingClientRect().top;
  const b = last.getBoundingClientRect().bottom;
  if (b > bottom) window.scrollBy(0, b - bottom);
  else if (t < top) window.scrollBy(0, Math.max(t - top, b - bottom));
}

/** Zet de hoogte van een vast element in een CSS-variabele op <html>, zolang het er is. */
function useHeightVar(ref, name, cls) {
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => root.style.setProperty(name, `${ref.current?.offsetHeight ?? 0}px`);
    measure();
    if (cls) root.classList.add(cls);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ref.current) observer?.observe(ref.current);
    return () => {
      observer?.disconnect();
      if (cls) root.classList.remove(cls);
      root.style.removeProperty(name);
    };
  }, []);
}

/**
 * Zwevende balk onderaan met de hoofdknop van de beurt, altijd in beeld en op
 * dezelfde plek. Een nieuwe knop staat even uit (ACTION_COOLDOWN). De hoogte
 * gaat naar --bar-h, zodat de pagina erboven uit te scrollen is en meldingen
 * en de uitkomst erboven verschijnen.
 */
function ActionBar({ action, actionKey, holder }) {
  // Pas als de tijd voor deze knop om is, komt zijn sleutel hier terecht.
  const [readyKey, setReadyKey] = useState(null);
  const cooling = readyKey !== actionKey;
  useEffect(() => {
    const timer = setTimeout(() => setReadyKey(actionKey), ACTION_COOLDOWN);
    return () => clearTimeout(timer);
  }, [actionKey]);
  const bar = useRef(null);
  useHeightVar(bar, '--bar-h', 'has-bar');
  return (
    <div class="confirm-bar" ref={bar} data-testid="action-bar" data-kind={action.kind}>
      {holder}
      {action.note && (
        <p class="bar-note" data-testid="bar-note">
          <span data-testid="waiting-for" role="status">
            {action.note}
          </span>
        </p>
      )}
      <button
        type="button"
        class={`btn${action.secondary ? '' : ' primary'} big`}
        onClick={() => !cooling && !action.disabled && action.onClick()}
        disabled={cooling || action.disabled}
        data-testid={action.testid}
        data-cooling={cooling ? 'yes' : 'no'}
      >
        {action.label}
      </button>
    </div>
  );
}

function Chevron({ dir = 'down' }) {
  const d = { down: 'M4 6l4 4 4-4', up: 'M4 10l4-4 4 4', right: 'M6 4l4 4-4 4' }[dir];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * Paneel dat van onderaan over het scherm schuift (stand, menu). Het blijft in
 * de pagina staan als het dicht is (verborgen), zodat de stand ook dan klopt
 * voor wie ze voorleest; open zet de focus erin, Escape of een tik ernaast
 * sluit het en de focus gaat terug naar de knop die het opende.
 */
function Sheet({ open, onClose, title, testid, children }) {
  const box = useRef(null);
  const opener = useRef(null);
  // Meteen na het tekenen (niet pas later): ook een snelle Escape sluit het.
  useLayoutEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    box.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('sheet-open');
      opener.current?.focus?.();
    };
  }, [open]);
  return (
    <div class="sheet-layer" hidden={!open} data-testid={testid} data-open={open ? 'yes' : 'no'}>
      <div class="sheet-backdrop" onClick={onClose} />
      <section class="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div class="sheet-grip" aria-hidden="true" />
        <div class="sheet-head">
          <h2 class="sheet-title">{title}</h2>
          <button type="button" class="icon-btn soft" onClick={onClose} aria-label={`Sluit ${title === 'Menu' ? 'het menu' : `de ${title.toLowerCase()}`}`} data-testid={`${testid}-close`}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  );
}

// Zo ver moet je het paneel met de uitkomst naar onder vegen om het in te klappen.
const SWIPE = 56;

/**
 * De uitkomst (onthulling, gekochte kaart, einde van het spel) als paneel dat
 * van onderaan over de tijdlijn schuift, net boven de zwevende balk. De
 * tijdlijn eronder blijft staan. Wegvegen of op «Verberg» tikken klapt het in
 * tot een smalle strook; tikken of omhoog vegen opent het weer. Bij een nieuwe
 * uitkomst staat het vanzelf open.
 */
function OutcomeSheet({ outcomeKey, summary, children }) {
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(true), [outcomeKey]);
  const box = useRef(null);
  useHeightVar(box, '--sheet-h', 'has-sheet');
  // Een veeg over de kop: het paneel volgt de vinger (alleen transform), bij
  // het loslaten beslist de afstand. Een korte tik is gewoon een tik.
  const swipe = useRef(null);
  function onPointerDown(e) {
    if (e.button !== 0) return;
    swipe.current = { id: e.pointerId, y: e.clientY, dy: 0, moved: false };
  }
  function onPointerMove(e) {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    s.dy = e.clientY - s.y;
    // Pas vanaf een echte beweging is het een veeg (en vangt de kop de vinger):
    // een gewone tik blijft zo een klik op de knop.
    if (!s.moved && Math.abs(s.dy) > 6) {
      s.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (s.moved && open && box.current) box.current.style.transform = `translateY(${Math.max(0, s.dy)}px)`;
  }
  function endSwipe(e, cancelled) {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    swipe.current = null;
    if (box.current) box.current.style.transform = '';
    if (cancelled || !s.moved) return;
    if (open && s.dy > SWIPE) setOpen(false);
    else if (!open && s.dy < -SWIPE / 2) setOpen(true);
    // Na een veeg is de klik die volgt geen tik op de knop.
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
  }
  const swallowClick = useRef(false);
  return (
    <aside
      class={`outcome${open ? ' open' : ''}`}
      ref={box}
      data-testid="outcome-sheet"
      data-open={open ? 'yes' : 'no'}
      aria-label="Uitkomst van de beurt"
    >
      <div
        class="outcome-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endSwipe(e, false)}
        onPointerCancel={(e) => endSwipe(e, true)}
      >
        <span class="sheet-grip" aria-hidden="true" />
        <button
          type="button"
          class="outcome-toggle"
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => !swallowClick.current && setOpen(!open)}
          data-testid="outcome-toggle"
        >
          {open ? (
            <>
              Verberg <Chevron dir="down" />
            </>
          ) : (
            <>
              <span class="outcome-summary">{summary}</span>
              <span class="outcome-show">
                Toon <Chevron dir="up" />
              </span>
            </>
          )}
        </button>
      </div>
      <div class="outcome-body" hidden={!open}>
        {children}
      </div>
    </aside>
  );
}

// Zoveel tokens kost een kaart kopen (LIMITS.buyCost op de server).
const BUY_COST = 3;

const tokenText = (n) => `${n} ${n === 1 ? 'token' : 'tokens'}`;

/** "Bob", "Bob en Cas", "Ann, Bob en Cas" */
function joinNames(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} en ${names.at(-1)}`;
}

/**
 * Eén regel uitleg: wie aan de beurt is of wat jij nu moet doen, met hoogstens
 * één zin erbij. Wat echt uitleg is, staat in de spelregels (menu).
 */
function Headline({ view, me, active, myTurn, nameOf, canBet, myBet, myPassed, slotsFull, tokens, waitText, canContinue, holdKey, children }) {
  // Binnen één beurt wordt de uitleg nooit lager: zo schuift de tijdlijn
  // eronder niet omhoog als de tekst bij de onthulling korter wordt (of de
  // koopknop verdwijnt). Een nieuwe beurt begint weer op zijn eigen hoogte.
  const box = useRef(null);
  const held = useRef({ key: null, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (held.current.key !== holdKey) {
      held.current = { key: holdKey, h: 0 };
      el.style.minHeight = '';
    }
    const h = el.offsetHeight;
    if (h >= held.current.h) held.current.h = h;
    else el.style.minHeight = `${held.current.h}px`;
  });
  const phase = view.phase;
  const activeName = nameOf(active?.id);
  const who = activeName[0].toUpperCase() + activeName.slice(1);
  const count = <strong data-testid="my-tokens">{tokenText(tokens)}</strong>;
  const wait = waitText ? <span data-testid="waiting-for">{waitText}</span> : null;
  let title;
  let line;
  let testid = 'headline';
  const attrs = {};
  if (phase === 'playing') {
    testid = 'turn-banner';
    Object.assign(attrs, { 'data-active': active?.id, 'data-mine': myTurn ? 'yes' : 'no' });
    title = myTurn ? 'Jij bent aan de beurt' : `${who} is aan de beurt`;
    line = myTurn ? 'Sleep de kaart naar de plaats waar dit nummer hoort.' : 'Luister mee. Waar zou jij het leggen?';
  } else if (phase === 'challenge') {
    testid = 'challenge-banner';
    const waiting = view.turn.waiting ?? [];
    Object.assign(attrs, {
      'data-active': view.turn.playerId,
      'data-can-bet': canBet ? 'yes' : 'no',
      'data-must-choose': waiting.includes(me) ? 'yes' : 'no',
      'data-waiting': waiting.join(','),
    });
    const later = wait ?? 'Wachten op de onthulling…';
    if (view.turn.playerId === me) {
      title = 'Je kaart ligt vast';
      line = waiting.length ? 'Onthullen kan zodra iedereen koos.' : 'Iedereen koos. Tik onderaan op Onthul.';
    } else if (myBet) {
      title = 'Token ingezet';
      line = <>Je zette een token in en hebt nog {count}. {later}</>;
    } else if (myPassed) {
      title = 'Geen token ingezet';
      line = <>Je zet deze beurt geen token in en houdt je {count}. {later}</>;
    } else if (canBet) {
      title = `Ligt ${activeName} fout?`;
      line = <>Sleep je token naar een andere plaats om in te zetten. Je hebt {count}.</>;
    } else if (slotsFull) {
      title = 'Even wachten';
      line = <>Alle andere plaatsen zijn al bezet. Je houdt je {count}. {later}</>;
    } else {
      title = `${who} legde het nummer`;
      line = later;
    }
  } else if (phase === 'reveal') {
    title = active?.id === me ? 'Jij bent aan de beurt' : `${who} is aan de beurt`;
    line = canContinue ? 'Het nummer is onthuld.' : `Het nummer is onthuld. Wachten tot ${active?.id === me ? 'jij' : who} of de host doorgaat…`;
  } else {
    title = 'Spel afgelopen';
    line = view.you === view.hostId ? 'Start onderaan een nieuw spel.' : 'De host kan een nieuw spel starten.';
  }
  return (
    <section class={`headline${myTurn ? ' mine' : ''}`} ref={box} data-testid={testid} data-phase={phase} {...attrs}>
      <h1 class="headline-title">{title}</h1>
      <p class="headline-line">{line}</p>
      {children}
    </section>
  );
}

/**
 * Noodknop van de host in de tussenfase, voor wie verbonden is maar niet
 * reageert: eerst een vraag in de pagina, nooit een venster van de browser.
 */
function ForceReveal({ send, waitNames, picking }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" class="btn link challenge-force" onClick={() => setAsking(true)} data-testid="force-reveal">
        Reageert er iemand niet? Toch onthullen…
      </button>
    );
  }
  return (
    <div class="notice warn challenge-force-box" data-testid="force-reveal-box" role="alertdialog" aria-label="Toch onthullen?">
      <p>
        Nog niet gekozen: <strong>{joinNames(waitNames)}</strong>. Wie niet koos, zet niets in en houdt zijn tokens.
        {picking && ' Je eigen token is nog niet ingezet.'} Toch onthullen?
      </p>
      <div class="row gap">
        <button type="button" class="btn grow" onClick={() => send({ t: 'reveal', force: true })} data-testid="force-reveal-confirm">
          Ja, onthul nu
        </button>
        <button type="button" class="btn grow" onClick={() => setAsking(false)} data-testid="force-reveal-cancel">
          Nee, wacht nog
        </button>
      </div>
    </div>
  );
}

/**
 * Op je eigen beurt, voor je een plaats bevestigt: de kaart kopen voor
 * BUY_COST tokens, in twee stappen zodat een verkeerde tik niets kost. Niet
 * voor je laatste kaart (één voor het doel): die moet je verdienen.
 */
function BuyCard({ tokens, cards, target, send }) {
  const [asking, setAsking] = useState(false);
  if (tokens < BUY_COST) return null;
  if (cards >= target - 1) {
    return (
      <p class="muted small buy-note" data-testid="buy-blocked">
        Kopen kan niet: je laatste kaart (de {target}e) moet je verdienen door juist te leggen.
      </p>
    );
  }
  if (!asking) {
    return (
      <button type="button" class="btn link buy-card" onClick={() => setAsking(true)} data-testid="buy-card">
        Koop deze kaart voor {BUY_COST} tokens
      </button>
    );
  }
  return (
    <div class="notice warn buy-box" data-testid="buy-box" role="alertdialog" aria-label="Kaart kopen?">
      <p>
        Je betaalt {BUY_COST} van je {tokens} tokens en de kaart komt meteen juist op je tijdlijn. Niemand kan er een token
        tegen inzetten. Kopen?
      </p>
      <div class="row gap">
        <button type="button" class="btn grow" onClick={() => send({ t: 'buy' })} data-testid="buy-confirm">
          Ja, koop voor {BUY_COST} tokens
        </button>
        <button type="button" class="btn grow" onClick={() => setAsking(false)} data-testid="buy-cancel">
          Nee
        </button>
      </div>
    </div>
  );
}

/**
 * Wat er met de muziek mis is, als één regel met de knop die het oplost. Staat
 * op het spelscherm van de host (nooit alleen in het menu). Volgorde: eerst
 * wat het geluid tegenhoudt, dan een fout bij het afspelen, dan dat er niet
 * het nummer van deze beurt speelt. Nooit welk nummer er wel speelt: ook de
 * host mag titel, artiest of jaar niet zien.
 */
function MusicAlert({ music, onSettings, onSkip, onFragments }) {
  const trackId = music.currentTrackId;
  // Net host geworden (doorgegeven of overgenomen): dat staat er eerst bij.
  const intro = music.handover ? 'Jij bent nu de host. ' : '';
  if (!music.ready && music.device?.local && music.local !== 'on') {
    // Bij fragmenten kan de host ook kiezen voor geen geluid hier (de spelers met «Geluid op dit toestel» horen het).
    const mute = music.source === 'fragment' && music.chooseMute && music.local !== 'starting';
    return (
      <div class="host-alert" role="alert" data-testid="browser-off">
        <span class="host-alert-text">
          {intro}
          {music.error || 'Het geluid op dit toestel staat nog uit.'}
          {mute && (
            <>
              {' '}
              <button type="button" class="btn link inline-link" onClick={music.chooseMute} data-testid="alert-mute">
                Geen geluid op dit toestel
              </button>
            </>
          )}
        </span>
        <button type="button" class="btn small-btn" onClick={music.chooseBrowser} disabled={music.local === 'starting'} data-testid="device-browser">
          {music.local === 'starting' ? 'Bezig…' : 'Zet het geluid aan'}
        </button>
      </div>
    );
  }
  if (music.source === 'spotify' && music.configured && !music.loggedIn) {
    // Bv. een nieuwe host: de muziek kwam van Spotify bij de vorige host. Hij
    // logt zelf in (Premium nodig), of stopt het spel en speelt verder met
    // fragmenten (een Spotify-lijst speelt niet met fragmenten).
    return (
      <div class="host-alert warn host-setup" role="alert" data-testid="host-spotify-setup">
        <span class="host-alert-text">
          {intro}De muziek van dit spel komt van Spotify. Log in bij Spotify (Premium nodig) en kies een toestel, of stop dit spel
          en speel verder met fragmenten, zonder account.
        </span>
        <span class="host-setup-actions">
          <button type="button" class="btn primary small-btn" onClick={music.login} data-testid="alert-login">
            Log in bij Spotify
          </button>
          <button type="button" class="btn small-btn" onClick={onFragments} data-testid="alert-fragments">
            Stop en kies fragmenten
          </button>
        </span>
      </div>
    );
  }
  if (music.error) {
    return (
      <p class="host-alert" role="alert" data-testid="host-music-error">
        <span class="host-alert-text">{music.error}</span>
        {/* Fragmenten: bestaat het fragment niet (meer), dan helpt alleen een ander nummer. */}
        {music.errorAction === 'skip' && trackId ? (
          <button type="button" class="btn small-btn" onClick={onSkip} data-testid="alert-skip">
            Ander nummer
          </button>
        ) : music.ready && trackId ? (
          <button type="button" class="btn small-btn" onClick={music.replay} data-testid="alert-replay">
            Opnieuw afspelen
          </button>
        ) : (
          <button type="button" class="btn small-btn" onClick={onSettings} data-testid="alert-settings">
            Muziekinstellingen
          </button>
        )}
      </p>
    );
  }
  if (!music.ready) {
    return (
      <p class="host-alert" role="alert" data-testid="host-music-setup">
        <span class="host-alert-text">{intro}De muziek is niet klaar: kies een toestel.</span>
        <button type="button" class="btn small-btn" onClick={onSettings} data-testid="alert-settings">
          Muziekinstellingen
        </button>
      </p>
    );
  }
  if (music.wrong) {
    return <MusicWrong music={music} />;
  }
  return null;
}

/** Er speelt niet het nummer van deze beurt (of Spotify zegt niet wat er speelt). */
function MusicWrong({ music }) {
  return (
    <div class="host-alert warn" role="alert" data-testid="music-wrong" data-kind={music.wrong}>
      <span class="host-alert-text">
        {music.wrong === 'unknown'
          ? `Spotify meldt niet wat er op «${music.device.name}» speelt. Hoor je het nummer van deze beurt niet, start het dan opnieuw.`
          : `Op «${music.device.name}» speelt niet het nummer van deze beurt. Het spel zette het stil.`}
      </span>
      <button type="button" class="btn primary small-btn" onClick={music.replay} data-testid="music-fix">
        Start het juiste nummer
      </button>
    </div>
  );
}

/**
 * Knoppen om het stuk één plaats hoger of lager te leggen: voor wie niet kan
 * of wil slepen, met toetsenbord of schermlezer. Hun naam zegt waar het stuk
 * dan komt ("Eén plaats hoger: tussen 1984 en 1991").
 */
function MoveButtons({ move }) {
  const up = move.upTo;
  const down = move.downTo;
  return (
    <span class="mv">
      <button
        type="button"
        class="mv-btn"
        onClick={() => move.onStep('up')}
        disabled={move.disabled || up === undefined}
        aria-label={up === undefined ? 'Kan niet hoger' : `Eén plaats hoger: ${move.name(up)}`}
        data-testid="move-up"
      >
        <Chevron dir="up" />
      </button>
      <button
        type="button"
        class="mv-btn"
        onClick={() => move.onStep('down')}
        disabled={move.disabled || down === undefined}
        aria-label={down === undefined ? 'Kan niet lager' : down === null ? 'Terug naar de houder' : `Eén plaats lager: ${move.name(down)}`}
        data-testid="move-down"
      >
        <Chevron dir="down" />
      </button>
    </span>
  );
}

/** Pijltjestoetsen op het stuk zelf doen hetzelfde als de knoppen. */
function onArrows(move) {
  return (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    move.onStep(e.key === 'ArrowUp' ? 'up' : 'down');
  };
}

/** De onbekende kaart van deze beurt: in de houder of op een plaats. */
function DragCard({ index, name, where, onPointerDown, move }) {
  const placed = index !== null;
  return (
    <div
      class="tl-card mystery mine drag-handle"
      tabIndex={0}
      role="group"
      aria-roledescription="kaart om te slepen"
      aria-label={placed ? `Het nummer, ligt ${name(index)}` : 'Het nummer, ligt nog in de houder'}
      onPointerDown={onPointerDown}
      onKeyDown={onArrows(move)}
      data-testid="drag-card"
      data-index={placed ? index : ''}
      data-where={where}
    >
      <span class="tl-year">?</span>
      <span class="tl-text">
        <span class="tl-title">{placed ? `Hier, ${name(index)}` : 'Het nummer'}</span>
        <span class="tl-artist">{placed ? 'Sleep om te verplaatsen' : 'Sleep naar je tijdlijn'}</span>
      </span>
      <MoveButtons move={move} />
    </div>
  );
}

function Coin() {
  return <span class="coin" aria-hidden="true" />;
}

/** Je token in de tussenfase: in de houder of op een vrije plaats. */
function DragToken({ index, name, onPointerDown, move, sending }) {
  const placed = index !== null;
  return (
    <div class={`drag-token${placed ? ' placed' : ''}`}>
      <div
        class="drag-handle token-handle"
        tabIndex={0}
        role="group"
        aria-roledescription="token om te slepen"
        aria-label={placed ? `Je token, ligt ${name(index)}, nog niet ingezet` : 'Je token, ligt nog in de houder'}
        onPointerDown={sending ? undefined : onPointerDown}
        onKeyDown={onArrows(move)}
        data-testid="drag-token"
        data-index={placed ? index : ''}
      >
        <Coin />
        <span class="tl-text">
          <span class="tl-title">{placed ? (sending ? 'Token wordt ingezet…' : `Nog niet ingezet: ${name(index)}`) : 'Je token'}</span>
          {!placed && <span class="tl-artist">Sleep het naar een vrije plaats</span>}
        </span>
      </div>
      <MoveButtons move={move} />
    </div>
  );
}

/**
 * Een neergelegd token, nog niet ingezet: ziet er bewust anders uit dan de
 * vastgelegde kaart, met de knop om te bevestigen er meteen bij.
 */
function BetPick({ index, name, betSend, onConfirm, children }) {
  return (
    <li class="tl-pick" data-testid="bet-pick" data-state={betSend ?? 'picked'} data-row data-pick data-slot={index}>
      <div class="tl-pick-head" data-testid="pending-card">
        {children}
      </div>
      <button
        type="button"
        class="btn primary big"
        onClick={onConfirm}
        disabled={betSend === 'sending'}
        aria-label={betSend === 'sending' ? undefined : `Zet token hier, ${name(index)}`}
        data-testid="confirm-bet"
      >
        {betSend === 'sending' ? 'Even geduld…' : 'Zet token hier'}
      </button>
      {/* Onder de knop, zodat die niet verschuift als de melding verschijnt. */}
      {(betSend === 'offline' || betSend === 'slow') && (
        <p class="notice error" role="alert" data-testid="bet-error">
          {betSend === 'offline'
            ? 'Geen verbinding: je token is nog niet ingezet. Tik opnieuw zodra je weer verbonden bent.'
            : 'Je token is nog niet ingezet: de server gaf geen antwoord. Tik opnieuw.'}
        </p>
      )}
    </li>
  );
}

function Reveal({ reveal, name, own, tokenName, cardTo, myBet, myTokens, buyerTokens }) {
  const { card, correct, bought } = reveal;
  let verdict;
  if (bought) verdict = `Gekocht! ${own ? 'Je kocht' : `${name} kocht`} de kaart voor ${BUY_COST} tokens.`;
  else if (correct) verdict = `Juist! ${name} houdt de kaart.`;
  else verdict = `Fout. ${own ? 'Je bent' : `${name} is`} de kaart kwijt.`;
  return (
    <section
      class={`reveal ${correct ? 'good' : 'bad'}`}
      data-testid="reveal"
      data-correct={correct ? 'yes' : 'no'}
      data-bought={bought ? 'yes' : 'no'}
      data-track={card.id}
    >
      <p class="reveal-verdict">{verdict}</p>
      <p class="reveal-year">{card.year}</p>
      <p class="reveal-title">{card.title}</p>
      <p class="reveal-artist">{card.artist}</p>
      {deezerId(card.id) ? (
        <a class="spotify-link" href={deezerLink(card.id)} target="_blank" rel="noopener noreferrer" data-testid="reveal-link">
          Open in Deezer
        </a>
      ) : (
        <a class="spotify-link" href={`https://open.spotify.com/track/${card.id}`} target="_blank" rel="noopener noreferrer" data-testid="reveal-link">
          Open in Spotify
        </a>
      )}
      {reveal.bets.length > 0 && !correct && (
        <p class="reveal-token" data-testid="reveal-card-to" data-player={reveal.cardTo ?? ''}>
          {cardTo ? `${cardTo} de kaart dankzij een token.` : 'Geen enkele inzet lag juist.'}
        </p>
      )}
      {reveal.bets.length > 0 && correct && <p class="reveal-token">De ingezette tokens zijn verloren.</p>}
      {bought && (
        <p class="reveal-token" data-testid="reveal-bought">
          {own ? 'Je hebt' : `${name} heeft`} nog {tokenText(buyerTokens)}.
        </p>
      )}
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
    <span class={`tokens${n ? '' : ' none'}`} data-testid="token-count" data-count={n}>
      {tokenText(n)}
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

/** Eén speler in de stand; een tik toont zijn tijdlijn op het spelscherm. */
function PlayerRow({ p, view, isActive, onShow }) {
  const target = view.settings.target;
  return (
    <li
      class={`board-row${isActive ? ' active' : ''}${p.online ? '' : ' offline'}`}
      data-testid="board-row"
      data-player={p.id}
      data-count={p.timeline.length}
      data-tokens={p.guessTokens ?? 0}
    >
      <button type="button" class="board-head" onClick={onShow} aria-label={`${p.name}: ${p.timeline.length} van ${target} kaarten, ${tokenText(p.guessTokens ?? 0)}. Toon de tijdlijn.`}>
        <span class="board-name">
          <span class="person-name">{p.name}</span>
          {p.id === view.you && <span class="chip soft">jij</span>}
          {p.id === view.hostId && <span class="chip">host</span>}
          {isActive && <span class="chip warn">aan de beurt</span>}
          {!p.online && <span class="chip soft">niet verbonden</span>}
        </span>
        <Tokens n={p.guessTokens ?? 0} />
        <span class="score">
          {p.timeline.length} / {target}
        </span>
      </button>
      <YearChips cards={p.timeline} />
    </li>
  );
}

/** Wat alleen de host kan: de muziek bedienen, de beurt sturen, het spel stoppen. */
function HostMenu({ view, send, music, deck, open, settings, setSettings, close }) {
  // Ook in de tussenfase loopt de beurt nog: overslaan kan dan ook.
  const playing = view.phase === 'playing' || view.phase === 'challenge';
  const trackId = music.currentTrackId;
  const needsSetup = !music.ready;
  const others = view.players.filter((p) => p.id !== view.you);
  return (
    <div class="menu-group" data-testid="host-controls">
      <p class="menu-label">Alleen voor de host</p>
      {/* Staat het menu open, dan staat een fout van de muziek hier (en niet
          meer op het spelscherm erachter). */}
      {open && music.error && (
        <p class="notice error" data-testid="host-music-error">
          {music.error}
        </p>
      )}
      {/* Idem voor de waarschuwing dat er een ander nummer speelt. */}
      {open && music.wrong && !needsSetup && <MusicWrong music={music} />}
      <div class="host-grid">
        <button class="btn" disabled={!trackId || needsSetup} onClick={music.replay} data-testid="replay">
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
        <button
          class="btn"
          disabled={!playing}
          onClick={() => {
            send({ t: 'skipTrack' });
            close();
          }}
          data-testid="skip-track"
        >
          Ander nummer
        </button>
        <button
          class="btn"
          disabled={!playing}
          onClick={() => {
            if (!confirm('De beurt van deze speler overslaan?')) return;
            send({ t: 'skipTurn' });
            close();
          }}
          data-testid="skip-turn"
        >
          Sla beurt over
        </button>
      </div>
      <button type="button" class="menu-row" onClick={() => setSettings(!settings)} aria-expanded={settings || needsSetup ? 'true' : 'false'}>
        Muziekinstellingen <Chevron dir={settings || needsSetup ? 'down' : 'right'} />
      </button>
      {/* Alleen in de pagina als het menu open is: zo staat het toestel maar op één plek. */}
      {open && (settings || needsSetup) && <MusicPanel music={music} />}
      {deck?.job?.phase === 'years' && (
        <p class="muted small" data-testid="deck-background">
          Jaartallen opzoeken voor «{deck.job.name}»: {deck.job.ready} klaar, nog {deck.left} te gaan
          {deck.left > 0 && <> (ongeveer {deck.minutes} min)</>}.
          {view.playlist && <> Dit spel speelt met {view.playlist.count} van de {deck.job.total} nummers.</>} Wat erbij komt, doet mee
          vanaf het volgende spel.
        </p>
      )}
      <HandOver view={view} send={send} onDone={close} />
      {others.length > 0 && (
        <details class="menu-remove">
          <summary>Een speler uit het spel halen</summary>
          <div class="menu-remove-list">
            {others.map((p) => (
              <button
                key={p.id}
                type="button"
                class="btn link danger"
                onClick={() => confirm(`${p.name} uit het spel halen?`) && send({ t: 'remove', playerId: p.id })}
              >
                Haal {p.name} uit het spel
              </button>
            ))}
          </div>
        </details>
      )}
      {view.phase === 'finished' ? (
        <button
          type="button"
          class="menu-row"
          onClick={() => {
            send({ t: 'lobby' });
            close();
          }}
          data-testid="menu-to-lobby"
        >
          Terug naar de wachtkamer
        </button>
      ) : (
        <button
          type="button"
          class="menu-row danger"
          onClick={() => {
            if (!confirm('Dit spel stoppen en terug naar de wachtkamer?')) return;
            send({ t: 'lobby' });
            close();
          }}
          data-testid="stop-game"
        >
          Stop dit spel
        </button>
      )}
    </div>
  );
}

const MUSIC_STATUS = {
  starting: 'Nummer wordt gestart…',
  wrong: 'Controleer de muziek',
  paused: 'Gepauzeerd',
  error: 'Probleem met de muziek',
};
