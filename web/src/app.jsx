import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Connection } from './lib/net.js';
import { clearInvite, loadSession, saveSession } from './lib/session.js';
import { useInvite } from './lib/useInvite.js';
import { keepAwake } from './lib/wakelock.js';
import { useHostMusic } from './lib/source.js';
import { useListen } from './lib/listen.js';
import { useDeck } from './lib/deck.js';
import { useFragmentChoice } from './lib/fragmentchoice.js';
import { APP_NAME } from './config.js';
import { Home } from './screens/Home.jsx';
import { Lobby } from './screens/Lobby.jsx';
import { Game } from './screens/Game.jsx';
import { MockChip, NetBanner, NetDot } from './components/Status.jsx';
import { InviteBusy, InviteConfirm, InviteJoin } from './screens/Invite.jsx';

export function App({ loginResult }) {
  const [session, setSession] = useState(loadSession);
  const [view, setView] = useState(null);
  const [net, setNet] = useState('offline');
  const [toast, setToast] = useState(loginResult?.error ? { text: loginResult.error, id: 0 } : null);
  // Het laatste geluidsbericht van de server (alleen als deze gsm meeluistert).
  const [sound, setSound] = useState(null);
  const conn = useRef(null);

  const notify = useCallback((text, code = null) => setToast({ text, code, id: Date.now() }), []);
  // Is de verbinding terug, dan klopt "Geen verbinding" niet meer: weg ermee.
  const onStatus = useCallback((s) => {
    setNet(s);
    if (s === 'online') setToast((t) => (t?.code === 'OFFLINE' ? null : t));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const code = session?.code;
  const token = session?.token;
  useEffect(() => {
    if (!code || !token) {
      setView(null);
      return undefined;
    }
    // Ander spel (bv. via een uitnodigingslink): toon niet nog even het vorige.
    setView(null);
    setSound(null);
    const c = new Connection({
      code,
      token,
      onState: setView,
      onSound: (s, receivedAt) => setSound({ sound: s, receivedAt }),
      onStatus,
      onError: (msg) => notify(msg.message, msg.code),
      onGone: (msg) => {
        saveSession(null);
        setSession(null);
        notify(msg.message);
      },
    });
    conn.current = c;
    // Haakje voor de automatische tests: verbreek de verbinding zoals een
    // vergrendeld scherm dat doet.
    window.__mt = { drop: () => c.ws?.close() };
    c.start();
    return () => {
      c.stop();
      conn.current = null;
    };
  }, [code, token, notify, onStatus]);

  const send = useCallback((msg) => conn.current?.send(msg) ?? false, []);

  const enter = useCallback((s) => {
    saveSession(s);
    setSession(s);
    // De uitnodigingscode mag nu uit de adresbalk.
    clearInvite();
  }, []);

  const leave = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  // Een uitnodigingslink (QR-code) gaat voor op het startscherm en het huidige spel.
  const { invite, submit, stepOver, cancel } = useInvite({ session, view, enter, notify });

  const isHost = Boolean(view && view.you === view.hostId);
  const music = useHostMusic({ enabled: isHost, view, send });
  const latency = useCallback(() => conn.current?.latency() ?? 0, []);
  const listen = useListen({ view, send, net, incoming: sound, latency });
  const deck = useDeck({ code, token, phase: view?.phase ?? null, players: view?.players.length ?? 1, target: view?.settings.target ?? 10 });
  // Met fragmenten: welke lijsten en welke periode (alleen bij de host).
  const choice = useFragmentChoice({ enabled: isHost && music.source === 'fragment', view, deck, send });

  useEffect(() => {
    keepAwake(Boolean(session));
  }, [Boolean(session)]);

  let screen;
  if (invite?.step === 'form') {
    screen = <InviteJoin invite={invite} session={session} onSubmit={submit} onCancel={cancel} />;
  } else if (invite?.step === 'confirm') {
    screen = <InviteConfirm invite={invite} onStepOver={stepOver} onStay={cancel} />;
  } else if (invite?.step === 'decide' || invite?.step === 'joining') {
    screen = <InviteBusy code={invite.code} />;
  } else if (!session) {
    screen = <Home onEnter={enter} notify={notify} />;
  } else if (!view) {
    screen = (
      <main class="page center">
        <p class="muted">{net === 'offline' ? 'Geen verbinding. Opnieuw proberen…' : 'Verbinden met het spel…'}</p>
        <button class="btn ghost" onClick={leave}>
          Annuleer
        </button>
      </main>
    );
  } else if (view.phase === 'lobby') {
    screen = <Lobby view={view} send={send} music={music} listen={listen} deck={deck} choice={choice} onLeave={leave} notify={notify} />;
  } else {
    // Het spelscherm heeft een eigen bovenbalk (stand en menu), met daarin ook
    // de verbindingsstatus en de testmodus.
    screen = <Game view={view} send={send} music={music} listen={listen} deck={deck} net={net} onLeave={leave} />;
  }
  const inGame = screen?.type === Game;

  return (
    <div class="app">
      {!inGame && (
        <header class="topbar">
          <span class="brand">
            <span class="brand-mark" aria-hidden="true" />
            {APP_NAME}
          </span>
          <span class="topbar-right">
            <MockChip />
            {view && <span class="chip code" data-testid="room-code">{view.code}</span>}
            {session && <NetDot net={net} />}
          </span>
        </header>
      )}
      {!inGame && session && view && net !== 'online' && <NetBanner />}
      {screen}
      {toast && (
        <div class="toast" role="alert" key={toast.id} data-testid="toast" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
