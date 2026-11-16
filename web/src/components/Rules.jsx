export function Rules({ open = false, target = 10 }) {
  return (
    <details class="rules" open={open}>
      <summary>Spelregels</summary>
      <ol>
        <li>Iedereen begint met één kaart: een nummer met zijn jaartal.</li>
        <li>Wie aan de beurt is, hoort een nummer. Titel en artiest blijven geheim.</li>
        <li>Leg het nummer op je tijdlijn: vóór, tussen of na de kaarten die je al hebt.</li>
        <li>Juist? Je houdt de kaart. Fout? De kaart is weg.</li>
        <li>Daarna wordt het nummer onthuld en is de volgende aan de beurt.</li>
        <li>Wie eerst {target} kaarten heeft, wint. Hetzelfde jaar als een buurkaart mag ervoor of erna.</li>
      </ol>
    </details>
  );
}
