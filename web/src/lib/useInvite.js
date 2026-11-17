// Voert uit wat decideInvite (invite.js) beslist voor een uitnodigingslink:
// meteen meedoen, om een naam vragen of de host eerst laten kiezen. De link kan
// binnenkomen bij het openen van de pagina of later, via hashchange.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { joinRoom } from './net.js';
import { clearInvite, inviteCode, loadName, saveName } from './session.js';
import { afterJoinError, decideInvite, hostOf, switchedMessage } from './invite.js';

/**
 * `invite` is null of { code, step, name?, from?, error?, busy? } met step:
 *   decide   nog te beslissen (meteen hierna)
 *   waiting  wachten op de eerste status van het huidige spel (host of niet?)
 *   joining  bezig met meedoen, zonder formulier
 *   form     sober instapscherm met naamveld (busy: bezig na een tik)
 *   confirm  host van een ander spel: eerst vragen
 */
export function useInvite({ session, view, enter, notify }) {
  const [invite, setInvite] = useState(() => fresh(inviteCode()));
  // Eén poging tegelijk, ook bij een dubbele tik of een effect dat twee keer loopt.
  const joining = useRef(false);
  // Een andere link die binnenkomt terwijl een poging loopt, komt daarna aan de beurt.
  const queued = useRef(null);
  // Na het wachten op de server telt de sessie van dat moment, niet die van bij de start.
  const current = useRef(session);
  current.current = session;

  const join = useCallback(
    async (code, name, viaForm) => {
      if (joining.current) return;
      joining.current = true;
      setInvite((cur) => ({ ...cur, code, name, step: viaForm ? 'form' : 'joining', busy: true, error: null }));
      try {
        const res = await joinRoom(code, name);
        saveName(name);
        const before = current.current;
        enter({ code: res.code, token: res.token, playerId: res.playerId, name, host: false });
        setInvite(null);
        // De oude plaats blijft daar als offline speler staan, net als bij "Verlaat het spel".
        if (before && before.code !== res.code) notify(switchedMessage(before.code, res.code));
      } catch (err) {
        if (afterJoinError(err.code) === 'give-up') {
          clearInvite();
          setInvite(null);
          notify(err.message);
        } else {
          // Bezette naam of geen netwerk: de speler past zijn naam aan of tikt opnieuw.
          setInvite({ code, step: 'form', name, from: current.current?.code ?? null, error: err.message });
        }
      } finally {
        joining.current = false;
        const next = queued.current;
        queued.current = null;
        if (next && next !== code) setInvite(fresh(next));
      }
    },
    [enter, notify],
  );

  useEffect(() => {
    function onHash() {
      const code = inviteCode();
      if (joining.current) {
        if (code) queued.current = code;
        return;
      }
      setInvite((cur) => {
        // Hash weg (bv. terug-knop): een open vraag vervalt.
        if (!code) return null;
        return cur && cur.code === code ? cur : fresh(code);
      });
    }
    window.addEventListener('hashchange', onHash);
    // Effecten lopen pas na de paint: een link die tussen het eerste tekenen en
    // nu binnenkwam, gaf geen hashchange meer door. Kijk de hash dus nog eens na;
    // dezelfde code als in de beginstate laat onHash ongemoeid.
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!invite || (invite.step !== 'decide' && invite.step !== 'waiting')) return;
    const d = decideInvite({ code: invite.code, session, knownName: loadName(), host: hostOf(session, view) });
    if (d.action === 'join') join(invite.code, d.name, false);
    else if (d.action === 'ask-name') setInvite({ code: invite.code, step: 'form', name: loadName(), from: d.from });
    else if (d.action === 'confirm') setInvite({ code: invite.code, step: 'confirm', name: d.name, from: d.from });
    else if (d.action === 'wait') {
      if (invite.step !== 'waiting') setInvite({ ...invite, step: 'waiting' });
    } else {
      // Zelfde spel als de sessie: gewoon verder, geen tweede speler.
      clearInvite();
      setInvite(null);
    }
  }, [invite, session, view, join]);

  const submit = useCallback(
    (name) => {
      const clean = name.trim();
      if (!clean) return notify('Vul eerst je naam in.');
      join(invite.code, clean, true);
    },
    [invite, join, notify],
  );

  const stepOver = useCallback(() => {
    if (invite.name) join(invite.code, invite.name, false);
    else setInvite({ code: invite.code, step: 'form', name: '', from: invite.from });
  }, [invite, join]);

  // "Blijf" en "ander spel": de link vervalt, alles blijft zoals het was.
  const cancel = useCallback(() => {
    clearInvite();
    setInvite(null);
  }, []);

  return { invite, submit, stepOver, cancel };
}

function fresh(code) {
  return code ? { code, step: 'decide' } : null;
}
