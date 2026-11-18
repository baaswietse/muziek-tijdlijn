#!/usr/bin/env python3
"""Maakt tracks.json voor Muziek-tijdlijn.

Wat het doet:
  1. Haalt de nummers van je Spotify-playlist op (je logt één keer in via de
     browser; er is geen Client Secret nodig).
  2. Zoekt per nummer het jaar van de EERSTE release op bij MusicBrainz.
     Spotify geeft alleen de datum van het album, en dat is vaak een remaster
     of een compilatie.
  3. Vraagt Wikidata als derde bron (in blokken van 25 titels). Twee bronnen
     die het eens zijn, winnen van de derde; dezelfde regels als de site
     (web/src/lib/years.js en wikidata.js).
  4. Schrijft web/public/tracks.json (track-ID, artiest, titel, jaar, bron) en
     tools/tracks-nakijken.md met de twijfelgevallen.

Gebruik (Windows, Python 3.9 of nieuwer, geen extra pakketten nodig):
  python tools/tracks.py
  python tools/tracks.py --playlist https://open.spotify.com/playlist/....
  python tools/tracks.py --invoer tools/playlist.json     (zonder Spotify-login)

Een jaartal verbeteren: zet het in tools/correcties.json en draai het script
opnieuw. Dankzij de cache gaat dat snel.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import http.server
import json
import re
import secrets
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
TRACKS_JSON = ROOT / "web" / "public" / "tracks.json"
PLAYLIST_JSON = TOOLS / "playlist.json"
CACHE_JSON = TOOLS / "musicbrainz-cache.json"
WD_CACHE_JSON = TOOLS / "wikidata-cache.json"
CORRECTIONS_JSON = TOOLS / "correcties.json"
REVIEW_MD = TOOLS / "tracks-nakijken.md"
CONFIG_JS = ROOT / "web" / "src" / "config.js"

DEFAULT_PLAYLIST = "0j9u5m5cCoc3Wnx8XsbjFa"
DEFAULT_PORT = 8765

# Bewust algemeen: geen naam, e-mail of projectadres in verzoeken naar buiten.
USER_AGENT = "jaartal-opzoeker/1.0 (python-urllib)"
MB_URL = "https://musicbrainz.org/ws/2/recording"
MB_MIN_INTERVAL = 1.1  # MusicBrainz vraagt maximaal 1 verzoek per seconde
SPOTIFY_SCOPES = "playlist-read-private playlist-read-collaborative"


# ---------------------------------------------------------------- hulpjes


def say(text: str = "") -> None:
    print(text, flush=True)


def read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def year_of(datestr) -> int | None:
    m = re.match(r"^(\d{4})", str(datestr or ""))
    if not m:
        return None
    y = int(m.group(1))
    return y if 1900 <= y <= date.today().year + 1 else None


# ---------------------------------------------------------------- titels vergelijken

# Toevoegingen die niets over het nummer zelf zeggen, zoals "- Remastered 2011".
_VERSION = (
    r"remaster(?:ed)?|re-?master(?:ed)?|mono|stereo|single|radio|album|edit|version|versie|mix|"
    r"bonus|deluxe|anniversary|live|soundtrack|motion picture|re-?record(?:ed|ing)?|acoustic|"
    r"demo|explicit|clean|feat\.?|featuring|ft\.?|original"
)
_VERSION_RE = re.compile(rf"\b(?:{_VERSION})\b", re.IGNORECASE)
_PAREN_TAIL_RE = re.compile(r"\s*[\(\[]([^\)\]]*)[\)\]]\s*$")
_LIVE_RE = re.compile(r"\blive\b", re.IGNORECASE)


# Een remix is een andere opname met een eigen releasedatum: de spelers horen
# de remix, dus telt het jaar van de remix. Alleen uitdrukkelijke remix-woorden
# tellen; "Extended Mix", "Club Mix" of "Radio Edit" zijn gewoon het origineel.
_REMIX_RE = re.compile(r"\b(?:remix(?:ed)?|rmx|re-?work(?:ed)?|bootleg|mash-?up|refix)\b", re.IGNORECASE)
# Woorden in een remix-aanduiding die niets over de remix zelf zeggen:
# "JXL Radio Edit Remix" en "JXL remix" zijn dezelfde remix.
_REMIX_NOISE = {
    "radio", "edit", "single", "version", "versie", "album", "explicit", "clean",
    "mono", "stereo", "remaster", "remastered", "by", "the",
}
_REMIX_SYNONYMS = {"remixed": "remix", "rmx": "remix", "reworked": "rework"}
_FEAT_RE = re.compile(r"\s*[\(\[]?\s*\b(?:feat\.?|featuring|ft\.)(?:\s.*)?$", re.IGNORECASE)

# Versie van de regels voor remixes; zit in de cachesleutel van remixes, zodat
# een oud remix-resultaat niet hergebruikt wordt. Verhoog dit als de regels
# voor remixes veranderen (dezelfde waarde als REMIX_RULES in years.js).
REMIX_RULES = 2


def clean_title(title: str) -> str:
    """Haalt versie-aanduidingen van een Spotify-titel af; een remix-aanduiding blijft staan."""
    parts = remix_parts(title)
    if parts:
        return f"{parts[0]} ({parts[1]})"
    return _strip_versions(title)


def remix_parts(title: str) -> tuple[str, str] | None:
    """Splitst een remix-titel in het nummer en de remix-aanduiding.

    "Roses - Imanbek Remix" en "Roses (feat. X) [Imanbek Remix]" geven allebei
    ("Roses", "Imanbek Remix"). Geen remix: None. Versie-aanduidingen achter
    de remix ("- Radio Edit") vallen eerst weg.
    """
    t = str(title).strip()
    for _ in range(6):
        before = t
        if " - " in t:
            head, tail = t.rsplit(" - ", 1)
            if head.strip() and _REMIX_RE.search(tail):
                return _strip_versions(head), _tidy_remix(tail)
            if head.strip() and (_VERSION_RE.search(tail) or re.fullmatch(r"\d{4}", tail.strip())):
                t = head.strip()
        m = _PAREN_TAIL_RE.search(t)
        head = t[: m.start()].strip() if m else ""
        if m and head and _REMIX_RE.search(m.group(1)):
            return _strip_versions(head), _tidy_remix(m.group(1))
        if m and head and _VERSION_RE.search(m.group(1)):
            t = head
        if t == before:
            break
    return None


def _tidy_remix(text: str) -> str:
    """"X Remix (feat. Y)" -> "X Remix": gastartiesten horen niet bij de naam van de remix."""
    t = _FEAT_RE.sub("", str(text))
    return re.sub(r"\s+", " ", re.sub(r"[\(\)\[\]]", " ", t)).strip()


def is_remix(title: str) -> bool:
    return remix_parts(title) is not None


def remix_key(title: str) -> str | None:
    """Vergelijkbare vorm van een remix: het nummer en de woorden van de remix,
    zonder "radio edit" en dergelijke en los van de volgorde ("Remix by X" = "X Remix")."""
    parts = remix_parts(title)
    if not parts:
        return None
    return norm(parts[0]) + "|" + " ".join(sorted(_remix_words(parts[1])))


def _remix_words(remix: str) -> list[str]:
    text = re.sub(r"\bre-(work|mix)", r"re\1", str(remix), flags=re.IGNORECASE)
    text = re.sub(r"\bmash-up\b", "mashup", text, flags=re.IGNORECASE)
    words = (_REMIX_SYNONYMS.get(w, w) for w in norm(text).split(" "))
    return [w for w in words if w and w not in _REMIX_NOISE]


def _strip_versions(title: str) -> str:
    """Haalt versie-aanduidingen weg, ook een remix-aanduiding die "edit" of "mix" bevat."""
    t = str(title).strip()
    for _ in range(4):
        before = t
        # "Titel - Remastered 2011" / "Titel - Live at ..."
        if " - " in t:
            head, tail = t.rsplit(" - ", 1)
            if head.strip() and (_VERSION_RE.search(tail) or re.fullmatch(r"\d{4}", tail.strip())):
                t = head.strip()
        # "Titel (2011 Remaster)" / "Titel [feat. X]"
        m = _PAREN_TAIL_RE.search(t)
        if m and _VERSION_RE.search(m.group(1)) and t[: m.start()].strip():
            t = t[: m.start()].strip()
        if t == before:
            break
    return t


def is_live(title: str) -> bool:
    raw = str(title).strip()
    clean = _strip_versions(raw)
    return clean != raw and bool(_LIVE_RE.search(raw[len(clean) :]))


def norm(text: str) -> str:
    """Vergelijkbare vorm: zonder accenten, hoofdletters en leestekens."""
    t = unicodedata.normalize("NFKD", str(text))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.casefold().replace("&", " and ")
    t = re.sub(r"[^a-z0-9 ]+", " ", t.replace("'", "").replace("\u2019", ""))
    t = re.sub(r"\s+", " ", t).strip()
    return re.sub(r"^the ", "", t)


def norm_loose(text: str) -> str:
    """Zoals norm(), maar ook zonder alles tussen haakjes."""
    return norm(re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", str(text)))


def title_matches(candidate: str, wanted: str) -> bool:
    # Een remix past alleen bij dezelfde remix: nooit bij het origineel of bij
    # een andere remix van hetzelfde nummer. De losse terugval hieronder (alles
    # tussen haakjes weg) zou ze net allemaal gelijk maken.
    remix = remix_key(wanted)
    if remix:
        return remix_key(candidate) == remix
    # Gewone nummers: zoals altijd (_strip_versions is de vroegere clean_title).
    a, b = norm(_strip_versions(candidate)), norm(wanted)
    if a and a == b:
        return True
    a, b = norm_loose(_strip_versions(candidate)), norm_loose(wanted)
    return bool(a) and a == b


def artist_matches(recording: dict, artists: list[str]) -> bool:
    wanted = {norm(a) for a in artists if a}
    names = set()
    joined = ""
    for credit in recording.get("artist-credit") or []:
        names.add(norm(credit.get("name", "")))
        artist = credit.get("artist") or {}
        names.add(norm(artist.get("name", "")))
        for alias in artist.get("aliases") or []:
            names.add(norm(alias.get("name", "")))
        joined += credit.get("name", "") + (credit.get("joinphrase") or "")
    names.add(norm(joined))
    names.discard("")
    # De eerste artiest van Spotify moet in de credits zitten.
    return bool(wanted) and (norm(artists[0]) in names or wanted <= names)


# ---------------------------------------------------------------- MusicBrainz

_last_mb_call = 0.0


def http_json(url: str, headers: dict | None = None, data: bytes | None = None, tries: int = 8):
    """GET of POST met wachten en opnieuw proberen bij 429/503 en netwerkfouten.

    MusicBrainz antwoordt geregeld met "server busy" of verbreekt de verbinding;
    met steeds langere pauzes (tot een halve minuut) lukt het daarna meestal wel.
    """
    wait = 2.0
    for attempt in range(1, tries + 1):
        # Gecomprimeerd vragen, zoals Wikimedia vraagt van scripts.
        req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read()
                if (res.headers.get("Content-Encoding") or "").lower() == "gzip":
                    body = gzip.decompress(body)
                return json.loads(body.decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < tries:
                retry_after = err.headers.get("Retry-After")
                pause = float(retry_after) if retry_after and retry_after.isdigit() else wait
                time.sleep(min(pause, 60))
                wait = min(wait * 2, 30)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < tries:
                time.sleep(wait)
                wait = min(wait * 2, 30)
                continue
            raise
    return None


def mb_search(query: str, limit: int = 100) -> tuple[list[dict], int]:
    """Zoekt opnames; geeft de eerste pagina en het totale aantal treffers."""
    global _last_mb_call
    pause = MB_MIN_INTERVAL - (time.monotonic() - _last_mb_call)
    if pause > 0:
        time.sleep(pause)
    url = MB_URL + "?" + urllib.parse.urlencode({"query": query, "fmt": "json", "limit": str(limit)})
    try:
        data = http_json(url, {"Accept": "application/json"}) or {}
    finally:
        _last_mb_call = time.monotonic()
    recordings = data.get("recordings") or []
    return recordings, int(data.get("count") or len(recordings))


def lucene_phrase(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


# Uitgaven die niets zeggen over wanneer een nummer uitkwam.
_SKIP_TYPES = {"live", "demo", "interview", "audiobook", "audio drama", "dj-mix", "mixtape/street", "spokenword"}
# Een opname met een van deze woorden in de titel of de toelichting is een
# andere versie dan het gewone nummer (tenzij de titel van Spotify ze ook heeft).
_OTHER_VERSION_RE = re.compile(r"\b(?:instrumental|karaoke|a ?cappella|acapella|demo)\b", re.IGNORECASE)
# In de toelichting niet "demo": die staat er soms ook bij de echte single (Enter Sandman).
_NOTE_VERSION_RE = re.compile(r"\b(?:instrumental|karaoke|a ?cappella|acapella)\b", re.IGNORECASE)
_PARENS_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")
# Een losse vroegste uitgave mag hoogstens zoveel jaar vóór een jaar met meer uitgaven liggen (zie pick_year).
LONE_WINDOW = 3


def _studio_releases(recording: dict) -> list[dict]:
    """Officiële studio-uitgaven met een datum van deze opname.

    Bootlegs, promo's, live-albums en demo's tellen niet mee: die zijn in
    MusicBrainz vaak fout of veel te vroeg gedateerd.
    """
    out = []
    for release in recording.get("releases") or []:
        if str(release.get("status") or "").casefold() != "official":
            continue
        group = release.get("release-group") or {}
        types = {str(t).casefold() for t in group.get("secondary-types") or []}
        if types & _SKIP_TYPES:
            continue
        d = release.get("date")
        y = year_of(d)
        if y is None:
            continue
        rid = release.get("id") or f"{recording.get('id')}|{d}|{release.get('title') or ''}"
        out.append({"date": str(d), "year": y, "id": rid, "group": group.get("id") or release.get("title") or rid,
                    "compilation": "compilation" in types})
    return out


def official_date(recording: dict) -> str | None:
    """Vroegste datum van een officiële studio-uitgave met deze opname."""
    dates = [r["date"] for r in _studio_releases(recording)]
    return min(dates) if dates else None


def other_version(recording: dict, wanted: str, live: bool = False) -> bool:
    """Is deze opname een andere versie dan wat gezocht wordt? Een remix, live-
    opname, instrumentale versie, karaoke of demo telt niet voor het gewone
    nummer (zie otherVersion in years.js)."""
    title = str(recording.get("title") or "")
    note = str(recording.get("disambiguation") or "")
    if not remix_key(wanted) and remix_key(title):
        return True
    if not live and (is_live(title) or re.search(r"\blive\b", note, re.IGNORECASE)):
        return True
    extra = title[len(_strip_versions(title)):] + " " + " ".join(_PARENS_RE.findall(title))
    return bool(_OTHER_VERSION_RE.search(extra) or _NOTE_VERSION_RE.search(note)) and not _OTHER_VERSION_RE.search(wanted)


def pick_year(recordings: list[dict], title: str, artists: list[str], live: bool = False) -> dict | None:
    """Kiest uit zoekresultaten het jaar van de eerste release (zie pickYear in years.js).

    Alle passende opnames samen. Alleen officiële studio-uitgaven tellen; zijn
    er geen, dan de vroegste datum van eender welke uitgave ('official': False).
    Een jaar met alleen verzamelaars telt pas vanaf twee verschillende
    verzamelaars (een enkele verzamelaar is vaak fout gedateerd). 'raw': het
    vroegste jaar zonder die regel; 'next': een later jaar met meer uitgaven als
    het gekozen jaar maar één uitgave heeft; 'count': zoveel uitgaven in het
    gekozen jaar.
    """
    releases = []
    matches = 0
    fallback = None
    seen = set()
    for rec in recordings or []:
        if not title_matches(rec.get("title", ""), title) or not artist_matches(rec, artists):
            continue
        if other_version(rec, title, live):
            continue
        rid = rec.get("id")
        if rid and rid in seen:
            continue
        if rid:
            seen.add(rid)
        studio = _studio_releases(rec)
        credit = "".join(c.get("name", "") + (c.get("joinphrase") or "") for c in rec.get("artist-credit") or [])
        if studio:
            matches += 1
            for r in studio:
                releases.append({**r, "mbid": rid, "title": rec.get("title"), "artist": credit})
            continue
        d = rec.get("first-release-date")
        y = year_of(d)
        if y is None:
            continue
        matches += 1
        if fallback is None or y < fallback["year"]:
            fallback = {"year": y, "date": d, "mbid": rid, "title": rec.get("title"), "artist": credit}
    if not releases:
        if not fallback:
            return None
        return {**fallback, "official": False, "matches": matches, "raw": fallback["year"], "count": 0}
    years: dict = {}
    for r in releases:
        y = years.setdefault(r["year"], {"ids": set(), "groups": set(), "other": False, "first": r})
        y["ids"].add(r["id"])
        if r["compilation"]:
            y["groups"].add(r["group"])
        else:
            y["other"] = True
        if r["date"] < y["first"]["date"]:
            y["first"] = r
    ordered = sorted(years)
    raw = ordered[0]
    year = next((y for y in ordered if years[y]["other"] or len(years[y]["groups"]) >= 2), raw)
    count = len(years[year]["ids"])
    first = years[year]["first"]
    found = {"year": year, "date": first["date"], "official": True, "mbid": first["mbid"], "title": first["title"],
             "artist": first["artist"], "matches": matches, "raw": raw, "count": count}
    if count == 1:
        later = next((y for y in ordered if year < y <= year + LONE_WINDOW and len(years[y]["ids"]) >= 2), None)
        if later:
            found["next"] = later
    return found


def lookup(title: str, artists: list[str], search=mb_search) -> dict:
    """Zoekt het eerste releasejaar; geeft {'year': None} als er niets past."""
    wanted = clean_title(title)
    primary = artists[0] if artists else ""
    remix = remix_parts(title)
    if remix:
        # MusicBrainz schrijft een remix meestal als "Titel (X remix)", soms met
        # "radio edit" erbij. Zoek dus op het nummer als geheel en de woorden van
        # de remix los; title_matches kiest daarna streng de juiste remix.
        base = remix[0]
        extra = _words(" ".join(_remix_words(remix[1])))
        queries = [
            ("exact", f"recording:{lucene_phrase(base)} AND recording:({extra}) AND artist:{lucene_phrase(primary)}"),
            ("ruim", f"recording:({_words(base)} AND {extra}) AND artist:({_words(primary)})"),
        ]
    else:
        queries = [
            ("exact", f"recording:{lucene_phrase(wanted)} AND artist:{lucene_phrase(primary)}"),
        ]
        loose = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", wanted).strip()
        if loose and norm(loose) != norm(wanted):
            queries.append(("zonder haakjes", f"recording:{lucene_phrase(loose)} AND artist:{lucene_phrase(primary)}"))
        queries.append(("ruim", f"recording:({_words(wanted)}) AND artist:({_words(primary)})"))
    live = is_live(title)
    for method, query in queries:
        # Alle opnames van deze zoekopdracht, over alle pagina's heen.
        pool: list = []

        def pick(recs):
            pool.extend(recs or [])
            return pick_year(pool, wanted, artists, live)

        recordings, total = search(query)
        found = pick(recordings)
        if total > len(recordings):
            # Bekende nummers hebben honderden opnames (live, bootlegs); de eerste
            # honderd zijn niet noodzakelijk de oudste en de studio-opname zit er
            # soms niet eens bij.
            studio = f"({query}){_STUDIO_FILTER}"
            if not (found and found["official"]):
                # Geen officiële studio-uitgave op de eerste pagina: vraag er
                # gericht naar. Dat zijn er hooguit enkele tientallen.
                found = pick(search(studio)[0])
            # Een opname met een vroegere officiële uitgave heeft ook een vroegere
            # 'eerste release'. Kijk dus of er vóór het gevonden jaar nog iets zit.
            # `seen`: alle opnames met een eerste release vóór dat jaar zijn al
            # bekeken (een volledige pagina). Ligt een officieel jaar daar niet na,
            # dan kan er niets vroegers meer bestaan en is een verzoek overbodig.
            seen = None
            for _ in range(5):
                if not found:
                    break
                if found["official"] and seen is not None and found["year"] <= seen:
                    break
                before = f" AND firstreleasedate:[1900-01-01 TO {found['year'] - 1}-12-31]"
                older, older_total = search(f"({query}){before}")
                improved = pick(older)
                if older_total > len(older):
                    # Nog altijd te veel om te overzien: opnieuw alleen studio-uitgaven.
                    improved = pick(search(studio + before)[0])
                else:
                    seen = found["year"]
                same = improved["year"] == found["year"] and improved["official"] == found["official"]
                found = improved
                if same:
                    break
        if not found:
            continue
        found["method"] = method
        return found
    return {"year": None, "method": "niets gevonden"}


_STUDIO_FILTER = " AND status:official AND NOT secondarytype:live AND NOT secondarytype:demo"


def _words(text: str) -> str:
    words = re.findall(r"[^\W_]+", str(text), flags=re.UNICODE)
    return " AND ".join(words) if words else '""'


# ---------------------------------------------------------------- Wikidata

# Wikidata als derde bron (zie web/src/lib/wikidata.js): vrije gegevens (CC0),
# zonder account. Eén verzoek zoekt tot 25 titels tegelijk.
WD_URL = "https://query.wikidata.org/sparql"
WD_BATCH = 25
WD_MIN_INTERVAL = 1.1
# Soorten items die een album, video of film zijn, niet het nummer zelf.
_WD_NOT_SONG = {"Q482994", "Q208569", "Q222910", "Q209939", "Q169930", "Q193977", "Q4176708", "Q24672043",
                "Q1056693", "Q10590726", "Q11424", "Q5398426"}
# Lied, single, muziekwerk: een item dat ook zo'n soort heeft, telt wel.
_WD_SONG = {"Q7366", "Q134556", "Q105543609"}
_WD_SEP = "\u001f"
_last_wd_call = 0.0


def wd_useful(title: str) -> bool:
    """Moet Wikidata voor dit nummer gevraagd worden? Niet voor remixes, live-opnames en heropnames."""
    return not is_remix(title) and not is_live(title) and not is_rerecording(title)


def wd_title(title: str) -> str:
    """De titel zoals Wikidata hem gezocht wordt: zonder versie-aanduidingen, in kleine letters."""
    parts = remix_parts(title)
    t = parts[0] if parts else clean_title(title)
    return re.sub(r"\s+", " ", t.lower().replace("\u2019", "'")).strip()


def wd_searches(title: str) -> list[str]:
    """Wat er voor een titel gezocht wordt: de titel, en zonder haakjes als die er zijn."""
    q = wd_title(title)
    if not q:
        return []
    loose = re.sub(r"\s+", " ", re.sub(r"\s*[\(\[][^\)\]]*[\)\]]\s*", " ", q)).strip()
    return [q, loose] if loose and loose != q else [q]


def _wd_literal(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def wd_query(titles: list[str]) -> str:
    """De SPARQL-vraag voor een lijst titels (dezelfde als wdQuery in wikidata.js)."""
    values = " ".join(_wd_literal(t) for t in titles)
    return f"""SELECT ?q ?item
  (GROUP_CONCAT(DISTINCT ?lab; separator="\\u001f") AS ?labels)
  (GROUP_CONCAT(DISTINCT ?pl; separator="\\u001f") AS ?performers)
  (GROUP_CONCAT(DISTINCT STR(?d); separator=" ") AS ?dates)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?ty), "entity/"); separator=" ") AS ?types)
WHERE {{
  VALUES ?q {{ {values} }}
  SERVICE wikibase:mwapi {{
    bd:serviceParam wikibase:api "EntitySearch" ; wikibase:endpoint "www.wikidata.org" ;
                    mwapi:search ?q ; mwapi:language "en" ; mwapi:limit "20" .
    ?item wikibase:apiOutputItem mwapi:item .
  }}
  ?item wdt:P175 ?p .
  ?p rdfs:label ?pl . FILTER(LANG(?pl) IN ("en", "mul"))
  ?item rdfs:label ?lab . FILTER(LANG(?lab) IN ("en", "mul", "nl"))
  OPTIONAL {{ ?item wdt:P577 ?d }}
  OPTIONAL {{ ?item wdt:P31 ?ty }}
}} GROUP BY ?q ?item"""


def wd_search(titles: list[str]) -> list[dict]:
    """Eén verzoek naar Wikidata: [{q, item, labels, performers, dates, types}]."""
    global _last_wd_call
    pause = WD_MIN_INTERVAL - (time.monotonic() - _last_wd_call)
    if pause > 0:
        time.sleep(pause)
    body = urllib.parse.urlencode({"query": wd_query(titles), "format": "json"}).encode()
    try:
        data = http_json(WD_URL, {"Accept": "application/sparql-results+json",
                                  "Content-Type": "application/x-www-form-urlencoded"}, data=body, tries=3) or {}
    finally:
        _last_wd_call = time.monotonic()
    return [{k: (v or {}).get("value", "") for k, v in b.items()} for b in (data.get("results") or {}).get("bindings") or []]


def wd_pick(track: dict, rows: list[dict]) -> dict:
    """Het jaar volgens Wikidata voor één nummer (zie wdPick in wikidata.js): {'year', 'items'}."""
    title = track.get("title", "")
    searched = set(wd_searches(title))
    parts = remix_parts(title)
    base = parts[0] if parts else clean_title(title)
    want, loose = norm(base), norm_loose(base)
    artists = {norm(a) for a in track.get("artists") or [] if a}
    year, items = None, 0
    for r in rows:
        if r.get("q") not in searched:
            continue
        labels = str(r.get("labels") or "").split(_WD_SEP)
        # Zonder haakjes vergelijken mag, maar niet als het label een live- of remixversie is.
        if not any(norm(lab) == want or (loose and norm_loose(lab) == loose and not is_live(lab) and not is_remix(lab))
                   for lab in labels):
            continue
        performers = {norm(p) for p in str(r.get("performers") or "").split(_WD_SEP)}
        if not (performers & artists):
            continue
        types = set(str(r.get("types") or "").split())
        if types & _WD_NOT_SONG and not types & _WD_SONG:
            continue
        items += 1
        for d in str(r.get("dates") or "").split():
            y = year_of(d)
            if y is not None and (year is None or y < year):
                year = y
    return {"year": year, "items": items}


def wd_lookup(tracks: list[dict], search=wd_search) -> dict:
    """Wikidata-jaar per track-ID, in blokken van WD_BATCH zoektermen (zie
    wdLookup in wikidata.js). Faalt een blok, dan stopt het: wat al binnen is
    blijft (dan zonder Wikidata)."""
    titles: list[str] = []
    index: dict[str, int] = {}
    todo = []
    for t in tracks:
        if not wd_useful(t.get("title", "")):
            continue
        qs = wd_searches(t.get("title", ""))
        if not qs:
            continue
        for q in qs:
            if q not in index:
                index[q] = len(titles)
                titles.append(q)
        todo.append([t, max(index[q] for q in qs), False])
    rows: list[dict] = []
    out = {}
    for i in range(0, len(titles), WD_BATCH):
        try:
            rows += search(titles[i:i + WD_BATCH])
        except Exception as err:  # niet bereikbaar of te druk: verder zonder Wikidata
            say(f"  Wikidata gaf geen antwoord ({err}); verder zonder.")
            break
        for item in todo:
            if item[2] or item[1] >= i + WD_BATCH:
                continue
            item[2] = True
            out[item[0]["id"]] = wd_pick(item[0], rows)
    return out


# ---------------------------------------------------------------- Spotify


def read_client_id() -> str:
    if CONFIG_JS.exists():
        m = re.search(r"SPOTIFY_CLIENT_ID\s*=\s*['\"]([0-9a-fA-F]{32})['\"]", CONFIG_JS.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    return ""


def playlist_id(value: str) -> str:
    m = re.search(r"playlist[/:]([A-Za-z0-9]{16,})", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9]{16,}", value):
        return value
    raise SystemExit(f"Dit lijkt geen Spotify-playlist: {value}")


def spotify_login(client_id: str, port: int) -> str:
    """Authorization Code + PKCE met een tijdelijk servertje op 127.0.0.1."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    redirect = f"http://127.0.0.1:{port}/callback"
    result: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (naam ligt vast)
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            params = urllib.parse.parse_qs(parsed.query)
            result["code"] = params.get("code", [""])[0]
            result["state"] = params.get("state", [""])[0]
            result["error"] = params.get("error", [""])[0]
            ok = bool(result["code"]) and not result["error"]
            body = (
                "<!doctype html><meta charset=utf-8><title>Muziek-tijdlijn</title>"
                "<body style='font-family:sans-serif;margin:3em'>"
                + ("<h1>Gelukt</h1><p>Je mag dit venster sluiten.</p>" if ok else "<h1>Niet gelukt</h1><p>Kijk in het venster van het script.</p>")
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # stil
            return

    try:
        server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    except OSError as err:
        raise SystemExit(f"Poort {port} is bezet ({err}). Sluit het andere programma of kies --poort.")
    server.timeout = 1
    url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "scope": SPOTIFY_SCOPES,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "redirect_uri": redirect,
            "state": state,
        }
    )
    say("Je browser opent nu Spotify. Log in en geef toestemming.")
    say("Gebeurt er niets? Open dan zelf deze link:")
    say(url)
    say()
    webbrowser.open(url)
    deadline = time.monotonic() + 300
    try:
        while "code" not in result and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    if result.get("error"):
        raise SystemExit(f"Spotify gaf een fout: {result['error']}")
    if not result.get("code"):
        raise SystemExit("Geen antwoord van Spotify binnen 5 minuten. Probeer opnieuw.")
    if result.get("state") != state:
        raise SystemExit("Het antwoord van Spotify klopte niet (state). Probeer opnieuw.")
    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": result["code"],
            "redirect_uri": redirect,
            "client_id": client_id,
            "code_verifier": verifier,
        }
    ).encode()
    try:
        token = http_json(
            "https://accounts.spotify.com/api/token",
            {"Content-Type": "application/x-www-form-urlencoded"},
            data=body,
            tries=2,
        )
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:300]
        raise SystemExit(
            f"Inloggen mislukte ({err.code}): {detail}\n"
            f"Staat {redirect} bij de Redirect URIs van je Spotify-app?"
        )
    return token["access_token"]


def fetch_playlist(pid: str, token: str) -> list[dict]:
    """Leest alle nummers via GET /playlists/{id}/items (max. 50 per pagina)."""
    url = f"https://api.spotify.com/v1/playlists/{pid}/items?" + urllib.parse.urlencode(
        {"limit": "50", "offset": "0", "additional_types": "track"}
    )
    tracks: list[dict] = []
    seen = set()
    while url:
        try:
            page = http_json(url, {"Authorization": f"Bearer {token}"})
        except urllib.error.HTTPError as err:
            if err.code == 403:
                raise SystemExit(
                    "Spotify weigert (403). Sinds februari 2026 kan je alleen playlists lezen waarvan je\n"
                    "eigenaar of medewerker bent, en je account moet de eigenaar van de Spotify-app zijn of\n"
                    "bij 'User Management' van de app staan."
                )
            if err.code == 404:
                raise SystemExit("Spotify vindt deze playlist niet (404). Klopt de link?")
            raise SystemExit(f"Spotify gaf een fout ({err.code}) bij het ophalen van de playlist.")
        for entry in page.get("items") or []:
            # Sinds februari 2026 heet het veld 'item'; vroeger 'track'.
            item = entry.get("item") or entry.get("track")
            if not item or entry.get("is_local") or item.get("type", "track") != "track" or not item.get("id"):
                continue
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            album = item.get("album") or {}
            tracks.append(
                {
                    "id": item["id"],
                    "artists": [a.get("name", "") for a in item.get("artists") or [] if a.get("name")],
                    "title": item.get("name", ""),
                    "spotify_date": album.get("release_date"),
                    "album": album.get("name"),
                    "album_type": album.get("album_type"),
                    "isrc": (item.get("external_ids") or {}).get("isrc"),
                }
            )
        url = page.get("next")
        say(f"  {len(tracks)} nummers gelezen…")
    return tracks


# ---------------------------------------------------------------- beslissen


def _near(a, b) -> bool:
    return a is not None and b is not None and abs(a - b) <= 1


def is_rerecording(title: str) -> bool:
    """Een heropname van de artiest zelf, zoals "Love Story (Taylor's Version)"."""
    return bool(re.search(r"\b(?:taylor['’]s version|re-?record(?:ed|ing)?)\b", str(title), re.IGNORECASE))


def decide(track: dict, mb: dict | None, correction: dict | None, wd: dict | None = None) -> dict:
    """Kiest het jaar voor één nummer en zegt of het nagekeken moet worden.

    Dezelfde regels als decide() in web/src/lib/years.js: twee bronnen die het
    eens zijn (hoogstens een jaar verschil) winnen van de derde; alleen zonder
    overeenstemming blijft er twijfel. `wd`: het resultaat van Wikidata
    ({'year': ...}), of None als Wikidata niet gevraagd is of niet antwoordde.
    """
    title = track.get("title", "")
    s = year_of(track.get("spotify_date"))
    remix = is_remix(title)
    own = not remix and not is_live(title) and not is_rerecording(title)
    asked = own and wd is not None
    w = (wd or {}).get("year") if asked else None
    mb = mb or {}
    m = mb.get("year")
    if m is not None and s is not None and mb.get("next") and w is not None and w >= mb["next"]:
        m = mb["next"]
    raw = mb.get("raw")
    # Behalve als Wikidata het latere jaar (of later) zegt: dan is de best-of fout gedateerd.
    if m is not None and s is not None and raw and raw == s and raw < m and not (w is not None and w >= m):
        m = raw
    strong = m == mb.get("year") and (mb.get("count") or 0) >= 2

    year, doubt = None, ""
    if m is not None and s is not None:
        if _near(m, s):
            year = m if (w == m and s != m) else min(m, s)
        elif _near(w, m) and not _near(w, s):
            year = m
        elif _near(w, s) and not _near(w, m):
            year = s
        else:
            both = f"Spotify ({s}) en MusicBrainz ({m}) verschillen meer dan een jaar"
            if asked:
                both += f"; Wikidata {w if w is not None else 'kent het niet'}"
            if w is not None and w < min(m, s) - 1:
                year, doubt = w, both
            elif strong and m < s and (w is None or w > m):
                year = m
            else:
                year, doubt = min(m, s), both
    elif m is not None:
        if w is not None and not _near(w, m):
            year, doubt = min(m, w), f"MusicBrainz ({m}) en Wikidata ({w}) verschillen meer dan een jaar"
        else:
            year = m
    elif s is not None:
        # Ook bij een remix: nooit het jaar van het origineel, dat hoort niet bij wat de spelers horen.
        why = ("remix die MusicBrainz niet kent; jaar van het Spotify-album gebruikt" if remix
               else "MusicBrainz vond niets; jaar van het Spotify-album gebruikt")
        if _near(w, s):
            year = min(s, w)
        elif w is not None:
            year, doubt = min(s, w), f"MusicBrainz vond niets; Spotify zegt {s}, Wikidata {w}"
        else:
            year, doubt = s, why
    elif w is not None:
        year, doubt = w, "alleen Wikidata kent een jaar"
    else:
        doubt = "geen jaar gevonden; vul het aan in correcties.json"

    source = "onbekend" if year is None else "musicbrainz" if year == m else "spotify" if year == s else "wikidata"
    reasons = [doubt] if doubt else []
    if doubt:
        # Wat de twijfel groter maakt; zonder twijfel doet het er niet toe.
        if m is not None and mb.get("method") == "ruim":
            reasons.append("alleen via een ruime zoekopdracht gevonden")
        if m is not None and mb.get("official") is False:
            reasons.append("MusicBrainz kent alleen live-, demo- of onofficiële uitgaven")
        if is_live(title):
            reasons.append("live-opname: het jaar is dat van de eerste release van het nummer")
    if correction and correction.get("year"):
        year, source, reasons = int(correction["year"]), "handmatig", []
    return {
        "id": track["id"],
        "artist": ", ".join(track.get("artists") or []),
        "title": clean_title(title),
        "year": year,
        "source": source,
        "spotify_year": s,
        "mb_year": m,
        "wd_year": w,
        "wd_asked": asked,
        "mbid": mb.get("mbid"),
        "reasons": reasons,
        "note": (correction or {}).get("note", ""),
        "original_title": title,
    }


def write_review(rows: list[dict], path: Path, have_spotify_years: bool) -> None:
    flagged = [r for r in rows if r["reasons"]]
    manual = [r for r in rows if r["source"] == "handmatig"]
    lines = [
        "# Jaartallen nakijken",
        "",
        f"Gemaakt door `tools/tracks.py` op {date.today().isoformat()}. "
        f"{len(rows)} nummers, waarvan {len(flagged)} om na te kijken en {len(manual)} handmatig verbeterd.",
        "",
        "Een jaartal verbeteren: zet het track-ID met het juiste jaar in `tools/correcties.json` en draai",
        "het script opnieuw, bijvoorbeeld:",
        "",
        "```json",
        '{ "5IX4TbIR5mMHGE4wiWwKW0": { "year": 1989, "note": "single uit 1989" } }',
        "```",
        "",
    ]
    if not have_spotify_years:
        lines += [
            "> Let op: deze lijst is gemaakt zonder de jaartallen van Spotify (het script draaide zonder",
            "> Spotify-login). De vergelijking Spotify ↔ MusicBrainz ontbreekt dus nog. Draai het script",
            "> lokaal met login om die erbij te krijgen.",
            "",
        ]
    lines += ["## Na te kijken", ""]
    if flagged:
        lines += [
            "| Artiest | Titel | Gekozen | Bron | Spotify | MusicBrainz | Wikidata | Waarom | Track-ID |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for r in flagged:
            mb = f"[{r['mb_year']}](https://musicbrainz.org/recording/{r['mbid']})" if r["mb_year"] and r["mbid"] else (r["mb_year"] or "–")
            lines.append(
                "| {artist} | {title} | {year} | {source} | {sp} | {mb} | {wd} | {why} | `{id}` |".format(
                    artist=_cell(r["artist"]),
                    title=_cell(r["title"]),
                    year=r["year"] or "**?**",
                    source=r["source"],
                    sp=r["spotify_year"] or "–",
                    mb=mb,
                    wd=(r["wd_year"] or "niets") if r.get("wd_asked") else "–",
                    why=_cell("; ".join(r["reasons"])),
                    id=r["id"],
                )
            )
    else:
        lines.append("Niets: alle jaartallen komen overeen.")
    lines += ["", "## Handmatig verbeterd", ""]
    if manual:
        lines += ["| Artiest | Titel | Jaar | Spotify | MusicBrainz | Opmerking | Track-ID |", "| --- | --- | --- | --- | --- | --- | --- |"]
        for r in manual:
            lines.append(
                f"| {_cell(r['artist'])} | {_cell(r['title'])} | {r['year']} | {r['spotify_year'] or '–'} | "
                f"{r['mb_year'] or '–'} | {_cell(r['note'])} | `{r['id']}` |"
            )
    else:
        lines.append("Nog niets.")
    lines += ["", "## Alle nummers", "", "| Jaar | Artiest | Titel | Bron |", "| --- | --- | --- | --- |"]
    for r in sorted(rows, key=lambda r: (r["year"] or 9999, r["artist"].casefold())):
        lines.append(f"| {r['year'] or '?'} | {_cell(r['artist'])} | {_cell(r['title'])} | {r['source']} |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _cell(text) -> str:
    return str(text or "").replace("|", "\\|").replace("\n", " ")


# ---------------------------------------------------------------- hoofdprogramma


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:  # Windows-console: voorkom fouten op letters buiten de codepagina
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Maakt tracks.json voor Muziek-tijdlijn.")
    ap.add_argument("--playlist", default=DEFAULT_PLAYLIST, help="link of ID van je Spotify-playlist")
    ap.add_argument("--client-id", default="", help="Client ID van je Spotify-app (standaard uit web/src/config.js)")
    ap.add_argument("--poort", type=int, default=DEFAULT_PORT, help=f"poort voor de Spotify-login (standaard {DEFAULT_PORT})")
    ap.add_argument("--invoer", default="", help="sla Spotify over en lees de nummers uit dit JSON-bestand")
    ap.add_argument("--opnieuw", action="store_true", help="negeer de caches en zoek alles opnieuw op")
    ap.add_argument("--zonder-wikidata", action="store_true", help="vraag Wikidata niet (alleen Spotify en MusicBrainz)")
    args = ap.parse_args(argv)

    # 1. De nummers
    if args.invoer:
        data = read_json(Path(args.invoer), None)
        if data is None:
            raise SystemExit(f"Bestand niet gevonden: {args.invoer}")
        tracks = data["tracks"] if isinstance(data, dict) else data
        say(f"{len(tracks)} nummers gelezen uit {args.invoer} (Spotify overgeslagen).")
    else:
        client_id = args.client_id or read_client_id()
        if not client_id:
            raise SystemExit(
                "Geen Client ID gevonden. Vul SPOTIFY_CLIENT_ID in web/src/config.js in of geef --client-id mee.\n"
                "Of gebruik --invoer tools/playlist.json om Spotify over te slaan."
            )
        pid = playlist_id(args.playlist)
        token = spotify_login(client_id, args.poort)
        say("Ingelogd. Playlist ophalen…")
        tracks = fetch_playlist(pid, token)
        write_json(PLAYLIST_JSON, {"playlist_id": pid, "opgehaald": date.today().isoformat(), "bron": "Spotify Web API", "tracks": tracks})
        say(f"{len(tracks)} nummers bewaard in {PLAYLIST_JSON.relative_to(ROOT)}.")
    if not tracks:
        raise SystemExit("De playlist is leeg.")

    # 2. MusicBrainz
    cache = {} if args.opnieuw else read_json(CACHE_JSON, {})
    todo = [t for t in tracks if _cache_key(t) != (cache.get(t["id"]) or {}).get("key")]
    if todo:
        say(f"MusicBrainz: {len(todo)} nummers opzoeken (ongeveer {max(1, round(len(todo) * 1.6 / 60))} min; max. 1 verzoek per seconde)…")
    for i, t in enumerate(todo, 1):
        try:
            found = lookup(t["title"], t.get("artists") or [])
        except Exception as err:  # netwerk blijft haperen: bewaar wat er is en stop netjes
            write_json(CACHE_JSON, cache)
            raise SystemExit(f"MusicBrainz is niet bereikbaar ({err}). Draai het script later opnieuw; het gaat verder waar het stopte.")
        found["key"] = _cache_key(t)
        cache[t["id"]] = found
        label = f"{', '.join(t.get('artists') or [])} – {t['title']}"
        say(f"  [{i:>3}/{len(todo)}] {label[:70]:<70} {found.get('year') or 'niets gevonden'}")
        if i % 10 == 0:
            write_json(CACHE_JSON, cache)
    # Alleen bewaren wat nog in de playlist zit.
    cache = {t["id"]: cache[t["id"]] for t in tracks if t["id"] in cache}
    write_json(CACHE_JSON, cache)

    # 3. Wikidata: de derde bron, in blokken van 25 titels (een handvol verzoeken).
    wd_cache = {} if args.opnieuw else read_json(WD_CACHE_JSON, {})
    if not args.zonder_wikidata:
        wd_todo = [t for t in tracks if wd_useful(t.get("title", "")) and wd_title(t.get("title", "")) != (wd_cache.get(t["id"]) or {}).get("key")]
        if wd_todo:
            say(f"Wikidata: {len(wd_todo)} nummers opzoeken…")
            for tid, found in wd_lookup(wd_todo).items():
                wd_cache[tid] = {**found, "key": wd_title(next(t["title"] for t in wd_todo if t["id"] == tid))}
        wd_cache = {t["id"]: wd_cache[t["id"]] for t in tracks if t["id"] in wd_cache}
        write_json(WD_CACHE_JSON, wd_cache)
    else:
        wd_cache = {}

    # 4. Samenvoegen
    corrections = read_json(CORRECTIONS_JSON, {})
    rows = [decide(t, cache.get(t["id"]), corrections.get(t["id"]), wd_cache.get(t["id"])) for t in tracks]
    # Hetzelfde nummer twee keer (bv. album- en singleversie) geeft twee dezelfde kaarten.
    first_seen: dict[str, str] = {}
    for t, r in zip(tracks, rows):
        key = _cache_key(t)
        if key in first_seen and r["source"] != "handmatig":
            r["reasons"].append("staat twee keer in de playlist (zelfde titel en artiest)")
        first_seen.setdefault(key, t["id"])
    out = [
        {"id": r["id"], "artist": r["artist"], "title": r["title"], "year": r["year"], "source": r["source"]}
        for r in rows
        if r["year"]
    ]
    write_json(TRACKS_JSON, out)
    have_spotify = any(r["spotify_year"] for r in rows)
    write_review(rows, REVIEW_MD, have_spotify)

    flagged = sum(1 for r in rows if r["reasons"])
    unknown = [c for c in corrections if c not in {t["id"] for t in tracks} and not c.startswith("_")]
    say()
    say(f"Klaar. {len(out)} nummers in {TRACKS_JSON.relative_to(ROOT)}.")
    say(f"  bron MusicBrainz: {sum(1 for r in rows if r['source'] == 'musicbrainz')}")
    say(f"  bron Spotify:     {sum(1 for r in rows if r['source'] == 'spotify')}")
    say(f"  handmatig:        {sum(1 for r in rows if r['source'] == 'handmatig')}")
    if len(out) < len(rows):
        say(f"  zonder jaar (niet in het spel): {len(rows) - len(out)}")
    say(f"Na te kijken: {flagged} nummers, zie {REVIEW_MD.relative_to(ROOT)}.")
    if unknown:
        say(f"Let op: {len(unknown)} correctie(s) horen bij nummers die niet (meer) in de playlist zitten.")
    return 0


def _cache_key(track: dict) -> str:
    # "v5": verhoog dit als de zoekmethode verandert, dan wordt alles opnieuw opgezocht.
    # Remixes krijgen er de regelversie voor remixes bij: zo wordt een remix die
    # nog met de oude regels (jaar van het origineel) bewaard is, opnieuw opgezocht,
    # zonder de rest van de cache weg te gooien.
    title = track.get("title", "")
    prefix = f"v5-remix{REMIX_RULES}|" if is_remix(title) else "v5|"
    return prefix + norm(clean_title(title)) + "|" + norm((track.get("artists") or [""])[0])


if __name__ == "__main__":
    sys.exit(main())
