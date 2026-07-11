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
        self.assertIn(" \u00B7 ", d["freshness_label"])
        self.assertNotIn("Â·", d["freshness_label"])

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
            self.assertIn(" → ", result["route"])
            self.assertNotIn("â†’", result["route"])
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
        self.assertIn("app.css?v=160", html)
        self.assertIn("app.js?v=163", html)
        self.assertNotIn("app.css?v=159", html)
        self.assertNotIn("app.js?v=161", html)
        self.assertNotIn("app.js?v=157", html)
        self.assertIn("Know what&rsquo;s worth checking.", html)
        self.assertIn("with clear trade-offs, confidence signals and official verification guidance.", html)
        self.assertIn("Fare context", html)
        self.assertIn("Award value", html)
        self.assertIn("Verification guidance", html)
        self.assertNotIn("Find where your<br>miles go further.", html)
        self.assertNotIn("all in one trusted decision view.", html)
        self.assertNotIn("Price context", html)
        self.assertNotIn("Routing confidence", html)
        self.assertNotIn("Official verification", html)
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
        self.assertIn("app.css?v=160", html)
        self.assertIn("consent.css?v=2", html)
        self.assertNotIn("app.js?v=147", html)

    def test_about_navigation_exists_on_main_page(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('class="nav-link" href="/about"', html)
        self.assertIn('<a href="/about">About</a>', html)
        self.assertIn("app.css?v=160", html)
        self.assertIn("app.js?v=163", html)

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

    def test_about_legacy_notice_replaced(self):
        html = self.client.get("/about").get_data(as_text=True)
        self.assertIn("Verify before booking — AwardRadar provides decision support only.", html)
        self.assertNotIn("beta-notice", html)
        self.assertNotIn("beta-tag", html)
        self.assertNotIn("decision-support context based on fare and award data", html)
        trust_note = html.split('<div class="trust-note">', 1)[1].split('</div>', 1)[0]
        self.assertNotIn("hello@awardradar.app", trust_note)
        self.assertIn('<a href="mailto:hello@awardradar.app">Contact</a>', html)

    def test_legacy_notice_css_removed(self):
        css = (pathlib.Path(__file__).parents[1] / "static" / "app.css").read_text(encoding="utf-8")
        self.assertNotIn(".beta-notice", css)
        self.assertNotIn(".beta-tag", css)

    def test_about_appears_in_sitemap(self):
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://awardradar.app/about", response.get_data(as_text=True))


class UiNextVisualArchitecture(unittest.TestCase):
    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "static", "ui-next.css"), encoding="utf-8") as handle:
            self.css = handle.read()
        with open(os.path.join(root, "templates", "index.html"), encoding="utf-8") as handle:
            self.index_html = handle.read()

    def test_ui_next_is_an_isolated_last_visual_layer(self):
        self.assertIn('/static/ui-next.css?v=1', self.index_html)
        self.assertGreater(
            self.index_html.index('/static/ui-next.css?v=1'),
            self.index_html.index('/static/app.css?v=160'),
        )

    def test_ui_next_defines_dual_font_and_document_materials(self):
        self.assertIn('--nx-display:"Inter","Source Sans 3"', self.css)
        self.assertIn('--nx-reading:"Source Sans 3"', self.css)
        self.assertIn('--nx-canvas:#e8eef4', self.css)
        self.assertIn('--nx-document:#fcfdfe', self.css)
        self.assertIn('--nx-canvas:#071525', self.css)
        self.assertIn('.recommendation-card{border:0', self.css)

    def test_ui_next_keeps_responsive_layout_without_mobile_frames(self):
        self.assertIn('@media(max-width:640px)', self.css)
        self.assertIn('.tabs{gap:2px;margin-bottom:18px;padding:3px;border:0}', self.css)


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
const document = {{ documentElement: {{ getAttribute: () => 'en' }} }};
function esc(s) {{
  return String(s ?? '').replace(/[&<>"]/g, c => ({{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }}[c]));
}}
const SIGNAL_LABEL = {{ exceptional: 'Strong award signal', great: 'Award signal' }};
const REC_LABEL = {{
  book_miles: 'Verify miles option',
  lean_miles: 'Lean towards Miles',
  consider: 'Compare options',
  pay_cash: 'Pay Cash',
}};
const container = {{ innerHTML: '' }};
{"function formatUserDate(dateStr)" + js.split("function formatUserDate(dateStr)", 1)[1].split("function fmtDur(min)", 1)[0]}
{"const SEARCH_MONTHS = [" + js.split("const SEARCH_MONTHS = [", 1)[1].split("function _searchSummaryText()", 1)[0]}
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
        self.assertNotIn("disc-stars", html)
        self.assertIn("FRA", html)
        self.assertIn("JFK", html)
        self.assertIn("2L", html)
        self.assertIn("UNKNOWN", html)
        self.assertIn("Strong award signal", html)
        self.assertIn("Award signal", html)
        self.assertIn("Review value signal", html)
        self.assertNotIn("Review this route", html)
        self.assertNotIn("Exceptional value", html)
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
        self.assertIn("No strong opportunity signals are available right now.", result["html"])
        self.assertNotIn("No exceptional opportunities detected today.", result["html"])
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
        self.assertIn("app.css?v=160", html)
        self.assertIn("consent.css?v=2", html)
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
        self.assertIn("app.css?v=160", html)
        self.assertIn("consent.css?v=2", html)
        self.assertIn('href="/privacy"', html)
        # German legal substance remains intact
        self.assertIn("Art. 6 Abs. 1 lit. f DSGVO", html)
        self.assertIn("§ 25 TDDDG", html)

    def test_impressum_uses_current_assets(self):
        html = self.client.get("/impressum").get_data(as_text=True)
        self.assertIn("app.css?v=160", html)
        self.assertIn("consent.css?v=2", html)
        self.assertNotIn("app.css?v=156", html)
        self.assertNotIn("app.css?v=155", html)
        self.assertNotIn("app.css?v=154", html)
        self.assertNotIn("app.css?v=153", html)
        self.assertNotIn("consent.css?v=1", html)

    def test_legal_pages_include_theme_toggle_hooks(self):
        for path in ("/impressum", "/privacy", "/datenschutz"):
            html = self.client.get(path).get_data(as_text=True)
            self.assertIn('class="about-page"', html)
            self.assertIn('id="themeBtn"', html)
            self.assertIn('id="themeIconMoon"', html)
            self.assertIn('id="themeIconSun"', html)
            self.assertIn("awardradar_theme", html)

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
        with open(os.path.join(root, "templates", "index.html"), encoding="utf-8") as f:
            self.html = f.read()

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

    def test_provider_attribution_is_available_only_in_disclosure(self):
        disclosure = self.js.split("function sourceDisclosureHtml(obj)", 1)[1].split("function actionLinksHtml", 1)[0]
        self.assertIn("entries.map", disclosure)
        self.assertNotIn("card-fare-source", self.js)
        self.assertNotIn("link-provider", self.js)
        # The prominent provider byline must not appear in visible Cash-card copy.
        self.assertNotIn('class="card-source">${esc(o.source', self.js)
        self.assertNotIn("Google Flights (SerpApi)", self.js)

    def test_mobile_and_large_text_classes_present(self):
        self.assertIn(".cash-itin-times", self.css)
        self.assertIn(".cash-itin-times{font-size:calc(15px * var(--text-scale))}", self.css)
        self.assertIn("flex-wrap:wrap", self.css)


class R2BCashDecisionCard(unittest.TestCase):
    """R2B-1: Recommendation card, compact alternatives, date localization, source disclosure."""

    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "static", "app.js"), encoding="utf-8") as f:
            self.js = f.read()
        with open(os.path.join(root, "static", "app.css"), encoding="utf-8") as f:
            self.css = f.read()
        with open(os.path.join(root, "templates", "index.html"), encoding="utf-8") as f:
            self.html = f.read()

    def test_recommendation_card_structure_present(self):
        """Scope A: First Cash result has distinct recommendation card structure."""
        self.assertIn(".recommendation-card", self.css)
        self.assertIn(".rec-verdict", self.css)
        self.assertIn(".rec-meta", self.css)
        self.assertIn(".rec-cta", self.css)

    def test_recommendation_card_uses_composed_reading_width(self):
        """Primary decision card should constrain briefing sections without shrinking the outer shell."""
        self.assertIn(".rec-brief{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(220px,.72fr)", self.css)
        self.assertIn(".rec-brief-main{display:flex;flex-direction:column;gap:10px;min-width:0;max-width:620px}", self.css)
        self.assertIn("class=\"rec-brief-side\"", self.js)
        self.assertIn("card-price rec-price-panel${isWeakAssessment ? ' price-evidence' : ''}", self.js)

    def test_compact_alternatives_present(self):
        """Scope F: Non-first results use compact structure."""
        self.assertIn(".compact-alternative", self.css)
        self.assertIn(".compact-row", self.css)
        self.assertIn(".compact-route", self.css)
        self.assertIn(".compact-price", self.css)
        self.assertIn(".compact-value", self.css)

    def test_award_program_grid_keeps_evaluated_card_intentional(self):
        """Evaluated redemption card should not stretch into a lonely full-width tile."""
        self.assertIn(".aw-cards-grid-briefing{grid-template-columns:minmax(0,1fr);margin-bottom:0}", self.css)
        self.assertIn(".aw-cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,280px));justify-content:start", self.css)
        self.assertIn("class=\"aw-cards-grid aw-cards-grid-briefing\"", self.js)

    def test_award_result_uses_two_column_briefing_composition(self):
        """Award recommendation should pair verdict and evidence in one desktop briefing block."""
        self.assertIn(".aw-briefing{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(300px,.82fr)", self.css)
        self.assertIn("class=\"aw-briefing\"", self.js)
        self.assertIn("class=\"aw-evidence\"", self.js)
        self.assertIn("class=\"aw-program-options\"", self.js)

    def test_typography_tokens_define_ledger_and_cockpit_layers(self):
        self.assertIn('font-family:"Inter";', self.css)
        self.assertIn('--font-body:"Source Sans 3",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;', self.css)
        self.assertIn("--font-sans:var(--font-body);", self.css)
        self.assertIn('--font-display:"Inter",var(--font-body);', self.css)
        self.assertIn('--font-data:"Inter",var(--font-body);', self.css)
        self.assertIn("body{min-height:100vh;font-family:var(--font-sans)", self.css)

    def test_typography_cockpit_selectors_use_display_and_data_fonts(self):
        self.assertIn(".price,.price-currency,.aw-card-miles,.aw-card-miles-unit,.aw-miles,.aw-cpm,.aw-meta-cpm,.aw-metric-val,.bdc-cpp,.score-num,.aw-trust-v,.aw-route-code,.journey-node-main{font-family:var(--font-data)}", self.css)
        self.assertIn(".rec-verdict,.cg-headline,.aw-verdict-h{font-family:var(--font-display)}", self.css)
        self.assertIn(".search-summary-text{font-family:var(--font-body)}", self.css)
        self.assertIn(".pa-code{letter-spacing:.02em;line-height:1;font-family:var(--font-body)}", self.css)
        self.assertNotIn(".tab-title,.go-main{font-family:var(--font-display)}", self.css)

    def test_compact_journey_summary_present(self):
        """Scope C: Compact Cash journey summary renderer exists."""
        self.assertIn("compactCashJourneySummary", self.js)
        self.assertIn(".compact-cash-journey", self.css)
        self.assertIn(".journey-strip", self.css)
        self.assertIn(".journey-node", self.css)
        self.assertIn(".journey-facts", self.css)
        self.assertIn(".ccjs-route", self.css)
        self.assertIn(".ccjs-times", self.css)
        self.assertIn(".ccjs-trip-meta", self.css)
        self.assertIn(".ccjs-via", self.css)

    def test_itinerary_priority_markup_present_in_cash_cards(self):
        self.assertIn("class=\"journey-strip", self.js)
        self.assertIn("journey-node-main", self.js)
        self.assertIn("journey-via", self.js)
        self.assertIn("class=\"journey-facts\"", self.js)
        self.assertIn("class=\"ccjs-times\"", self.js)
        self.assertIn("class=\"ccjs-trip-meta\"", self.js)
        self.assertIn("class=\"compact-times\"", self.js)
        self.assertIn("class=\"compact-trip-meta\"", self.js)
        self.assertIn("class=\"compact-date-meta\"", self.js)
        self.assertIn("class=\"compact-via\"", self.js)
        self.assertIn("class=\"compact-time-arrow\"", self.js)

    def test_times_and_trip_meta_remain_visible_without_invention(self):
        self.assertIn("if (dep && arr)", self.js)
        self.assertIn("times = `Dep ${esc(dep)}`", self.js)
        self.assertIn("times = `Arr ${esc(arr)}", self.js)
        self.assertIn("const tripMeta = [dur, stopsLabel].filter(Boolean).join(' · ');", self.js)
        self.assertIn("const tripMetaLine = [durStr, stopsLabel].filter(Boolean).join(' · ');", self.js)
        self.assertNotIn("esc(o.return_dep_time)", self.js)
        self.assertNotIn("esc(o.return_arr_time)", self.js)

    def test_cash_card_renderer_outputs_itinerary_priority_html(self):
        bundled_node = pathlib.Path(
            r"C:\Users\Flo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        )
        node = shutil.which("node") or (str(bundled_node) if bundled_node.exists() else None)
        if not node:
            self.skipTest("Node.js is required for frontend rendering regression tests")

        script = f"""
const fs = require('fs');
const document = {{ documentElement: {{ getAttribute: () => 'en' }} }};
const src = fs.readFileSync({json.dumps(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "app.js"))}, 'utf8');
function between(start, end) {{
  const s = src.indexOf(start);
  if (s < 0) throw new Error('missing start marker: ' + start);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error('missing end marker: ' + end);
  return src.slice(s, e);
}}
const block = [
  between('function formatUserDate(dateStr)', 'function aircraftStub'),
  between('function esc(s)', 'async function run()'),
  between('const SEARCH_MONTHS = [', 'function _searchSummaryText()'),
  between('const CASH_TIER_CSS = {{', 'function priceTiers(calendar)'),
  between('function cashItineraryHtml(o)', '// Client-side mirror of the backend valid-price rule'),
  between('function isValidCashPrice(v)', 'function decisionGuidanceHtml(guidance)'),
  between('function decisionGuidanceHtml(guidance)', 'function render(data)'),
].join('\\n');
eval(block);
const offers = [
  {{
    offer_id: 'offer-1',
    origin: 'FRA',
    dest: 'JFK',
    dep_time: '07:30',
    arr_time: '10:15',
    durationMin: 465,
    stops: 0,
    via: [],
    airline: 'Lufthansa',
    airlineCode: 'LH',
    flight_number: 'LH 400',
    date: '2026-10-20',
    returnDate: '2026-10-28',
    currency: 'EUR',
    price: 510,
    dealScore: 84,
    tier: 'great',
    label: 'Strong Value',
    links: {{ 'Google Flights': 'https://example.com/gf', 'Kayak': 'https://example.com/ky' }}
  }},
  {{
    offer_id: 'offer-2',
    origin: 'FRA',
    dest: 'JFK',
    dep_time: '09:10',
    arr_time: '12:05',
    durationMin: 490,
    stops: 1,
    via: ['BOS'],
    airline: 'United',
    airlineCode: 'UA',
    flight_number: 'UA 101',
    date: '2026-10-20',
    currency: 'EUR',
    price: 560,
    dealScore: 71,
    tier: 'good',
    label: 'Fair Value',
    links: {{ 'Google Flights': 'https://example.com/gf2' }}
  }}
];
const guidance = {{
  recommended_offer_id: 'offer-1',
  headline: 'Test headline',
  why: 'Test why',
  watch_out: 'Test watch out',
  next_step: 'Test next step',
  evidence_level: 'medium'
}};
const html = cheapCardsHtml(offers, 'score', guidance, {{
  roundTripRequested: true,
  decisionActionsMarkup: '<div class="decision-actions"><button>Compare award options</button></div>'
}});
process.stdout.write(html);
"""
        out = subprocess.run([node, "-e", script], text=True, capture_output=True, timeout=20)
        self.assertEqual(out.returncode, 0, out.stderr)
        html = out.stdout
        self.assertIn('class="ccjs-route"', html)
        self.assertIn('class="journey-strip"', html)
        self.assertIn('class="journey-node journey-node-main"', html)
        self.assertTrue('class="ccjs-times"' in html or 'class="compact-times"' in html)
        self.assertTrue('class="ccjs-trip-meta"' in html or 'class="compact-trip-meta"' in html)
        self.assertIn("FRA", html)
        self.assertIn("JFK", html)
        self.assertIn("class=\"journey-node journey-via\"", html)
        self.assertIn("BOS", html)
        top_card_start = html.find('class="card recommendation-card')
        compact_start = html.find('class="card compact-alternative')
        self.assertGreaterEqual(top_card_start, 0)
        self.assertGreater(compact_start, top_card_start)
        top_card_html = html[top_card_start:compact_start]
        self.assertNotIn('class="journey-node journey-via"', top_card_html)
        lowered = html.lower()
        self.assertNotIn("aircraft", lowered)
        self.assertNotIn("terminal", lowered)
        self.assertNotIn("baggage", lowered)
        self.assertNotIn("layover", lowered)
        self.assertNotIn("self-transfer", lowered)
        self.assertNotIn("hello@awardradar.app", html)
        self.assertNotIn("decision-support context", html)
        self.assertIn("Lufthansa", html)
        self.assertIn("LH 400", html)
        self.assertIn("Verify current fare", html)
        self.assertNotIn("View fare", html)
        self.assertIn("Google Flights", html)
        self.assertNotIn("AwardRadar does not sell or book fares.", top_card_html)
        self.assertEqual(top_card_html.count('class="link-primary"'), 1)

    def test_date_formatter_present(self):
        """Scope D: Date localization helper formatUserDate exists."""
        self.assertIn("function formatUserDate(dateStr)", self.js)

    def test_central_formatters_present(self):
        self.assertIn("function formatMoney(value, currency = 'EUR')", self.js)
        self.assertIn("function formatMilesNumber(value)", self.js)
        self.assertIn("function formatMiles(value, unit = 'miles')", self.js)
        self.assertIn("function formatCpm(value)", self.js)
        self.assertIn("function formatTripDate(value)", self.js)
        self.assertIn("function formatTripDateRange(start, end)", self.js)

    def test_visual_token_primitives_present(self):
        self.assertIn("--ar-bg-deep", self.css)
        self.assertIn("--ar-surface-glass", self.css)
        self.assertIn("--ar-border-subtle", self.css)
        self.assertIn("--ar-border-focus", self.css)
        self.assertIn("--ar-accent-cyan", self.css)
        self.assertIn("--ar-accent-mint", self.css)
        self.assertIn("--ar-caution-amber", self.css)

    def test_number_formatters_lock_international_locale(self):
        self.assertIn("num.toLocaleString('en-US'", self.js)
        self.assertIn("Math.round(num).toLocaleString('en-US')", self.js)
        self.assertNotIn("toLocaleString(undefined", self.js)

    def test_award_card_miles_keep_split_span_structure(self):
        self.assertIn('class="aw-card-miles">${esc(formatMilesNumber(p.miles) || \'—\')}</span>', self.js)
        self.assertIn('<span class="aw-card-miles-unit">miles</span>', self.js)
        self.assertNotIn('class="aw-card-miles">${esc(formatMiles(p.miles))}', self.js)

    def test_trip_dates_use_central_formatters(self):
        self.assertIn("const dateContext = formatTripDateRange(r.date, r.returnDate);", self.js)
        self.assertIn("esc(formatTripDate(r.date))", self.js)
        self.assertIn("Date: ${formatTripDate(o.available_date)}", self.js)
        self.assertNotIn("${r.date} -> ${r.returnDate}", self.js)
        self.assertNotIn("Date: ${o.available_date}", self.js)

    def test_money_displays_use_central_formatter(self):
        self.assertIn("formatMoney(o.price, o.currency)", self.js)
        self.assertIn("formatMoney(r.cash_eur)", self.js)
        self.assertIn("formatMoney(cal.price)", self.js)
        self.assertIn("formatMoney(fees)", self.js)
        self.assertNotIn("Potential difference ~${Math.round(r.savings)} EUR vs direct", self.js)
        self.assertNotIn(" + EUR ${Math.round(fees)}", self.js)

    def test_cpm_unit_is_ct_per_mile(self):
        self.assertIn("return `${num.toFixed(1)} ct/mi`;", self.js)
        self.assertNotIn("${cpm.toFixed(1)} ct", self.js)

    def test_source_disclosure_present(self):
        """Source transparency remains available as demoted verification context."""
        self.assertIn("sourceDisclosureHtml", self.js)
        self.assertIn("Fare sources and verification options", self.js)
        self.assertNotIn("Compare sources", self.js)
        self.assertIn(".source-disclosure", self.css)
        self.assertIn(".source-toggle", self.css)
        self.assertIn(".source-popover", self.css)

    def test_source_disclosure_keyboard_accessible(self):
        """Scope E: Source toggle has keyboard focus styles."""
        self.assertIn(".source-toggle:focus-visible", self.css)
        self.assertIn("outline:2px solid var(--cyan)", self.css)

    def test_airline_rendered_prominently(self):
        """Scope B: Airline name rendered at card level (not tiny metadata)."""
        self.assertIn("class=\"airline-name\"", self.js)
        self.assertIn(".airline-name", self.css)
        self.assertIn(".card-airline", self.css)

    def test_flight_number_rules_unchanged(self):
        """Scope B: Top-level flight number only for single-segment."""
        self.assertIn("o.flight_number ?", self.js)

    def test_verdict_copy_uses_existing_signals(self):
        """Scope A: Verdict text maps to existing sort/tier logic."""
        verdicts = [
            "Lowest fare in this search",
            "Best nonstop option",
            "Fewest stops option",
            "Best available option",
            "Only option found",
            "Exceptional value for this search",
            "Strong value for this search",
            "Best match for this search",
        ]
        for v in verdicts:
            self.assertIn(v, self.js)

    def test_verdict_no_unsupported_claims(self):
        """Scope A: Unsupported claims removed from verdict copy."""
        self.assertNotIn("Exceptional value — nonstop and affordable", self.js)
        self.assertNotIn("nonstop and affordable", self.js)

    def test_cash_cta_uses_verification_not_booking_copy(self):
        self.assertIn("Verify current fare", self.js)
        self.assertIn("Verify current fare externally", self.js)
        self.assertIn('target="_blank" rel="noopener"', self.js)
        self.assertIn("AwardRadar does not sell or book fares.", self.js)
        self.assertNotIn("View fare", self.js)
        self.assertNotIn("Book Now", self.js)
        self.assertNotIn('label: "Buy"', self.js)
        self.assertNotIn('"Buy"', self.js)

    def test_cash_verification_explainer_is_result_level_not_card_level(self):
        helper = self.js.split("function linksHtmlWithLabels(obj)", 1)[1].split("function sourceDisclosureHtml", 1)[0]
        self.assertNotIn("AwardRadar does not sell or book fares.", helper)
        self.assertIn("function cashVerificationExplainerHtml()", self.js)
        self.assertIn("External verification", self.js)
        self.assertIn("AwardRadar does not sell or book fares.", self.js)
        self.assertIn("cashVerificationExplainerHtml()", self.js)
        self.assertIn(".cash-result-verification", self.css)

    def test_header_ready_pill_and_value_signal_hint_are_removed(self):
        self.assertNotIn('id="status"', self.html)
        self.assertNotIn('>ready<', self.html)
        legend = self.js.split("function scoreLegendHtml()", 1)[1].split("function cashVerificationExplainerHtml", 1)[0]
        self.assertIn("What is the Value Signal?", legend)
        self.assertNotIn("tap to expand", legend)
        self.assertNotIn("legend-hint", self.css)

    def test_cash_primary_link_hierarchy_keeps_one_verification_path(self):
        helper = self.js.split("function linksHtmlWithLabels(obj)", 1)[1].split("function sourceDisclosureHtml", 1)[0]
        self.assertIn("const [, url] = entries[0];", helper)
        self.assertNotIn("entries.map", helper)
        disclosure = self.js.split("function sourceDisclosureHtml(obj)", 1)[1].split("function actionLinksHtml", 1)[0]
        self.assertIn("entries.map", disclosure)

    def test_score_and_grade_are_demoted_from_primary_surface(self):
        score = self.js.split("function scoreHtml(o)", 1)[1].split("function bestBadgeHtml", 1)[0]
        self.assertIn('<details class="score-block score-details', score)
        self.assertIn("<summary>Assessment details</summary>", score)
        self.assertNotIn("/100", score)
        self.assertNotIn("score-grade", score)
        self.assertNotIn("score-num", score)
        self.assertIn("relativeSignalLabel", score)
        self.assertIn(".score-details", self.css)

    def test_cash_assessment_hierarchy_demotes_price_and_provider_details(self):
        self.assertIn("assessment-caution", self.js)
        self.assertIn("price-evidence", self.js)
        self.assertIn(".assessment-caution .rec-price-panel", self.css)
        self.assertIn(".price-evidence .price", self.css)
        self.assertIn("order:1", self.css)
        self.assertIn("order:2", self.css)

    def test_compact_cards_use_lowest_returned_fare_not_cheapest_wording(self):
        facts = self.js.split("function journeyFactsHtml", 1)[1].split("// Client-side mirror", 1)[0]
        self.assertIn("Lowest returned fare", facts)
        self.assertNotIn("Cheapest returned option", facts)

    def test_compact_cash_labels_are_neutral(self):
        self.assertIn("Stronger relative signal", self.js)
        self.assertIn("Moderate relative signal", self.js)
        self.assertIn("Weaker relative signal", self.js)
        self.assertNotIn("C · Pricey", self.js)
        self.assertNotIn("D · Weak", self.js)

    def test_cash_reason_copy_is_deaggregated_in_display_layer(self):
        self.assertIn("function cashReasonDisplay(reason)", self.js)
        self.assertIn("Lowest returned fare", self.js)
        self.assertIn("Higher than lowest returned fare", self.js)
        self.assertIn("Nonstop itinerary", self.js)
        self.assertIn("One-stop itinerary", self.js)

    def test_cash_sort_controls_are_reframed_without_key_changes(self):
        self.assertIn("Review by:", self.js)
        self.assertIn(">Assessment</button>", self.js)
        self.assertIn(">Fare amount</button>", self.js)
        self.assertIn(">Routing simplicity</button>", self.js)
        self.assertIn("data-sort=\"score\"", self.js)
        self.assertIn("data-sort=\"price\"", self.js)
        self.assertIn("data-sort=\"nonstop\"", self.js)

    def test_cash_note_avoids_beta_cache_wording(self):
        note = app.TEXT["cheap_note_live"]["en"]
        self.assertEqual(note, "Fare context from external sources. Confirm the current fare and itinerary details before booking.")
        self.assertNotIn("Cached during beta", note)

    def test_debug_resolved_line_removed(self):
        """Scope G: Debug Resolved block no longer rendered in user-facing HTML."""
        # The render() function must NOT output the debug block at all
        self.assertNotIn('style="display:none"', self.js)
        # But "Resolved" should not appear in the rendered output section
        # (it may appear in comments, but not in the render function's output)
        render_section = self.js.split('function render(data)')[1].split('function ')[0] if 'function render(data)' in self.js else ''
        if 'Resolved:' in render_section:
            self.fail("Debug 'Resolved:' block still appears in render() output")

    def test_escape_handler_present(self):
        """Keyboard accessibility: Escape key handler exists for source disclosure."""
        self.assertIn("e.key !== 'Escape'", self.js)
        self.assertIn(".source-popover:not([hidden])", self.js)
        self.assertIn("btn.focus()", self.js)

    def test_mobile_compact_value_readable(self):
        """Mobile text sizing: compact-value font-size at least 11px."""
        # Check mobile override doesn't use font-size below 11px
        self.assertNotIn(".compact-value{font-size:9px", self.css)
        self.assertNotIn(".compact-value{font-size:10px", self.css)
        # Should use 11px or higher on mobile
        self.assertIn(".compact-value{font-size:11px", self.css)

    def test_score_remains_available_secondary(self):
        """Scope: Score visible but demoted (not removed)."""
        self.assertIn("scoreHtml(o)", self.js)
        self.assertIn("${scoreHtml(o)}", self.js)
        self.assertNotIn("//scoreHtml(o)", self.js)

    def test_recommendation_card_first_only(self):
        """Only the first result (i === 0) becomes recommendation card."""
        self.assertIn("if (isTop)", self.js)
        self.assertIn(".recommendation-card", self.css)
        self.assertIn("decisionActionsHtml()", self.js)
        self.assertIn("Compare award options", self.js)
        self.assertIn("Check hidden opportunities", self.js)

    def test_frontend_consumes_backend_cash_guidance(self):
        """Guidance block must come from backend cash_guidance payload."""
        self.assertIn("currentCashGuidance = data.cash_guidance || null", self.js)
        self.assertIn("function decisionGuidanceHtml(guidance)", self.js)
        self.assertIn("guidance.headline", self.js)
        self.assertIn("guidance.why", self.js)
        self.assertIn("guidance.watch_out", self.js)
        self.assertIn("guidance.next_step", self.js)
        self.assertIn("guidance.evidence_level", self.js)
        self.assertIn("Decision guidance", self.js)
        self.assertIn("Evidence level:", self.js)
        self.assertIn("returnDisclosureHtml", self.js)
        self.assertIn("Return itinerary details unavailable from current fare source. Verify return flight times before purchase.", self.js)

    def test_recommended_offer_id_is_used_without_frontend_recompute(self):
        """Frontend marks backend-selected offer; no recommendation state machine."""
        self.assertIn("guidance.recommended_offer_id", self.js)
        self.assertIn("o.offer_id === recommendedId", self.js)
        self.assertIn("Recommended option", self.js)
        self.assertIn("Best returned option", self.js)
        self.assertIn("Only returned option", self.js)
        self.assertNotIn("recommendation_state ===", self.js)

    def test_sorting_preserves_recommended_offer_visibility(self):
        """Recommended offer is moved to visible first card regardless of sort."""
        self.assertIn("sorted = [recommended, ...sorted.filter(o => o.offer_id !== recommendedId)]", self.js)
        self.assertIn("cheapCardsHtml(currentOffers, key, currentCashGuidance, { roundTripRequested: currentCheapRoundTripRequested })", self.js)
        self.assertIn("if (!hasPrimaryDecisionActions) {", self.js)
        self.assertIn("html += relatedAnalysesHtml('cheap');", self.js)

    def test_related_analyses_falls_back_when_primary_actions_missing(self):
        """Cheap path keeps Related analyses when primary decision actions are unavailable."""
        self.assertIn("const primaryDecisionActionsHtml = decisionActionsHtml();", self.js)
        self.assertIn("const hasPrimaryDecisionActions = !!String(primaryDecisionActionsHtml || '').trim();", self.js)
        self.assertIn("decisionActionsMarkup: primaryDecisionActionsHtml", self.js)
        self.assertIn("if (!hasPrimaryDecisionActions) {", self.js)
        self.assertIn("html += relatedAnalysesHtml('cheap');", self.js)

    def test_cash_guidance_missing_falls_back_safely(self):
        """No guidance payload must render existing card flow without empty blocks."""
        self.assertIn("if (!guidance || typeof guidance !== 'object') return '';", self.js)
        self.assertIn("if (!headline && !why && !watchOut && !nextStep && !evidence) return '';", self.js)

    def test_roundtrip_missing_return_details_disclosure_guardrail_present(self):
        self.assertIn("function hasExplicitReturnLegDetails(o)", self.js)
        self.assertIn("function needsReturnDisclosure(o, roundTripRequested)", self.js)
        self.assertIn("if (!roundTripRequested) return false;", self.js)
        self.assertIn("Shown itinerary details are from returned fare data.", self.js)
        self.assertIn("Return itinerary details unavailable from current fare source. Verify return flight times before purchase.", self.js)
        self.assertIn(".rt-disclosure", self.css)
        self.assertIn(".rt-disclosure-k", self.css)

    def test_oneway_path_does_not_force_return_disclosure(self):
        self.assertIn("currentCheapRoundTripRequested = !requestPayload.oneWay", self.js)
        self.assertIn("if (!roundTripRequested) return false;", self.js)

    def test_frontend_does_not_render_invented_return_times(self):
        self.assertNotIn("esc(o.return_dep_time)", self.js)
        self.assertNotIn("esc(o.return_arr_time)", self.js)

    def test_result_mode_shell_is_compact_after_search(self):
        """Result mode should use the compact search summary shell and collapse landing hero."""
        self.assertIn("function collapseSearch()", self.js)
        self.assertIn("st.textContent = _searchSummaryText()", self.js)
        self.assertIn('id="landing-state"', self.html)
        self.assertIn('id="searchSummary"', self.html)
        self.assertIn("search-summary", self.html)
        self.assertIn(".shell.has-results #landing-state{display:none}", self.css)
        self.assertIn(".shell.has-results .hero{padding:10px 0 12px", self.css)
        self.assertIn(".shell.has-results .panel{padding:13px 15px 13px", self.css)
        self.assertIn(".shell.has-results .search-summary{gap:8px", self.css)
        self.assertIn(".shell.has-results .results{margin-top:8px;gap:8px}", self.css)

    def test_trust_notices_are_compact_result_context_not_banners(self):
        self.assertIn(".shell.has-results .card.note", self.css)
        self.assertIn("data.note", self.js)

    def test_primary_actions_exist_before_provider_links(self):
        self.assertIn("decision-actions", self.css)
        self.assertIn("Compare award options", self.js)
        self.assertIn("Check hidden opportunities", self.js)
        self.assertIn("decisionActionsHtml()", self.js)
        self.assertIn("switchTabAndRun('awards')", self.js)
        self.assertIn("switchTabAndRun('skiplag')", self.js)

    def test_trust_note_replaces_intelligence_notice(self):
        """Trust note: quiet verification disclosure replaces Intelligence beta-notice."""
        self.assertIn("Verify before booking", self.html)
        self.assertIn(".trust-note", self.css)
        self.assertNotIn("decision-support context", self.html)
        self.assertNotIn("provider .", self.html)
        # Old 'Intelligence' pill removed from this notice context
        idx = self.html.find("trust-note")
        if idx >= 0:
            end = self.html.find("</div>", idx)
            block = self.html[idx:end] if end > idx else self.html[idx:idx+500]
            self.assertNotIn("hello@awardradar.app", block)
            self.assertNotIn("Intelligence", block)

    def test_decision_support_copy_absent_from_index(self):
        """Old decision-support context copy must not appear in index.html."""
        self.assertNotIn("decision-support context", self.html)

    def test_provider_punctuation_not_broken(self):
        """No 'provider .' (space before period) in index.html."""
        self.assertNotIn("provider .", self.html)

    def test_search_mode_controls_include_all_three_modes(self):
        """All three search mode tabs must be present."""
        self.assertIn('data-tab="cheap"', self.html)
        self.assertIn('data-tab="awards"', self.html)
        self.assertIn('data-tab="skiplag"', self.html)
        self.assertIn("Best Value Flights", self.html)
        self.assertIn("Award Redemptions", self.html)
        self.assertIn("Hidden Opportunities", self.html)

    def test_popular_airports_progressive_disclosure_exists(self):
        """Mobile airport disclosure: pa-col-compact class and pa-all-toggle button injected via JS."""
        self.assertIn("pa-col-compact", self.js)
        self.assertIn("pa-all-toggle", self.js)
        self.assertIn("Show all airports", self.js)
        self.assertIn("Show fewer airports", self.js)
        self.assertIn(".pa-col.pa-col-compact .pa-group:not(:first-child){display:none}", self.css)
        self.assertIn(".pa-all-toggle{display:none}", self.css)

    def test_search_cta_validation_still_intact(self):
        """Search CTA must remain disabled until form is valid."""
        self.assertIn('id="go"', self.html)
        self.assertIn('aria-disabled="true"', self.html)
        self.assertIn('id="searchValidationStatus"', self.html)
        self.assertIn("validateSearchForm", self.js)
        self.assertIn("Select origin, destination and departure date to search.", self.html)

    def test_compact_tab_css_present(self):
        """Mobile tabs rendered as compact segmented control."""
        self.assertIn(".tab-icon{display:none}", self.css)
        self.assertIn(".tab-info{display:none}", self.css)
        self.assertIn("flex-direction:row", self.css)

    def test_mobile_tab_labels_intentional(self):
        """Mobile tab titles use short intentional labels; desktop keeps full labels."""
        self.assertIn("tab-label-long", self.html)
        self.assertIn("tab-label-short", self.html)
        self.assertIn("Best Value Flights", self.html)
        self.assertIn("Award Redemptions", self.html)
        self.assertIn("Hidden Opportunities", self.html)
        self.assertIn(".tab-label-short{display:none}", self.css)
        self.assertIn(".tab-label-long{display:none}", self.css)
        self.assertIn(".tab-label-short{display:inline}", self.css)


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

    def test_fallback_routes_use_clean_arrow(self):
        r = self._run_with(None)
        self.assertEqual(r.status_code, 200)
        fallback = r.get_json().get("fallback") or []
        self.assertTrue(fallback)
        self.assertIn(" → ", fallback[0]["route"])
        self.assertNotIn("â†’", fallback[0]["route"])


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

    def test_price_render_uses_central_money_formatter(self):
        # Guard remains the sole path; invalid prices never reach this line.
        self.assertIn("formatMoney(o.price, o.currency)", self.js)

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
