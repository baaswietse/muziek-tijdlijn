export function Rules({ open = false, target = 10 }) {
  return (
    <details class="rules" open={open}>
      <summary>Spelregels</summary>
      <ol>
        <li>Iedereen begint met één kaart (een nummer met zijn jaartal) en 2 tokens.</li>
        <li>Wie aan de beurt is, hoort een nummer. Titel en artiest blijven geheim.</li>
        <li>Leg het nummer op je tijdlijn: vóór, tussen of na de kaarten die je al hebt.</li>
        <li>Juist? Je houdt de kaart. Fout? De kaart is weg.</li>
        <li>Daarna wordt het nummer onthuld en is de volgende aan de beurt.</li>
        <li>Wie aan de beurt is, mag hardop artiest en nummer raden (fout of geen idee? dan de volgende); wie het eerst juist heeft, krijgt na de onthulling een token extra.</li>
        <li>Met een token kan je bij de beurt van een ander, nadat die zijn kaart legde, een andere plaats kiezen: ligt die speler fout en jij juist, dan krijg jij de kaart. Een ingezet token ben je altijd kwijt.</li>
        <li>Wie eerst {target} kaarten heeft, wint. Hetzelfde jaar als een buurkaart mag ervoor of erna.</li>
      </ol>
    </details>
  );
}
