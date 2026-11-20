// Waar de muziek van de host vandaan komt: Spotify (inloggen, toestel kiezen,
// Premium) of fragmenten van Deezer (30 seconden, zonder account, uit de
// browser van de host). De keuze blijft bewaard op deze gsm.

import { useCallback, useRef, useState } from 'preact/hooks';
import { useMusic } from './music.js';
import { useFragmentMusic } from './fragments.js';
import { storage } from './session.js';

const SOURCE = 'mt.source';
export const SOURCES = ['spotify', 'fragment'];

/** Hoort de lijst op de server bij deze bron? Fragmenten spelen alleen een fragmentenlijst, Spotify nooit. */
export function deckMatches(source, playlist) {
  const fragmentDeck = playlist?.source === 'fragment';
  return source === 'fragment' ? fragmentDeck : !fragmentDeck;
}

/** De bron die bij de lijst op de server past: een fragmentenlijst speelt met fragmenten, al de rest met Spotify. */
export function sourceOf(playlist) {
  return playlist?.source === 'fragment' ? 'fragment' : 'spotify';
}

export function useHostMusic({ enabled, view, send = () => false }) {
  const [source, setSourceState] = useState(() => (storage.read(SOURCE) === 'fragment' ? 'fragment' : 'spotify'));
  // Werd deze gsm net host (doorgegeven of overgenomen), dan neemt hij de bron
  // van het spel over: die past bij de lijst op de server (een lijst met
  // fragmenten speelt met fragmenten, al de rest met Spotify). `handover`
  // onthoudt dat, zodat het spelscherm kan zeggen wat er nu van hem verwacht
  // wordt.
  const [handover, setHandover] = useState(false);
  const lastHost = useRef(null); // { code, hostId } van de vorige stand
  let effective = source;
  if (view) {
    const prev = lastHost.current;
    const became = prev && prev.code === view.code && prev.hostId !== view.you && view.hostId === view.you;
    if (became) {
      effective = sourceOf(view.playlist);
      if (effective !== source) {
        storage.write(SOURCE, effective);
        setSourceState(effective);
      }
      if (!handover) setHandover(true);
    } else if (handover && (view.hostId !== view.you || (prev && prev.code !== view.code))) {
      setHandover(false);
    }
    lastHost.current = { code: view.code, hostId: view.hostId };
  }
  const spotify = useMusic({ enabled: enabled && effective === 'spotify', view });
  const fragment = useFragmentMusic({ enabled: enabled && effective === 'fragment', view, send });
  const setSource = useCallback((s) => {
    const next = s === 'fragment' ? 'fragment' : 'spotify';
    storage.write(SOURCE, next);
    setSourceState(next);
  }, []);
  const active = effective === 'fragment' ? fragment : spotify;
  return { ...active, source: effective, setSource, spotifyLoggedIn: spotify.loggedIn, handover };
}
