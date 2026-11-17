"""Tests voor tools/tracks.py. Draaien zonder netwerk:  python -m unittest discover -s tools -p "test_*.py" """

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tracks as T  # noqa: E402


def rel(date, status="Official", secondary=()):
    return {"date": date, "status": status, "release-group": {"primary-type": "Album", "secondary-types": list(secondary)}}


def rec(title, artist, first, mbid="x", aliases=(), releases=None):
    """Een opname zoals MusicBrainz ze teruggeeft. Zonder `releases` krijgt ze
    één officiële studio-uitgave op de datum `first`."""
    return {
        "id": mbid,
        "title": title,
        "first-release-date": first,
        "artist-credit": [{"name": artist, "artist": {"name": artist, "aliases": [{"name": a} for a in aliases]}}],
        "releases": [rel(first)] if releases is None else releases,
    }


class CleanTitle(unittest.TestCase):
    def test_strips_version_suffixes(self):
        cases = {
            "Bohemian Rhapsody - Remastered 2011": "Bohemian Rhapsody",
            "The Trooper - 1998 Remastered Version": "The Trooper",
            "Whole Lotta Love - 1990 Remaster": "Whole Lotta Love",
            "Fade To Black - Remastered": "Fade To Black",
            "Paranoid (2012 Remaster)": "Paranoid",
            "Enter Sandman - Live": "Enter Sandman",
            "Song [feat. Iemand]": "Song",
            "Heroes - Single Version; 2014 Remaster": "Heroes",
            "Black - 2009": "Black",
        }
        for raw, want in cases.items():
            self.assertEqual(T.clean_title(raw), want, raw)

    def test_keeps_real_titles(self):
        for title in [
            "The Final Episode (Let's Change Channel)",
            "Rollin' (Air Raid Vehicle)",
            "Numb / Encore",
            "(I Can't Get No) Satisfaction",
            "Live and Let Die",
            "Alive",
            "Part of Me - Part 2",
        ]:
            self.assertEqual(T.clean_title(title), title)

    def test_is_live(self):
        self.assertTrue(T.is_live("Enter Sandman - Live"))
        self.assertTrue(T.is_live("Alive (Live at Wembley)"))
        self.assertFalse(T.is_live("Live and Let Die"))
        self.assertFalse(T.is_live("Bohemian Rhapsody - Remastered 2011"))


class Matching(unittest.TestCase):
    def test_norm(self):
        self.assertEqual(T.norm("Motörhead"), "motorhead")
        self.assertEqual(T.norm("JAŸ-Z"), T.norm("JAY‐Z"))
        self.assertEqual(T.norm("Guns N' Roses"), T.norm("Guns N’ Roses"))
        self.assertEqual(T.norm("The Rolling Stones"), "rolling stones")
        self.assertEqual(T.norm("Simon & Garfunkel"), T.norm("Simon and Garfunkel"))
        self.assertEqual(T.norm("AC/DC"), "ac dc")

    def test_title_matches(self):
        self.assertTrue(T.title_matches("Numb/Encore", "Numb / Encore"))
        self.assertTrue(T.title_matches("Bohemian Rhapsody (live at Wembley)", "Bohemian Rhapsody"))
        self.assertTrue(T.title_matches("The Final Episode (Let's Change the Channel)", "The Final Episode (Let's Change Channel)"))
        self.assertFalse(T.title_matches("Bohemian Rhapsody Medley", "Bohemian Rhapsody"))

    def test_artist_matches(self):
        self.assertTrue(T.artist_matches(rec("x", "Queen", "1975"), ["Queen"]))
        self.assertFalse(T.artist_matches(rec("x", "Simon & Garfunkel", "1964"), ["Disturbed"]))
        self.assertTrue(T.artist_matches(rec("x", "JAY‐Z", "2004"), ["JAŸ-Z", "Linkin Park"]))
        self.assertTrue(T.artist_matches(rec("x", "Prins", "1984", aliases=["Prince"]), ["Prince"]))
        self.assertFalse(T.artist_matches(rec("x", "Queen", "1975"), []))


class PickYear(unittest.TestCase):
    def test_earliest_matching_recording(self):
        found = T.pick_year(
            [
                rec("Bohemian Rhapsody", "Queen", "1992-05-01", "late"),
                rec("Bohemian Rhapsody", "Queen", "1975-10-31", "first"),
                rec("Bohemian Rhapsody", "Andere Band", "1960", "cover"),
                rec("Iets Anders", "Queen", "1950", "other"),
                rec("Bohemian Rhapsody", "Queen", "", "nodate"),
                rec("Bohemian Rhapsody", "Queen", "0001", "bogus"),
            ],
            "Bohemian Rhapsody",
            ["Queen"],
        )
        self.assertEqual(found["year"], 1975)
        self.assertEqual(found["mbid"], "first")
        self.assertEqual(found["matches"], 2)
        self.assertTrue(found["official"])

    def test_nothing(self):
        self.assertIsNone(T.pick_year([rec("A", "B", "1990")], "C", ["D"]))

    def test_bootlegs_live_and_demos_do_not_count(self):
        # Zoals in het echt: de studio-opname heeft een fout gedateerde bootleg
        # (1990), en er bestaan een live-bootleg (1978) en een demo (1989).
        studio = rec(
            "Enter Sandman",
            "Metallica",
            "1990",
            "studio",
            releases=[rel(None, "Bootleg"), rel("1990", "Bootleg"), rel("1991-08-12"), rel("2008-11-28"), rel("1990", "Promotion")],
        )
        live = rec("Enter Sandman", "Metallica", "1978", "live", releases=[rel("1978", "Bootleg", ["Live"])])
        official_live = rec("Enter Sandman", "Metallica", "1985", "olive", releases=[rel("1985", "Official", ["Live"])])
        demo = rec("Enter Sandman", "Metallica", "1989", "demo", releases=[rel("1989", "Official", ["Demo"])])
        found = T.pick_year([live, demo, official_live, studio], "Enter Sandman", ["Metallica"])
        self.assertEqual((found["year"], found["mbid"], found["official"]), (1991, "studio", True))

    def test_falls_back_to_unofficial_when_nothing_else(self):
        only_live = rec("Zeldzaam", "Band", "1999", "l", releases=[rel("1999", "Official", ["Live"])])
        found = T.pick_year([only_live], "Zeldzaam", ["Band"])
        self.assertEqual((found["year"], found["official"]), (1999, False))

    def test_compilations_count(self):
        comp = rec("Lied", "Band", "1980", "c", releases=[rel("1980", "Official", ["Compilation"])])
        self.assertEqual(T.pick_year([comp], "Lied", ["Band"])["year"], 1980)


class Lookup(unittest.TestCase):
    def test_descends_to_older_recordings(self):
        calls = []

        def search(query, limit=100):
            calls.append(query)
            if "firstreleasedate" not in query:
                return [rec("Whole Lotta Love", "Led Zeppelin", "1970", "p1")], 600
            if "TO 1969-12-31" in query:
                # Het origineel staat ook op een live-compilatie: de studio-filter
                # sluit het uit, alleen de zoekopdracht zonder filter vindt het.
                if "status:official" in query:
                    return [], 0
                return [rec("Whole Lotta Love", "Led Zeppelin", "1969-10-22", "orig")], 1
            return [], 0

        found = T.lookup("Whole Lotta Love - 1990 Remaster", ["Led Zeppelin"], search=search)
        self.assertEqual(found["year"], 1969)
        self.assertEqual(found["method"], "exact")
        self.assertNotIn("_rank", found)
        self.assertIn('recording:"Whole Lotta Love"', calls[0])
        self.assertNotIn("status:official", calls[0])
        self.assertIn("status:official", calls[1])
        self.assertIn("TO 1968-12-31", calls[-1])
        self.assertEqual(len(calls), 4)

    def test_older_bootlegs_do_not_replace_an_official_release(self):
        def search(query, limit=100):
            if "firstreleasedate" not in query:
                return [rec("Back in Black", "AC/DC", "1980-07-25", "studio")], 300
            return [rec("Back in Black", "AC/DC", "1978", "boot", releases=[rel("1978", "Bootleg", ["Live"])])], 1

        found = T.lookup("Back In Black", ["AC/DC"], search=search)
        self.assertEqual((found["year"], found["mbid"]), (1980, "studio"))

    def test_studio_recording_missing_from_first_page(self):
        # Zoals "Master of Puppets": 791 opnames, de eerste honderd zijn allemaal
        # live of heruitgaven. Alleen de studio-filter vindt het origineel.
        calls = []

        def search(query, limit=100):
            calls.append(query)
            if "firstreleasedate" in query:
                return [], 0
            if "status:official" in query:
                return [rec("Master of Puppets", "Metallica", "1986", "studio"), rec("Master of Puppets", "Metallica", "2017", "box")], 55
            return [
                rec("Master of Puppets", "Metallica", "2017-11-10", "box"),
                rec("Master of Puppets", "Metallica", "2003", "live", releases=[rel("2003", "Official", ["Live"])]),
            ], 791

        found = T.lookup("Master Of Puppets", ["Metallica"], search=search)
        self.assertEqual((found["year"], found["mbid"], found["official"]), (1986, "studio", True))
        self.assertIn("NOT secondarytype:live", calls[1])

    def test_first_page_without_any_match_still_tries_the_studio_filter(self):
        def search(query, limit=100):
            if "firstreleasedate" in query:
                return [], 0
            if "status:official" in query:
                return [rec("Lied", "Band", "1995", "studio")], 5
            return [rec("Ander lied", "Band", "2001")], 400

        found = T.lookup("Lied", ["Band"], search=search)
        self.assertEqual((found["year"], found["official"]), (1995, True))

    def test_many_older_recordings_fall_back_to_the_studio_filter(self):
        calls = []

        def search(query, limit=100):
            calls.append(query)
            if "firstreleasedate" in query and "TO 2016-12-31" in query:
                if "status:official" in query:
                    return [rec("Lied", "Band", "1986", "studio")], 3
                return [rec("Lied", "Band", "2003", "live", releases=[rel("2003", "Official", ["Live"])])], 500
            if "firstreleasedate" in query:
                return [], 0
            return [rec("Lied", "Band", "2017", "box")], 700

        found = T.lookup("Lied", ["Band"], search=search)
        self.assertEqual((found["year"], found["mbid"]), (1986, "studio"))

    def test_no_extra_request_when_all_results_seen(self):
        calls = []

        def search(query, limit=100):
            calls.append(query)
            return [rec("Prehistoric Dog", "Red Fang", "2007")], 1

        self.assertEqual(T.lookup("Prehistoric Dog", ["Red Fang"], search=search)["year"], 2007)
        self.assertEqual(len(calls), 1)

    def test_falls_back_and_reports_nothing(self):
        calls = []

        def search(query, limit=100):
            calls.append(query)
            return [], 0

        found = T.lookup('Vreemd "Lied" (Demo Take)', ["Niemand"], search=search)
        self.assertIsNone(found["year"])
        self.assertGreaterEqual(len(calls), 2)
        self.assertIn('\\"Lied\\"', calls[0])


class Decide(unittest.TestCase):
    track = {"id": "abc", "artists": ["Queen"], "title": "Bohemian Rhapsody - Remastered 2011", "spotify_date": "2011-01-01"}

    def test_musicbrainz_earlier_is_flagged_when_far_apart(self):
        r = T.decide(self.track, {"year": 1975, "mbid": "m", "method": "exact"}, None)
        self.assertEqual((r["year"], r["source"], r["title"]), (1975, "musicbrainz", "Bohemian Rhapsody"))
        self.assertTrue(any("verschillen meer dan een jaar" in x for x in r["reasons"]))

    def test_within_one_year_is_not_flagged(self):
        t = dict(self.track, spotify_date="1975-11-21")
        self.assertEqual(T.decide(t, {"year": 1975, "method": "exact"}, None)["reasons"], [])
        r = T.decide(t, {"year": 1976, "method": "exact"}, None)
        self.assertEqual((r["year"], r["source"], r["reasons"]), (1975, "spotify", []))

    def test_spotify_earlier_wins_and_is_flagged(self):
        t = dict(self.track, spotify_date="1975")
        r = T.decide(t, {"year": 1992, "method": "exact"}, None)
        self.assertEqual((r["year"], r["source"]), (1975, "spotify"))
        self.assertEqual(len(r["reasons"]), 1)

    def test_nothing_found_uses_spotify(self):
        r = T.decide(self.track, {"year": None}, None)
        self.assertEqual((r["year"], r["source"]), (2011, "spotify"))
        self.assertIn("MusicBrainz vond niets", r["reasons"][0])

    def test_no_year_at_all(self):
        r = T.decide(dict(self.track, spotify_date=None), None, None)
        self.assertIsNone(r["year"])
        self.assertEqual(r["source"], "onbekend")

    def test_unofficial_basis_is_flagged(self):
        t = dict(self.track, spotify_date="1975")
        r = T.decide(t, {"year": 1975, "method": "exact", "official": False}, None)
        self.assertTrue(any("onofficiële" in x for x in r["reasons"]))

    def test_correction_wins_and_clears_reasons(self):
        r = T.decide(self.track, {"year": 1980, "method": "ruim"}, {"year": 1975, "note": "single"})
        self.assertEqual((r["year"], r["source"], r["reasons"], r["note"]), (1975, "handmatig", [], "single"))


class Remix(unittest.TestCase):
    """Titels zoals Spotify en MusicBrainz ze echt schrijven (nagekeken in november 2026).
    Dezelfde gevallen als in tests/unit/years.test.js."""

    def test_only_explicit_remix_words_make_a_remix(self):
        remixes = {
            "A Little Less Conversation - JXL Radio Edit Remix": ("A Little Less Conversation", "JXL Radio Edit Remix"),
            "Brimful of Asha - Norman Cook Remix Single Version": ("Brimful of Asha", "Norman Cook Remix Single Version"),
            "Roses - Imanbek Remix": ("Roses", "Imanbek Remix"),
            "Roses (Imanbek Remix)": ("Roses", "Imanbek Remix"),
            "Ignition - Remix": ("Ignition", "Remix"),
            "Titel (feat. Y) [X Remix]": ("Titel", "X Remix"),
            "Titel - X Remix - Radio Edit": ("Titel", "X Remix"),
            "Titel - X Remix (feat. Y)": ("Titel", "X Remix"),
            "Titel (X Remix) - 2011 Remaster": ("Titel", "X Remix"),
            "Titel - X Rmx": ("Titel", "X Rmx"),
            "Titel - X Re-Work": ("Titel", "X Re-Work"),
            "Titel (X Bootleg)": ("Titel", "X Bootleg"),
            "Titel - Mash-Up": ("Titel", "Mash-Up"),
            "Titel - X Refix": ("Titel", "X Refix"),
            "Titel (Remixed by X)": ("Titel", "Remixed by X"),
        }
        for raw, want in remixes.items():
            self.assertEqual(T.remix_parts(raw), want, raw)
            self.assertTrue(T.is_remix(raw), raw)
        for title in [
            "Smalltown Boy - Extended Mix",
            "Blue Monday - Club Mix",
            "One More Time - Radio Edit",
            "Help! - 2009 Stereo Mix",
            "Heroes - Single Version",
            "Something - Remastered 2011",
            "Bohemian Rhapsody",
            "Remix",
            "Mixed Emotions",
            "Remix to Ignition",
        ]:
            self.assertFalse(T.is_remix(title), title)

    def test_clean_title_keeps_the_remix(self):
        self.assertEqual(T.clean_title("Roses - Imanbek Remix"), "Roses (Imanbek Remix)")
        self.assertEqual(T.clean_title("A Little Less Conversation - JXL Radio Edit Remix"), "A Little Less Conversation (JXL Radio Edit Remix)")
        self.assertEqual(T.clean_title("Titel (feat. Y) [X Remix]"), "Titel (X Remix)")
        self.assertEqual(T.clean_title("Smalltown Boy - Extended Mix"), "Smalltown Boy")
        self.assertEqual(T.clean_title("One More Time - Radio Edit"), "One More Time")
        self.assertTrue(T.is_live("Titel (X Remix) - Live"))
        self.assertFalse(T.is_live("Roses - Imanbek Remix"))

    def test_a_remix_only_matches_the_same_remix(self):
        jxl = T.clean_title("A Little Less Conversation - JXL Radio Edit Remix")
        self.assertTrue(T.title_matches("A Little Less Conversation (JXL radio edit remix)", jxl))
        self.assertTrue(T.title_matches("A Little Less Conversation [JXL radio edit remix]", jxl))
        self.assertTrue(T.title_matches("A Little Less Conversation (JXL remix)", jxl))
        self.assertFalse(T.title_matches("A Little Less Conversation", jxl))
        self.assertFalse(T.title_matches("A Little Less Conversation (vs JXL)", jxl))
        self.assertFalse(T.title_matches("A Little Less Conversation (JXL radio edit remix) (Elvis vs JXL)", jxl))

        asha = T.clean_title("Brimful of Asha - Norman Cook Remix Single Version")
        self.assertTrue(T.title_matches("Brimful of Asha (Norman Cook remix)", asha))
        self.assertTrue(T.title_matches("Brimful of Asha (The Norman Cook remix, single version)", asha))
        self.assertFalse(T.title_matches("Brimful of Asha (Norman Cook remix extended version)", asha))
        self.assertFalse(T.title_matches("Brimful of Asha (Norman Cook extended mix)", asha))
        self.assertFalse(T.title_matches("Brimful of Asha", asha))

        ignition = T.clean_title("Ignition - Remix")
        self.assertTrue(T.title_matches("Ignition (remix)", ignition))
        self.assertTrue(T.title_matches("Ignition - Remix", ignition))
        self.assertTrue(T.title_matches("Ignition (remix) (album version)", ignition))
        self.assertFalse(T.title_matches("Ignition (remix) (instrumental)", ignition))
        self.assertFalse(T.title_matches("Ignition (Slang Tech remix)", ignition))
        self.assertFalse(T.title_matches("Ignition", ignition))

        roses = T.clean_title("Roses (feat. Iemand) [Imanbek Remix]")
        self.assertTrue(T.title_matches("Roses (Imanbek remix)", roses))
        self.assertTrue(T.title_matches("Roses (Imanbek remix radio edit)", T.clean_title("Roses - Imanbek Remix - Radio Edit")))
        self.assertTrue(T.title_matches("Roses (Remix by Imanbek)", roses))
        self.assertFalse(T.title_matches("Roses (Andere remix)", roses))
        self.assertFalse(T.title_matches("Roses", roses))

        # Gewone nummers: zoals vroeger, ook als MusicBrainz een remix teruggeeft.
        self.assertTrue(T.title_matches("Smalltown Boy (extended mix)", T.clean_title("Smalltown Boy - Extended Mix")))
        self.assertTrue(T.title_matches("Roses (Imanbek remix)", "Roses"))

    def test_lookup_finds_the_remix_not_the_older_original(self):
        calls = []
        # Zoals bij MusicBrainz: "Elvis Presley vs. JXL" als twee credits.
        remix = rec("A Little Less Conversation (JXL radio edit remix)", "Elvis Presley", "2002-06-10", "remix")
        remix["artist-credit"] = [
            {"name": "Elvis Presley", "joinphrase": " vs. ", "artist": {"name": "Elvis Presley"}},
            {"name": "JXL", "artist": {"name": "Junkie XL"}},
        ]

        def search(query, limit=100):
            calls.append(query)
            return [
                rec("A Little Less Conversation", "Elvis Presley", "1968", "orig"),
                rec("A Little Less Conversation (JXL remix)", "Elvis Presley", "2007", "later"),
                remix,
            ], 3

        found = T.lookup("A Little Less Conversation - JXL Radio Edit Remix", ["Elvis Presley", "JXL"], search=search)
        self.assertEqual((found["year"], found["mbid"], found["method"]), (2002, "remix", "exact"))
        self.assertEqual(calls, ['recording:"A Little Less Conversation" AND recording:(jxl AND remix) AND artist:"Elvis Presley"'])

    def test_unknown_remix_gets_the_spotify_year_never_the_original(self):
        calls = []

        def search(query, limit=100):
            calls.append(query)
            return [rec("Roses", "SAINt JHN", "2016", "orig"), rec("Roses (Imanbek remix)", "SAINt JHN", "2019", "imanbek")], 2

        title = "Roses - Bestaat Niet Remix"
        mb = T.lookup(title, ["SAINt JHN"], search=search)
        self.assertIsNone(mb["year"])
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[1].startswith("recording:(Roses AND bestaat AND niet AND remix)"))

        track = {"id": "r", "artists": ["SAINt JHN"], "title": title, "spotify_date": "2021-03-01"}
        r = T.decide(track, mb, None)
        self.assertEqual((r["year"], r["source"], r["title"]), (2021, "spotify", "Roses (Bestaat Niet Remix)"))
        self.assertEqual(r["reasons"], ["remix die MusicBrainz niet kent; jaar van het Spotify-album gebruikt"])

        # Gevonden: zoals bij elk nummer het vroegste van de twee.
        found = T.decide(dict(track, title="Roses - Imanbek Remix", spotify_date="2020"), {"year": 2019, "method": "exact"}, None)
        self.assertEqual((found["year"], found["source"], found["reasons"]), (2019, "musicbrainz", []))

    def test_cache_key_only_changes_for_remixes(self):
        # Gewone nummers houden hun sleutel, zodat de cache niet weggegooid wordt;
        # remixes krijgen een nieuwe en worden dus opnieuw opgezocht.
        self.assertEqual(T._cache_key({"title": "Bohemian Rhapsody - Remastered 2011", "artists": ["Queen"]}), "v4|bohemian rhapsody|queen")
        self.assertEqual(T._cache_key({"title": "Smalltown Boy - Extended Mix", "artists": ["Bronski Beat"]}), "v4|smalltown boy|bronski beat")
        key = T._cache_key({"title": "Roses - Imanbek Remix", "artists": ["SAINt JHN"]})
        self.assertEqual(key, f"v4-remix{T.REMIX_RULES}|roses imanbek remix|saint jhn")


class Misc(unittest.TestCase):
    def test_playlist_id(self):
        pid = "0j9u5m5cCoc3Wnx8XsbjFa"
        self.assertEqual(T.playlist_id(f"https://open.spotify.com/playlist/{pid}?si=abc"), pid)
        self.assertEqual(T.playlist_id(f"spotify:playlist:{pid}"), pid)
        self.assertEqual(T.playlist_id(pid), pid)
        with self.assertRaises(SystemExit):
            T.playlist_id("geen link")

    def test_year_of(self):
        self.assertEqual(T.year_of("1984-07-27"), 1984)
        self.assertEqual(T.year_of("1984"), 1984)
        self.assertIsNone(T.year_of(""))
        self.assertIsNone(T.year_of(None))
        self.assertIsNone(T.year_of("0001"))


class Spotify(unittest.TestCase):
    """De Spotify-kant met een nagebootste Spotify: geen netwerk, geen browser."""

    def test_login_flow(self):
        import threading
        import urllib.parse
        import urllib.request
        from unittest import mock

        seen = {}

        def fake_browser(url):
            # Doet wat Spotify doet: stuurt de browser terug naar de redirect URI.
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            seen["authorize"] = q
            back = q["redirect_uri"][0] + "?" + urllib.parse.urlencode({"code": "de-code", "state": q["state"][0]})
            threading.Thread(target=lambda: urllib.request.urlopen(back, timeout=5).read(), daemon=True).start()
            return True

        def fake_token(url, headers=None, data=None, tries=5):
            seen["token_url"] = url
            seen["token"] = urllib.parse.parse_qs(data.decode())
            return {"access_token": "het-token"}

        with mock.patch.object(T.webbrowser, "open", fake_browser), mock.patch.object(T, "http_json", fake_token), mock.patch.object(T, "say", lambda *a: None):
            token = T.spotify_login("a" * 32, 8799)

        self.assertEqual(token, "het-token")
        auth = seen["authorize"]
        self.assertEqual(auth["redirect_uri"], ["http://127.0.0.1:8799/callback"])
        self.assertEqual(auth["response_type"], ["code"])
        self.assertEqual(auth["code_challenge_method"], ["S256"])
        self.assertIn("playlist-read-private", auth["scope"][0])
        sent = seen["token"]
        self.assertEqual(sent["grant_type"], ["authorization_code"])
        self.assertEqual(sent["code"], ["de-code"])
        self.assertEqual(sent["redirect_uri"], ["http://127.0.0.1:8799/callback"])
        self.assertNotIn("client_secret", sent)
        # De challenge hoort bij de verifier (PKCE, S256).
        import base64
        import hashlib

        digest = hashlib.sha256(sent["code_verifier"][0].encode()).digest()
        self.assertEqual(auth["code_challenge"], [base64.urlsafe_b64encode(digest).rstrip(b"=").decode()])

    def test_fetch_playlist_pages_and_new_field_names(self):
        from unittest import mock

        def track(i, **extra):
            return {
                "type": "track",
                "id": f"id{i}",
                "name": f"Titel {i}",
                "artists": [{"name": "Band"}, {"name": "Gast"}],
                "album": {"name": "Album", "release_date": "1999-05-01", "album_type": "album"},
                "external_ids": {"isrc": "X"},
                **extra,
            }

        pages = {
            1: {
                "items": [
                    {"item": track(1)},  # veldnaam sinds februari 2026
                    {"track": track(2)},  # oude veldnaam
                    {"item": None},
                    {"item": track(3), "is_local": True},
                    {"item": track(4, type="episode")},
                    {"item": track(1)},  # dubbel
                ],
                "next": "https://api.spotify.com/v1/playlists/PID/items?offset=50&limit=50",
            },
            2: {"items": [{"item": track(5)}], "next": None},
        }
        urls = []

        def fake(url, headers=None, data=None, tries=5):
            urls.append(url)
            self.assertEqual(headers["Authorization"], "Bearer tok")
            return pages[len(urls)]

        with mock.patch.object(T, "http_json", fake), mock.patch.object(T, "say", lambda *a: None):
            got = T.fetch_playlist("PID", "tok")
        self.assertIn("/v1/playlists/PID/items?", urls[0])
        self.assertIn("limit=50", urls[0])
        self.assertEqual([t["id"] for t in got], ["id1", "id2", "id5"])
        self.assertEqual(got[0]["artists"], ["Band", "Gast"])
        self.assertEqual(got[0]["spotify_date"], "1999-05-01")


if __name__ == "__main__":
    unittest.main()
