// Maakt de app-iconen (web/public/icons/*.png) uit het merk van het favicon in
// web/index.html: een groen vlak met de meetlat en de amberkleurige stip.
// Rendert met de Chromium van Playwright, dus zonder extra pakketten.
//
// Gebruik: node tools/iconen.mjs

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../web/public/icons/', import.meta.url));

const GREEN = '#0e7c66';
const PAPER = '#fffdf8';
const AMBER = '#f2b33d';

// Het merk in de eenheden van het favicon (vak van 64). In het favicon staat
// het iets links van het midden; hier schuift het 2,25 op zodat het precies in
// het midden staat (omkadering met de ronde lijnuiteinden: x 14–54,5, y 9,5–54,5).
const MARK = `
  <g transform="translate(-2.25 0)">
    <path d="M20 12v40" stroke="${PAPER}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="20" cy="20" r="6" fill="${AMBER}"/>
    <circle cx="20" cy="44" r="6" fill="${PAPER}"/>
    <path d="M32 20h20M32 44h14" stroke="${PAPER}" stroke-width="5" stroke-linecap="round"/>
  </g>`;

/** Het merk, geschaald rond het midden van het vak. */
function mark(scale) {
  return `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${MARK}</g>`;
}

const ICONS = [
  // Zoals het favicon: afgeronde hoeken, daarbuiten doorzichtig.
  { file: 'icon-192.png', size: 192, bg: `<rect width="64" height="64" rx="14" fill="${GREEN}"/>`, scale: 1, transparent: true },
  { file: 'icon-512.png', size: 512, bg: `<rect width="64" height="64" rx="14" fill="${GREEN}"/>`, scale: 1, transparent: true },
  // Maskable: groen tot aan de rand, het merk binnen de veilige zone (cirkel
  // met straal 40% van de breedte, hier 25,6). Het verste punt van het merk
  // (de uiteinden van de meetlat) ligt op ~28 van het midden; geschaald met
  // 0,8 is dat ~22,4.
  { file: 'icon-maskable-512.png', size: 512, bg: `<rect width="64" height="64" fill="${GREEN}"/>`, scale: 0.8 },
  // iOS rondt zelf de hoeken af en wil geen doorzichtigheid.
  { file: 'apple-touch-icon.png', size: 180, bg: `<rect width="64" height="64" fill="${GREEN}"/>`, scale: 1 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${icon.size}" height="${icon.size}">` +
      `${icon.bg}${mark(icon.scale)}</svg>`;
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${icon.transparent ? 'transparent' : GREEN}">${svg}</body></html>`,
    );
    await page.locator('svg').screenshot({ path: OUT + icon.file, omitBackground: Boolean(icon.transparent) });
    await page.close();
    console.log(`${icon.file} (${icon.size}×${icon.size})`);
  }
} finally {
  await browser.close();
}
