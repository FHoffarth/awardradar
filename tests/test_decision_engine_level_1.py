"""Decision Engine Level 1 — acceptance tests (unittest, no external deps).

Run: python -m unittest tests.test_decision_engine_level_1 -v
Covers the mandatory guardrails from docs/decision_engine_level_1.md:
- Guardrail A trip-basis normalization (3 spec test cases)
- Guardrail B single threshold source (sweet_spot_grade reuses VALUE_TIER_THRESHOLDS)
"""
import os
import json
import pathlib
import re
import shutil
import subprocess
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

    def test_normal_cash_search_offers_carry_reliable_times(self):
        # R1: cash offers now carry reliable itinerary timing (from the same
        # provider datetime parsing used for award cash context), still cash-owned.
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
        self.assertEqual(offer["time_data_status"], "complete")
        self.assertEqual(offer["dep_time"], "08:10")
        self.assertEqual(offer["arr_time"], "09:40")
        self.assertEqual(offer["departure_date"], "2026-07-07")
        self.assertEqual(offer["arrival_date"], "2026-07-07")
        self.assertIsNone(offer["arrival_day_offset"])
        self.assertEqual(offer["flight_number"], "LH 2226")

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
        self.assertIn("app.css?v=139", html)
        self.assertIn("app.js?v=148", html)
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
        self.assertNotIn("app.js?v=147", html)

    def test_about_navigation_exists_on_main_page(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('class="nav-link" href="/about"', html)
        self.assertIn('<a href="/about">About</a>', html)
        self.assertIn("app.css?v=139", html)
        self.assertIn("app.js?v=148", html)

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


class SearchArchitectureValidation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = pathlib.Path(__file__).resolve().parents[1]
        cls.index_html = (cls.repo_root / "templates" / "index.html").read_text(encoding="utf-8")
        cls.app_js = (cls.repo_root / "static" / "app.js").read_text(encoding="utf-8")

    def block(self, start, end):
        return self.app_js.split(start, 1)[1].split(end, 1)[0]

    def test_fresh_load_has_empty_required_fields_and_disabled_cta(self):
        html = self.index_html
        self.assertRegex(html, r'<input id="origin"[^>]*placeholder="City or airport"')
        self.assertRegex(html, r'<input id="dest"[^>]*placeholder="City or airport"')
        self.assertRegex(html, r'<input id="date"[^>]*placeholder="Select date"')
        self.assertNotRegex(html, r'<input id="origin"[^>]*value=')
        self.assertNotRegex(html, r'<input id="dest"[^>]*value=')
        self.assertNotRegex(html, r'<input id="date"[^>]*value=')
        self.assertRegex(html, r'<button class="go" id="go"[^>]*disabled[^>]*aria-disabled="true"')

    def test_return_date_hidden_for_one_way_and_visible_logic_exists(self):
        self.assertRegex(self.index_html, r'<input id="oneWay" type="checkbox" checked>')
        toggle = self.block("function toggleReturn", "function updateCalendarPrices")
        self.assertIn("wrap.style.display = on ? 'none' : ''", toggle)
        self.assertIn("$('returnDate').disabled = on", toggle)
        self.assertIn("returnDate: isOneWay ? '' : $('returnDate').value", self.app_js)

    def test_removed_static_presets_are_absent_from_markup_and_behavior(self):
        for term in ["weekend", "nextweek", "christmas", "newyear", "summer"]:
            self.assertNotIn(f'data-preset="{term}"', self.index_html)
            self.assertNotIn(f"preset === '{term}'", self.app_js)
        self.assertIn('data-preset="today"', self.index_html)
        self.assertIn('data-preset="tomorrow"', self.index_html)

    def test_today_and_tomorrow_use_local_dates_and_never_run(self):
        preset = self.block("function applyDatePreset", "// Flatpickr")
        self.assertIn("localDateString(d)", preset)
        self.assertIn("d.setDate(now.getDate() + 1)", preset)
        self.assertNotIn("toISOString", preset)
        self.assertNotIn("run()", preset)
        self.assertNotIn("runIfSearchValid()", preset)

    def test_airport_validity_requires_resolved_selection_not_free_text(self):
        self.assertIn("const airportResolution = { origin: null, dest: null }", self.app_js)
        airport_code = self.block("function airportCodeFor", "function localDateString")
        self.assertIn("airportResolution[inputId] === code", airport_code)
        touched = self.block("function markSearchFieldTouched", "function runIfSearchValid")
        self.assertIn("options.resolved !== true", touched)
        self.assertIn("airportResolution[inputId] = null", touched)
        self.assertIn("setResolvedAirport(inputId, input.value)", self.app_js)

    def test_same_airport_and_round_trip_validation_rules_exist(self):
        validate = self.block("function validateSearchForm", "function markSearchFieldTouched")
        self.assertIn("origin && dest && origin === dest", validate)
        self.assertIn("Origin and destination must be different.", validate)
        self.assertIn("!oneWay", validate)
        self.assertIn("Select a return date.", validate)
        self.assertIn("ret < dep", validate)

    def test_cta_and_run_use_same_validation_source_of_truth(self):
        validate = self.block("function validateSearchForm", "function markSearchFieldTouched")
        self.assertIn("go.disabled = !valid", validate)
        self.assertIn("go.setAttribute('aria-disabled'", validate)
        run_prefix = self.app_js.split("async function run()", 1)[1].split("const endpoint", 1)[0]
        self.assertIn("validateSearchForm({ submit: true })", run_prefix)
        self.assertIn("return;", run_prefix)

    def test_invalid_state_returns_before_endpoint_or_fetch(self):
        run_fn = self.block("async function run()", "// ===== Compact editable Search Summary")
        self.assertLess(run_fn.index("validateSearchForm({ submit: true })"), run_fn.index("const endpoint"))
        self.assertLess(run_fn.index("return;"), run_fn.index("fetch(endpoint"))

    def test_existing_modes_still_map_to_existing_endpoints(self):
        run_fn = self.block("async function run()", "// ===== Compact editable Search Summary")
        self.assertIn("mode === 'cheap' ? '/api/cheap'", run_fn)
        self.assertIn("mode === 'skiplag' ? '/api/skiplag' : '/api/awards'", run_fn)
        self.assertIn("function activateTab", self.app_js)

    def test_autorun_paths_use_validation_gate(self):
        self.assertIn("function runIfSearchValid()", self.app_js)
        self.assertIn("if ($('results').children.length) runIfSearchValid();", self.app_js)
        self.assertIn("$('oneWay').onchange = () => toggleReturn(false);", self.app_js)


class TopOpportunitiesFrontendRendering(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = pathlib.Path(__file__).resolve().parents[1]
        cls.app_js = cls.repo_root / "static" / "app.js"
        bundled_node = pathlib.Path(
            r"C:\Users\Flo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        )
        cls.node = shutil.which("node") or (str(bundled_node) if bundled_node.exists() else None)

    def render_fixture(self, opportunities):
        if not self.node:
            self.skipTest("Node.js is required for frontend rendering regression tests")
        js = self.app_js.read_text(encoding="utf-8")
        helper_block = js.split("// ===== Discovery Widget helpers =====", 1)[1].split(
            "// ===== Discovery Widget =====", 1
        )[0]
        render_tail = js.split("  function renderCards(opps) {\n    const cards = [];", 1)[1].split(
            "\n\n  function renderError()", 1
        )[0]
        render_cards = "function renderCards(opps) {\n    const cards = [];" + render_tail
        script = f"""
const warnings = [];
const console = {{ warn: (...args) => warnings.push(args.join(' ')) }};
const window = {{ location: {{ origin: 'https://awardradar.app' }} }};
function esc(s) {{
  return String(s ?? '').replace(/[&<>"]/g, c => ({{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }}[c]));
}}
const STARS_MAP = {{ exceptional: '*****', great: '****' }};
const REC_LABEL = {{
  book_miles: 'Verify miles option',
  lean_miles: 'Lean towards Miles',
  consider: 'Compare options',
  pay_cash: 'Pay Cash',
}};
const container = {{ innerHTML: '' }};
{helper_block}
{render_cards}
renderCards({json.dumps(opportunities)});
process.stdout.write(JSON.stringify({{ html: container.innerHTML, warnings }}));
"""
        result = subprocess.run([self.node, "-e", script], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def valid_opportunity(self, **overrides):
        item = {
            "origin": "FRA",
            "dest": "JFK",
            "available_date": "2026-07-08",
            "cabin": "First",
            "cash_eur": None,
            "cpm": 4.2,
            "direct": True,
            "grade_label": "Exceptional value",
            "grade_tier": "exceptional",
            "miles": 85000,
            "program": "Miles & More",
            "reasoning": "Estimated value looks promising.",
            "recommendation": "book_miles",
            "seats": 2,
            "surcharge": 310,
            "airlines": "2L",
            "url": "https://example.com/verify",
        }
        item.update(overrides)
        return item

    def test_live_shape_with_nullable_cash_and_unknown_airline_renders_cards(self):
        result = self.render_fixture(
            [
                self.valid_opportunity(),
                self.valid_opportunity(
                    origin="MUC",
                    dest="SIN",
                    cabin="Business",
                    cpm=2.7,
                    direct=False,
                    seats=1,
                    surcharge=180,
                    airlines="UNKNOWN",
                    grade_tier="great",
                ),
            ]
        )
        html = result["html"]
        self.assertIn("disc-card", html)
        self.assertIn("FRA", html)
        self.assertIn("JFK", html)
        self.assertIn("2L", html)
        self.assertIn("UNKNOWN", html)
        self.assertIn("Provider reports direct availability", html)
        self.assertNotIn("disc-error", html)
        self.assertEqual(result["warnings"], [])

    def test_nullable_optional_numbers_degrade_without_crashing(self):
        result = self.render_fixture(
            [self.valid_opportunity(miles=None, cpm=None, surcharge=None, cash_eur=None)]
        )
        html = result["html"]
        self.assertIn("Miles unavailable", html)
        self.assertNotIn("ct/mi", html)
        self.assertNotIn("undefined", html)

    def test_empty_success_response_uses_neutral_empty_state(self):
        result = self.render_fixture([])
        self.assertIn("No exceptional opportunities detected today.", result["html"])
        self.assertNotIn("temporarily unavailable", result["html"])

    def test_malformed_item_does_not_suppress_valid_cards(self):
        result = self.render_fixture(
            [
                {"origin": "", "dest": "CDG", "miles": 1},
                self.valid_opportunity(origin="CDG", dest="NRT", airlines="NH"),
            ]
        )
        html = result["html"]
        self.assertIn("CDG", html)
        self.assertIn("NRT", html)
        self.assertIn("NH", html)
        self.assertEqual(html.count('role="article"'), 1)

    def test_text_fields_are_escaped_and_unsafe_urls_are_not_rendered(self):
        result = self.render_fixture(
            [
                self.valid_opportunity(
                    program="<b>Bad Program</b>",
                    cpm=None,
                    reasoning="<script>alert(1)</script>",
                    url="javascript:alert(1)",
                )
            ]
        )
        html = result["html"]
        self.assertNotIn("<script", html.lower())
        self.assertNotIn("<b>Bad Program</b>", html)
        self.assertNotIn("javascript:", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("&lt;b&gt;Bad Program&lt;/b&gt;", html)

    def test_failed_api_response_still_uses_degraded_state(self):
        js = self.app_js.read_text(encoding="utf-8")
        self.assertIn("if (d && d.ok === true) renderCards(d.opportunities || []);", js)
        self.assertIn("else renderError();", js)
        self.assertIn("Top opportunities unavailable.", js)


class EnglishPrivacyNotice(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_privacy_route_returns_english_informational_notice(self):
        response = self.client.get("/privacy")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        # Informational-only disclaimer and controlling-version statement
        self.assertIn(
            "This English version is provided for information only. "
            "The German version is legally controlling.",
            html,
        )
        self.assertIn('href="/datenschutz"', html)
        self.assertIn("Datenschutzerklärung", html)
        # Substantive facts mirrored from the German source
        self.assertIn("EU West (Amsterdam, Netherlands)", html)
        self.assertIn("Article 6(1)(f) GDPR", html)
        self.assertIn("Article 6(1)(a) GDPR", html)
        self.assertIn("Article 21 GDPR", html)
        self.assertIn("Article 7(3) GDPR", html)
        self.assertIn("Section 25 TDDDG", html)
        self.assertIn("Seats.aero", html)
        self.assertIn("awardradar_text_size", html)
        self.assertIn("approximately 6 hours", html)
        self.assertIn("approximately 4 hours", html)
        self.assertIn("where applicable", html)
        self.assertIn("July 2026", html)

    def test_privacy_avoids_forbidden_and_overclaiming_wording(self):
        html = self.client.get("/privacy").get_data(as_text=True)
        self.assertNotIn("Article 6(1)(b) GDPR", html)
        self.assertNotIn("TTDSG", html)
        forbidden = [
            "ar_key",
            "Beta-Zugangscode",
            "Beta access code",
            "session authentication",
            "Sitzungsauthentifizierung",
            "fully compliant",
            "GDPR-compliant",
            "Standard Contractual Clauses",
            "Data Privacy Framework",
            "adequacy decision",
        ]
        for phrase in forbidden:
            self.assertNotIn(phrase, html)

    def test_german_page_links_to_english_privacy(self):
        response = self.client.get("/datenschutz")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('href="/privacy"', html)
        # German legal substance remains intact
        self.assertIn("Art. 6 Abs. 1 lit. f DSGVO", html)
        self.assertIn("§ 25 TDDDG", html)

    def test_footers_link_to_english_privacy(self):
        for path in ("/", "/about"):
            html = self.client.get(path).get_data(as_text=True)
            self.assertIn('<a href="/privacy">English privacy</a>', html)

    def test_sitemap_includes_privacy(self):
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://awardradar.app/privacy", response.get_data(as_text=True))

    def test_related_legal_and_core_routes_remain_healthy(self):
        for path in ("/datenschutz", "/impressum", "/about", "/"):
            self.assertEqual(self.client.get(path).status_code, 200)


class CashItineraryNormalization(unittest.TestCase):
    """R1: _serp_item_to_offer carries reliable itinerary timing without invention."""

    def _offer(self, flights, price=300, total_duration=480):
        return app._serp_item_to_offer(
            {"price": price, "total_duration": total_duration, "flights": flights},
            "EUR", None, False,
        )

    def _nonstop(self, dep="2026-08-15 10:45", arr="2026-08-15 13:15", fn="LH 400"):
        return [{
            "departure_airport": {"id": "FRA", "time": dep},
            "arrival_airport": {"id": "JFK", "time": arr},
            "flight_number": fn,
            "airline": "Lufthansa",
        }]

    def test_both_times_are_complete(self):
        o = self._offer(self._nonstop())
        self.assertEqual(o["time_data_status"], "complete")
        self.assertEqual(o["dep_time"], "10:45")
        self.assertEqual(o["arr_time"], "13:15")

    def test_one_time_is_partial(self):
        o = self._offer([{
            "departure_airport": {"id": "FRA", "time": "2026-08-15 10:45"},
            "arrival_airport": {"id": "JFK", "time": ""},
            "flight_number": "LH 400",
        }])
        self.assertEqual(o["time_data_status"], "partial")
        self.assertEqual(o["dep_time"], "10:45")
        self.assertIsNone(o["arr_time"])

    def test_no_times_is_unavailable(self):
        o = self._offer([{
            "departure_airport": {"id": "FRA", "time": ""},
            "arrival_airport": {"id": "JFK", "time": ""},
            "flight_number": "LH 400",
        }])
        self.assertEqual(o["time_data_status"], "unavailable")
        self.assertIsNone(o["dep_time"])
        self.assertIsNone(o["arr_time"])

    def test_missing_dates_do_not_downgrade_complete_times(self):
        # Times present but only clock strings (no date) → still complete.
        o = self._offer([{
            "departure_airport": {"id": "FRA", "time": "10:45"},
            "arrival_airport": {"id": "JFK", "time": "13:15"},
            "flight_number": "LH 400",
        }])
        self.assertEqual(o["time_data_status"], "complete")
        self.assertIsNone(o["departure_date"])
        self.assertIsNone(o["arrival_date"])
        self.assertIsNone(o["arrival_day_offset"])

    def test_reliable_positive_arrival_day_offset(self):
        o = self._offer(self._nonstop(dep="2026-08-15 22:30", arr="2026-08-16 06:10"))
        self.assertEqual(o["arrival_day_offset"], 1)

    def test_no_offset_inferred_from_clock_values_alone(self):
        # Arrival clock earlier than departure clock but no dates → no invented offset.
        o = self._offer([{
            "departure_airport": {"id": "FRA", "time": "22:30"},
            "arrival_airport": {"id": "JFK", "time": "06:10"},
            "flight_number": "LH 400",
        }])
        self.assertIsNone(o["arrival_day_offset"])

    def test_duration_preserved(self):
        o = self._offer(self._nonstop(), total_duration=510)
        self.assertEqual(o["durationMin"], 510)

    def test_stops_and_via_preserved(self):
        conn = [
            {"departure_airport": {"id": "MUC", "time": "2026-08-15 08:00"},
             "arrival_airport": {"id": "FRA", "time": "2026-08-15 09:00"},
             "flight_number": "LH 100", "airline": "Lufthansa"},
            {"departure_airport": {"id": "FRA", "time": "2026-08-15 11:00"},
             "arrival_airport": {"id": "JFK", "time": "2026-08-15 14:00"},
             "flight_number": "LH 400", "airline": "Lufthansa"},
        ]
        o = self._offer(conn)
        self.assertEqual(o["stops"], 1)
        self.assertEqual(o["via"], ["FRA"])

    def test_airline_preserved(self):
        o = self._offer(self._nonstop())
        self.assertEqual(o["airline"], "Lufthansa")

    def test_single_segment_flight_number_preserved(self):
        o = self._offer(self._nonstop(fn="LH 400"))
        self.assertEqual(o["flight_number"], "LH 400")

    def test_connecting_first_flight_number_not_exposed_as_top_level(self):
        conn = [
            {"departure_airport": {"id": "MUC", "time": "2026-08-15 08:00"},
             "arrival_airport": {"id": "FRA", "time": "2026-08-15 09:00"},
             "flight_number": "LH 100", "airline": "Lufthansa"},
            {"departure_airport": {"id": "FRA", "time": "2026-08-15 11:00"},
             "arrival_airport": {"id": "JFK", "time": "2026-08-15 14:00"},
             "flight_number": "LH 400", "airline": "Lufthansa"},
        ]
        o = self._offer(conn)
        self.assertIsNone(o["flight_number"])

    def test_backward_compatible_fields_present(self):
        o = self._offer(self._nonstop())
        for key in ("source", "itinerary_source", "displayed_itinerary", "price",
                    "currency", "origin", "dest", "date", "airline", "airlineCode",
                    "stops", "via", "durationMin", "links", "dealScore", "scoreReason"):
            self.assertIn(key, o)
        self.assertEqual(o["itinerary_source"], "cash_offer")
        self.assertEqual(o["displayed_itinerary"], "cash")


class CashCardRenderMarkup(unittest.TestCase):
    """R1: static assertions on the Cash-card render path and styling."""

    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "static", "app.js"), encoding="utf-8") as f:
            self.js = f.read()
        with open(os.path.join(root, "static", "app.css"), encoding="utf-8") as f:
            self.css = f.read()

    def test_renderer_shows_complete_times(self):
        self.assertIn("cash-itin-times", self.js)
        self.assertIn("cash-itin-time", self.js)

    def test_renderer_partial_fallback_copy(self):
        self.assertIn("Cash itinerary details incomplete", self.js)

    def test_renderer_unavailable_fallback_copy(self):
        self.assertIn("Times not available from the current source", self.js)

    def test_renderer_formats_duration(self):
        self.assertIn("fmtDur(o.durationMin)", self.js)

    def test_renderer_stop_labels(self):
        self.assertIn("Nonstop", self.js)
        self.assertIn("1 stop", self.js)
        self.assertIn("stops", self.js)

    def test_renderer_positive_day_change_marker(self):
        self.assertIn("cash-itin-day", self.js)
        self.assertIn("arrival_day_offset > 0", self.js)

    def test_renderer_uses_time_data_status(self):
        self.assertIn("time_data_status", self.js)
        self.assertIn("'complete'", self.js)
        self.assertIn("'partial'", self.js)

    def test_provider_attribution_present_but_secondary(self):
        self.assertIn("Fare data: Google Flights", self.js)
        self.assertIn(".card-fare-source", self.css)
        # The prominent provider byline must not appear in visible Cash-card copy.
        self.assertNotIn('class="card-source">${esc(o.source', self.js)
        self.assertNotIn("Google Flights (SerpApi)", self.js)

    def test_mobile_and_large_text_classes_present(self):
        self.assertIn(".cash-itin-times", self.css)
        self.assertIn(".cash-itin-times{font-size:calc(15px * var(--text-scale))}", self.css)
        self.assertIn("flex-wrap:wrap", self.css)


class InvalidCashPriceValidation(unittest.TestCase):
    """P0: invalid fares must never enter the result pipeline."""

    def _seg(self, o="FRA", d="JFK", al="Lufthansa", fn="LH 400"):
        return {"departure_airport": {"id": o, "time": "2026-08-15 10:00"},
                "arrival_airport": {"id": d, "time": "2026-08-15 13:00"},
                "flight_number": fn, "airline": al}

    def _offer(self, price):
        item = {"total_duration": 480, "flights": [self._seg()]}
        if price != "__MISSING__":
            item["price"] = price
        return app._serp_item_to_offer(item, "EUR", None, False)

    # --- valid ---
    def test_positive_int_accepted(self):
        self.assertEqual(self._offer(480)["price"], 480.0)

    def test_positive_float_accepted(self):
        self.assertEqual(self._offer(480.5)["price"], 480.5)

    def test_numeric_string_accepted(self):
        self.assertEqual(self._offer("480")["price"], 480.0)

    # --- invalid → rejected (None) ---
    def test_zero_rejected(self):
        self.assertIsNone(self._offer(0))

    def test_string_zero_rejected(self):
        self.assertIsNone(self._offer("0"))

    def test_negative_rejected(self):
        self.assertIsNone(self._offer(-50))

    def test_null_rejected(self):
        self.assertIsNone(self._offer(None))

    def test_empty_string_rejected(self):
        self.assertIsNone(self._offer(""))

    def test_missing_price_rejected(self):
        self.assertIsNone(self._offer("__MISSING__"))

    def test_non_numeric_rejected(self):
        self.assertIsNone(self._offer("abc"))

    def test_nan_rejected(self):
        self.assertIsNone(self._offer(float("nan")))

    def test_positive_infinity_rejected(self):
        self.assertIsNone(self._offer(float("inf")))

    def test_negative_infinity_rejected(self):
        self.assertIsNone(self._offer(float("-inf")))

    def test_boolean_rejected(self):
        self.assertIsNone(self._offer(True))
        self.assertIsNone(self._offer(False))

    def test_valid_price_helper_direct(self):
        self.assertEqual(app._valid_price(480), 480.0)
        self.assertEqual(app._valid_price("480"), 480.0)
        for bad in (0, "0", -1, None, "", "abc", float("nan"),
                    float("inf"), float("-inf"), True, False):
            self.assertIsNone(app._valid_price(bad))

    def test_invalid_price_does_not_score_or_link(self):
        # If scoring/link generation ran on an invalid price it would raise or
        # produce output; rejection returns None before any of that.
        calls = {"deal_score": 0, "score_reason": 0, "links_for": 0}
        orig = (app.deal_score, app.score_reason, app.links_for)
        app.deal_score = lambda *a, **k: calls.__setitem__("deal_score", calls["deal_score"] + 1) or 0
        app.score_reason = lambda *a, **k: calls.__setitem__("score_reason", calls["score_reason"] + 1) or ""
        app.links_for = lambda *a, **k: calls.__setitem__("links_for", calls["links_for"] + 1) or {}
        try:
            self.assertIsNone(self._offer(0))
            self.assertIsNone(self._offer(-50))
            self.assertIsNone(self._offer(float("nan")))
            self.assertEqual(calls, {"deal_score": 0, "score_reason": 0, "links_for": 0})
        finally:
            app.deal_score, app.score_reason, app.links_for = orig

    def test_valid_offer_behavior_unchanged(self):
        o = self._offer(480)
        self.assertEqual(o["price"], 480.0)
        self.assertEqual(o["time_data_status"], "complete")
        self.assertIn("dealScore", o)
        self.assertIn("links", o)


class CheapApiMixedPrices(unittest.TestCase):
    """P0: /api/cheap keeps valid offers, drops invalid, never 500s."""

    def setUp(self):
        self.client = app.app.test_client()
        self._orig_search = app.serpapi_search
        self._orig_token = app.SERPAPI_TOKEN
        self._orig_source = app.PRICE_SOURCE
        app.SERPAPI_TOKEN = "test"
        app.PRICE_SOURCE = "serpapi"

    def tearDown(self):
        app.serpapi_search = self._orig_search
        app.SERPAPI_TOKEN = self._orig_token
        app.PRICE_SOURCE = self._orig_source

    def _seg(self, al, fn):
        return {"departure_airport": {"id": "FRA", "time": "2026-08-15 10:00"},
                "arrival_airport": {"id": "JFK", "time": "2026-08-15 13:00"},
                "flight_number": fn, "airline": al}

    def _run_with(self, bad_price):
        def fake(origin, dest, dep, ret, cabin, currency, lang="de"):
            return {"best_flights": [
                {"price": 480, "total_duration": 480, "flights": [self._seg("Lufthansa", "LH 400")]},
                {"price": bad_price, "total_duration": 500, "flights": [self._seg("KLM", "KL 641")]},
            ], "price_insights": {"typical_price_range": [400, 900]}}
        app.serpapi_search = fake
        r = self.client.post("/api/cheap", json={"origin": "FRA", "dest": "JFK",
                                                 "date": "2026-08-15", "oneWay": True})
        return r

    def test_mixed_valid_and_invalid_returns_only_valid(self):
        for bad in (0, -50, None, "abc", float("nan"), float("inf")):
            r = self._run_with(bad)
            self.assertEqual(r.status_code, 200, f"bad={bad!r} should not 500")
            offers = r.get_json().get("offers") or []
            prices = [o["price"] for o in offers]
            self.assertIn(480.0, prices, f"valid offer dropped for bad={bad!r}")
            for p in prices:
                self.assertTrue(math_isfinite(p) and p > 0, f"invalid price surfaced: {p!r} (bad={bad!r})")

    def test_invalid_offer_does_not_displace_valid(self):
        # negative previously scored highest and became the sole result.
        r = self._run_with(-50)
        offers = r.get_json().get("offers") or []
        self.assertTrue(any(o["price"] == 480.0 for o in offers))
        self.assertFalse(any(o["price"] < 0 for o in offers))


class CashCardInvalidPriceFrontendDefense(unittest.TestCase):
    """P0: cheapCardsHtml filters invalid prices (defense in depth)."""

    @classmethod
    def setUpClass(cls):
        cls.root = pathlib.Path(__file__).resolve().parents[1]
        cls.app_js = cls.root / "static" / "app.js"
        bundled_node = pathlib.Path(
            r"C:\Users\Flo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        )
        cls.node = shutil.which("node") or (str(bundled_node) if bundled_node.exists() else None)

    def setUp(self):
        self.js = self.app_js.read_text(encoding="utf-8")

    def test_frontend_uses_boolean_rejecting_helper(self):
        self.assertIn("function isValidCashPrice(v)", self.js)
        self.assertIn("typeof v === 'boolean'", self.js)
        self.assertIn("isValidCashPrice(o.price)", self.js)

    def test_frontend_filter_runs_before_sort(self):
        idx_filter = self.js.find(".filter(o => o && isValidCashPrice(o.price))")
        idx_sort = self.js.find("sorted.sort(")
        self.assertGreater(idx_filter, -1)
        self.assertGreater(idx_sort, idx_filter)

    def test_price_render_uses_math_round(self):
        # Guard remains the sole path; invalid prices never reach this line.
        self.assertIn("Math.round(o.price)", self.js)

    def _eval_helper(self, cases_json):
        if not self.node:
            self.skipTest("Node.js is required for frontend price-helper tests")
        src = self.js
        start = src.index("function isValidCashPrice(v)")
        end = src.index("\n}", start) + 2
        helper = src[start:end]
        script = helper + (
            "\nconst cases = " + cases_json + ";"
            "\nprocess.stdout.write(JSON.stringify(cases.map(c => isValidCashPrice(c))));"
        )
        out = subprocess.run([self.node, "-e", script], text=True, capture_output=True, timeout=20)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_helper_accepts_valid_rejects_invalid(self):
        # Order: 480, "480", true, false, "   ", 0, -50, NaN, Infinity, null, "", "abc"
        results = self._eval_helper('[480, "480", true, false, "   ", 0, -50, NaN, Infinity, null, "", "abc"]')
        self.assertEqual(
            results,
            [True, True, False, False, False, False, False, False, False, False, False, False],
        )

    def test_helper_rejects_booleans_explicitly(self):
        self.assertEqual(self._eval_helper("[true, false]"), [False, False])

    def test_helper_rejects_whitespace_string(self):
        self.assertEqual(self._eval_helper('["   ", "\\t", " 0 "]'), [False, False, False])

    def test_helper_accepts_positive_numeric_string_and_number(self):
        self.assertEqual(self._eval_helper('["480", 480, 1]'), [True, True, True])


def math_isfinite(x):
    try:
        import math as _m
        return _m.isfinite(float(x))
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    unittest.main()
