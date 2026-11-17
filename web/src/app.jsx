import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Connection } from './lib/net.js';
import { clearInvite, loadSession, saveSession } from './lib/session.js';
import { useInvite } from './lib/useInvite.js';
import { keepAwake } from './lib/wakelock.js';
import { useMusic } from './lib/music.js';
import { useDeck } from './lib/deck.js';
import { isMock } from './spotify/index.js';
import { APP_NAME } from './config.js';
import { Home } from './screens/Home.jsx';
import { Lobby } from './screens/Lobby.jsx';
import { Game } from './screens/Game.jsx';
import { InviteBusy, InviteConfirm, InviteJoin } from './screens/Invite.jsx';

export function App({ loginResult }) {
  const [session, setSession] = useState(loadSession);
  const [view, setView] = useState(null);
  const [net, setNet] = useState('offline');
  const [toast, setToast] = useState(loginResult?.error ? { text: loginResult.error, id: 0 } : null);
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
    const c = new Connection({
      code,
      token,
      onState: setView,
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
  const music = useMusic({ enabled: isHost, view });
  const deck = useDeck({ code, token, phase: view?.phase ?? null, players: view?.players.length ?? 1, target: view?.settings.target ?? 10 });

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
    screen = <Lobby view={view} send={send} music={music} deck={deck} onLeave={leave} notify={notify} />;
  } else {
    screen = <Game view={view} send={send} music={music} deck={deck} onLeave={leave} />;
  }

  return (
    <div class="app">
      <header class="topbar">
        <span class="brand">
          <span class="brand-mark" aria-hidden="true" />
          {APP_NAME}
        </span>
        <span class="topbar-right">
          {isMock && (
            <a class="chip warn" href="?mock=0" title="Testmodus: Spotify is nagebootst, er komt geen geluid. Tik om de testmodus uit te zetten.">
              testmodus
            </a>
          )}
          {view && <span class="chip code" data-testid="room-code">{view.code}</span>}
          {session && (
            <span class={`net ${net}`} data-testid="net-status" data-status={net} title={NET_LABEL[net]}>
              <span class="visually-hidden">{NET_LABEL[net]}</span>
            </span>
          )}
        </span>
      </header>
      {session && view && net !== 'online' && (
        <div class="banner" role="status">
          Verbinding kwijt. Ik probeer opnieuw…
        </div>
      )}
      {screen}
      {toast && (
        <div class="toast" role="alert" key={toast.id} data-testid="toast" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

const NET_LABEL = { online: 'Verbonden', connecting: 'Verbinden…', offline: 'Geen verbinding' };
