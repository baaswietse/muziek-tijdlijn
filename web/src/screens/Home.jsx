import { useState } from 'preact/hooks';
import { createRoom, joinRoom } from '../lib/net.js';
import { loadName, saveName } from '../lib/session.js';
import { SERVER_URL } from '../config.js';
import { Rules } from '../components/Rules.jsx';

export function Home({ onEnter, notify }) {
  const [mode, setMode] = useState('join'); // join | host
  const [name, setName] = useState(loadName);
  // Wie via een uitnodigingslink komt, ziet dit scherm niet (zie useInvite.js).
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    const clean = name.trim();
    if (!clean) return notify('Vul eerst je naam in.');
    if (mode === 'join' && !/^[A-Za-z]{4}$/.test(code)) return notify('De code bestaat uit 4 letters.');
    setBusy(true);
    try {
      saveName(clean);
      const res = mode === 'host' ? await createRoom(clean) : await joinRoom(code.toUpperCase(), clean);
      // `host` onthouden: een host die een uitnodiging voor een ander spel opent, krijgt eerst de vraag of hij overstapt.
      onEnter({ code: res.code, token: res.token, playerId: res.playerId, name: clean, host: mode === 'host' });
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="page">
      <section class="hero">
        <h1>Leg elk nummer op de juiste plaats.</h1>
        <p class="muted">Eén box, ieder zijn gsm. Luister, gok het jaar en bouw de langste tijdlijn.</p>
      </section>

      {!SERVER_URL && (
        <p class="notice warn" data-testid="no-server">
          De spelserver is nog niet ingesteld (zie <code>web/src/config.js</code>). Spelen kan pas daarna.
        </p>
      )}

      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'join'} class={mode === 'join' ? 'tab on' : 'tab'} onClick={() => setMode('join')}>
          Meedoen
        </button>
        <button role="tab" aria-selected={mode === 'host'} class={mode === 'host' ? 'tab on' : 'tab'} onClick={() => setMode('host')}>
          Nieuw spel
        </button>
      </div>

      <form class="card form" onSubmit={submit}>
        {mode === 'join' ? (
          <label class="field">
            <span>Code van het spel</span>
            <input
              class="input code-input"
              data-testid="code-input"
              value={code}
              onInput={(e) => setCode(e.currentTarget.value.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase())}
              placeholder="ABCD"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellcheck={false}
              maxLength={4}
            />
          </label>
        ) : (
          <p class="muted small">
            Jij wordt de host: jouw gsm stuurt Spotify aan en hangt aan de box. Je hebt Spotify Premium nodig. Je speelt zelf ook
            mee.
          </p>
        )}
        <label class="field">
          <span>Je naam</span>
          <input
            class="input"
            data-testid="name-input"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="bv. Sam"
            maxLength={16}
            autoComplete="nickname"
          />
        </label>
        <button class="btn primary big" type="submit" disabled={busy} data-testid="enter-button">
          {busy ? 'Even geduld…' : mode === 'host' ? 'Maak een spel' : 'Doe mee'}
        </button>
      </form>

      <Rules />
    </main>
  );
}
