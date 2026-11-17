// Een tijdlijn: kaarten van oud (boven) naar nieuw (onder). Er staan alleen
// kaarten op; wie een kaart of token legt, sleept die erin (zie lib/drag.js).

export function slotLabel(cards, i) {
  if (cards.length === 0) return 'hier';
  if (i === 0) return `vóór ${cards[0].year}`;
  if (i === cards.length) return `na ${cards[i - 1].year}`;
  return `tussen ${cards[i - 1].year} en ${cards[i].year}`;
}

// Vanaf zoveel kaarten wordt alles compacter, zodat 9 à 10 kaarten zo goed als
// op één scherm passen.
const COMPACT_FROM = 6;

function CardRow({ card, index, fresh }) {
  return (
    <li class={`tl-card${fresh ? ' fresh' : ''}`} data-row data-card={index} data-year={card.year} data-track={card.id}>
      <span class="tl-year">{card.year}</span>
      <span class="tl-text">
        <span class="tl-title">{card.title}</span>
        <span class="tl-artist">{card.artist}</span>
      </span>
    </li>
  );
}

function Mystery({ text, testid = 'pending-card', slot }) {
  return (
    <li class="tl-card mystery" data-testid={testid} data-row data-slot={slot}>
      <span class="tl-year">?</span>
      <span class="tl-text">
        <span class="tl-title">{text}</span>
      </span>
    </li>
  );
}

/** Een ingezet token bij een gat: wie, en na de onthulling of het juist was. */
function BetMark({ mark }) {
  const verdict = mark.correct === undefined ? '' : mark.correct ? ' — juist' : ' — fout';
  const state = mark.correct === undefined ? '' : mark.correct ? ' good' : ' bad';
  return (
    <li class={`tl-bet${state}`} data-testid="bet-mark" data-player={mark.playerId} data-index={mark.index} data-row data-slot={mark.index}>
      Token van {mark.name}
      {verdict}
    </li>
  );
}

/**
 * @param {object} props
 * @param {Array} props.cards        kaarten, al gesorteerd op jaar
 * @param {string} [props.testid]
 * @param {number|null} [props.pendingIndex]  waar de speler aan beurt twijfelt (bij de anderen)
 * @param {string} [props.pendingText]
 * @param {object} [props.reveal]    net onthulde kaart { card, index, correct }
 * @param {number|null} [props.lockedIndex]  vastgelegde plaats van de speler aan beurt (tussenfase)
 * @param {Array} [props.marks]      ingezette tokens { playerId, index, name, correct? }
 * @param {string} [props.freshId]   kaart die er net bij kwam (via een token)
 * @param {object} [props.place]     wie hier zelf iets legt: { index, row, listRef } — `row`
 *                                   is de eigen keuze (een <li data-pick>) op plaats `index`
 */
export function Timeline({
  cards,
  testid,
  pendingIndex = null,
  pendingText = 'Hier komt het nummer…',
  reveal,
  lockedIndex = null,
  lockedText,
  marks = [],
  freshId = null,
  place,
}) {
  const rows = [];
  for (let i = 0; i <= cards.length; i++) {
    if (lockedIndex === i) rows.push(<Mystery key={`l${i}`} text={lockedText} testid="placed-card" slot={i} />);
    for (const m of marks) if (m.index === i) rows.push(<BetMark key={`b${m.playerId}`} mark={m} />);
    if (reveal && !reveal.correct && reveal.index === i) {
      rows.push(
        <li class="tl-card wrong" key="wrong" data-testid="wrong-card" data-row data-slot={i}>
          <span class="tl-year">{reveal.card.year}</span>
          <span class="tl-text">
            <span class="tl-title">{reveal.card.title}</span>
            <span class="tl-artist">{reveal.cardTo ? 'hoort hier niet' : 'hoort hier niet — kaart weg'}</span>
          </span>
        </li>,
      );
    }
    if (place && place.index === i) rows.push(place.row);
    else if (!place && pendingIndex === i) rows.push(<Mystery key={`m${i}`} text={pendingText} slot={i} />);
    if (i < cards.length) {
      const card = cards[i];
      rows.push(
        <CardRow key={card.id} card={card} index={i} fresh={Boolean((reveal?.correct && reveal.card.id === card.id) || freshId === card.id)} />,
      );
    }
  }
  return (
    <ol class={`timeline${cards.length >= COMPACT_FROM ? ' compact' : ''}`} data-testid={testid} ref={place?.listRef}>
      {rows}
      {/* Tijdens het slepen: waar de kaart zou landen (plaats en grootte zet lib/drag.js). */}
      {place && <li class="tl-drop" aria-hidden="true" />}
    </ol>
  );
}

/** Compacte versie: alleen de jaartallen op een rij. */
export function YearChips({ cards }) {
  if (cards.length === 0) return <span class="muted small">nog geen kaarten</span>;
  return (
    <span class="years">
      {cards.map((c) => (
        <span class="year-chip" key={c.id}>
          {c.year}
        </span>
      ))}
    </span>
  );
}
