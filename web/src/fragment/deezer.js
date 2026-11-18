// Het adres van een fragment (30 seconden) bij Deezer, zonder account of
// sleutel. De API van Deezer stuurt geen CORS-kop, dus fetch() kan het
// antwoord niet lezen; JSONP (een <script> met `output=jsonp&callback=...`)
// wel. Het adres van de mp3 draagt een handtekening die na enkele uren
// verloopt: vraag het daarom op vlak voor het afspelen, niet vooraf.
//
// Los van "ik ben de host": dit kan elke browser die een fragment wil spelen.

export const DEEZER_API = 'https://api.deezer.com';
const TIMEOUT = 10_000;

/** Fout bij het ophalen of afspelen van een fragment. `kind`: missing | network | blocked. */
export class FragmentError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

export const MISSING = 'Dit fragment bestaat niet (meer) bij Deezer. Tik op «Ander nummer».';
export const OFFLINE = 'Deezer antwoordt niet. Controleer de verbinding en tik op «Opnieuw afspelen», of kies «Ander nummer».';

/** `dz-3135556` -> `3135556`; null als het geen fragment-ID is. */
export function deezerId(trackId) {
  const m = /^dz-([0-9]{1,20})$/.exec(String(trackId ?? ''));
  return m ? m[1] : null;
}

/** De pagina van het nummer bij Deezer (voor na de onthulling), of null. */
export function deezerLink(trackId) {
  const id = deezerId(trackId);
  return id ? `https://www.deezer.com/track/${id}` : null;
}

let counter = 0;

/** Eén JSONP-verzoek. Geeft het antwoord (een object) of faalt met een FragmentError('network'). */
export function jsonp(url, { timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    counter += 1;
    const name = `__mtDeezer${Date.now().toString(36)}${counter}`;
    const script = document.createElement('script');
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.remove();
      // Een te laat antwoord mag niets meer doen, maar ook geen fout geven.
      window[name] = () => {};
      setTimeout(() => {
        delete window[name];
      }, 60_000);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new FragmentError(OFFLINE, 'network')), timeout);
    window[name] = (data) => finish(resolve, data);
    script.onerror = () => finish(reject, new FragmentError(OFFLINE, 'network'));
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}output=jsonp&callback=${name}`;
    document.head.append(script);
  });
}

/**
 * Vraagt het adres van het fragment op. Geeft alleen dat adres terug: titel,
 * artiest en album uit het antwoord worden meteen weggegooid, zodat niets
 * ze per ongeluk kan tonen.
 */
export async function fetchPreview(trackId, { request = jsonp } = {}) {
  const id = deezerId(trackId);
  if (!id) throw new FragmentError(MISSING, 'missing');
  for (let attempt = 0; ; attempt++) {
    const data = await request(`${DEEZER_API}/track/${id}`);
    const err = data && data.error;
    // Code 4: te veel verzoeken (Deezer laat er 50 per 5 seconden toe). Even wachten.
    if (err && Number(err.code) === 4 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (err) throw new FragmentError(Number(err.code) === 4 ? OFFLINE : MISSING, Number(err.code) === 4 ? 'network' : 'missing');
    const preview = typeof data?.preview === 'string' ? data.preview : '';
    if (!/^https:\/\//.test(preview)) throw new FragmentError(MISSING, 'missing');
    return preview;
  }
}
