// Instellingen voor de muziek, alleen op de gsm van de host: de bron kiezen
// (Spotify of fragmenten zonder account), bij Spotify inloggen en een toestel
// kiezen, bij fragmenten het geluid aanzetten, en het geluid testen.

import { redirectUri } from '../spotify/index.js';

const STATUS = {
  idle: '',
  starting: 'Nummer wordt gestart…',
  playing: 'Muziek speelt',
  paused: 'Muziek gepauzeerd',
  error: '',
  wrong: '',
};

/**
 * `onSource`: alleen in de wachtkamer, waar de host de bron kan wisselen (de
 * wachtkamer past dan ook de lijst met nummers aan).
 */
export function MusicPanel({ music, onSource = null }) {
  const chooser = onSource ? <SourceChooser music={music} onSource={onSource} /> : null;
  if (music.source === 'fragment') return <FragmentPanel music={music} chooser={chooser} />;
  return <SpotifyPanel music={music} chooser={chooser} />;
}

function SourceChooser({ music, onSource }) {
  const options = [
    { id: 'spotify', name: 'Spotify', hint: 'volledige nummers; Spotify Premium en een login nodig' },
    { id: 'fragment', name: 'Fragmenten (30 seconden, zonder account)', hint: 'geen login, geen Premium: het geluid komt uit dit toestel' },
  ];
  return (
    <div class="source-choice" role="group" aria-label="Waar komt de muziek vandaan?">
      <p class="label">Waar komt de muziek vandaan?</p>
      <ul class="devices">
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              class={`device${music.source === o.id ? ' on' : ''}`}
              aria-pressed={music.source === o.id}
              data-testid={`source-${o.id}`}
              onClick={() => music.source !== o.id && onSource(o.id)}
            >
              <span class="device-name">{o.name}</span>
              <span class="muted small">{o.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Fragmenten van Deezer: geen login of toestel, wel één tik om het geluid aan te zetten. */
function FragmentPanel({ music, chooser }) {
  return (
    <section class="card music" data-testid="music-panel" data-source="fragment">
      <h2>Muziek</h2>
      {chooser}
      <p class="muted small">
        Elke beurt speelt een fragment van 30 seconden van Deezer, steeds opnieuw tot de beurt voorbij is. Het geluid komt uit
        dit toestel: hang het aan een box als je wil. Laat de site open op het scherm.
      </p>
      {music.local !== 'on' ? (
        <>
          <p class="notice" data-testid="fragment-locked">
            Je browser speelt pas geluid na een tik. Tik één keer op de knop hieronder.
          </p>
          <button class="btn primary" onClick={music.chooseBrowser} disabled={music.local === 'starting'} data-testid="fragment-unlock">
            {music.local === 'starting' ? 'Bezig…' : 'Zet het geluid aan'}
          </button>
        </>
      ) : (
        <div class="row gap">
          <button class="btn" onClick={music.test} disabled={music.busy || music.inGame} data-testid="music-test">
            Test het geluid
          </button>
        </div>
      )}
      <p class="music-status" data-testid="music-status" data-ready={music.ready ? 'yes' : 'no'}>
        {music.ready ? 'Klaar: het geluid komt uit dit toestel. ' : 'Zet eerst het geluid aan. '}
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
          <li>Het spel toont titel, artiest en jaar pas bij de onthulling, ook aan jou.</li>
          <li>De mediabediening van je gsm (meldingen, vergrendelscherm) toont alleen «Muziek-tijdlijn».</li>
          <li>Het spel houdt je scherm wakker. Open tijdens een beurt geen ontwikkelaarstools: daar staat het antwoord van Deezer.</li>
        </ul>
      </details>
    </section>
  );
}

function SpotifyPanel({ music, chooser }) {
  if (!music.configured) {
    return (
      <section class="card music" data-testid="music-panel">
        <h2>Muziek</h2>
        {chooser}
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
        {chooser}
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
      {chooser}

      <p class="label">Op welk toestel speelt de muziek? Dit scherm maakt zelf geen geluid.</p>
      <ul class="devices">
        {music.browserSupported && (
          <li>
            <button
              type="button"
              class={`device${music.device?.local && music.local === 'on' ? ' on' : ''}`}
              data-testid="device-browser"
              aria-pressed={Boolean(music.device?.local && music.local === 'on')}
              disabled={music.local === 'starting'}
              onClick={music.chooseBrowser}
            >
              <span class="device-name">Dit toestel</span>
              <span class="muted small">
                {music.local === 'starting' ? 'bezig met starten…' : 'geluid uit dit toestel zelf, zonder Spotify-app'}
              </span>
            </button>
          </li>
        )}
        {(devices || []).map((d) => (
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
      {devices === null ? (
        <p class="muted small">Andere toestellen zoeken…</p>
      ) : (
        <p class="muted small" data-testid="device-hint">
          {devices.length === 0 ? 'Spotify ziet nu geen andere toestellen. ' : ''}
          Staat een toestel er niet bij (bv. je gsm aan de box)? Open er de Spotify-app, speel even een nummer af en kom
          terug: de lijst ververst vanzelf. Kies alleen een toestel dat hier in de kamer staat.
        </p>
      )}
      {music.device?.local && music.local === 'off' && (
        <p class="notice" data-testid="browser-off">
          Het geluid op dit toestel staat nog uit. Tik op «Dit toestel» om het aan te zetten.
        </p>
      )}
      {music.device && !music.device.local && devices && !devices.some((d) => d.id === music.device.id) && (
        <p class="notice">
          «{music.device.name}» is nu niet zichtbaar voor Spotify. Open er de Spotify-app en tik op «Zoek opnieuw».
        </p>
      )}

      <div class="row gap">
        <button class="btn" onClick={music.refreshDevices} disabled={music.busy}>
          Zoek opnieuw
        </button>
        {/* Tijdens een spel zou de test het nummer van de beurt onderbreken: gebruik dan «Opnieuw afspelen». */}
        <button class="btn" onClick={music.test} disabled={music.busy || !music.device || music.inGame} data-testid="music-test">
          Test het geluid
        </button>
      </div>

      <p class="music-status" data-testid="music-status" data-ready={music.ready ? 'yes' : 'no'}>
        {music.ready
          ? music.device.local
            ? 'Klaar: het geluid komt uit dit toestel. '
            : `Klaar: speelt op «${music.device.name}». `
          : 'Kies een toestel. '}
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
