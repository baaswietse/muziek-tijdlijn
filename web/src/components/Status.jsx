// Kleine statusonderdelen die zowel de gewone bovenbalk als die van het
// spelscherm tonen: de verbinding en de testmodus.

import { isMock } from '../spotify/index.js';

const NET_LABEL = { online: 'Verbonden', connecting: 'Verbinden…', offline: 'Geen verbinding' };

/** Bolletje voor de verbinding: groen, amber (bezig) of rood. */
export function NetDot({ net }) {
  return (
    <span class={`net ${net}`} data-testid="net-status" data-status={net} title={NET_LABEL[net]}>
      <span class="visually-hidden">{NET_LABEL[net]}</span>
    </span>
  );
}

/** Spotify is nagebootst (?mock=1): er komt geen geluid. Met `short` past het in een volle balk. */
export function MockChip({ short = false }) {
  if (!isMock) return null;
  return (
    <a class="chip warn" href="?mock=0" title="Testmodus: Spotify is nagebootst, er komt geen geluid. Tik om de testmodus uit te zetten.">
      {short ? 'test' : 'testmodus'}
    </a>
  );
}

export function NetBanner() {
  return (
    <div class="banner" role="status">
      Verbinding kwijt. Ik probeer opnieuw…
    </div>
  );
}
