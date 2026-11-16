// Een tijdlijn: kaarten van oud (boven) naar nieuw (onder). Is het jouw beurt,
// dan staan er tussen de kaarten plaatsen waar je het nummer kan leggen.

export function slotLabel(cards, i) {
  if (cards.length === 0) return 'hier';
  if (i === 0) return `vóór ${cards[0].year}`;
  if (i === cards.length) return `na ${cards[i - 1].year}`;
  return `tussen ${cards[i - 1].year} en ${cards[i].year}`;
}

function CardRow({ card, fresh }) {
  return (
    <li class={`tl-card${fresh ? ' fresh' : ''}`} data-year={card.year} data-track={card.id}>
      <span class="tl-year">{card.year}</span>
      <span class="tl-text">
        <span class="tl-title">{card.title}</span>
        <span class="tl-artist">{card.artist}</span>
      </span>
    </li>
  );
}

function Mystery({ own }) {
  return (
    <li class="tl-card mystery" data-testid="pending-card">
      <span class="tl-year">?</span>
      <span class="tl-text">
        <span class="tl-title">{own ? 'Hier leg je het nummer' : 'Hier komt het nummer…'}</span>
      </span>
    </li>
  );
}

/**
 * @param {object} props
 * @param {Array} props.cards        kaarten, al gesorteerd op jaar
 * @param {number|null} props.pendingIndex  plaats die nu aangeduid is
 * @param {Function} [props.onPick]  aanwezig = jouw beurt, plaatsen aanklikbaar
 * @param {object} [props.reveal]    net onthulde kaart { card, index, correct }
 */
export function Timeline({ cards, pendingIndex = null, onPick, reveal, testid }) {
  const rows = [];
  for (let i = 0; i <= cards.length; i++) {
    if (reveal && !reveal.correct && reveal.index === i) {
      rows.push(
        <li class="tl-card wrong" key="wrong" data-testid="wrong-card">
          <span class="tl-year">{reveal.card.year}</span>
          <span class="tl-text">
            <span class="tl-title">{reveal.card.title}</span>
            <span class="tl-artist">hoort hier niet — kaart weg</span>
          </span>
        </li>,
      );
    }
    if (onPick) {
      rows.push(
        pendingIndex === i ? (
          <Mystery key={`m${i}`} own />
        ) : (
          <li class="tl-slot" key={`s${i}`}>
            <button type="button" class="slot-btn" data-testid={`slot-${i}`} onClick={() => onPick(i)}>
              <span class="slot-plus" aria-hidden="true">+</span>
              {slotLabel(cards, i)}
            </button>
          </li>
        ),
      );
    } else if (pendingIndex === i) {
      rows.push(<Mystery key={`m${i}`} />);
    }
    if (i < cards.length) {
      const card = cards[i];
      rows.push(<CardRow key={card.id} card={card} fresh={Boolean(reveal?.correct && reveal.card.id === card.id)} />);
    }
  }
  return (
    <ol class="timeline" data-testid={testid}>
      {rows}
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
