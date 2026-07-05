"""Relative Cash Scoring — acceptance tests (unittest, no external deps).

Run: python -m unittest tests.test_relative_cash_scoring -v
Covers the mandatory cases A–H from the Relative Cash Scoring work package.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


def offer(price, stops, dur=None, code="LH", typical=None):
    return {
        "price": float(price),
        "stops": stops,
        "durationMin": dur,
        "airlineCode": code,
        "typicalRange": typical,
    }


def scored(offers):
    app.rescore_offer_set(offers)
    return offers


class RelativeCashScoring(unittest.TestCase):
    def test_case_A_cheapest_nonstop_wins_clearly(self):
        o = scored([offer(174, 0), offer(272, 1), offer(452, 1)])
        self.assertEqual(max(o, key=lambda x: x["dealScore"]), o[0])
        self.assertGreater(o[0]["dealScore"], o[1]["dealScore"] + 20)

    def test_case_B_pricier_but_nonstop_gets_some_credit_not_top(self):
        cheap_1stop, pricier_nonstop = scored([offer(200, 1), offer(240, 0)])
        # Nonstop compensates enough to beat a cheaper 1-stop...
        self.assertGreater(pricier_nonstop["dealScore"], cheap_1stop["dealScore"])
        # ...but is not automatically an Exceptional top score.
        self.assertNotEqual(pricier_nonstop["tier"], "exceptional")

    def test_case_C_expensive_worse_itinerary_low_no_great(self):
        _, expensive = scored([offer(180, 0), offer(600, 2)])
        self.assertLess(expensive["dealScore"], 40)
        self.assertNotIn(expensive["tier"], ("exceptional", "great"))

    def test_case_D_similar_results_scarce_top_labels(self):
        o = scored([offer(300, 1), offer(315, 1), offer(330, 1)])
        exceptional = [x for x in o if x["tier"] == "exceptional"]
        self.assertEqual(len(exceptional), 0)  # no below-typical anchor → none exceptional

    def test_case_E_single_result_no_auto_100(self):
        (only,) = scored([offer(240, 0)])
        self.assertLessEqual(only["dealScore"], app.CASH_SCORE_CONFIG["single_result_cap"])
        self.assertNotEqual(only["dealScore"], 100)
        self.assertEqual(only["scoreContext"], "limited_comparison")
        self.assertEqual(only["scoreConfidence"], "low")

    def test_case_F_all_expensive_best_not_exceptional(self):
        # No typical range / no below-typical anchor → expensive-field cap applies.
        o = scored([offer(900, 1), offer(1100, 1), offer(1400, 2)])
        top = max(o, key=lambda x: x["dealScore"])
        self.assertNotEqual(top["tier"], "exceptional")
        self.assertEqual(top["scoreContext"], "best_available_not_cheap")

    def test_case_G_alliance_does_not_override_poor_value(self):
        # Cheapest is a non-alliance nonstop; alliance option is pricier 1-stop.
        cheap_nonstop, alliance_pricey = scored([offer(200, 0, code="AA"), offer(360, 1, code="LH")])
        self.assertGreater(cheap_nonstop["dealScore"], alliance_pricey["dealScore"] + 20)
        self.assertNotIn(alliance_pricey["tier"], ("exceptional", "great"))

    def test_case_H_missing_duration_degrades_confidence(self):
        o = scored([offer(200, 0, dur=None), offer(260, 0, dur=None)])
        self.assertTrue(all(x["scoreConfidence"] in ("medium", "low") for x in o))
        # Still produces a stable ordering.
        self.assertGreaterEqual(o[0]["dealScore"], o[1]["dealScore"])

    def test_below_typical_enables_exceptional(self):
        # Cheapest nonstop, genuinely below the typical range → may reach Exceptional.
        o = scored([offer(174, 0, dur=600, typical=[220, 400]),
                    offer(272, 1, dur=800, typical=[220, 400])])
        self.assertEqual(o[0]["tier"], "exceptional")
        self.assertNotEqual(o[1]["tier"], "exceptional")

    def test_grade_label_consistency(self):
        o = scored([offer(174, 0, typical=[220, 400]), offer(500, 2)])
        for x in o:
            g = app._cash_grade(x["dealScore"])
            self.assertEqual(x["tier"], g["tier"])
            self.assertEqual(x["grade"], g["grade"])
            self.assertEqual(x["label"], g["label"])

    def test_empty_and_zero_price_safe(self):
        self.assertEqual(app.rescore_offer_set([]), [])
        o = app.rescore_offer_set([offer(0, 0)])  # no positive price
        self.assertEqual(o[0].get("dealScore", None) in (None, 0), True)


if __name__ == "__main__":
    unittest.main()
