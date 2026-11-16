#!/usr/bin/env python3
"""Maakt tracks.json voor Muziek-tijdlijn.

Wat het doet:
  1. Haalt de nummers van je Spotify-playlist op (je logt één keer in via de
     browser; er is geen Client Secret nodig).
  2. Zoekt per nummer het jaar van de EERSTE release op bij MusicBrainz.
     Spotify geeft alleen de datum van het album, en dat is vaak een remaster
     of een compilatie.
  3. Schrijft web/public/tracks.json (track-ID, artiest, titel, jaar, bron) en
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


def clean_title(title: str) -> str:
    """Haalt versie-aanduidingen van een Spotify-titel af."""
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
    return clean_title(title) != title.strip() and bool(_LIVE_RE.search(title[len(clean_title(title)) :]))


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
    a, b = norm(clean_title(candidate)), norm(wanted)
    if a and a == b:
        return True
    a, b = norm_loose(clean_title(candidate)), norm_loose(wanted)
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


def http_json(url: str, headers: dict | None = None, data: bytes | None = None, tries: int = 5):
    """GET of POST met wachten en opnieuw proberen bij 429/503 en netwerkfouten."""
    wait = 2.0
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < tries:
                retry_after = err.headers.get("Retry-After")
                pause = float(retry_after) if retry_after and retry_after.isdigit() else wait
                time.sleep(min(pause, 60))
                wait *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < tries:
                time.sleep(wait)
                wait *= 2
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


def pick_year(recordings: list[dict], title: str, artists: list[str]) -> dict | None:
    """Kiest uit zoekresultaten het vroegste jaar van een opname die echt past."""
    best = None
    count = 0
    for rec in recordings:
        y = year_of(rec.get("first-release-date"))
        if y is None:
            continue
        if not title_matches(rec.get("title", ""), title) or not artist_matches(rec, artists):
            continue
        count += 1
        if best is None or y < best["year"]:
            credit = "".join(
                c.get("name", "") + (c.get("joinphrase") or "") for c in rec.get("artist-credit") or []
            )
            best = {
                "year": y,
                "date": rec.get("first-release-date"),
                "mbid": rec.get("id"),
                "title": rec.get("title"),
                "artist": credit,
            }
    if best:
        best["matches"] = count
    return best


def lookup(title: str, artists: list[str], search=mb_search) -> dict:
    """Zoekt het eerste releasejaar; geeft {'year': None} als er niets past."""
    wanted = clean_title(title)
    primary = artists[0] if artists else ""
    queries = [
        ("exact", f"recording:{lucene_phrase(wanted)} AND artist:{lucene_phrase(primary)}"),
    ]
    loose = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", wanted).strip()
    if loose and norm(loose) != norm(wanted):
        queries.append(("zonder haakjes", f"recording:{lucene_phrase(loose)} AND artist:{lucene_phrase(primary)}"))
    queries.append(("ruim", f"recording:({_words(wanted)}) AND artist:({_words(primary)})"))
    for method, query in queries:
        recordings, total = search(query)
        found = pick_year(recordings, wanted, artists)
        if not found:
            continue
        # Bekende nummers hebben honderden opnames (live, remasters) en de oudste
        # zit niet altijd bij de eerste honderd. Vraag daarom gericht naar opnames
        # van vóór het gevonden jaar, tot er geen oudere meer is.
        steps = 0
        while total > len(recordings) and steps < 6:
            steps += 1
            older, _ = search(f"({query}) AND firstreleasedate:[1900-01-01 TO {found['year'] - 1}-12-31]")
            earlier = pick_year(older, wanted, artists)
            if not earlier or earlier["year"] >= found["year"]:
                break
            earlier["matches"] = found["matches"]
            found = earlier
        found["method"] = method
        return found
    return {"year": None, "method": "niets gevonden"}


def _words(text: str) -> str:
    words = re.findall(r"[^\W_]+", str(text), flags=re.UNICODE)
    return " AND ".join(words) if words else '""'


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


def decide(track: dict, mb: dict | None, correction: dict | None) -> dict:
    """Kiest het jaar voor één nummer en zegt of het nagekeken moet worden."""
    sp_year = year_of(track.get("spotify_date"))
    mb_year = (mb or {}).get("year")
    reasons = []
    if correction and correction.get("year"):
        year, source = int(correction["year"]), "handmatig"
    elif mb_year and sp_year:
        # Het vroegste van de twee: een album kan niet voor de eerste release liggen.
        year, source = (mb_year, "musicbrainz") if mb_year <= sp_year else (sp_year, "spotify")
        if abs(mb_year - sp_year) > 1:
            reasons.append(f"Spotify ({sp_year}) en MusicBrainz ({mb_year}) verschillen meer dan een jaar")
    elif mb_year:
        year, source = mb_year, "musicbrainz"
    elif sp_year:
        year, source = sp_year, "spotify"
        reasons.append("MusicBrainz vond niets; jaar van het Spotify-album gebruikt")
    else:
        year, source = None, "onbekend"
        reasons.append("geen jaar gevonden; vul het aan in correcties.json")
    if source != "handmatig":
        if mb_year and (mb or {}).get("method") == "ruim":
            reasons.append("alleen via een ruime zoekopdracht gevonden")
        if is_live(track.get("title", "")):
            reasons.append("live-opname: het jaar is dat van de eerste release van het nummer")
    return {
        "id": track["id"],
        "artist": ", ".join(track.get("artists") or []),
        "title": clean_title(track.get("title", "")),
        "year": year,
        "source": source,
        "spotify_year": sp_year,
        "mb_year": mb_year,
        "mbid": (mb or {}).get("mbid"),
        "reasons": [] if source == "handmatig" else reasons,
        "note": (correction or {}).get("note", ""),
        "original_title": track.get("title", ""),
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
            "| Artiest | Titel | Gekozen | Bron | Spotify | MusicBrainz | Waarom | Track-ID |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for r in flagged:
            mb = f"[{r['mb_year']}](https://musicbrainz.org/recording/{r['mbid']})" if r["mb_year"] and r["mbid"] else (r["mb_year"] or "–")
            lines.append(
                "| {artist} | {title} | {year} | {source} | {sp} | {mb} | {why} | `{id}` |".format(
                    artist=_cell(r["artist"]),
                    title=_cell(r["title"]),
                    year=r["year"] or "**?**",
                    source=r["source"],
                    sp=r["spotify_year"] or "–",
                    mb=mb,
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
    ap.add_argument("--opnieuw", action="store_true", help="negeer de MusicBrainz-cache en zoek alles opnieuw op")
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

    # 3. Samenvoegen
    corrections = read_json(CORRECTIONS_JSON, {})
    rows = [decide(t, cache.get(t["id"]), corrections.get(t["id"])) for t in tracks]
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
    return norm(clean_title(track.get("title", ""))) + "|" + norm((track.get("artists") or [""])[0])


if __name__ == "__main__":
    sys.exit(main())
