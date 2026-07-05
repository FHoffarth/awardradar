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

    def test_case_1_roundtrip_search_oneway_award_confidence_drops(self):
        base = app.build_decision(_award(1.5), cash_eur=300, cash_is_real=True,
                                  cash_level="within_typical", requested_trip_type="one_way")
        rt = app.build_decision(_award(1.5), cash_eur=300, cash_is_real=True,
                                cash_level="within_typical", requested_trip_type="round_trip")
        self.assertTrue(rt["trip_basis_compatible"])          # normalized to one-way
        self.assertEqual(rt["normalized_trip_type"], "one_way")
        # Confidence must SINK when we assume/normalize vs the clean OW/OW case.
        order = {"low": 0, "medium": 1, "high": 2}
        self.assertLess(order[rt["confidence"]], order[base["confidence"]])

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


if __name__ == "__main__":
    unittest.main()
