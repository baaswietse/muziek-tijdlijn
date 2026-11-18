"""Tests voor tools/deezer.py. Draaien zonder netwerk:  python -m unittest discover -s tools -p "test_*.py" """

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deezer as D  # noqa: E402


def hit(id, title, artist, rank=100, preview=True, album_id=1):
    return {"id": id, "title": title, "artist": artist, "album_id": album_id, "album": "A", "rank": rank, "preview": preview, "readable": True}


class VersionTier(unittest.TestCase):
    def tier(self, candidate, wanted, artists=("X",)):
        return D.version_tier(candidate, wanted, list(artists))

    def test_same_song_with_harmless_additions(self):
        self.assertEqual(self.tier("Go Your Own Way", "Go Your Own Way - 2004 Remaster"), 0)
        self.assertEqual(self.tier("Go Your Own Way (2004 Remaster)", "Go Your Own Way"), 0)
        self.assertEqual(self.tier("A Sky Full of Stars (Radio Edit)", "A Sky Full of Stars"), 0)
        self.assertEqual(self.tier("Barcelona (Single Version)", "Barcelona"), 0)
        self.assertEqual(self.tier("Sexy Bitch (feat. Akon)", "Sexy Bitch (feat. Akon)", ["David Guetta", "Akon"]), 0)

    def test_punctuation_does_not_matter(self):
        self.assertEqual(self.tier("Chop Suey", "Chop Suey!"), 0)
        self.assertEqual(self.tier("Party in the USA", "Party In The U.S.A."), 0)

    def test_other_recordings_are_refused(self):
        refused = [
            ("Mr. Brightside (Jacques Lu Cont's Thin White Duke Mix)", "Mr. Brightside"),
            ("Sultans of Swing (Live at Wembley Stadium, 13th July 1985)", "Sultans Of Swing"),
            ("Chasing Cars (Reworked)", "Chasing Cars"),
            ("The Man Who Can't Be Moved (Acoustic)", "The Man Who Can't Be Moved"),
            ("Sham Pain (2025 VERSION)", "Sham Pain"),
            ("Since U Been Gone (Juliet’s Version)", "Since U Been Gone"),
            ("Sexy Bitch (feat. Akon) (Sped Up Version)", "Sexy Bitch (feat. Akon)"),
            ("Zeil Je Voor Het Eerst (Remix)", "Zeil Je Voor Het Eerst"),
            ("Bye Bye Bye (Rock)", "Bye Bye Bye"),
            ("Something Else", "Bye Bye Bye"),
        ]
        for candidate, wanted in refused:
            with self.subTest(candidate=candidate):
                self.assertIsNone(self.tier(candidate, wanted))

    def test_asked_for_live_or_remix(self):
        self.assertEqual(self.tier("Pump It (Live 2022)", "Pump It - Live 2022"), 0)
        self.assertIsNone(self.tier("Pump It", "Pump It - Live 2022"))
        self.assertEqual(self.tier("Baddest Behaviour (Timmy Trumpet Remix)", "Baddest Behaviour - Timmy Trumpet Remix"), 0)
        self.assertIsNone(self.tier("Baddest Behaviour (Other Remix)", "Baddest Behaviour - Timmy Trumpet Remix"))

    def test_a_mix_is_second_choice(self):
        self.assertEqual(self.tier("Banger Hart (Radio Mix)", "Banger Hart"), 1)


class Pick(unittest.TestCase):
    def test_studio_before_live_then_rank(self):
        results = [
            hit(1, "Sultans of Swing (Live)", "Dire Straits", rank=900),
            hit(2, "Sultans of Swing", "Dire Straits", rank=300),
            hit(3, "Sultans of Swing (Remastered)", "Dire Straits", rank=500),
            hit(4, "Sultans of Swing", "Een Coverband", rank=999),
            hit(5, "Sultans of Swing", "Dire Straits", rank=800, preview=False),
        ]
        self.assertEqual(D.pick(results, "Dire Straits", "Sultans Of Swing")["id"], 3)

    def test_artist_variants(self):
        self.assertTrue(D.artist_ok("*NSYNC", ["*NSYNC"]))
        self.assertTrue(D.artist_ok("P!nk", ["P!nk"]))
        self.assertTrue(D.artist_ok("Macklemore & Ryan Lewis", ["Macklemore & Ryan Lewis", "Ray Dalton"]))
        self.assertTrue(D.artist_ok("Bruce Springsteen", ["Bruce Springsteen & The E Street Band"]))
        self.assertTrue(D.artist_ok("David Guetta", ["David Guetta", "Sia"]))
        self.assertFalse(D.artist_ok("Sia", ["David Guetta", "Sia"]))
        self.assertFalse(D.artist_ok("Freshman", ["*NSYNC"]))

    def test_queries_from_targeted_to_broad(self):
        q = D.queries("System Of A Down", "Chop Suey!")
        self.assertEqual(q[0], 'artist:"System Of A Down" track:"Chop Suey!"')
        self.assertIn('artist:"System Of A Down" track:"Chop Suey"', q)
        self.assertNotIn('track:"Chop Suey!"', q)  # zonder artist: zoekt Deezer niet op de titel
        q = D.queries("Rudimental, John Newman", "Feel The Love (feat. John Newman)")
        self.assertEqual(q[0], 'artist:"Rudimental" track:"Feel The Love"')


class Find(unittest.TestCase):
    def deezer(self, answers):
        calls = []

        def fetch(url):
            calls.append(url)
            for key, value in answers.items():
                if key in url:
                    return value
            return {"data": []}

        tmp = Path(tempfile.mkdtemp()) / "cache.json"
        return D.Deezer(cache_path=tmp, fetch=fetch), calls

    def test_falls_back_to_the_artists_top_tracks(self):
        raw = lambda id, title, artist: {"id": id, "title": title, "artist": {"name": artist}, "album": {"id": 9, "title": "A"}, "rank": 5, "preview": "https://p"}
        dz, calls = self.deezer({
            "search?": {"data": [raw(1, "NSYNC Bye Bye Bye", "Freshman")]},
            "search/artist": {"data": [{"id": 520, "name": "*NSYNC", "nb_fan": 300000}, {"id": 1, "name": "N Sync", "nb_fan": 1}]},
            "artist/520/top": {"data": [raw(42, "Bye Bye Bye", "*NSYNC")]},
        })
        found = D.find(dz, "*NSYNC", "Bye Bye Bye")
        self.assertEqual(found["id"], 42)
        self.assertTrue(any("artist/520/top" in c for c in calls))
        # Uit de cache: geen nieuwe verzoeken.
        n = len(calls)
        self.assertEqual(D.find(dz, "*NSYNC", "Bye Bye Bye")["id"], 42)
        self.assertEqual(len(calls), n)

    def test_stops_after_the_first_two_queries_when_found(self):
        raw = {"id": 7, "title": "Wuthering Heights", "artist": {"name": "Kate Bush"}, "album": {"id": 3}, "rank": 10, "preview": "https://p"}
        dz, calls = self.deezer({"search?": {"data": [raw]}})
        self.assertEqual(D.find(dz, "Kate Bush", "Wuthering Heights")["id"], 7)
        self.assertEqual(len(calls), 2)


class BuildLists(unittest.TestCase):
    def rows(self):
        out = []
        for i in range(40):
            out.append({"deezer": 1000 + i, "artist": f"Rock {i}", "title": f"R{i}", "year": 1990 + i % 20, "genres": ["Rock"], "rank": i})
        for i in range(30):
            out.append({"deezer": 2000 + i, "artist": f"Metal {i}", "title": f"M{i}", "year": 1985, "genres": ["Rock", "Metal"], "rank": i})
        out.append({"deezer": 3000, "artist": "Pop", "title": "P", "year": 2005, "genres": ["Pop", "Dance"], "rank": 1})
        out.append({"deezer": None, "artist": "Weg", "title": "W", "year": 2005, "genres": ["Pop"]})
        out.append({"deezer": 1000, "artist": "Rock 0", "title": "R0 dubbel", "year": 1990, "genres": ["Rock"]})
        return out

    def test_lists(self):
        data = D.build_lists(self.rows())
        lists = {x["id"]: [t for t in data["tracks"] if x["id"] in t["lists"]] for x in data["lists"]}
        self.assertEqual(len(lists["alles"]), 71)
        self.assertEqual([t["deezer"] for t in lists["pop"]], [3000])
        self.assertEqual([t["deezer"] for t in lists["dance"]], [3000])
        self.assertEqual({t["deezer"] for t in lists["2000"]}, {t["deezer"] for t in lists["alles"] if t["year"] >= 2000})
        rock = lists["rock"]
        heavy = [t for t in rock if t["deezer"] >= 2000]
        self.assertEqual(len(rock), 50)  # 40 rock + 10 metal: een vijfde
        self.assertLessEqual(len(heavy) / len(rock), 0.2)
        # De bekendste metalnummers (hoogste rank) gaan mee: herhaalbaar.
        self.assertEqual(sorted(t["deezer"] for t in heavy), list(range(2020, 2030)))
        self.assertEqual(D.build_lists(self.rows()), data)
        self.assertEqual(lists["nl"], [])

    def test_hand_made_lists_stay(self):
        previous = {"tracks": [{"deezer": 3000, "lists": ["alles", "nl", "rustig"]}]}
        data = D.build_lists(self.rows(), previous)
        pop = next(t for t in data["tracks"] if t["deezer"] == 3000)
        self.assertEqual(pop["lists"], ["alles", "2000", "pop", "dance", "nl", "rustig"])


if __name__ == "__main__":
    unittest.main()
