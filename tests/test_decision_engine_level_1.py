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


if __name__ == "__main__":
    unittest.main()
