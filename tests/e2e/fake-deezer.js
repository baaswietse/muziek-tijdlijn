// Nagebootste Deezer op netwerkniveau, voor de tests met fragmenten: de API
// (JSONP, zoals de site die gebruikt) en de mp3's op cdnt-preview.dzcdn.net.
// Het echte Deezer wordt nooit aangesproken, ook niet tegen de echte site
// (MT_LIVE=1): openPhone (helpers.js) blokkeert alles van deezer.com en
// dzcdn.net, en fakeDeezer antwoordt in de plaats.
//
// De lijsten van de site (fragmenten.json) worden vervangen door de vaste
// testlijst tests/fixtures/fragmenten.json, met verzonnen titels.

import { readFileSync } from 'node:fs';

export const FRAGMENTS = JSON.parse(readFileSync(new URL('../fixtures/fragmenten.json', import.meta.url), 'utf8'));
const MP3 = readFileSync(new URL('../fixtures/fragment.mp3', import.meta.url));
export const FRAGMENT_SECONDS = 1.5; // zo lang duurt het testfragment

/** Het nummer uit de testlijst bij een ID `dz-…` of een Deezer-ID. */
export const fragmentOf = (id) => FRAGMENTS.tracks.find((t) => `dz-${t.deezer}` === String(id) || String(t.deezer) === String(id));

/**
 * `missing`: Deezer-ID's die niet (meer) bestaan (de API geeft fout 800).
 * `noPreview`: ID's zonder fragment (preview leeg).
 * `expired`: ID's waarvan het eerste adres niet meer speelt (403), zoals
 * een verlopen handtekening; een tweede opvraging geeft een geldig adres.
 */
export async function fakeDeezer(context, { missing = [], noPreview = [], expired = [] } = {}) {
  const deezer = {
    api: [], // { id, callback }
    media: [], // { id, version, status }
    missing: new Set(missing.map(String)),
    noPreview: new Set(noPreview.map(String)),
    expired: new Set(expired.map(String)),
    served: new Map(), // id -> aantal opgevraagde adressen
  };

  await context.route('**/fragmenten.json', (route) => route.fulfill({ json: FRAGMENTS, headers: { 'cache-control': 'no-store' } }));

  await context.route('https://api.deezer.com/**', async (route) => {
    const url = new URL(route.request().url());
    const m = /^\/track\/(\d+)$/.exec(url.pathname);
    const callback = url.searchParams.get('callback') || '';
    deezer.api.push({ id: m ? m[1] : null, callback, output: url.searchParams.get('output') });
    let body;
    const t = m && fragmentOf(m[1]);
    if (!m || !t || deezer.missing.has(m[1])) {
      body = { error: { type: 'DataException', message: 'no data', code: 800 } };
    } else {
      const n = (deezer.served.get(m[1]) || 0) + 1;
      deezer.served.set(m[1], n);
      body = {
        id: t.deezer,
        readable: true,
        title: t.title,
        artist: { id: 1, name: t.artist },
        album: { id: 2, title: `Album van ${t.title}` },
        release_date: `${t.year}-01-01`,
        duration: 200,
        preview: deezer.noPreview.has(m[1]) ? '' : `https://cdnt-preview.dzcdn.net/api/1/1/f/a/k/e/${m[1]}-${n}.mp3?hdnea=exp=9999999999~hmac=nep`,
      };
    }
    // Zoals de echte API: JSONP als erom gevraagd wordt, anders JSON zonder CORS-kop.
    if (/^[A-Za-z_$][\w$]*$/.test(callback)) {
      await route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: `${callback}(${JSON.stringify(body)})` });
    } else {
      await route.fulfill({ json: body });
    }
  });

  await context.route('https://cdnt-preview.dzcdn.net/**', async (route) => {
    const m = /\/(\d+)-(\d+)\.mp3$/.exec(new URL(route.request().url()).pathname);
    const id = m ? m[1] : null;
    const version = m ? Number(m[2]) : 0;
    const status = !m ? 404 : deezer.expired.has(id) && version === 1 ? 403 : 200;
    deezer.media.push({ id, version, status });
    if (status !== 200) return route.fulfill({ status, body: '' });
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3, headers: { 'accept-ranges': 'none' } });
  });

  return deezer;
}

/** Wat het <audio>-element van de host nu doet. */
export async function audioState(page) {
  return page.evaluate(() => {
    const a = document.querySelector('[data-testid="fragment-audio"]');
    if (!a) return null;
    const m = /\/(\d+)-\d+\.mp3/.exec(a.currentSrc || a.src || '');
    return { id: m ? `dz-${m[1]}` : null, paused: a.paused, loop: a.loop, time: a.currentTime, seeks: a.__seeks || 0 };
  });
}

/** Telt hoe vaak het fragment opnieuw van voren begon (herhalen). */
export async function countLoops(page) {
  await page.evaluate(() => {
    const a = document.querySelector('[data-testid="fragment-audio"]');
    if (a && !a.__seekWatch) {
      a.__seekWatch = true;
      a.__seeks = 0;
      a.addEventListener('seeked', () => {
        a.__seeks += 1;
      });
    }
  });
}
