"""Tests voor tools/tracks.py. Draaien zonder netwerk:  python -m unittest discover -s tools -p "test_*.py" """

import re
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


def index(recordings, calls, limit=100):
    """Een nagebootste MusicBrainz die zich gedraagt als de echte: de filters op
    eerste release en studio-uitgave werken, en er komen hoogstens `limit`
    opnames per pagina terug, met het totale aantal treffers."""

    def types(r):
        return [t.lower() for x in r["releases"] for t in x["release-group"]["secondary-types"]]

    def search(query, limit_=100):
        calls.append(query)
        found = recordings
        to = re.search(r"firstreleasedate:\[1900-01-01 TO (\d{4})-12-31\]", query)
        if to:
            found = [r for r in found if T.year_of(r["first-release-date"]) and T.year_of(r["first-release-date"]) <= int(to.group(1))]
        if "status:official" in query:
            # Zoals bij MusicBrainz telt dit per opname: één live-uitgave sluit ze al uit.
            found = [
                r for r in found
                if any(x["status"] == "Official" for x in r["releases"]) and not {"live", "demo"} & set(types(r))
            ]
        return found[:limit], len(found)

    return search


def lives(title, artist, n, first, last):
    """`n` live-opnames van een nummer, tussen `first` en `last`."""
    out = []
    for i in range(n):
        year = str(first + i % (last - first + 1))
        out.append(rec(title, artist, year, f"live{i}", releases=[rel(year, "Official", ["Live"])]))
    return out


def relx(date, title, secondary=(), status="Official"):
    """Een uitgave met titel (en dus een eigen release group) en id."""
    return {"id": f"{title}|{date}", "title": title, "date": date, "status": status,
            "release-group": {"id": f"rg-{title}", "primary-type": "Album", "secondary-types": list(secondary)}}


class TooEarly(unittest.TestCase):
    """Echte gevallen uit een playlist (november 2026); dezelfde als in tests/unit/years.test.js."""

    def test_a_single_misdated_compilation_does_not_count(self):
        radar = rec("Radar Love", "Golden Earring", "1971", "radar", releases=[
            relx("1971", "The Best of Golden Earring", ["Compilation"]), relx("1973", "Radar Love"),
            relx("1973-06", "Radar Love / The Song Is Over"), relx("1976", "Golden Earring", ["Compilation"])])
        found = T.pick_year([radar], "Radar Love", ["Golden Earring"])
        self.assertEqual((found["year"], found["raw"], found["official"]), (1973, 1971, True))
        weekend = rec("Weekend (radio edit)", "Scooter", "2001", "wk", releases=[
            relx("2001", "Mädchen Soft+Crazy", ["Compilation"]), relx("2002-08-08", "Pepsi: More Music 2", ["Compilation"]),
            relx("2003", "Weekend!"), relx("2003", "NOW 8", ["Compilation"])])
        self.assertEqual(T.pick_year([weekend], "Weekend!", ["Scooter"])["year"], 2003)
        alive = [
            rec("I'm Alive", "Céline Dion", "2000", "c2000", releases=[relx("2000", "2000 Collection", ["Compilation"])]),
            rec("I’m Alive", "Céline Dion", "2002", "single", releases=[relx("2002", "I'm Alive")]),
        ]
        found = T.pick_year(alive, "I'm Alive", ["Céline Dion"])
        self.assertEqual((found["year"], found["mbid"]), (2002, "single"))

    def test_two_different_compilations_in_one_year_do_count(self):
        ongewoon = rec("Ongewoon", "Pommelien Thijs", "2022-06-10", "o", releases=[
            relx("2022-06-10", "MNM Big Hits Summer 2022", ["Compilation"]), relx("2022-08-26", "Tien om te zien 2022", ["Compilation"]),
            relx("2023-06-23", "Per ongeluk")])
        self.assertEqual(T.pick_year([ongewoon], "Ongewoon", ["Pommelien Thijs"])["year"], 2022)

    def test_remix_live_instrumental_and_karaoke_versions_do_not_count(self):
        karaoke = rec("Shape of You", "Ed Sheeran", "2016", "karaoke", releases=[relx("2016", "Karaoke Hits")])
        karaoke["disambiguation"] = "karaoke version"
        recs = [
            rec("Shape of You (DJ Inko remix)", "Ed Sheeran", "2015-01-30", "inko", releases=[relx("2015-01-30", "Various Tracks")]),
            rec("Shape of You (live at Taratata)", "Ed Sheeran", "2016", "live", releases=[relx("2016", "Divide Collector")]),
            rec("Shape of You (instrumental)", "Ed Sheeran", "2016", "instr", releases=[relx("2016", "Shape of You instr")]),
            karaoke,
            rec("Shape of You", "Ed Sheeran", "2017-01-06", "orig", releases=[relx("2017-01-06", "Shape of You"), relx("2017-03-03", "÷")]),
        ]
        found = T.pick_year(recs, "Shape of You", ["Ed Sheeran"])
        self.assertEqual((found["year"], found["mbid"]), (2017, "orig"))
        self.assertTrue(T.other_version(recs[0], "Shape of You"))
        self.assertFalse(T.other_version(recs[4], "Shape of You"))
        live = T.pick_year(recs, "Shape of You", ["Ed Sheeran"], live=True)
        self.assertEqual((live["year"], live["mbid"]), (2016, "live"))

    def test_a_lone_earliest_release_gives_a_candidate(self):
        slim = rec("The Real Slim Shady", "Eminem", "1999-12-31", "s", releases=[
            relx("1999-12-31", "The Way I Am"), relx("2000", "The Marshall Mathers LP"), relx("2000", "The Real Slim Shady"),
            relx("2000-05", "VIVA Summer Hits", ["Compilation"])])
        found = T.pick_year([slim], "The Real Slim Shady", ["Eminem"])
        self.assertEqual((found["year"], found["count"], found["next"]), (1999, 1, 2000))
        hey = rec("Hey Jude", "The Beatles", "1968", "h", releases=[relx("1968", "Hey Jude"), relx("1968-08-26", "Hey Jude US"), relx("1970", "Hey Jude LP")])
        self.assertNotIn("next", T.pick_year([hey], "Hey Jude", ["The Beatles"]))

    def test_spotify_equal_to_the_raw_earliest_year(self):
        mb = {"year": 2009, "raw": 2008, "count": 4, "official": True, "method": "exact"}
        r = T.decide({"id": "x", "title": "Sweet Goodbyes", "spotify_date": "2008-11-06"}, mb, None)
        self.assertEqual((r["year"], r["source"], r["reasons"]), (2008, "musicbrainz", []))

    def test_own_best_of_does_not_count_when_wikidata_says_the_later_year(self):
        # Islands in the Stream: fout gedateerde "Greatest Hits" bij Spotify (1982), MusicBrainz en Wikidata 1983.
        islands = {"year": 1983, "raw": 1982, "count": 12, "official": True, "method": "exact"}
        r = T.decide({"id": "x", "title": "Islands in the Stream", "spotify_date": "1982"}, islands, None, {"year": 1983})
        self.assertEqual((r["year"], r["source"], r["reasons"]), (1983, "musicbrainz", []))
        # Zonder Wikidata, als Wikidata niets kent of zelf het vroege jaar zegt: de regel blijft gelden.
        mb = {"year": 2009, "raw": 2008, "count": 4, "official": True, "method": "exact"}
        t = {"id": "x", "title": "Sweet Goodbyes", "spotify_date": "2008-11-06"}
        self.assertEqual(T.decide(t, mb, None)["year"], 2008)
        self.assertEqual(T.decide(t, mb, None, {"year": None})["year"], 2008)
        self.assertEqual(T.decide(t, mb, None, {"year": 2008})["year"], 2008)


def wdrow(q, labels, performers, dates, types="Q134556"):
    """Een rij zoals de zoekdienst van Wikidata ze teruggeeft (na wd_search)."""
    labels = labels if isinstance(labels, list) else [labels]
    performers = performers if isinstance(performers, list) else [performers]
    dates = dates if isinstance(dates, list) else [dates]
    return {"q": q, "item": "x", "labels": "\u001f".join(labels), "performers": "\u001f".join(performers),
            "dates": " ".join(f"{d}-01-01T00:00:00Z" for d in dates if d), "types": types}


class Wikidata(unittest.TestCase):
    """Dezelfde gevallen als tests/unit/wikidata.test.js."""

    def test_title_and_useful(self):
        self.assertEqual(T.wd_title("Hips Don’t Lie (feat. Wyclef Jean)"), "hips don't lie")
        self.assertEqual(T.wd_title("Roses - Imanbek Remix"), "roses")
        self.assertTrue(T.wd_useful("Hotel California - 2013 Remaster"))
        for title in ["Roses - Imanbek Remix", "Pump It - Live 2022", "Love Story (Taylor’s Version)"]:
            self.assertFalse(T.wd_useful(title), title)

    def test_searches_also_without_parentheses(self):
        self.assertEqual(T.wd_searches("Heaven Must Be Missing an Angel (Pt. 1)"),
                         ["heaven must be missing an angel (pt. 1)", "heaven must be missing an angel"])
        self.assertEqual(T.wd_searches("Radar Love"), ["radar love"])
        rows = [wdrow("heaven must be missing an angel", "Heaven Must Be Missing an Angel", "Tavares", ["1976-05", "1986-02"])]
        self.assertEqual(T.wd_pick({"title": "Heaven Must Be Missing an Angel (Pt. 1)", "artists": ["Tavares"]}, rows)["year"], 1976)

    def test_query(self):
        q = T.wd_query(["radar love", 'een "lied" \\ met tekens'])
        self.assertIn('VALUES ?q { "radar love" "een \\"lied\\" \\\\ met tekens" }', q)
        self.assertIn("wdt:P577", q)

    def test_pick(self):
        rows = [
            wdrow("radar love", "Radar Love", "Golden Earring", ["1973-07", "1974"]),
            wdrow("radar love", "Radar Love", "Golden Earring", "1971", "Q482994"),
            wdrow("radar love", "Radar Love", "Golden Earring", "1970", "Q193977"),
            wdrow("radar love", "Radar Love", "White Lion", "1989"),
            wdrow("radar love", "Radar Love (Live)", "Golden Earring", "1960"),
            wdrow("radar love", "Radar Love", "Golden Earring", "1972", "Q482994 Q134556"),
            wdrow("iets anders", "Radar Love", "Golden Earring", "1950"),
        ]
        self.assertEqual(T.wd_pick({"title": "Radar Love", "artists": ["Golden Earring"]}, rows), {"year": 1972, "items": 2})
        self.assertEqual(T.wd_pick({"title": "Radar Love", "artists": ["Iemand"]}, rows), {"year": None, "items": 0})
        ch = [wdrow("cowboy", "Cowboy", ["Ch!pz", "Chipz"], "2003")]
        self.assertEqual(T.wd_pick({"title": "Cowboy - Single Version", "artists": ["Gast", "Chipz"]}, ch)["year"], 2003)

    def test_lookup_in_batches_and_stops_on_failure(self):
        tracks = [{"id": f"t{i}", "title": f"Lied {i}", "artists": ["Band"]} for i in range(30)]
        tracks += [{"id": "remix", "title": "Lied 1 - X Remix", "artists": ["Band"]}]
        asked = []

        def search(titles):
            asked.append(titles)
            return [wdrow(t, t, "Band", "1990") for t in titles]

        out = T.wd_lookup(tracks, search=search)
        self.assertEqual([len(a) for a in asked], [25, 5])
        self.assertEqual(out["t0"]["year"], 1990)
        self.assertNotIn("remix", out)

        calls = []

        def flaky(titles):
            calls.append(titles)
            if len(calls) > 1:
                raise RuntimeError("weg")
            return search(titles)

        self.assertEqual(len(T.wd_lookup(tracks, search=flaky)), 25)


class DecideThreeSources(unittest.TestCase):
    """Beslissen met drie bronnen; dezelfde gevallen als tests/unit/wikidata.test.js."""

    @staticmethod
    def pick(title, s, mb, w="geen"):
        track = {"id": "x", "title": title, "spotify_date": str(s) if s else None}
        r = T.decide(track, mb, None, None if w == "geen" else {"year": w})
        return r["year"], r["source"], len(r["reasons"])

    @staticmethod
    def mb(year, **extra):
        return {"year": year, "official": True, "method": "exact", "raw": year, "count": 5, **extra}

    def test_two_sources_agree_and_wikidata_breaks_ties(self):
        mb = self.mb
        self.assertEqual(self.pick("Paint It, Black", 1966, mb(1964, count=1, next=1966), 1966), (1966, "musicbrainz", 0))
        self.assertEqual(self.pick("Radar Love", 1973, mb(1971, count=1), 1973), (1973, "spotify", 0))
        self.assertEqual(self.pick("Smoke on the Water", 1998, mb(1972), 1973), (1972, "musicbrainz", 0))
        self.assertEqual(self.pick("Sebastian", 1999, mb(1987, count=3), 1973), (1973, "wikidata", 1))
        self.assertEqual(self.pick("Tim", 1998, mb(1975, count=1), None), (1975, "musicbrainz", 1))
        self.assertEqual(self.pick("Insomnia", 2014, mb(1995, count=6), 2005), (1995, "musicbrainz", 0))
        self.assertEqual(self.pick("Insomnia", 2014, mb(1995, count=6)), (1995, "musicbrainz", 0))

    def test_one_year_apart_is_not_automatically_agreement(self):
        mb = self.mb
        self.assertEqual(self.pick("I Gotta Feeling", 2009, mb(2008, count=1, next=2009), 2009), (2009, "musicbrainz", 0))
        self.assertEqual(self.pick("The Real Slim Shady", 2000, mb(1999, count=1, next=2000), 2000), (2000, "musicbrainz", 0))
        self.assertEqual(self.pick("Go Your Own Way", 1977, mb(1976, count=1, next=1977), 1976), (1976, "musicbrainz", 0))
        self.assertEqual(self.pick("Jolene", 1974, mb(1973, count=1, next=1974)), (1973, "musicbrainz", 0))
        self.assertEqual(self.pick("Beat It", 1982, mb(1982, count=12), 1983), (1982, "musicbrainz", 0))
        self.assertEqual(self.pick("Lied", 2008, mb(2009), 2009), (2009, "musicbrainz", 0))

    def test_remix_live_and_rerecording_ignore_wikidata(self):
        r = T.decide({"id": "x", "title": "Roses - Imanbek Remix", "spotify_date": "2019"}, {"year": None}, None, {"year": 2016})
        self.assertEqual((r["year"], r["source"], r["wd_asked"]), (2019, "spotify", False))
        self.assertEqual(self.pick("Pump It - Live 2022", 2023, self.mb(2023), 2021), (2023, "musicbrainz", 0))

    def test_musicbrainz_found_nothing(self):
        self.assertEqual(self.pick("Cowboy - Single Version", 2005, {"year": None}, 2003), (2003, "wikidata", 1))
        self.assertEqual(self.pick("Lied", 2004, {"year": None}, 2004), (2004, "spotify", 0))
        self.assertEqual(self.pick("Lied", None, {"year": None}, 2004), (2004, "wikidata", 1))
        self.assertEqual(self.pick("Aerials", None, self.mb(2001, count=1, next=2002), 2002), (2001, "musicbrainz", 0))


class Lookup(unittest.TestCase):
    def test_descends_to_older_recordings(self):
        calls = []
        # Het origineel staat ook op een live-compilatie: de studio-filter sluit
        # het uit, alleen de zoekopdracht zonder filter vindt het.
        orig = rec(
            "Whole Lotta Love", "Led Zeppelin", "1969-10-22", "orig",
            releases=[rel("1969-10-22"), rel("1975", "Official", ["Compilation", "Live"])],
        )
        search = index(
            [rec("Whole Lotta Love", "Led Zeppelin", "1970", "p1"), *lives("Whole Lotta Love", "Led Zeppelin", 150, 1971, 2010), orig],
            calls,
        )
        found = T.lookup("Whole Lotta Love - 1990 Remaster", ["Led Zeppelin"], search=search)
        self.assertEqual((found["year"], found["mbid"], found["official"]), (1969, "orig", True))
        self.assertEqual(found["method"], "exact")
        self.assertNotIn("_rank", found)
        # Al een officiële uitgave op de eerste pagina (1970): meteen de oudere
        # opnames vragen. Die pagina is volledig, dus vroeger dan 1969 kan er
        # niets meer zijn.
        self.assertEqual(len(calls), 2)
        self.assertIn('recording:"Whole Lotta Love"', calls[0])
        self.assertNotIn("status:official", calls[0])
        self.assertIn("TO 1969-12-31", calls[1])
        self.assertNotIn("status:official", calls[1])

    def test_official_on_first_page_and_a_complete_page_of_older_recordings(self):
        calls = []
        search = index(
            [
                rec("Lied", "Band", "2001", "heruitgave"),
                *lives("Lied", "Band", 120, 1990, 2020),
                rec("Lied", "Band", "1975", "orig"),
                rec("Lied", "Band", "1972", "boot", releases=[rel("1972", "Bootleg")]),
            ],
            calls,
        )
        # Vroeger 3 verzoeken: eerste pagina, studio-filter, ouder dan 1975.
        found = T.lookup("Lied", ["Band"], search=search)
        self.assertEqual((found["year"], found["mbid"], found["official"]), (1975, "orig", True))
        self.assertEqual(len(calls), 2)
        self.assertIn("TO 2000-12-31", calls[1])

    def test_official_year_after_the_seen_years_is_still_checked(self):
        # Een bootleg uit 1975 op de eerste pagina; een opname die eerst als
        # bootleg (1970) en pas in 1980 officieel uitkwam; en een die in 1977
        # officieel uitkwam. Beide staan ook op een live-album: de studio-filter mist ze.
        calls = []
        search = index(
            [
                rec("Lied", "Band", "1975", "boot75", releases=[rel("1975", "Bootleg")]),
                *lives("Lied", "Band", 150, 1990, 2020),
                rec("Lied", "Band", "1970", "laat", releases=[rel("1970", "Bootleg"), rel("1980", "Official", ["Compilation"]), rel("1985", "Official", ["Live"])]),
                rec("Lied", "Band", "1977", "orig", releases=[rel("1977"), rel("1990", "Official", ["Live"])]),
            ],
            calls,
        )
        found = T.lookup("Lied", ["Band"], search=search)
        # Officieel gaat voor op onofficieel; alle opnames vóór 1980 zijn bekeken: 1977.
        self.assertEqual((found["year"], found["mbid"], found["official"]), (1977, "orig", True))
        self.assertTrue(any("TO 1979-12-31" in q for q in calls))

    def test_older_bootlegs_do_not_replace_an_official_release(self):
        def search(query, limit=100):
            if "firstreleasedate" not in query:
                return [rec("Back in Black", "AC/DC", "1980-07-25", "studio")], 300
            return [rec("Back in Black", "AC/DC", "1978", "boot", releases=[rel("1978", "Bootleg", ["Live"])])], 1

        found = T.lookup("Back In Black", ["AC/DC"], search=search)
        self.assertEqual((found["year"], found["mbid"]), (1980, "studio"))

    def test_studio_recording_missing_from_first_page(self):
        # Zoals "Master of Puppets": honderden opnames, de eerste honderd zijn
        # allemaal live of heruitgaven, en ook vóór 2017 zijn er te veel om te
        # overzien. Alleen de studio-filter vindt het origineel.
        calls = []
        search = index(
            [
                rec("Master of Puppets", "Metallica", "2017-11-10", "box"),
                rec("Master of Puppets", "Metallica", "2003", "live", releases=[rel("2003", "Official", ["Live"])]),
                *lives("Master of Puppets", "Metallica", 300, 1987, 2016),
                rec("Master of Puppets", "Metallica", "1986", "studio"),
            ],
            calls,
        )
        found = T.lookup("Master Of Puppets", ["Metallica"], search=search)
        self.assertEqual((found["year"], found["mbid"], found["official"]), (1986, "studio", True))
        self.assertTrue(any("NOT secondarytype:live" in q and "TO 2016-12-31" in q for q in calls))

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

    def test_unofficial_basis_is_flagged_only_with_a_real_doubt(self):
        # Alleen onofficiële uitgaven of een ruime zoekopdracht zijn alleen nog een
        # reden om na te kijken als de bronnen het oneens zijn.
        t = dict(self.track, spotify_date="1975")
        self.assertEqual(T.decide(t, {"year": 1975, "method": "ruim", "official": False}, None)["reasons"], [])
        r = T.decide(dict(self.track, spotify_date="1990"), {"year": 1975, "method": "exact", "official": False}, None)
        self.assertTrue(any("onofficiële" in x for x in r["reasons"]))
        live = dict(self.track, title="Enter Sandman - Live", spotify_date="1991")
        self.assertEqual(T.decide(live, {"year": 1991, "method": "exact"}, None)["reasons"], [])

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
        self.assertEqual(T._cache_key({"title": "Bohemian Rhapsody - Remastered 2011", "artists": ["Queen"]}), "v5|bohemian rhapsody|queen")
        self.assertEqual(T._cache_key({"title": "Smalltown Boy - Extended Mix", "artists": ["Bronski Beat"]}), "v5|smalltown boy|bronski beat")
        key = T._cache_key({"title": "Roses - Imanbek Remix", "artists": ["SAINt JHN"]})
        self.assertEqual(key, f"v5-remix{T.REMIX_RULES}|roses imanbek remix|saint jhn")


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
