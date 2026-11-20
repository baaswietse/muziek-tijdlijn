// Verdeling van het spelverloop (tests/e2e/*.spec.js) over parallelle jobs in
// .github/workflows/ci.yml. De groepen staan in .github/e2e-groepen.json, met
// de hand verdeeld op duur: een gewone --shard van Playwright verdeelt op
// aantal tests, en de bestanden verschillen te veel in duur (van 1 s tot bijna
// 2 minuten) om zo evenwichtige jobs te krijgen.
//
// Dit script kijkt na dat elk spec-bestand in precies één groep zit en dat elk
// genoemd bestand bestaat, en schrijft dan de groepen als JSON voor de matrix
// van de workflow: [{"naam":"1","bestanden":"tests/e2e/a.spec.js ..."}, ...].
// Een nieuw spec-bestand dat nergens bij staat, laat de controle dus falen.
//
// Lokaal: node .github/e2e-groepen.mjs

import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'tests/e2e';
const groepen = JSON.parse(readFileSync(new URL('./e2e-groepen.json', import.meta.url), 'utf8'));
const specs = readdirSync(DIR).filter((f) => f.endsWith('.spec.js'));

const fouten = [];
const waar = new Map(); // bestand -> groepen waarin het staat
for (const [naam, bestanden] of Object.entries(groepen)) {
  if (!bestanden.length) fouten.push(`groep ${naam} is leeg`);
  for (const f of bestanden) waar.set(f, [...(waar.get(f) || []), naam]);
}
for (const f of specs) if (!waar.has(f)) fouten.push(`${DIR}/${f} zit in geen enkele groep`);
for (const [f, in_] of waar) {
  if (!specs.includes(f)) fouten.push(`${f} (groep ${in_.join(', ')}) bestaat niet in ${DIR}`);
  if (in_.length > 1) fouten.push(`${f} zit in meer dan één groep: ${in_.join(', ')}`);
}

if (fouten.length) {
  console.error(`Fout in .github/e2e-groepen.json:\n- ${fouten.join('\n- ')}`);
  process.exit(1);
}

const matrix = Object.entries(groepen).map(([naam, bestanden]) => ({
  naam,
  bestanden: bestanden.map((f) => `${DIR}/${f}`).join(' '),
}));
console.log(JSON.stringify(matrix));
