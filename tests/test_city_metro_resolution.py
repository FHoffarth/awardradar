import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


class CityMetroResolutionParsing(unittest.TestCase):
    def setUp(self):
        self._orig_autocomplete = app.autocomplete_places
        app.autocomplete_places = lambda *a, **k: tuple()

    def tearDown(self):
        app.autocomplete_places = self._orig_autocomplete

    def test_metro_code_expansion(self):
        self.assertEqual(app.resolve_codes("NYC"), ["JFK", "EWR", "LGA"])
        self.assertEqual(app.resolve_codes("LON"), ["LHR", "LGW", "LCY", "STN", "LTN", "SEN"])
        self.assertEqual(app.resolve_codes("PAR"), ["CDG", "ORY", "BVA"])
        self.assertEqual(app.resolve_codes("ROM"), ["FCO", "CIA"])
        self.assertEqual(app.resolve_codes("MIL"), ["MXP", "LIN", "BGY"])
        self.assertEqual(app.resolve_codes("TYO"), ["HND", "NRT"])

    def test_single_airport_codes_remain_single(self):
        self.assertEqual(app.resolve_codes("BER"), ["BER"])
        self.assertEqual(app.resolve_codes("FRA"), ["FRA"])

    def test_unknown_three_letter_code_is_rejected(self):
        self.assertEqual(app.local_codes("QQQ"), [])
        self.assertEqual(app.resolve_codes("QQQ"), [])

    def test_free_text_aliases_resolve_to_expected_sets(self):
        self.assertEqual(app.resolve_codes("New York"), ["JFK", "EWR", "LGA"])
        self.assertEqual(app.resolve_codes("London"), ["LHR", "LGW", "LCY", "STN", "LTN", "SEN"])
        self.assertEqual(app.resolve_codes("Paris"), ["CDG", "ORY", "BVA"])
        self.assertEqual(app.resolve_codes("Rome"), ["FCO", "CIA"])
        self.assertEqual(app.resolve_codes("Milan"), ["MXP", "LIN", "BGY"])


class CityMetroResolutionApi(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        self._orig_autocomplete = app.autocomplete_places
        self._orig_fetch_cash_details = app.fetch_cash_details
        self._orig_award_search = app.STATIC_AWARD_SOURCE.search
        app.autocomplete_places = lambda *a, **k: tuple()

    def tearDown(self):
        app.autocomplete_places = self._orig_autocomplete
        app.fetch_cash_details = self._orig_fetch_cash_details
        app.STATIC_AWARD_SOURCE.search = self._orig_award_search

    def test_airports_london_results_are_submit_safe(self):
        resp = self.client.get("/api/airports?q=london&lang=en")
        self.assertEqual(resp.status_code, 200)
        items = resp.get_json()
        values = [item["value"] for item in items]
        self.assertTrue(values)
        self.assertTrue(all(re.fullmatch(r"[A-Z]{3}", value) for value in values))
        self.assertTrue(all("," not in value for value in values))
        for expected in ["LHR", "LGW", "LCY", "STN", "LTN", "SEN"]:
            self.assertIn(expected, values)

    def test_airports_lon_query_stays_submit_safe(self):
        resp = self.client.get("/api/airports?q=LON&lang=en")
        self.assertEqual(resp.status_code, 200)
        items = resp.get_json()
        values = [item["value"] for item in items]
        self.assertTrue(values)
        self.assertTrue(all(re.fullmatch(r"[A-Z]{3}", value) for value in values))
        self.assertTrue(all("," not in value for value in values))

    def test_awards_rejects_same_metro_routes(self):
        for metro in ("NYC", "LON", "PAR"):
            with self.subTest(metro=metro):
                r = self.client.post("/api/awards", json={"origin": metro, "dest": metro, "date": "2026-08-15", "oneWay": True})
                self.assertEqual(r.status_code, 422)
                data = r.get_json()
                self.assertEqual(data.get("error"), "unsupported_route")

    def test_cheap_and_skiplag_reject_same_metro_routes(self):
        payload = {"origin": "NYC", "dest": "NYC", "date": "2026-08-15", "oneWay": True}
        cheap = self.client.post("/api/cheap", json=payload)
        self.assertEqual(cheap.status_code, 422)
        skiplag = self.client.post("/api/skiplag", json=payload)
        self.assertEqual(skiplag.status_code, 422)

    def test_awards_accepts_normal_route_syntax_without_real_providers(self):
        app.fetch_cash_details = lambda *a, **k: {}
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []

        for dest in ("NYC", "JFK"):
            with self.subTest(dest=dest):
                r = self.client.post("/api/awards", json={"origin": "FRA", "dest": dest, "date": "2026-08-15", "oneWay": True})
                self.assertEqual(r.status_code, 200)
                self.assertTrue(r.get_json().get("ok"))


if __name__ == "__main__":
    unittest.main()
