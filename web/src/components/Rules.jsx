export function Rules({ open = false, target = 10 }) {
  return (
    <details class="rules" open={open}>
      <summary>Spelregels</summary>
      <ol>
        <li>Iedereen begint met één kaart (een nummer met zijn jaartal) en 2 tokens.</li>
        <li>Wie aan de beurt is, hoort een nummer. Titel en artiest blijven geheim.</li>
        <li>
          Leg het nummer op je tijdlijn: vóór, tussen of na de kaarten die je al hebt. Sleep de kaart met het vraagteken uit
          de houder onderaan naar de juiste plaats (of schuif ze met de pijltjes) en tik op «Leg het …». Terug in de houder
          slepen maakt je keuze ongedaan.
        </li>
        <li>Juist? Je houdt de kaart. Fout? De kaart is weg.</li>
        <li>Daarna wordt het nummer onthuld en is de volgende aan de beurt.</li>
        <li>Wie aan de beurt is, mag hardop artiest en nummer raden (fout of geen idee? dan de volgende); wie het eerst juist heeft, krijgt na de onthulling een token extra.</li>
        <li>Met een token kan je bij de beurt van een ander, nadat die zijn kaart legde, je token naar een andere, vrije plaats op diens tijdlijn slepen en met «Zet token hier» inzetten: ligt die speler fout en jij juist, dan krijg jij de kaart. Een ingezet token ben je altijd kwijt.</li>
        <li>Wie een token heeft, kiest bij elke beurt van een ander: inzetten of «Ik zet geen token in». Pas als iedereen koos, kan er onthuld worden. Wie niet verbonden is, houdt niets tegen; reageert iemand niet, dan kan de host toch onthullen.</li>
        <li>Op je eigen beurt kan je, voor je een plaats bevestigt, de kaart kopen voor 3 tokens: ze komt meteen juist op je tijdlijn. Je laatste kaart (de {target}e) kan je niet kopen; die moet je verdienen.</li>
        <li>Wie eerst {target} kaarten heeft, wint. Hetzelfde jaar als een buurkaart mag ervoor of erna.</li>
        <li>Bovenaan zie je je eigen kaarten en tokens; tik erop voor de stand van iedereen. Het menu (rechtsboven) heeft de spelcode, deze spelregels en, voor de host, de muziek en de beurt.</li>
      </ol>
    </details>
  );
}
