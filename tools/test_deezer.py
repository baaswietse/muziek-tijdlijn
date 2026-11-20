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

    def test_a_mix_is_last_choice(self):
        self.assertEqual(self.tier("Banger Hart (Radio Mix)", "Banger Hart"), D.TIER_MIX)

    def test_guest_artists_and_soundtracks(self):
        # Een gast die niet gevraagd was: hetzelfde nummer, maar tweede keus.
        self.assertEqual(self.tier("Uptown Funk (feat. Bruno Mars)", "Uptown Funk", ["Mark Ronson"]), D.TIER_GUEST)
        self.assertEqual(self.tier("Crazy In Love (feat. JAŸ-Z)", "Crazy in Love", ["Beyoncé"]), D.TIER_GUEST)
        self.assertEqual(self.tier("Thrift Shop (feat. Wanz)", "Thrift Shop", ["Macklemore & Ryan Lewis"]), D.TIER_GUEST)
        self.assertEqual(self.tier("Havana (with Young Thug)", "Havana", ["Camila Cabello"]), D.TIER_GUEST)
        self.assertEqual(self.tier("Now You're Gone (feat. DJ Mental Theo's Bazzheadz) (Radio Edit)", "Now You're Gone", ["Basshunter"]), D.TIER_GUEST)
        # Een gevraagde gast: gewoon hetzelfde nummer.
        self.assertEqual(self.tier("Uptown Funk (feat. Bruno Mars)", "Uptown Funk", ["Mark Ronson", "Bruno Mars"]), D.TIER_SAME)
        # De film of musical waaruit het komt: alleen als er niets zonder is.
        self.assertEqual(self.tier('Happy (From "Despicable Me 2")', "Happy"), D.TIER_FROM)
        self.assertEqual(self.tier('Night Fever (From "Saturday Night Fever" Soundtrack)', "Night Fever"), D.TIER_FROM)
        self.assertEqual(self.tier('Let It Go (From "Frozen"/Soundtrack Version)', "Let It Go"), D.TIER_FROM)
        self.assertEqual(self.tier("You're The One That I Want (From “Grease”)", "You're the One That I Want"), D.TIER_FROM)
        self.assertEqual(
            self.tier('CAN\'T STOP THE FEELING! (Original Song from DreamWorks Animation\'s "TROLLS")', "Can't Stop the Feeling!"),
            D.TIER_FROM,
        )
        # Ook in de gevraagde titel.
        self.assertEqual(
            self.tier('It Must Have Been Love (From the Film "Pretty Woman")', 'It Must Have Been Love - From the Film "Pretty Woman"'),
            D.TIER_FROM,
        )
        self.assertEqual(self.tier("It Must Have Been Love", 'It Must Have Been Love - From the Film "Pretty Woman"'), D.TIER_SAME)
        # Een jaartal naast de film: een nieuwe opname.
        self.assertIsNone(self.tier('Reflection (2020) (From "Mulan")', "Reflection"))
        self.assertEqual(self.tier('Happy (From "Despicable Me 2") (2014 Remaster)', "Happy"), D.TIER_FROM)
        # Anders geschreven of een onschuldige toevoeging.
        self.assertEqual(self.tier("2 Wicky", "2Wicky"), D.TIER_SAME)
        self.assertEqual(self.tier("Blue (Da Ba Dee) (Video Edit)", "Blue (Da Ba Dee)"), D.TIER_SAME)
        self.assertEqual(self.tier("Cotton Eye Joe (Mastered 1994)", "Cotton Eye Joe"), D.TIER_SAME)
        self.assertEqual(self.tier("Mickey (Original Recording Remastered)", "Mickey"), D.TIER_SAME)
        self.assertEqual(self.tier("Zij Weet Het (Studio Versie)", "Zij weet het"), D.TIER_SAME)

    def test_still_other_recordings(self):
        refused = [
            ('Let It Go (From "Frozen"/Papercha$er Club Remix)', "Let It Go"),
            ("Uptown Funk (feat. Bruno Mars) (Will Sparks Remix)", "Uptown Funk"),
            ("Jerusalema (feat. Burna Boy & Nomcebo Zikode) (Remix)", "Jerusalema"),
            ("Crazy In Love (Homecoming Live)", "Crazy in Love"),
            ("867-5309 / Jenny (Re-Recorded Version)", "867-5309/Jenny"),
            ("Push It (Re-Recorded) [Remastered]", "Push It"),
            ("Mickey (Spanish Version)", "Mickey"),
            ("Pop Muzik (12 Inch Version)", "Pop Muzik"),
            ("Headhunter (Front Line Assembly)", "Headhunter"),
            ("Happy (In the Style of Pharrell Williams) [Karaoke Instrumental Version]", "Happy"),
            ("Bailando (feat. Sean Paul, Descemer Bueno & Gente de Zona) (English Version)", "Bailando"),
        ]
        for candidate, wanted in refused:
            with self.subTest(candidate=candidate):
                self.assertIsNone(self.tier(candidate, wanted))


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

    def test_without_guest_before_with_guest(self):
        results = [
            hit(1, "Despacito (feat. Justin Bieber)", "Luis Fonsi", rank=990),
            hit(2, "Despacito (feat. Daddy Yankee)", "Luis Fonsi", rank=900),
            hit(3, "Despacito", "Luis Fonsi", rank=500),
        ]
        self.assertEqual(D.pick(results, "Luis Fonsi, Daddy Yankee", "Despacito")["id"], 2)
        self.assertEqual(D.pick(results[:2], "Luis Fonsi", "Despacito")["id"], 1)
        self.assertEqual(D.pick(results, "Luis Fonsi", "Despacito")["id"], 3)

    def test_artist_variants(self):
        self.assertTrue(D.artist_ok("*NSYNC", ["*NSYNC"]))
        self.assertTrue(D.artist_ok("P!nk", ["P!nk"]))
        self.assertTrue(D.artist_ok("Macklemore & Ryan Lewis", ["Macklemore & Ryan Lewis", "Ray Dalton"]))
        self.assertTrue(D.artist_ok("Bruce Springsteen", ["Bruce Springsteen & The E Street Band"]))
        self.assertTrue(D.artist_ok("David Guetta", ["David Guetta", "Sia"]))
        self.assertFalse(D.artist_ok("Sia", ["David Guetta", "Sia"]))
        self.assertFalse(D.artist_ok("Freshman", ["*NSYNC"]))
        self.assertTrue(D.artist_ok("Machine Gun Kelly", ["mgk", "Kid Rock"]))
        self.assertTrue(D.artist_ok("Diddy", ["Puff Daddy"]))
        self.assertTrue(D.artist_ok("Auli'i Cravalho", ["Auliʻi Cravalho"]))

    def test_queries_from_targeted_to_broad(self):
        q = D.queries("System Of A Down", "Chop Suey!")
        self.assertEqual(q, ["System Of A Down Chop Suey!", "Chop Suey!", "System Of A Down Chop Suey", "Chop Suey"])
        q = D.queries("Rudimental, John Newman", "Feel The Love (feat. John Newman)")
        self.assertEqual(q[0], "Rudimental Feel The Love")
        self.assertIn("Black Eyed Peas Pump It live", D.queries("Black Eyed Peas", "Pump It - Live 2022"))


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

    def test_stops_after_the_first_query_that_finds_it(self):
        raw = {"id": 7, "title": "Wuthering Heights", "artist": {"name": "Kate Bush"}, "album": {"id": 3}, "rank": 10, "preview": "https://p"}
        dz, calls = self.deezer({"search?": {"data": [raw]}})
        self.assertEqual(D.find(dz, "Kate Bush", "Wuthering Heights")["id"], 7)
        self.assertEqual(len(calls), 1)


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
        previous = {"tracks": [{"deezer": 3000, "lists": ["alles", "nl", "rustig", "feest"]}]}
        data = D.build_lists(self.rows(), previous)
        pop = next(t for t in data["tracks"] if t["deezer"] == 3000)
        self.assertEqual(pop["lists"], ["alles", "2000", "pop", "dance", "nl", "rustig", "feest"])

    def test_hand_added_tracks_and_lists_stay(self):
        """Een tweede run van `lijsten` wist niets van wat met de hand in het bestand kwam."""
        previous = {
            "lists": [{"id": "alles", "name": "Alle hits", "main": True}, {"id": "eigen", "name": "Eigen lijst"}],
            "tracks": [
                {"deezer": 5001, "artist": "Hand", "title": "Ballade", "year": 2010, "lists": ["alles", "2000", "pop", "rustig"]},
                {"deezer": 5002, "artist": "Bumba", "title": "Bumba", "year": 2004, "lists": ["kind"]},
                {"deezer": 5003, "artist": "Pharrell Williams", "title": "Happy", "year": 2013, "lists": ["alles", "2000", "feest", "kind"]},
                {"deezer": 5004, "artist": "Eigen", "title": "Nummer", "year": 1999, "lists": ["eigen"]},
                {"deezer": 5005, "artist": "Weg", "title": "Uit de oude invoer", "year": 1990, "lists": ["alles", "rock"]},
            ],
        }
        data = D.build_lists(self.rows(), previous)
        ids = [x["id"] for x in data["lists"]]
        self.assertEqual(ids[: len(D.LIJSTEN)], [x["id"] for x in D.LIJSTEN])
        self.assertEqual(ids[-1], "eigen")
        self.assertEqual(data["lists"][0], {"id": "alles", "name": "Alle hits", "main": True})
        by = {t["deezer"]: t for t in data["tracks"]}
        self.assertEqual(by[5001], {"deezer": 5001, "artist": "Hand", "title": "Ballade", "year": 2010, "lists": ["alles", "2000", "pop", "rustig"]})
        # Alleen in Kinderen en tekenfilms: niet in Alle hits of 2000 tot nu.
        self.assertEqual(by[5002]["lists"], ["kind"])
        self.assertEqual(by[5003]["lists"], ["alles", "2000", "feest", "kind"])
        self.assertEqual(by[5004]["lists"], ["alles", "eigen"])
        # Een nummer zonder lijst die je zelf vult en niet in de invoer: weg, zoals voordien.
        self.assertNotIn(5005, by)
        # Nog een run op het resultaat verandert niets.
        self.assertEqual(D.build_lists(self.rows(), data), data)


if __name__ == "__main__":
    unittest.main()
