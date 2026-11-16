"""Tests voor tools/tracks.py. Draaien zonder netwerk:  python -m unittest discover -s tools -p "test_*.py" """

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tracks as T  # noqa: E402


def rec(title, artist, first, mbid="x", aliases=()):
    return {
        "id": mbid,
        "title": title,
        "first-release-date": first,
        "artist-credit": [{"name": artist, "artist": {"name": artist, "aliases": [{"name": a} for a in aliases]}}],
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

    def test_nothing(self):
        self.assertIsNone(T.pick_year([rec("A", "B", "1990")], "C", ["D"]))


class Lookup(unittest.TestCase):
    def test_descends_to_older_recordings(self):
        calls = []

        def search(query, limit=100):
            calls.append(query)
            if "firstreleasedate" not in query:
                return [rec("Whole Lotta Love", "Led Zeppelin", "1970", "p1")], 600
            if "TO 1969-12-31" in query:
                return [rec("Whole Lotta Love", "Led Zeppelin", "1969-10-22", "orig")], 2
            return [], 0

        found = T.lookup("Whole Lotta Love - 1990 Remaster", ["Led Zeppelin"], search=search)
        self.assertEqual(found["year"], 1969)
        self.assertEqual(found["method"], "exact")
        self.assertEqual(len(calls), 3)
        self.assertIn('recording:"Whole Lotta Love"', calls[0])
        self.assertIn("TO 1968-12-31", calls[2])

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

    def test_correction_wins_and_clears_reasons(self):
        r = T.decide(self.track, {"year": 1980, "method": "ruim"}, {"year": 1975, "note": "single"})
        self.assertEqual((r["year"], r["source"], r["reasons"], r["note"]), (1975, "handmatig", [], "single"))


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


if __name__ == "__main__":
    unittest.main()
