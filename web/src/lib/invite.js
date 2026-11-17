// Wat er moet gebeuren als iemand een uitnodigingslink (#/j/ABCD) opent. Puur
// en zonder browser-API's, zodat de unit-tests elk geval kunnen nalopen; de app
// voert de gekozen actie uit (zie app.jsx).

/** Code uit de hash van een uitnodigingslink, of '' als het er geen is. */
export function codeFromHash(hash) {
  const m = String(hash || '').match(/^#\/j\/([A-Za-z]{4})$/);
  return m ? m[1].toUpperCase() : '';
}

/**
 * Is deze gsm de host van de ruimte in de sessie? true, false of null (nog
 * niet te zeggen). De status van de server weegt het zwaarst; zolang die er
 * niet is, telt wat bij het aanmaken of meedoen bewaard werd. Oude sessies
 * hebben dat veld niet: dan weten we het pas na de eerste status.
 */
export function hostOf(session, view) {
  if (!session) return null;
  if (view && view.code === session.code) return view.you === view.hostId;
  return typeof session.host === 'boolean' ? session.host : null;
}

/**
 * Beslist wat er met uitnodigingscode `code` gebeurt.
 *
 * @param {{code:string, session:?{code:string,name?:string}, knownName?:string, host?:?boolean}} input
 * @returns {{action:'none'}
 *   | {action:'stay'}                                  zelfde ruimte: gewoon verder
 *   | {action:'wait'}                                  host of niet? wacht op de server
 *   | {action:'join', name:string, from:?string}       meteen meedoen
 *   | {action:'ask-name', from:?string}                sober instapscherm met naamveld
 *   | {action:'confirm', name:string, from:string}}    host van een ander spel: eerst vragen
 *
 * `from` is de code van het spel dat de speler verlaat, of null.
 */
export function decideInvite({ code, session, knownName = '', host = null }) {
  if (!code) return { action: 'none' };
  const fallback = String(knownName || '').trim();
  if (!session) return fallback ? { action: 'join', name: fallback, from: null } : { action: 'ask-name', from: null };
  if (session.code === code) return { action: 'stay' };

  const name = String(session.name || '').trim() || fallback;
  // Een host die vertrekt, legt het spel stil voor de anderen: dat moet hij
  // zelf beslissen. Zolang we niet weten of hij host is, beslissen we niets.
  if (host === null || host === undefined) return { action: 'wait' };
  if (host) return { action: 'confirm', name, from: session.code };
  return name ? { action: 'join', name, from: session.code } : { action: 'ask-name', from: session.code };
}

// Fouten waarbij een andere naam niets verandert: de ruimte is er niet, zit vol
// of kan niemand meer opnemen. Opnieuw proberen heeft dan geen zin.
const FINAL = new Set(['NO_ROOM', 'ROOM_FULL', 'DECK_EMPTY', 'NO_SERVER']);

/**
 * Wat na een mislukte poging om mee te doen? 'give-up': melding tonen en de
 * link laten vallen. 'form': het instapscherm tonen met de melding, zodat de
 * speler een andere naam kiest of na een netwerkfout met één tik opnieuw probeert.
 */
export function afterJoinError(errorCode) {
  return FINAL.has(errorCode) ? 'give-up' : 'form';
}

/** Melding na het wisselen van spel. */
export function switchedMessage(from, to) {
  return `Je zat nog in spel ${from}. Je doet nu mee met ${to}.`;
}
