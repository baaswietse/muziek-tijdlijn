// Controle van tracks.json zoals de server die inleest.

/** Vorm van een track-ID (ook gebruikt voor de gedeelde lijst met jaartallen). */
export const TRACK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 120;

/** Houdt alleen geldige, unieke nummers over. */
export function normaliseTracks(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tracks) ? raw.tracks : [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const id = String(t.id ?? '');
    const year = Number(t.year);
    const artist = String(t.artist ?? '').trim().slice(0, MAX_TEXT);
    const title = String(t.title ?? '').trim().slice(0, MAX_TEXT);
    if (!TRACK_ID.test(id) || seen.has(id)) continue;
    if (!Number.isInteger(year) || year < 1000 || year > 2200) continue;
    if (!artist || !title) continue;
    seen.add(id);
    out.push({ id, artist, title, year });
  }
  return out;
}
