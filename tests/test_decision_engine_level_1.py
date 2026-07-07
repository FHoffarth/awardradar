"""Decision Engine Level 1 — acceptance tests (unittest, no external deps).

Run: python -m unittest tests.test_decision_engine_level_1 -v
Covers the mandatory guardrails from docs/decision_engine_level_1.md:
- Guardrail A trip-basis normalization (3 spec test cases)
- Guardrail B single threshold source (sweet_spot_grade reuses VALUE_TIER_THRESHOLDS)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


def _award(cpm, trip_type="one_way", data_source="estimated"):
    return {
        "program": "Miles & More",
        "miles": 55000,
        "surcharge": 100,
        "cpm": cpm,
        "grade": app.sweet_spot_grade(cpm) if cpm is not None else None,
        "trip_type": trip_type,
        "data_source": data_source,
    }


class ThresholdSingleSource(unittest.TestCase):
    def test_boundaries_match_central_constant(self):
        for min_cpm, tier in app.VALUE_TIER_THRESHOLDS:
            self.assertEqual(app.sweet_spot_grade(min_cpm)["tier"], tier)
            self.assertEqual(app.sweet_spot_grade(min_cpm + 0.01)["tier"], tier)

    def test_below_lowest_is_poor(self):
        lowest = app.VALUE_TIER_THRESHOLDS[-1][0]
        self.assertEqual(app.sweet_spot_grade(lowest - 0.01)["tier"], "poor")

    def test_calc_cpm(self):
        # (300 - 100) / 55000 * 100 = 0.36
        self.assertAlmostEqual(app.calc_cpm(300, 55000, 100), 0.36, places=2)
        self.assertEqual(app.calc_cpm(50, 55000, 100), 0.0)  # net <= 0


class TripBasisNormalization(unittest.TestCase):
    def test_case_2_oneway_vs_oneway_full_signal(self):
        d = app.build_decision(_award(1.5), cash_eur=300, cash_is_real=True,
                               cash_level="within_typical", requested_trip_type="one_way")
        self.assertTrue(d["trip_basis_compatible"])
        self.assertEqual(d["normalized_trip_type"], "one_way")
        self.assertEqual(d["verdict"], "lean_miles")   # cpm 1.5 → good → lean_miles
        self.assertEqual(d["confidence"], "medium")

    def test_case_1_roundtrip_search_oneway_award_is_blocked(self):
        base = app.build_decision(_award(1.5), cash_eur=300, cash_is_real=True,
                                  cash_level="within_typical", requested_trip_type="one_way")
        rt = app.build_decision(_award(1.5), cash_eur=300, cash_is_real=True,
                                cash_level="within_typical", requested_trip_type="round_trip")
        self.assertTrue(base["trip_basis_compatible"])
        self.assertFalse(rt["trip_basis_compatible"])
        self.assertEqual(rt["normalized_trip_type"], "one_way")
        self.assertEqual(rt["signal"], "insufficient_data")
        self.assertEqual(rt["verdict"], "insufficient_data")

    def test_case_3_incompatible_basis_no_value_signal(self):
        # round-trip award vs one-way cash → not safely normalizable
        d = app.build_decision(_award(1.5, trip_type="round_trip"), cash_eur=300,
                               cash_is_real=True, cash_level="within_typical",
                               requested_trip_type="round_trip")
        self.assertFalse(d["trip_basis_compatible"])
        self.assertEqual(d["verdict"], "insufficient_data")
        self.assertIsNone(d["tier"])

    def test_unknown_cash_is_availability_only(self):
        d = app.build_decision(_award(1.5), cash_eur=None, cash_is_real=False,
                               cash_level="unknown", requested_trip_type="one_way")
        self.assertEqual(d["verdict"], "availability_only")
        self.assertEqual(d["cash_trip_type"], "unknown")

    def test_no_award_is_insufficient(self):
        d = app.build_decision(None, cash_eur=300, cash_is_real=True,
                               cash_level="within_typical", requested_trip_type="one_way")
        self.assertEqual(d["verdict"], "insufficient_data")


class CashContext(unittest.TestCase):
    def test_relative_cash_levels(self):
        self.assertEqual(app.assess_cash_level(200, [300, 500]), "below_typical")
        self.assertEqual(app.assess_cash_level(400, [300, 500]), "within_typical")
        self.assertEqual(app.assess_cash_level(600, [300, 500]), "above_typical")
        self.assertEqual(app.assess_cash_level(400, None), "unknown")

    def test_cash_source_metadata_shape(self):
        meta = app.cash_source_metadata()
        for k in ("provider", "source", "source_type"):
            self.assertIn(k, meta)

    def test_assess_cash_level_delegates_to_below_typical(self):
        # No independent recomputation: must agree with the cash foundation.
        for price in (150, 360, 700):
            band = app._below_typical(price, [300, 500])
            level = app.assess_cash_level(price, [300, 500])
            expected = {"below": "below_typical", "low_half": "within_typical",
                        "within": "within_typical", "above": "above_typical",
                        "unknown": "unknown"}[band]
            self.assertEqual(level, expected)


class DecisionSignalsLevel1(unittest.TestCase):
    """STEP 9 cases A–H against the new signal/label/confidence shape."""

    def _d(self, cpm=None, cash=300, real=True, level="within_typical",
           tt="one_way", trip="one_way", ds="estimated"):
        best = _award(cpm, trip_type=trip, data_source=ds) if cpm is not None else None
        return app.build_decision(best, cash_eur=cash, cash_is_real=real,
                                  cash_level=level, requested_trip_type=tt)

    def test_A_high_cash_low_award_miles_make_sense(self):
        d = self._d(cpm=2.6)                       # high cash vs low miles → high cpm
        self.assertEqual(d["signal"], "strong_miles_value")
        self.assertEqual(d["label"], "Miles may make sense here")
        self.assertEqual(d["estimated_value"], 2.6)

    def test_B_low_cash_high_award_cash_stronger(self):
        d = self._d(cpm=0.4)                        # low cpm → cash may be stronger
        self.assertEqual(d["signal"], "cash_may_be_stronger")
        self.assertIn("Cash may be stronger", d["label"])

    def test_C_missing_cash_insufficient_low_conf(self):
        d = self._d(cpm=1.5, cash=None, real=False, level="unknown")
        self.assertEqual(d["signal"], "insufficient_data")
        self.assertEqual(d["confidence"], "low")
        self.assertTrue(d["verification_guidance"])   # guidance still provided

    def test_D_static_estimate_confidence_not_overstated(self):
        d = self._d(cpm=1.5, ds="estimated")
        self.assertNotEqual(d["confidence"], "high")
        self.assertIn("static award estimate", d["confidence_reason"])

    def test_E_estimate_freshness_acknowledged(self):
        d = self._d(cpm=1.5, ds="estimated")
        self.assertIn("estimate", d["freshness_label"].lower())

    def test_F_roundtrip_cash_vs_oneway_award_no_value(self):
        basis = app.normalize_trip_basis("round_trip", "one_way", "round_trip")
        self.assertFalse(basis["trip_basis_compatible"])

    def test_G_oneway_vs_oneway_valid(self):
        d = self._d(cpm=1.5)
        self.assertTrue(d["trip_basis_compatible"])
        self.assertIsNotNone(d["estimated_value"])

    def test_H_unclear_basis_insufficient(self):
        d = self._d(cpm=1.5, trip="round_trip", tt="round_trip")
        self.assertFalse(d["trip_basis_compatible"])
        self.assertEqual(d["signal"], "insufficient_data")

    def test_additive_keys_present(self):
        d = self._d(cpm=1.5)
        for k in ("signal", "label", "estimated_value", "confidence", "confidence_reason",
                  "freshness_label", "explanation", "verification_guidance",
                  "cash_trip_type", "award_trip_type", "normalized_trip_type",
                  "trip_basis_compatible", "verdict", "tier",
                  "evaluated_program", "evaluated_miles", "evaluated_surcharge",
                  "evaluated_data_source"):
            self.assertIn(k, d)

    def test_evaluated_option_identity_matches_input(self):
        # The card must be able to name exactly the option that was judged.
        best = _award(1.5)
        d = app.build_decision(best, cash_eur=300, cash_is_real=True,
                               cash_level="within_typical", requested_trip_type="one_way")
        self.assertEqual(d["evaluated_program"], best["program"])
        self.assertEqual(d["evaluated_miles"], best["miles"])
        self.assertEqual(d["evaluated_surcharge"], best["surcharge"])

    def test_real_oneway_payload_keeps_cash_and_award_basis_compatible(self):
        old_award_source = app.AWARD_SOURCE
        old_seatsaero_key = app.SEATSAERO_KEY
        old_fetch_cash_details = app.fetch_cash_details
        old_fetch_seatsaero = app.fetch_seatsaero
        try:
            app.AWARD_SOURCE = "seatsaero"
            app.SEATSAERO_KEY = "test-key"

            def fake_cash_details(origin, dest, dep, cabin, currency="EUR", ret=None):
                self.assertEqual((origin, dest, cabin), ("FRA", "JFK", "Economy"))
                self.assertIsNone(ret)
                return {
                    "price": 620.0,
                    "typical_range": [500, 800],
                    "cash_trip_type": "one_way",
                }

            def fake_seatsaero(origin, dest, cabin, dep):
                self.assertEqual((origin, dest, cabin), ("FRA", "JFK", "Economy"))
                return [{
                    "Source": "united",
                    "Date": dep.isoformat(),
                    "YAvailable": True,
                    "YMileageCost": 55000,
                    "YDirect": True,
                    "YAirlines": "LH",
                    "YRemainingSeats": 1,
                }]

            app.fetch_cash_details = fake_cash_details
            app.fetch_seatsaero = fake_seatsaero

            client = app.app.test_client()
            response = client.post("/api/awards", json={
                "origin": "FRA",
                "dest": "JFK",
                "date": "2026-08-15",
                "cabin": "Economy",
                "oneWay": True,
            })
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            decision = payload["results"][0]["decision"]
            self.assertTrue(decision["trip_basis_compatible"])
            self.assertEqual(decision["cash_trip_type"], "one_way")
            self.assertEqual(decision["award_trip_type"], "one_way")
            self.assertNotEqual(decision["verdict"], "insufficient_data")
            self.assertNotEqual(decision["signal"], "insufficient_data")
            self.assertNotIn("could not be normalized", decision["explanation"])
        finally:
            app.AWARD_SOURCE = old_award_source
            app.SEATSAERO_KEY = old_seatsaero_key
            app.fetch_cash_details = old_fetch_cash_details
            app.fetch_seatsaero = old_fetch_seatsaero

    def test_real_trip_basis_mismatch_still_blocks_value_signal(self):
        d = app.build_decision(_award(1.5, trip_type="round_trip"),
                               cash_eur=620,
                               cash_is_real=True,
                               cash_level="within_typical",
                               requested_trip_type="one_way",
                               cash_trip_type="one_way")
        self.assertFalse(d["trip_basis_compatible"])
        self.assertEqual(d["verdict"], "insufficient_data")
        self.assertEqual(d["signal"], "insufficient_data")

    def test_roundtrip_request_passes_return_date_and_blocks_oneway_estimate(self):
        old_award_source = app.AWARD_SOURCE
        old_seatsaero_key = app.SEATSAERO_KEY
        old_fetch_cash_details = app.fetch_cash_details
        try:
            app.AWARD_SOURCE = "estimated"
            app.SEATSAERO_KEY = None
            seen = {}

            def fake_cash_details(origin, dest, dep, cabin, currency="EUR", ret=None):
                seen["args"] = {
                    "origin": origin,
                    "dest": dest,
                    "dep": dep.isoformat(),
                    "ret": ret.isoformat() if ret else None,
                    "cabin": cabin,
                }
                return {
                    "price": 220.0,
                    "typical_range": [180, 320],
                    "cash_trip_type": "round_trip",
                }

            app.fetch_cash_details = fake_cash_details
            client = app.app.test_client()
            response = client.post("/api/awards", json={
                "origin": "MUC",
                "dest": "CDG",
                "date": "2026-07-07",
                "returnDate": "2026-07-09",
                "oneWay": False,
                "cabin": "Economy",
            })

            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            result = payload["results"][0]
            program = result["programs"][0]
            decision = result["decision"]

            self.assertEqual(seen["args"], {
                "origin": "MUC",
                "dest": "CDG",
                "dep": "2026-07-07",
                "ret": "2026-07-09",
                "cabin": "Economy",
            })
            self.assertEqual(result["returnDate"], "2026-07-09")
            self.assertEqual(program["return_date"], "2026-07-09")
            self.assertEqual(program["requested_trip_type"], "round_trip")
            self.assertEqual(program["trip_type"], "one_way")
            self.assertEqual(decision["cash_trip_type"], "round_trip")
            self.assertEqual(decision["award_trip_type"], "one_way")
            self.assertFalse(decision["trip_basis_compatible"])
            self.assertEqual(decision["signal"], "insufficient_data")
            self.assertEqual(decision["verdict"], "insufficient_data")
            self.assertIsNone(decision["estimated_value"])
            self.assertIsNone(decision["tier"])
            self.assertNotIn("net_cash_saved", decision)
            self.assertNotIn("cpm", decision)
        finally:
            app.AWARD_SOURCE = old_award_source
            app.SEATSAERO_KEY = old_seatsaero_key
            app.fetch_cash_details = old_fetch_cash_details

    def test_incompatible_trip_basis_exposes_no_value_metrics_or_verdict(self):
        d = app.build_decision(_award(1.5, trip_type="one_way"),
                               cash_eur=300,
                               cash_is_real=True,
                               cash_level="within_typical",
                               requested_trip_type="round_trip",
                               cash_trip_type="round_trip")
        self.assertFalse(d["trip_basis_compatible"])
        self.assertEqual(d["signal"], "insufficient_data")
        self.assertEqual(d["verdict"], "insufficient_data")
        self.assertIsNone(d["estimated_value"])
        self.assertIsNone(d["tier"])
        self.assertNotIn("net_cash_saved", d)
        self.assertNotIn("cpm", d)

    def test_compatible_roundtrip_cash_and_award_basis_compares_normally(self):
        d = app.build_decision(_award(1.5, trip_type="round_trip"),
                               cash_eur=300,
                               cash_is_real=True,
                               cash_level="within_typical",
                               requested_trip_type="round_trip",
                               cash_trip_type="round_trip")
        self.assertTrue(d["trip_basis_compatible"])
        self.assertEqual(d["normalized_trip_type"], "round_trip")
        self.assertNotEqual(d["signal"], "insufficient_data")


class ItineraryOwnershipIntegrity(unittest.TestCase):
    def test_award_result_with_cash_segments_declares_cash_itinerary_ownership(self):
        old_award_source = app.AWARD_SOURCE
        old_seatsaero_key = app.SEATSAERO_KEY
        old_fetch_cash_details = app.fetch_cash_details
        try:
            app.AWARD_SOURCE = "estimated"
            app.SEATSAERO_KEY = None

            def fake_cash_details(origin, dest, dep, cabin, currency="EUR", ret=None):
                return {
                    "price": 620.0,
                    "typical_range": [500, 800],
                    "cash_trip_type": "one_way",
                    "segments": [{
                        "dep_iata": "FRA",
                        "arr_iata": "JFK",
                        "departure_datetime_raw": "2026-08-15 10:45",
                        "arrival_datetime_raw": "2026-08-15 13:15",
                        "departure_date": "2026-08-15",
                        "arrival_date": "2026-08-15",
                        "dep_time": "10:45",
                        "arr_time": "13:15",
                        "arrival_day_offset": 0,
                        "duration_min": 510,
                        "overnight": False,
                    }],
                }

            app.fetch_cash_details = fake_cash_details
            response = app.app.test_client().post("/api/awards", json={
                "origin": "FRA", "dest": "JFK", "date": "2026-08-15",
                "cabin": "Economy", "oneWay": True,
            })
            self.assertEqual(response.status_code, 200)
            result = response.get_json()["results"][0]
            self.assertEqual(result["journey_route_source"], "cash_context")
            self.assertEqual(result["displayed_itinerary"], "cash")
            self.assertEqual(result["award_routing_status"], "not_available")
            self.assertFalse(result["verified_identical_routing"])
        finally:
            app.AWARD_SOURCE = old_award_source
            app.SEATSAERO_KEY = old_seatsaero_key
            app.fetch_cash_details = old_fetch_cash_details

    def test_award_result_without_cash_segments_declares_search_fallback(self):
        old_award_source = app.AWARD_SOURCE
        old_seatsaero_key = app.SEATSAERO_KEY
        old_fetch_cash_details = app.fetch_cash_details
        try:
            app.AWARD_SOURCE = "estimated"
            app.SEATSAERO_KEY = None
            app.fetch_cash_details = lambda *a, **k: {
                "price": 300.0,
                "typical_range": [250, 450],
                "cash_trip_type": "one_way",
            }
            response = app.app.test_client().post("/api/awards", json={
                "origin": "FRA", "dest": "JFK", "date": "2026-08-15",
                "cabin": "Economy", "oneWay": True,
            })
            self.assertEqual(response.status_code, 200)
            result = response.get_json()["results"][0]
            self.assertEqual(result["journey_route_source"], "search_fallback")
            self.assertEqual(result["displayed_itinerary"], "none")
        finally:
            app.AWARD_SOURCE = old_award_source
            app.SEATSAERO_KEY = old_seatsaero_key
            app.fetch_cash_details = old_fetch_cash_details

    def test_full_provider_datetime_survives_cash_normalization(self):
        old_serpapi_search = app.serpapi_search
        old_token = app.SERPAPI_TOKEN
        try:
            app.SERPAPI_TOKEN = "test"

            def fake_serpapi_search(*_args, **_kwargs):
                return {"best_flights": [{
                    "price": 620,
                    "total_duration": 510,
                    "flights": [{
                        "departure_airport": {"id": "FRA", "time": "2026-08-15 10:45"},
                        "arrival_airport": {"id": "JFK", "time": "2026-08-15 13:15"},
                        "duration": 510,
                        "flight_number": "LH 400",
                        "airline": "Lufthansa",
                    }],
                }]}

            app.serpapi_search = fake_serpapi_search
            details = app.fetch_cash_details("FRA", "JFK", app.dt.date(2026, 8, 15), "Economy")
            seg = details["segments"][0]
            self.assertEqual(seg["departure_datetime_raw"], "2026-08-15 10:45")
            self.assertEqual(seg["arrival_datetime_raw"], "2026-08-15 13:15")
            self.assertEqual(seg["dep_time"], "10:45")
            self.assertEqual(seg["arr_time"], "13:15")
            self.assertEqual(seg["departure_date"], "2026-08-15")
            self.assertEqual(seg["arrival_date"], "2026-08-15")
            self.assertEqual(seg["arrival_day_offset"], 0)
        finally:
            app.serpapi_search = old_serpapi_search
            app.SERPAPI_TOKEN = old_token

    def test_overnight_offset_requires_reliable_evidence(self):
        self.assertEqual(app._arrival_day_offset("2026-08-15", "2026-08-16", False), 1)
        self.assertEqual(app._arrival_day_offset(None, None, True), 1)
        self.assertIsNone(app._arrival_day_offset(None, None, False))

    def test_roundtrip_with_outbound_cash_segments_is_not_full_return_itinerary(self):
        meta = app.itinerary_ownership_metadata({"segments": [{"dep_iata": "MUC", "arr_iata": "CDG"}]})
        self.assertEqual(meta["journey_route_source"], "cash_context")
        self.assertEqual(meta["displayed_itinerary"], "cash")
        self.assertFalse(meta["verified_identical_routing"])

    def test_normal_cash_search_offers_are_cash_owned_without_times(self):
        offer = app._serp_item_to_offer({
            "price": 200,
            "total_duration": 90,
            "flights": [{
                "departure_airport": {"id": "MUC", "time": "2026-07-07 08:10"},
                "arrival_airport": {"id": "CDG", "time": "2026-07-07 09:40"},
                "flight_number": "LH 2226",
            }],
        }, "EUR", None, False)
        self.assertEqual(offer["itinerary_source"], "cash_offer")
        self.assertEqual(offer["displayed_itinerary"], "cash")
        self.assertEqual(offer["time_data_status"], "unavailable")
        self.assertNotIn("dep_time", offer)

    def test_frontend_copy_qualifies_unverified_routing_and_direct_signal(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "static", "app.js"), encoding="utf-8") as f:
            js = f.read()
        with open(os.path.join(root, "static", "app.css"), encoding="utf-8") as f:
            css = f.read()
        with open(os.path.join(root, "templates", "index.html"), encoding="utf-8") as f:
            html = f.read()
        self.assertIn("Cash itinerary shown", js)
        self.assertIn("The itinerary context below is cash-based.", js)
        self.assertIn("Award routing must be verified before comparing travel time, stops and convenience.", js)
        self.assertIn("The award shows a strong redemption value.", js)
        self.assertIn("Provider reports direct availability", js)
        self.assertIn("Confirmed itinerary routing is not available.", js)
        self.assertIn("The price signals are closely matched.", js)
        self.assertIn("app.css?v=136", html)
        self.assertIn("app.js?v=143", html)
        self.assertIn("data-text-size-option=\"small\"", html)
        self.assertIn("data-text-size-option=\"default\"", html)
        self.assertIn("data-text-size-option=\"large\"", html)
        self.assertIn("aria-label=\"Text size\"", html)
        self.assertIn("aria-pressed=\"true\"", html)
        self.assertIn("awardradar_text_size", html)
        self.assertIn("awardradar_text_size", js)
        self.assertIn("normalizeTextSize", js)
        self.assertIn("applyTextSize", js)
        self.assertIn("dataset.textSize", js)
        self.assertIn("--text-scale", css)
        self.assertIn("[data-text-size=\"small\"]", css)
        self.assertIn("[data-text-size=\"large\"]", css)
        self.assertNotIn("Miles are worth using here.", js)
        self.assertNotIn("Miles look worth using here.", js)
        self.assertNotIn("Miles may be worth using here.", js)
        self.assertNotIn("Cash and miles are closely matched.", js)
        self.assertNotIn("Journey intelligence route", js)
        self.assertNotIn("o.direct ? 'Nonstop' : ''", js)


class AboutMethodologyPage(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_about_route_returns_methodology_page(self):
        response = self.client.get("/about")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn("About AwardRadar", html)
        self.assertIn("How the Decision Layer works", html)
        self.assertIn("Data status and freshness", html)
        self.assertIn("What confidence means", html)
        self.assertIn("What to verify before booking", html)
        self.assertIn("Independence and commercial links", html)
        self.assertIn("Limitations", html)
        self.assertIn("app.css?v=136", html)
        self.assertNotIn("app.js?v=143", html)

    def test_about_navigation_exists_on_main_page(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('class="nav-link" href="/about"', html)
        self.assertIn('<a href="/about">About</a>', html)
        self.assertIn("app.css?v=136", html)
        self.assertIn("app.js?v=143", html)

    def test_about_copy_avoids_overclaiming(self):
        html = self.client.get("/about").get_data(as_text=True).lower()
        forbidden = [
            "guaranteed availability",
            "100% live",
            "always accurate",
            "fully live inventory",
            "official airline or loyalty-program service",
        ]
        for phrase in forbidden:
            self.assertNotIn(phrase, html)
        self.assertIn("official airline, booking-site and loyalty-program sources are the final verification point", html)
        self.assertIn("commercial placement", html)

    def test_about_appears_in_sitemap(self):
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://awardradar.app/about", response.get_data(as_text=True))


class AwardsApiErrorHandling(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        self.old_fetch_cash_details = app.fetch_cash_details
        self.old_static_search = app.STATIC_AWARD_SOURCE.search
        self.old_award_source_metadata = app.award_source_metadata

    def tearDown(self):
        app.fetch_cash_details = self.old_fetch_cash_details
        app.STATIC_AWARD_SOURCE.search = self.old_static_search
        app.award_source_metadata = self.old_award_source_metadata

    def post_awards(self, payload, headers=None, path="/api/awards"):
        return self.client.post(path, json=payload, headers=headers or {})

    def valid_awards_payload(self):
        return {"origin": "FRA", "dest": "CDG", "date": "2026-07-07", "oneWay": True}

    def assert_error(self, response, status, code, retryable):
        self.assertEqual(response.status_code, status)
        data = response.get_json()
        self.assertEqual(data["ok"], False)
        self.assertEqual(data["error"], code)
        self.assertIn("message", data)
        self.assertEqual(data["retryable"], retryable)
        body = response.get_data(as_text=True).lower()
        self.assertNotIn("traceback", body)
        self.assertNotIn("serpapi", body)
        self.assertNotIn("token", body)

    def test_missing_json_body_is_400(self):
        response = self.client.post("/api/awards", data=b"", content_type="application/json")
        self.assert_error(response, 400, "invalid_json", False)

    def test_invalid_json_is_400(self):
        response = self.client.post("/api/awards", data="{bad", content_type="application/json")
        self.assert_error(response, 400, "invalid_json", False)

    def test_missing_origin_is_400(self):
        response = self.post_awards({"dest": "CDG", "date": "2026-07-07", "oneWay": True})
        self.assert_error(response, 400, "invalid_request", False)

    def test_missing_destination_is_400(self):
        response = self.post_awards({"origin": "FRA", "date": "2026-07-07", "oneWay": True})
        self.assert_error(response, 400, "invalid_request", False)

    def test_missing_departure_date_is_400(self):
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "oneWay": True})
        self.assert_error(response, 400, "invalid_request", False)

    def test_invalid_departure_date_is_400(self):
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "date": "bad", "oneWay": True})
        self.assert_error(response, 400, "invalid_date", False)

    def test_same_origin_destination_is_422(self):
        response = self.post_awards({"origin": "FRA", "dest": "FRA", "date": "2026-07-07", "oneWay": True})
        self.assert_error(response, 422, "unsupported_route", False)

    def test_provider_unavailable_is_503(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: (_ for _ in ()).throw(app.requests.ConnectionError("provider down"))
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "date": "2026-07-07", "oneWay": True})
        self.assert_error(response, 503, "provider_unavailable", True)

    def test_provider_timeout_is_504(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: (_ for _ in ()).throw(app.requests.Timeout("provider timeout"))
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "date": "2026-07-07", "oneWay": True})
        self.assert_error(response, 504, "provider_timeout", True)

    def test_empty_valid_result_is_200_not_500(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "date": "2026-07-07", "oneWay": True})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["results"][0]["programs"], [])

    def test_unexpected_internal_exception_is_500(self):
        app.award_source_metadata = lambda: (_ for _ in ()).throw(RuntimeError("internal boom"))
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "date": "2026-07-07", "oneWay": True})
        self.assert_error(response, 500, "internal_error", True)
        self.assertNotIn("internal boom", response.get_data(as_text=True))

    def test_success_contract_remains_unchanged(self):
        response = self.post_awards({"origin": "FRA", "dest": "CDG", "date": "2026-07-07", "cabin": "Economy", "oneWay": True})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertIn("results", data)
        self.assertIn("award_source", data)
        result = data["results"][0]
        self.assertIn("decision", result)
        self.assertIn("programs", result)
        self.assertIn("journey_route_source", result)

    def test_public_awards_api_requires_no_app_token(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []
        response = self.post_awards(self.valid_awards_payload())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def test_public_product_api_routes_are_not_app_token_guarded(self):
        endpoints = [
            ("POST", "/api/cheap"),
            ("POST", "/api/skiplag"),
            ("POST", "/api/awards"),
            ("GET", "/api/top-opportunities"),
        ]
        payload = self.valid_awards_payload()
        for method, path in endpoints:
            with self.subTest(path=path):
                if method == "GET":
                    response = self.client.get(path)
                else:
                    response = self.client.post(path, json=payload)
                self.assertNotEqual(response.status_code, 401)

    def test_authorization_header_has_no_authentication_effect(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []
        response = self.post_awards(self.valid_awards_payload(), headers={"Authorization": "Token secret-test-token"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def test_query_key_has_no_authentication_effect(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []
        response = self.post_awards(self.valid_awards_payload(), path="/api/awards?key=secret-test-token")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def test_legacy_app_token_header_has_no_authentication_effect(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []
        response = self.post_awards(self.valid_awards_payload(), headers={"X-App-Token": "secret-test-token"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def test_app_token_cookie_has_no_authentication_effect(self):
        app.STATIC_AWARD_SOURCE.search = lambda *a, **k: []
        self.client.set_cookie("app_token", "secret-test-token")
        response = self.post_awards(self.valid_awards_payload())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def test_key_query_does_not_set_token_cookie(self):
        response = self.client.get("/?key=secret-test-token")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("app_token", response.headers.get("Set-Cookie", ""))

    def test_health_no_longer_reports_api_guard(self):
        data = self.client.get("/health").get_json()
        self.assertTrue(data["ok"])
        self.assertNotIn("api_guard", data)


if __name__ == "__main__":
    unittest.main()
