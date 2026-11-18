// Waar de muziek van de host vandaan komt: Spotify (inloggen, toestel kiezen,
// Premium) of fragmenten van Deezer (30 seconden, zonder account, uit de
// browser van de host). De keuze blijft bewaard op deze gsm.

import { useCallback, useState } from 'preact/hooks';
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

export function useHostMusic({ enabled, view, send = () => false }) {
  const [source, setSourceState] = useState(() => (storage.read(SOURCE) === 'fragment' ? 'fragment' : 'spotify'));
  const spotify = useMusic({ enabled: enabled && source === 'spotify', view });
  const fragment = useFragmentMusic({ enabled: enabled && source === 'fragment', view, send });
  const setSource = useCallback((s) => {
    const next = s === 'fragment' ? 'fragment' : 'spotify';
    storage.write(SOURCE, next);
    setSourceState(next);
  }, []);
  const active = source === 'fragment' ? fragment : spotify;
  return { ...active, source, setSource, spotifyLoggedIn: spotify.loggedIn };
}
