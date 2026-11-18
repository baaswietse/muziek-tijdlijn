// «Geluid op dit toestel» voor spelers die geen host zijn (zie lib/listen.js):
// de keuze zelf (in het menu en in de wachtkamer), en op het spelscherm één
// regel met een knop als het geluid hier niet speelt.

import { LISTEN_LOCKED } from '../lib/listen.js';

const STATUS = {
  idle: '',
  waiting: 'Wacht op het fragment van de host…',
  starting: 'Fragment laden…',
  playing: 'Het fragment speelt op dit toestel.',
  paused: 'De host pauzeerde het fragment.',
  error: '',
};

/** De keuze aan/uit, met één zin uitleg. Alleen als de host met fragmenten speelt. */
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
      <p class="muted small">
        Om op afstand mee te spelen: het fragment speelt dan ook hier. Zit je bij dezelfde luidspreker als de host, laat het
        dan uit (anders hoor je het dubbel).
      </p>
      {on && (listen.status !== 'idle' || listen.error) && (
        <p class="muted small" data-testid="listen-status" data-status={listen.status}>
          {listen.error || STATUS[listen.status]}
        </p>
      )}
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
