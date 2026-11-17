import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Connection } from './lib/net.js';
import { loadSession, saveSession } from './lib/session.js';
import { keepAwake } from './lib/wakelock.js';
import { useMusic } from './lib/music.js';
import { useDeck } from './lib/deck.js';
import { isMock } from './spotify/index.js';
import { APP_NAME } from './config.js';
import { Home } from './screens/Home.jsx';
import { Lobby } from './screens/Lobby.jsx';
import { Game } from './screens/Game.jsx';

export function App({ loginResult }) {
  const [session, setSession] = useState(loadSession);
  const [view, setView] = useState(null);
  const [net, setNet] = useState('offline');
  const [toast, setToast] = useState(loginResult?.error ? { text: loginResult.error, id: 0 } : null);
  const conn = useRef(null);

  const notify = useCallback((text) => setToast({ text, id: Date.now() }), []);

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
    const c = new Connection({
      code,
      token,
      onState: setView,
      onStatus: setNet,
      onError: (msg) => notify(msg.message),
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
  }, [code, token, notify]);

  const send = useCallback((msg) => conn.current?.send(msg) ?? false, []);

  const enter = useCallback((s) => {
    saveSession(s);
    setSession(s);
    // De uitnodigingscode mag nu uit de adresbalk.
    history.replaceState(null, '', location.pathname + location.search);
  }, []);

  const leave = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  const isHost = Boolean(view && view.you === view.hostId);
  const music = useMusic({ enabled: isHost, view });
  const deck = useDeck({ code, token });

  useEffect(() => {
    keepAwake(Boolean(session));
  }, [Boolean(session)]);

  let screen;
  if (!session) {
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
    screen = <Game view={view} send={send} music={music} onLeave={leave} />;
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
