// Nagebootste Deezer op netwerkniveau, voor de tests met fragmenten: de API
// (JSONP, zoals de site die gebruikt) en de mp3's op cdnt-preview.dzcdn.net.
// Het echte Deezer wordt nooit aangesproken, ook niet tegen de echte site
// (MT_LIVE=1): openPhone (helpers.js) blokkeert alles van deezer.com en
// dzcdn.net, en fakeDeezer antwoordt in de plaats.
//
// De lijsten van de site (fragmenten.json) worden vervangen door de vaste
// testlijst tests/fixtures/fragmenten.json, met verzonnen titels.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const FRAGMENTS = JSON.parse(readFileSync(new URL('../fixtures/fragmenten.json', import.meta.url), 'utf8'));
const MP3 = readFileSync(new URL('../fixtures/fragment.mp3', import.meta.url));
export const FRAGMENT_SECONDS = 1.5; // zo lang duurt het testfragment

// Zoals bij het echte Deezer staat het ID van het nummer niet in het adres van
// de mp3: alleen een hash. Hier onthouden we welk nummer erbij hoort (voor
// alle nagebootste Deezers samen, zodat ook de browser van een gast die het
// adres via de server kreeg, het juiste fragment krijgt).
const MEDIA = new Map(); // hash -> { id, version }

/** Het adres van versie `n` van het fragment van Deezer-ID `id`. */
function mediaUrl(id, n) {
  const hash = createHash('md5').update(`nep-${id}-${n}`).digest('hex');
  MEDIA.set(hash, { id: String(id), version: n });
  return `https://cdnt-preview.dzcdn.net/api/1/1/${hash[0]}/${hash[1]}/${hash[2]}/0/${hash}.mp3?hdnea=exp=9999999999~hmac=nep`;
}

/** Welk fragment (ID `dz-…`) en welke versie een adres is, of null. */
export function mediaOf(url) {
  const m = /\/([0-9a-f]{32})\.mp3/.exec(String(url || ''));
  const found = m && MEDIA.get(m[1]);
  return found ? { id: `dz-${found.id}`, version: found.version } : null;
}

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
        preview: deezer.noPreview.has(m[1]) ? '' : mediaUrl(m[1], n),
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
    const media = mediaOf(route.request().url());
    const id = media ? media.id.slice(3) : null;
    const version = media ? media.version : 0;
    const status = !media ? 404 : deezer.expired.has(id) && version === 1 ? 403 : 200;
    deezer.media.push({ id, version, status });
    if (status !== 200) return route.fulfill({ status, body: '' });
    // Zoals het echte CDN: met bereiken (Range). Zonder kan de browser niet in
    // het fragment springen (`seekable` blijft leeg en elke sprong landt op 0),
    // en loopt een gast die midden in een fragment inhaakt nooit gelijk.
    const range = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range || (!range[1] && !range[2])) {
      return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3, headers: { 'accept-ranges': 'bytes' } });
    }
    const size = MP3.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return route.fulfill({ status: 416, body: '', headers: { 'content-range': `bytes */${size}` } });
    }
    return route.fulfill({
      status: 206,
      contentType: 'audio/mpeg',
      body: MP3.subarray(start, end + 1),
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}` },
    });
  });

  return deezer;
}

/** Wat het <audio>-element van een gsm (de host, of een gast die meeluistert) nu doet. */
export async function audioState(page) {
  const s = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="fragment-audio"]');
    if (!a) return null;
    return { src: a.currentSrc || a.src || '', paused: a.paused, loop: a.loop, time: a.currentTime, duration: a.duration, seeks: a.__seeks || 0, seekable: a.seekable.length ? a.seekable.end(a.seekable.length - 1) : 0 };
  });
  if (!s) return null;
  const media = mediaOf(s.src);
  return { ...s, id: media?.id ?? null, version: media?.version ?? null };
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
