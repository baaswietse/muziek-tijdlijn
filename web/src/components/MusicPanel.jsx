// Instellingen voor de muziek, alleen op de gsm van de host:
// inloggen bij Spotify, een toestel kiezen en het geluid testen.

import { redirectUri } from '../spotify/index.js';

const STATUS = {
  idle: '',
  starting: 'Nummer wordt gestart…',
  playing: 'Muziek speelt',
  paused: 'Muziek gepauzeerd',
  error: '',
};

export function MusicPanel({ music }) {
  if (!music.configured) {
    return (
      <section class="card music" data-testid="music-panel">
        <h2>Muziek</h2>
        <p class="notice warn">
          De Client ID van de Spotify-app is nog niet ingevuld (<code>web/src/config.js</code>). Redirect URI voor het dashboard:{' '}
          <code>{redirectUri()}</code>
        </p>
      </section>
    );
  }

  if (!music.loggedIn) {
    return (
      <section class="card music" data-testid="music-panel">
        <h2>Muziek</h2>
        <p class="muted small">
          Alleen jij als host logt in. Je hebt Spotify Premium nodig. Je wachtwoord of je gegevens komen niet bij het spel terecht.
        </p>
        <button class="btn primary" onClick={music.login} data-testid="music-login">
          Log in bij Spotify
        </button>
        {music.error && <p class="notice error">{music.error}</p>}
      </section>
    );
  }

  const devices = music.devices;
  return (
    <section class="card music" data-testid="music-panel">
      <div class="row between">
        <h2>Muziek</h2>
        <button class="btn link" onClick={music.logout}>
          Log uit
        </button>
      </div>

      <p class="label">Op welk toestel speelt de muziek?</p>
      {devices === null ? (
        <p class="muted small">Toestellen zoeken…</p>
      ) : devices.length === 0 ? (
        <p class="notice">
          Geen toestel gevonden. Open de Spotify-app op het toestel dat aan de box hangt, speel even een nummer af en tik op
          «Zoek opnieuw».
        </p>
      ) : (
        <ul class="devices">
          {devices.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                class={`device${music.device?.id === d.id ? ' on' : ''}`}
                data-testid={`device-${d.id}`}
                aria-pressed={music.device?.id === d.id}
                disabled={d.restricted}
                onClick={() => music.chooseDevice(d)}
              >
                <span class="device-name">{d.name}</span>
                <span class="muted small">
                  {deviceType(d.type)}
                  {d.restricted ? ' · niet bedienbaar' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {music.device && devices && !devices.some((d) => d.id === music.device.id) && (
        <p class="notice">
          «{music.device.name}» is nu niet zichtbaar voor Spotify. Open er de Spotify-app en tik op «Zoek opnieuw».
        </p>
      )}

      <div class="row gap">
        <button class="btn" onClick={music.refreshDevices} disabled={music.busy}>
          Zoek opnieuw
        </button>
        <button class="btn" onClick={music.test} disabled={music.busy || !music.device} data-testid="music-test">
          Test het geluid
        </button>
      </div>

      <p class="music-status" data-testid="music-status" data-ready={music.ready ? 'yes' : 'no'}>
        {music.ready ? `Klaar: speelt op «${music.device.name}». ` : 'Kies een toestel. '}
        {STATUS[music.status]}
      </p>
      {music.error && (
        <p class="notice error" data-testid="music-error">
          {music.error}
        </p>
      )}

      <details class="tips">
        <summary>Zo blijft de titel ook voor jou geheim</summary>
        <ul>
          <li>Het spel houdt je scherm wakker, zodat je vergrendelscherm (met titel en hoes) niet verschijnt.</li>
          <li>Trek de meldingenbalk niet open en open de Spotify-app niet tijdens een beurt.</li>
          <li>
            Android: zet «Media op vergrendelscherm tonen» uit (Instellingen → Geluid → Media). Een box met een schermpje kan de
            titel ook tonen.
          </li>
          <li>
            Het zekerst: hang een ander toestel aan de box (oude gsm, tablet of laptop met Spotify open, scherm naar beneden) en
            kies dat hierboven.
          </li>
        </ul>
      </details>
    </section>
  );
}

function deviceType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'smartphone') return 'gsm';
  if (t === 'computer') return 'computer';
  if (t === 'speaker') return 'box';
  if (t === 'tablet') return 'tablet';
  if (t === 'tv') return 'tv';
  return type || 'toestel';
}
