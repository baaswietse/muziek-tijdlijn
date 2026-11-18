#!/usr/bin/env python3
"""Zoekt Deezer-ID's voor de fragmentenlijsten van Muziek-tijdlijn.

Met fragmenten (30 seconden, zonder account) speelt het spel nummers van
Deezer. Dit script zoekt voor een lijst nummers (artiest en titel) het
Deezer-ID van de juiste opname: de studio-opname, geen live-versie, remix,
akoestische versie of heropname, tenzij de titel zelf daarom vraagt
("Pump It - Live 2022", "Roses - Imanbek Remix").

Gebruik (Python 3.9 of nieuwer, geen extra pakketten):

  python tools/deezer.py zoek nummers.json --uit gevonden.json
  python tools/deezer.py lijsten gevonden.json

`zoek` leest een JSON-lijst met per nummer minstens `artist` en `title` (de
andere velden blijven staan), of een tekstbestand met per regel
"Artiest - Titel". Het schrijft dezelfde lijst terug met `deezer` (het ID, of
null), `deezer_titel`, `deezer_artiest`, `rank` (hoe bekend het nummer is bij
Deezer), `album` en `album_genres` (de genres van het album bij Deezer). Wat niet
gevonden is, staat onderaan in de uitvoer van het script.

`lijsten` maakt daaruit het bronbestand web/public/fragmenten.json met de
lijsten die uit jaar en genre volgen (zie LIJSTEN hieronder). Als genre telt
`genres` uit de invoer, of anders `album_genres`. Lijsten die je
zelf vult (Nederlandstalig, Rustige pop en ballads) blijven daarbij staan,
per Deezer-ID. Daarna pas je fragmenten.json gewoon zelf aan.

De antwoorden van Deezer staan in tools/deezer-cache.json, dus een tweede keer
gaat snel; met --opnieuw vraagt het alles opnieuw. Het script doet hoogstens
drie verzoeken per seconde (Deezer laat er 50 per 5 seconden toe) en stuurt
een algemene User-Agent, zonder naam of adres.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tracks as T  # noqa: E402  (titels vergelijken: dezelfde regels als voor de jaartallen)

ROOT = Path(__file__).resolve().parent.parent
CACHE_JSON = ROOT / "tools" / "deezer-cache.json"
FRAGMENTEN_JSON = ROOT / "web" / "public" / "fragmenten.json"

API = "https://api.deezer.com"
USER_AGENT = "fragment-zoeker/1.0 (python-urllib)"
MIN_INTERVAL = 0.35  # seconden tussen twee verzoeken: hoogstens 3 per seconde
SEARCH_LIMIT = 50

# ---------------------------------------------------------------- de lijsten

# Volgorde = volgorde in het spel. `genres`/`vanaf` bepalen wie er bij
# `lijsten` in komt; een lijst zonder regel vul je zelf in fragmenten.json.
LIJSTEN = [
    {"id": "alles", "name": "Alle hits"},
    {"id": "2000", "name": "2000 tot nu"},
    {"id": "pop", "name": "Pop"},
    {"id": "rock", "name": "Rock"},
    {"id": "dance", "name": "Dance"},
    {"id": "nl", "name": "Nederlandstalig"},
    {"id": "rustig", "name": "Rustige pop en ballads"},
]
ROCK = {"Rock", "Alternative", "Indie Rock"}
HEAVY = {"Metal", "Hard Rock"}
DANCE = {"Dance", "Electro", "Techno/House", "Dancefloor", "Disco"}
HEAVY_SHARE = 0.2  # hoogstens zo'n deel van de lijst Rock is metal of hardrock

# ---------------------------------------------------------------- titels

# Woorden die in een versie-aanduiding mogen staan zonder dat het een andere
# opname is: "(2004 Remaster)", "- Radio Edit", "(Single Version)", "feat. X".
_ALLOWED = {
    "remaster", "remastered", "remasterd", "remasters", "digitally", "digital", "single", "album", "radio",
    "edit", "version", "versie", "mono", "stereo", "original", "explicit", "clean", "bonus", "track",
    "deluxe", "edition", "expanded", "anniversary", "from", "soundtrack", "motion", "picture", "film",
    "the", "a", "an", "of", "and", "feat", "featuring", "ft", "with", "x", "vs", "short", "uncensored",
}
# Een andere opname, tenzij de gevraagde titel het ook zegt.
_OTHER = {
    "live", "remix", "remixed", "rmx", "rework", "reworked", "bootleg", "mashup", "refix", "acoustic",
    "akoestisch", "unplugged", "instrumental", "karaoke", "demo", "sped", "slowed", "acapella",
    "capella", "cover", "tribute", "rerecorded", "recorded", "taylors", "orchestral", "symphonic",
    "reprise", "session", "sessions", "dub", "club", "extended", "megamix", "medley", "lofi", "piano",
    "nightcore", "reverb", "8d", "workout", "made", "famous",
}
# Klinkt (bijna) als het origineel, maar liever niet als er iets beters is.
_SOFT = {"mix"}


def words(text: str) -> list[str]:
    return [w for w in T.norm(text).split(" ") if w]


def base_title(title: str) -> str:
    """De titel zonder versie- en feat-aanduidingen: "Roses - Imanbek Remix" -> "Roses"."""
    parts = T.remix_parts(title)
    base = parts[0] if parts else T._strip_versions(title)
    base = T._FEAT_RE.sub("", base).strip()
    return base or str(title).strip()


def artists_of(artist: str) -> list[str]:
    """"Rudimental, John Newman" -> ["Rudimental", "John Newman"]."""
    return [a.strip() for a in re.split(r",\s*", str(artist)) if a.strip()]


# Dezelfde artiest onder een andere naam bij Deezer.
ALIASES = {"mgk": "machine gun kelly"}


def artist_ok(candidate: str, wanted: list[str]) -> bool:
    """De eerste gevraagde artiest moet in de artiest van Deezer zitten (of omgekeerd), als hele woorden."""
    c = T.norm(candidate)
    wanted = [ALIASES.get(T.norm(a), a) for a in wanted]
    if not c or not wanted:
        return False
    for i, a in enumerate(wanted):
        w = T.norm(a)
        if not w:
            continue
        if c == w or f" {w} " in f" {c} " or (i == 0 and f" {c} " in f" {w} "):
            return True
        # Leestekens in een naam ("P!nk", "*NSYNC", "Bomfunk MC's"): zonder spaties vergelijken.
        if c.replace(" ", "") == w.replace(" ", ""):
            return True
        if i == 0:
            break  # alleen de eerste artiest moet kloppen; de rest is een gast
    return False


def version_tier(candidate: str, wanted: str, wanted_artists: list[str]) -> int | None:
    """Hoe goed een titel van Deezer past bij de gevraagde titel.

    0: hetzelfde nummer (eventueel "Remaster", "Radio Edit", "feat. X");
    1: een "mix" die geen remix heet; None: een andere opname of een ander nummer.
    """
    if not T.title_matches(candidate, T.clean_title(wanted)):
        # Leestekens of haakjes in de titel zelf ("Chop Suey!", "Party In The U.S.A.").
        if T.norm(base_title(candidate)).replace(" ", "") != T.norm(base_title(wanted)).replace(" ", ""):
            return None
        if T.is_remix(candidate) != T.is_remix(wanted):
            return None
    # Gevraagd live: dan ook een live-opname (een studio-opname heeft een ander jaar).
    if T.is_live(wanted) and "live" not in words(candidate):
        return None
    ww = words(wanted)
    # Ook aaneengeschreven ("U.S.A." -> "u s a" -> "usa").
    allowed = {"".join(ww[i:j]) for i in range(len(ww)) for j in range(i + 1, min(i + 5, len(ww) + 1))}
    allowed |= {w for a in wanted_artists for w in words(a)}
    extra = [w for w in words(candidate) if w not in allowed]
    tier = 0
    for w in extra:
        if w in _ALLOWED or w.isdigit():
            continue
        if w in _SOFT:
            tier = 1
            continue
        return None  # "live", "acoustic", of een woord dat er niet hoort ("Jacques Lu Cont")
    # Een heropname heet vaak "(2025 Version)": een jaartal bij "version" zonder "remaster".
    cand = set(words(candidate))
    if "version" in cand and any(w.isdigit() and len(w) == 4 and w not in allowed for w in cand) and not cand & {"remaster", "remastered"}:
        return None
    return tier


def pick(results: list[dict], artist: str, title: str) -> dict | None:
    """Het beste resultaat: eerst de juiste versie, dan het bekendste (rank)."""
    wanted_artists = artists_of(artist)
    best = None
    for r in results:
        if not r.get("preview") or r.get("readable") is False:
            continue
        if not artist_ok(r.get("artist", ""), wanted_artists):
            continue
        tier = version_tier(r.get("title", ""), title, wanted_artists)
        if tier is None:
            continue
        key = (tier, -int(r.get("rank") or 0), int(r.get("id") or 0))
        if best is None or key < best[0]:
            best = (key, r)
    return best[1] if best else None


def queries(artist: str, title: str) -> list[str]:
    """Zoekopdrachten van gericht naar ruim; de eerste die iets oplevert, wint."""
    main = artists_of(artist)[0] if artists_of(artist) else artist
    base = base_title(title)
    plain = re.sub(r"[^\w\s']+", " ", base, flags=re.UNICODE)
    plain = re.sub(r"\s+", " ", plain).strip()
    # De geavanceerde zoekvorm (`artist:"..." track:"..."`) geeft bij de API van
    # Deezer (november 2026) niets terug; gewone woorden wel.
    out = [f"{main} {base}", base]
    if plain and plain != base:
        out += [f"{main} {plain}", plain]
    # Een remix of live-versie: ook met de volledige titel zoeken.
    if T.is_remix(title):
        out.insert(1, f"{main} {T.clean_title(title)}")
    elif T.is_live(title):
        out.insert(1, f"{main} {base} live")
    seen, uniq = set(), []
    for q in out:
        if q not in seen:
            seen.add(q)
            uniq.append(q)
    return uniq


# ---------------------------------------------------------------- Deezer


class Deezer:
    """Verzoeken naar api.deezer.com met cache en rustig tempo."""

    def __init__(self, cache_path: Path = CACHE_JSON, fresh: bool = False, fetch=None):
        self.cache_path = cache_path
        self.cache = {} if fresh else T.read_json(cache_path, {})
        self.fetch = fetch or self._fetch
        self.last = 0.0
        self.calls = 0
        self.dirty = 0

    def _fetch(self, url: str) -> dict:
        wait = 2.0
        for attempt in range(1, 9):
            pause = MIN_INTERVAL - (time.monotonic() - self.last)
            if pause > 0:
                time.sleep(pause)
            self.last = time.monotonic()
            self.calls += 1
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    data = json.loads(res.read().decode("utf-8"))
            except urllib.error.HTTPError as err:
                if err.code in (429, 500, 502, 503, 504) and attempt < 8:
                    time.sleep(wait)
                    wait = min(wait * 2, 30)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt < 8:
                    time.sleep(wait)
                    wait = min(wait * 2, 30)
                    continue
                raise
            err = data.get("error") if isinstance(data, dict) else None
            # Code 4: "Quota limit exceeded" (meer dan 50 verzoeken per 5 seconden).
            if err and err.get("code") == 4 and attempt < 8:
                time.sleep(max(wait, 5))
                wait = min(wait * 2, 30)
                continue
            return data
        return {}

    def _save_later(self):
        self.dirty += 1
        if self.dirty >= 25:
            self.save()

    def save(self):
        if self.dirty:
            T.write_json(self.cache_path, self.cache)
            self.dirty = 0

    def search(self, q: str, base: str) -> list[dict]:
        """Zoekresultaten, ingekort. In de cache alleen wat op de titel kan passen."""
        key = f"zoek:{q}"
        if key not in self.cache:
            url = f"{API}/search?" + urllib.parse.urlencode({"q": q, "limit": SEARCH_LIMIT})
            data = self.fetch(url)
            core = T.norm(base).replace(" ", "")
            keep = []
            for r in (data or {}).get("data") or []:
                t = str(r.get("title") or "")
                if core and core not in T.norm(t).replace(" ", ""):
                    continue
                keep.append(self._trim(r))
            self.cache[key] = keep
            self._save_later()
        return self.cache[key]

    @staticmethod
    def _trim(r: dict) -> dict:
        return {
            "id": r.get("id"),
            "title": str(r.get("title") or ""),
            "artist": (r.get("artist") or {}).get("name", ""),
            "album_id": (r.get("album") or {}).get("id"),
            "album": (r.get("album") or {}).get("title", ""),
            "rank": r.get("rank") or 0,
            "preview": bool(r.get("preview")),
            "readable": r.get("readable", True),
        }

    def artist_top(self, name: str) -> list[dict]:
        """De 100 bekendste nummers van de artiest met die naam (de meeste fans)."""
        key = f"top:{T.norm(name)}"
        if key not in self.cache:
            data = self.fetch(f"{API}/search/artist?" + urllib.parse.urlencode({"q": name, "limit": 10})) or {}
            found = [a for a in data.get("data") or [] if artist_ok(a.get("name", ""), [name])]
            found.sort(key=lambda a: -(a.get("nb_fan") or 0))
            top = []
            if found:
                res = self.fetch(f"{API}/artist/{found[0]['id']}/top?limit=100") or {}
                top = [self._trim(r) for r in res.get("data") or []]
            self.cache[key] = top
            self._save_later()
        return self.cache[key]

    def album(self, album_id) -> dict:
        key = f"album:{album_id}"
        if key not in self.cache:
            data = self.fetch(f"{API}/album/{album_id}") or {}
            genres = [g.get("name") for g in ((data.get("genres") or {}).get("data") or []) if g.get("name")]
            self.cache[key] = {"genres": genres, "release_date": data.get("release_date")}
            self._save_later()
        return self.cache[key]


def find(dz: Deezer, artist: str, title: str) -> dict | None:
    """Het beste Deezer-nummer voor artiest en titel, of None."""
    base = base_title(title)
    best = None
    for q in queries(artist, title):
        hit = pick(dz.search(q, base), artist, title)
        if hit and (best is None or (version_tier(hit["title"], title, artists_of(artist)), -hit["rank"]) < (version_tier(best["title"], title, artists_of(artist)), -best["rank"])):
            best = hit
        # Ruimer zoeken alleen als nog niets paste.
        if best:
            break
    if best is None:
        # Laatste kans: de bekendste nummers van de artiest zelf. Sommige
        # artiesten ("*NSYNC") vindt de gewone zoekfunctie niet terug.
        best = pick(dz.artist_top(artists_of(artist)[0] if artists_of(artist) else artist), artist, title)
    return best


# ---------------------------------------------------------------- lijsten


def display_title(title: str) -> str:
    """Wat de spelers bij de onthulling zien: zonder "- Remastered 2011", maar een remix of live-opname blijft herkenbaar."""
    if T.is_remix(title):
        return T.clean_title(title)
    clean = T._strip_versions(title)
    return f"{clean} (live)" if T.is_live(title) else clean


def build_lists(rows: list[dict], previous: dict | None = None) -> dict:
    """Het bronbestand voor de site: de lijsten en per nummer in welke het zit.

    `previous`: het huidige fragmenten.json; wat daarin met de hand in een
    lijst zonder regel staat (Nederlandstalig, Rustige pop en ballads), blijft.
    """
    manual_ids = {"nl", "rustig"}
    kept = {}
    for t in (previous or {}).get("tracks") or []:
        tags = [x for x in t.get("lists") or [] if x in manual_ids]
        if tags:
            kept[int(t["deezer"])] = tags
    seen_ids, seen_songs, tracks = set(), set(), []
    for r in rows:
        dz_id = r.get("deezer")
        if not dz_id or dz_id in seen_ids:
            continue
        song = T.norm(base_title(r["title"])) + "|" + T.norm(artists_of(r["artist"])[0])
        if song in seen_songs:
            continue
        seen_ids.add(dz_id)
        seen_songs.add(song)
        tracks.append({
            "deezer": int(dz_id),
            "artist": r["artist"],
            "title": display_title(r["title"]),
            "year": int(r["year"]),
            "lists": [],
            # Genres die al in de invoer staan, gaan voor op die van het album bij Deezer.
            "_genres": set(r.get("genres") or r.get("album_genres") or []),
            "_rank": int(r.get("rank") or 0),
        })
    for t in tracks:
        g = t["_genres"]
        t["lists"].append("alles")
        if t["year"] >= 2000:
            t["lists"].append("2000")
        if "Pop" in g:
            t["lists"].append("pop")
        if g & DANCE:
            t["lists"].append("dance")
    # Rock: rock en alternative, aangevuld met de bekendste metal- en
    # hardrocknummers tot hoogstens een vijfde van de lijst. Een nummer met
    # zowel Rock als Metal telt als metal. Vaste volgorde: rank, dan ID.
    rock = [t for t in tracks if t["_genres"] & ROCK and not t["_genres"] & HEAVY]
    heavy = sorted((t for t in tracks if t["_genres"] & HEAVY), key=lambda t: (-t["_rank"], t["deezer"]))
    room = int(len(rock) * HEAVY_SHARE / (1 - HEAVY_SHARE))
    for t in rock + heavy[:room]:
        t["lists"].append("rock")
    for t in tracks:
        t["lists"] += kept.get(t["deezer"], [])
        t["lists"] = [x["id"] for x in LIJSTEN if x["id"] in t["lists"]]
        del t["_genres"], t["_rank"]
    tracks.sort(key=lambda t: (t["year"], T.norm(t["artist"]), T.norm(t["title"])))
    return {"lists": [{"id": x["id"], "name": x["name"]} for x in LIJSTEN], "tracks": tracks}


def write_fragments(path: Path, data: dict) -> None:
    """Eén nummer per regel: makkelijk met de hand aan te passen en te vergelijken."""
    lines = ["{", '  "lists": [']
    lines.append(",\n".join("    " + json.dumps(x, ensure_ascii=False) for x in data["lists"]))
    lines += ["  ],", '  "tracks": [']
    lines.append(",\n".join("    " + json.dumps(t, ensure_ascii=False) for t in data["tracks"]))
    lines += ["  ]", "}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- main


def read_input(path: Path) -> list[dict]:
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        return data["tracks"] if isinstance(data, dict) else data
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if " - " in line.strip():
            artist, title = line.strip().split(" - ", 1)
            rows.append({"artist": artist.strip(), "title": title.strip()})
    return rows


def cmd_zoek(args) -> int:
    rows = read_input(Path(args.invoer))
    dz = Deezer(fresh=args.opnieuw)
    missing = []
    try:
        for i, r in enumerate(rows, 1):
            hit = find(dz, r["artist"], r["title"])
            if hit:
                info = dz.album(hit["album_id"]) if hit.get("album_id") else {"genres": []}
                r.update({
                    "deezer": int(hit["id"]),
                    "deezer_titel": hit["title"],
                    "deezer_artiest": hit["artist"],
                    "rank": hit["rank"],
                    "album": hit["album"],
                    "album_genres": info.get("genres") or [],
                })
            else:
                r.update({"deezer": None, "deezer_titel": None, "deezer_artiest": None, "rank": 0, "album": None})
                missing.append(r)
            if i % 25 == 0:
                T.say(f"  {i}/{len(rows)} ({dz.calls} verzoeken)")
    finally:
        dz.save()
    Path(args.uit).write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    found = len(rows) - len(missing)
    T.say(f"Gevonden: {found} van {len(rows)} ({dz.calls} verzoeken naar Deezer).")
    if missing:
        T.say("Niet gevonden:")
        for r in missing:
            T.say(f"  - {r['artist']} – {r['title']}")
    return 0


def cmd_lijsten(args) -> int:
    rows = read_input(Path(args.invoer))
    out = Path(args.uit) if args.uit else FRAGMENTEN_JSON
    previous = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    data = build_lists(rows, previous)
    write_fragments(out, data)
    for x in data["lists"]:
        n = sum(1 for t in data["tracks"] if x["id"] in t["lists"])
        T.say(f"  {x['name']}: {n}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Deezer-ID's zoeken en de fragmentenlijsten maken.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    z = sub.add_parser("zoek", help="zoek per nummer het Deezer-ID")
    z.add_argument("invoer")
    z.add_argument("--uit", required=True)
    z.add_argument("--opnieuw", action="store_true", help="de cache negeren")
    z.set_defaults(func=cmd_zoek)
    l = sub.add_parser("lijsten", help="maak web/public/fragmenten.json")
    l.add_argument("invoer")
    l.add_argument("--uit", help="ander doelbestand (standaard web/public/fragmenten.json)")
    l.set_defaults(func=cmd_lijsten)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
