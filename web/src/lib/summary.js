// Het overzicht op het eindscherm: eindstand, cijfers per speler, prijzen en
// hoe lang het spel duurde. Rekent alleen met de stand die de server stuurt
// (zie viewFor in server/src/rules.js), zonder DOM, zodat het ook als unit-test
// draait en de gedeelde afbeelding (shareimage.js) hetzelfde toont als het scherm.

/** "1 kaart", "3 kaarten" */
export const plural = (n, one, more) => `${n} ${n === 1 ? one : more}`;

/** "Bob", "Bob en Cas", "Ann, Bob en Cas" */
export function joinNames(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} en ${names.at(-1)}`;
}

/**
 * De prijzen, in deze volgorde. Een prijs telt pas vanaf `min` (anders zegt ze
 * niets), en bij een gelijke stand delen hoogstens twee spelers ze; staan er
 * meer gelijk, dan valt ze weg (nooit een willekeurige winnaar).
 */
export const PRIZES = [
  {
    key: 'streak',
    title: 'Langste reeks',
    value: (s) => s.bestStreak,
    min: 3,
    detail: (n) => `${n} juist na elkaar`,
  },
  {
    key: 'guess',
    title: 'Beste rader',
    value: (s) => s.guessed,
    min: 2,
    detail: (n) => `${n} keer artiest en titel`,
  },
  {
    key: 'sharp',
    title: 'Scherpste inzetter',
    value: (s) => s.betsWon,
    min: 2,
    detail: (n) => `${plural(n, 'kaart', 'kaarten')} gewonnen met een token`,
  },
  {
    key: 'gamble',
    title: 'Grootste gokker',
    value: (s) => s.betsWon + s.betsLost,
    min: 3,
    detail: (n) => `${plural(n, 'token', 'tokens')} ingezet`,
  },
];

/** Zoveel spelers mogen een prijs delen; staan er meer gelijk, dan valt ze weg. */
export const MAX_SHARED = 2;

/**
 * De prijzen voor deze spelers (elk met `stats`; wie geen cijfers heeft, doet
 * niet mee). Met minder dan twee spelers zijn er geen prijzen.
 */
export function prizesFor(players) {
  const counted = players.filter((p) => p.stats);
  if (counted.length < 2) return [];
  const out = [];
  for (const prize of PRIZES) {
    const best = Math.max(...counted.map((p) => prize.value(p.stats) || 0));
    if (best < prize.min) continue;
    const top = counted.filter((p) => (prize.value(p.stats) || 0) === best);
    if (top.length > MAX_SHARED) continue;
    out.push({
      key: prize.key,
      title: prize.title,
      ids: top.map((p) => p.id),
      names: top.map((p) => p.name),
      value: best,
      detail: prize.detail(best),
    });
  }
  return out;
}

/**
 * Korte cijfers van één speler, alleen wat iets zegt: de lege tellers vallen
 * weg (wie nooit inzette, krijgt geen "0 tokens verloren").
 */
export function statLines(stats) {
  if (!stats) return [];
  const out = [];
  if (stats.placed > 0) out.push({ key: 'placed', text: `${stats.correct} van ${stats.placed} juist gelegd` });
  if (stats.bestStreak >= 2) out.push({ key: 'streak', text: `reeks van ${stats.bestStreak}` });
  if (stats.guessed > 0) out.push({ key: 'guessed', text: `${stats.guessed}× geraden` });
  if (stats.betsWon > 0) out.push({ key: 'betsWon', text: `${plural(stats.betsWon, 'kaart', 'kaarten')} met een token` });
  if (stats.betsLost > 0) out.push({ key: 'betsLost', text: `${plural(stats.betsLost, 'token', 'tokens')} verloren` });
  if (stats.bought > 0) out.push({ key: 'bought', text: `${plural(stats.bought, 'kaart', 'kaarten')} gekocht` });
  return out;
}

/** "minder dan een minuut", "12 min", "1 u 05 min"; null als het niet gekend is. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return 'minder dan een minuut';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} u ${String(min % 60).padStart(2, '0')} min`;
}

/**
 * Alles voor het eindscherm uit één stand van de server.
 * - `standings`: de winnaar(s) eerst, dan meeste kaarten, dan meeste tokens,
 *   dan de beurtvolgorde. `rank` is gedeeld bij gelijke kaarten en tokens, en
 *   alle winnaars staan op 1.
 * - `complete`: het spel hield de cijfers bij (een spel dat al liep bij de
 *   uitrol niet: dan alleen de eindstand, zonder cijfers, prijzen of duur).
 */
export function buildSummary(view) {
  const winnerIds = view.winnerIds ?? [];
  const isWinner = (p) => winnerIds.includes(p.id);
  const players = view.players.map((p, order) => ({
    id: p.id,
    name: p.name,
    cards: p.timeline?.length ?? 0,
    tokens: p.guessTokens ?? 0,
    winner: isWinner(p),
    stats: p.stats ?? null,
    order,
  }));
  const ahead = (a, b) => {
    if (a.winner !== b.winner) return a.winner ? -1 : 1;
    if (a.cards !== b.cards) return b.cards - a.cards;
    return b.tokens - a.tokens;
  };
  const standings = players.slice().sort((a, b) => ahead(a, b) || a.order - b.order);
  // Winnaars delen de eerste plaats; daarna telt wie er echt voor staat.
  for (const p of standings) p.rank = p.winner ? 1 : 1 + standings.filter((q) => ahead(q, p) < 0).length;
  const summary = view.summary ?? null;
  const complete = Boolean(summary) && players.length > 0 && players.every((p) => p.stats);
  const winners = standings.filter((p) => p.winner);
  return {
    target: view.settings?.target ?? null,
    winners,
    standings,
    prizes: complete ? prizesFor(players) : [],
    complete,
    turns: summary ? summary.turns ?? null : null,
    ms: summary ? summary.ms ?? null : null,
  };
}

/** De regel met duur, beurten en doel: "32 min · 24 beurten · naar 10 kaarten". */
export function metaLine(s) {
  const parts = [];
  const time = formatDuration(s.ms);
  if (time) parts.push(time);
  if (Number.isFinite(s.turns) && s.turns > 0) parts.push(plural(s.turns, 'beurt', 'beurten'));
  if (s.target) parts.push(`naar ${s.target} kaarten`);
  return parts.join(' · ');
}

/** De kop van de winnaar(s), zonder "jij": voor de afbeelding en schermlezers. */
export function winnerTitle(s) {
  if (s.winners.length === 0) return 'Spel afgelopen';
  if (s.winners.length === 1) return `${s.winners[0].name} wint`;
  return `Gelijkspel: ${joinNames(s.winners.map((w) => w.name))}`;
}
