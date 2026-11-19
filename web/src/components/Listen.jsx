// «Geluid op dit toestel» voor spelers die geen host zijn (zie lib/listen.js).
// Een speler op afstand die niets hoort, moet het meteen vinden; wie bij de
// luidspreker van de host zit, mag er geen last van hebben. Daarom:
// - in de wachtkamer een eigen blok bovenaan met één grote knop (ListenCard);
// - op het spelscherm een luidsprekerknop in de bovenbalk (ListenButton) en
//   één keer per spel een wegtikbare tip als het geluid hier uit staat
//   (ListenHint);
// - de keuze in het menu (ListenToggle), zoals voordien;
// - één regel met een knop als het geluid hier niet speelt (ListenAlert).

import { useEffect, useState } from 'preact/hooks';
import { LISTEN_LOCKED } from '../lib/listen.js';
import { storage } from '../lib/session.js';

const STATUS = {
  idle: '',
  waiting: 'Wacht op het fragment van de host…',
  starting: 'Fragment laden…',
  playing: 'Het fragment speelt op dit toestel.',
  paused: 'De host pauzeerde het fragment.',
  error: '',
};

/** Waarvoor het dient, in één zin (overal dezelfde). */
const WHY = 'Bedoeld om op afstand mee te spelen. Zit je bij dezelfde luidspreker als de host, laat het dan uit (anders hoor je het dubbel).';

/** Staat het geluid hier echt aan (gekozen én ontgrendeld)? Na een herlaad nog niet. */
const soundOn = (listen) => listen.wanted && listen.local === 'on';

/** Luidspreker met golfjes (aan) of met een kruisje (uit): het verschil zit in de vorm, niet alleen in de kleur. */
export function SpeakerIcon({ on, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="speaker-icon">
      <path d="M3.5 9h4l5-4v14l-5-4h-4z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        {on ? (
          <>
            <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
            <path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
          </>
        ) : (
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        )}
      </g>
    </svg>
  );
}

/** Wat het geluid hier nu doet (alleen als het aan staat). */
function StatusLine({ listen }) {
  if (!listen.wanted || (listen.status === 'idle' && !listen.error)) return null;
  return (
    <p class="muted small" data-testid="listen-status" data-status={listen.status}>
      {listen.error || STATUS[listen.status]}
    </p>
  );
}

/**
 * Wachtkamer: een eigen blok voor een speler die geen host is, met een vraag
 * in gewone taal en één knop. Staat het aan, dan zegt het blok dat duidelijk,
 * met een knop om het weer uit te zetten.
 */
export function ListenCard({ listen }) {
  if (!listen.available) return null;
  const on = listen.wanted;
  return (
    <section class={`card listen-card${on ? ' on' : ''}`} data-testid="listen-card" data-on={on ? 'yes' : 'no'} aria-labelledby="listen-card-title">
      <p class="listen-card-title" id="listen-card-title">
        <span class="listen-card-icon">
          <SpeakerIcon on={on} />
        </span>
        <span>{on ? 'Het geluid staat aan op deze gsm' : 'Hoor je de muziek van de host niet?'}</span>
      </p>
      {on ? (
        <>
          <StatusLine listen={listen} />
          <button key="off" type="button" class="btn" onClick={listen.turnOff} data-testid="listen-off">
            Zet het geluid hier uit
          </button>
        </>
      ) : (
        <>
          <p class="listen-card-text">Zet het geluid hier aan: dan speelt het fragment ook op deze gsm.</p>
          <button key="on" type="button" class="btn primary big listen-card-btn" onClick={listen.turnOn} data-testid="listen-on">
            <SpeakerIcon on /> Zet het geluid hier aan
          </button>
        </>
      )}
      <p class="muted small">{WHY}</p>
    </section>
  );
}

/**
 * Bovenbalk van het spelscherm: de stand in één oogopslag en één tik om te
 * schakelen. Gekozen maar nog niet ontgrendeld (na een herlaad): dan toont
 * hij «uit» en zet een tik het geluid aan.
 */
export function ListenButton({ listen }) {
  if (!listen.available) return null;
  const on = soundOn(listen);
  return (
    <button
      type="button"
      class={`icon-btn listen-btn${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      aria-label="Geluid op dit toestel"
      title={on ? 'Geluid op dit toestel staat aan. Tik om het uit te zetten.' : 'Geluid op dit toestel staat uit. Tik om het aan te zetten.'}
      onClick={() => (on ? listen.turnOff() : listen.turnOn())}
      data-testid="listen-quick"
      data-on={on ? 'yes' : 'no'}
    >
      <SpeakerIcon on={on} />
    </button>
  );
}

const hintKey = (code, game) => `mt.listenHint.${code}.${game}`;

/**
 * Eén keer per spel, als het geluid hier uit staat en er een fragment loopt:
 * een korte tip dat het hier aan kan. Weg met een tik, en vanzelf na die beurt.
 * `turn`: welke beurt nu loopt (null: er loopt geen fragment).
 */
export function ListenHint({ listen, code, game, turn }) {
  const key = hintKey(code, game);
  // De beurt waarin de tip verscheen; null zolang hij niet getoond is.
  const [shownIn, setShownIn] = useState(null);
  const [gone, setGone] = useState(() => storage.read(key) === true);
  const eligible = listen.available && !listen.wanted && turn !== null && !gone;

  useEffect(() => {
    if (!eligible || shownIn !== null) return;
    // Meteen bewaren: ook na een herlaad komt hij in dit spel niet terug.
    storage.write(key, true);
    setShownIn(turn);
  }, [eligible, shownIn, turn, key]);
  // Wie het geluid in dit spel al eens aanzette, kent het: geen tip meer, ook niet als het weer uit gaat.
  useEffect(() => {
    if (!listen.available || !listen.wanted || gone) return;
    storage.write(key, true);
    setGone(true);
  }, [listen.available, listen.wanted, gone, key]);

  if (!eligible || shownIn !== turn) return null;
  return (
    <div class="listen-hint" role="status" data-testid="listen-hint">
      <span class="listen-hint-text">Hoor je de muziek niet? Zet het geluid hier aan.</span>
      <button type="button" class="btn small-btn primary" onClick={listen.turnOn} data-testid="listen-hint-on">
        Zet aan
      </button>
      <button type="button" class="icon-btn soft" onClick={() => setGone(true)} aria-label="Verberg deze tip" data-testid="listen-hint-close">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** De keuze aan/uit in het menu, met één zin uitleg. Alleen als de host met fragmenten speelt. */
export function ListenToggle({ listen }) {
  if (!listen.available) return null;
  const on = listen.wanted;
  return (
    <div class="listen" data-testid="listen" data-on={on ? 'yes' : 'no'}>
      <button
        type="button"
        class="menu-row"
        role="switch"
        aria-checked={on ? 'true' : 'false'}
        onClick={() => (on ? listen.turnOff() : listen.turnOn())}
        data-testid="listen-toggle"
      >
        Geluid op dit toestel <span class={`chip${on ? '' : ' soft'}`}>{on ? 'aan' : 'uit'}</span>
      </button>
      <p class="muted small">{WHY}</p>
      <StatusLine listen={listen} />
    </div>
  );
}

/**
 * Op het spelscherm, alleen als er iets mis is: het geluid staat hier nog uit
 * (na een herlaad, of de browser weigerde) of het fragment speelt hier niet.
 * Alleen deze speler ziet dat; het spel van de anderen loopt door.
 */
export function ListenAlert({ listen }) {
  if (!listen.active) return null;
  if (listen.local !== 'on') {
    return (
      <p class="host-alert" role="alert" data-testid="listen-alert" data-kind="locked">
        <span class="host-alert-text">{listen.error || LISTEN_LOCKED}</span>
        <button type="button" class="btn small-btn" onClick={listen.turnOn} data-testid="listen-unlock">
          Zet het geluid aan
        </button>
      </p>
    );
  }
  if (listen.status === 'error') {
    return (
      <p class="host-alert" role="alert" data-testid="listen-alert" data-kind="error">
        <span class="host-alert-text">{listen.error}</span>
        <button type="button" class="btn small-btn" onClick={listen.retry} data-testid="listen-retry">
          Probeer opnieuw
        </button>
      </p>
    );
  }
  return null;
}
