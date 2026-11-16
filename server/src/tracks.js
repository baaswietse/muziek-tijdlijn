// Controle van tracks.json zoals de server die inleest.

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Houdt alleen geldige, unieke nummers over. */
export function normaliseTracks(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tracks) ? raw.tracks : [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const id = String(t.id ?? '');
    const year = Number(t.year);
    const artist = String(t.artist ?? '').trim();
    const title = String(t.title ?? '').trim();
    if (!ID.test(id) || seen.has(id)) continue;
    if (!Number.isInteger(year) || year < 1000 || year > 2200) continue;
    if (!artist || !title) continue;
    seen.add(id);
    out.push({ id, artist, title, year });
  }
  return out;
}
