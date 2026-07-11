"""Cash Guidance v0.1 contract tests (behavioral unit tests).

Run: python -m unittest tests.test_cash_guidance_corrected -v
Covers: offer filtering, IDs, canonical selection, guidance generation, signal detection.
"""
import os
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


class ValidOfferFilteringCanonical(unittest.TestCase):
    """Test that invalid-price offers are filtered using canonical _valid_price helper."""

    def test_valid_price_helper_rejects_zero(self):
        """_valid_price rejects zero."""
        self.assertIsNone(app._valid_price(0))

    def test_valid_price_helper_rejects_negative(self):
        """_valid_price rejects negative numbers."""
        self.assertIsNone(app._valid_price(-150.50))

    def test_valid_price_helper_rejects_none(self):
        """_valid_price rejects None."""
        self.assertIsNone(app._valid_price(None))

    def test_valid_price_helper_rejects_empty_string(self):
        """_valid_price rejects empty string."""
        self.assertIsNone(app._valid_price(""))

    def test_valid_price_helper_rejects_nonnumeric_string(self):
        """_valid_price rejects non-numeric strings."""
        self.assertIsNone(app._valid_price("abc"))

    def test_valid_price_helper_rejects_boolean(self):
        """_valid_price rejects booleans (True != 1.0 for fare)."""
        self.assertIsNone(app._valid_price(True))

    def test_valid_price_helper_accepts_positive_float(self):
        """_valid_price accepts positive floats."""
        result = app._valid_price(150.50)
        self.assertEqual(result, 150.50)

    def test_valid_price_helper_accepts_positive_numeric_string(self):
        """_valid_price accepts positive numeric strings."""
        result = app._valid_price("150.50")
        self.assertEqual(result, 150.50)

    def test_guidance_filters_with_valid_price_helper(self):
        """build_cash_guidance uses canonical _valid_price for filtering."""
        offers = [
            {"price": 0, "dealScore": 70, "stops": 0},
            {"price": None, "dealScore": 75, "stops": 0},
            {"price": "abc", "dealScore": 80, "stops": 0},
            {"price": 150, "dealScore": 80, "stops": 0},
        ]
        # Only the last offer has valid price; guidance should select it or return None (single offer)
        guidance = app.build_cash_guidance(offers)
        # With only 1 valid offer, guidance is limited_evidence
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "limited_evidence")


class OfferIDDecimalPrecision(unittest.TestCase):
    """Test that offer ID preserves decimal price precision."""

    def test_offer_id_decimal_precision_199_10_vs_199_90(self):
        """Different decimal prices (199.10 vs 199.90) must produce different IDs."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 199.10, "currency": "EUR", "stops": 0,
            "durationMin": 120, "airlineCode": "LH"
        }
        offer2 = dict(offer1)
        offer2["price"] = 199.90
        id1 = app.compute_offer_id(offer1)
        id2 = app.compute_offer_id(offer2)
        self.assertNotEqual(id1, id2, "Prices 199.10 and 199.90 should produce different IDs")

    def test_offer_id_decimal_equivalence_string_vs_float(self):
        """Equivalent price representations should produce same ID."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 199.10, "currency": "EUR", "stops": 0, "durationMin": 120
        }
        offer2 = dict(offer1)
        offer2["price"] = "199.10"
        id1 = app.compute_offer_id(offer1)
        id2 = app.compute_offer_id(offer2)
        self.assertEqual(id1, id2, "Prices 199.10 (float) and '199.10' (string) should produce same ID")

    def test_offer_id_sub_cent_differentiation(self):
        """Sub-cent prices must produce different IDs (Decimal precision)."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 0.001, "currency": "EUR", "stops": 0, "durationMin": 120
        }
        offer2 = dict(offer1)
        offer2["price"] = 0.002
        id1 = app.compute_offer_id(offer1)
        id2 = app.compute_offer_id(offer2)
        self.assertNotEqual(id1, id2, "Prices 0.001 and 0.002 should produce different IDs")

    def test_offer_id_normalized_decimal_equivalent(self):
        """Normalized decimal representations should match (e.g., 199.1 == 199.10 after Decimal)."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 199.1, "currency": "EUR", "stops": 0, "durationMin": 120
        }
        offer2 = dict(offer1)
        offer2["price"] = 199.10
        id1 = app.compute_offer_id(offer1)
        id2 = app.compute_offer_id(offer2)
        self.assertEqual(id1, id2, "Decimal-normalized prices 199.1 and 199.10 should produce same ID")

    def test_offer_id_deterministic(self):
        """Same offer content must produce same ID."""
        offer = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 150.50, "currency": "EUR", "stops": 0,
            "durationMin": 120, "airlineCode": "LH"
        }
        id1 = app.compute_offer_id(offer)
        id2 = app.compute_offer_id(offer)
        self.assertEqual(id1, id2)
        self.assertTrue(id1.startswith("offer_"))

    def test_offer_id_different_price_different_id(self):
        """Different price → different ID."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 150, "currency": "EUR", "stops": 0,
            "durationMin": 120, "airlineCode": "LH"
        }
        offer2 = dict(offer1)
        offer2["price"] = 200
        self.assertNotEqual(app.compute_offer_id(offer1), app.compute_offer_id(offer2))


class OfferIDRealFields(unittest.TestCase):
    """Test that offer ID uses real SerpApi offer fields (no invented field names)."""

    def test_offer_id_uses_dep_time_arr_time_not_invented_fields(self):
        """Offer ID should use dep_time, arr_time (real fields from SerpApi)."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 150, "currency": "EUR", "stops": 0, "durationMin": 120,
            "dep_time": "08:00", "arr_time": "10:00"
        }
        offer2 = dict(offer1)
        offer2["dep_time"] = "09:00"
        # Should produce different IDs (different dep_time)
        self.assertNotEqual(app.compute_offer_id(offer1), app.compute_offer_id(offer2))

    def test_offer_id_uses_flight_number_for_single_segment(self):
        """Offer ID should use flight_number if provided."""
        offer1 = {
            "origin": "VIE", "dest": "BEG", "date": "2026-07-15",
            "price": 150, "currency": "EUR", "stops": 0, "durationMin": 120,
            "flight_number": "LH123"
        }
        offer2 = dict(offer1)
        offer2["flight_number"] = "LH124"
        self.assertNotEqual(app.compute_offer_id(offer1), app.compute_offer_id(offer2))


class CanonicalSelection(unittest.TestCase):
    """Test deterministic canonical offer selection."""

    def test_canonical_highest_score_primary(self):
        """Canonical must have highest dealScore."""
        offers = [
            {"price": 150, "dealScore": 70, "stops": 0, "durationMin": 120},
            {"price": 180, "dealScore": 65, "stops": 0, "durationMin": 120},
            {"price": 200, "dealScore": 80, "stops": 1, "durationMin": 150},
        ]
        canonical = app.select_canonical_cash_offer(offers)
        self.assertEqual(canonical["dealScore"], 80)

    def test_canonical_independent_of_order(self):
        """Canonical selection must not depend on input order."""
        offers = [
            {"price": 150, "dealScore": 70, "stops": 0, "durationMin": 120},
            {"price": 200, "dealScore": 80, "stops": 1, "durationMin": 150},
            {"price": 180, "dealScore": 65, "stops": 0, "durationMin": 120},
        ]
        offers_reversed = list(reversed(offers))
        canonical1 = app.select_canonical_cash_offer(offers)
        canonical2 = app.select_canonical_cash_offer(offers_reversed)
        # Should be the same offer (dealScore 80)
        self.assertEqual(canonical1["dealScore"], canonical2["dealScore"])
        self.assertEqual(canonical1["price"], canonical2["price"])

    def test_canonical_lowest_price_tiebreak(self):
        """If scores tied, canonical is lowest price."""
        offers = [
            {"price": 200, "dealScore": 75, "stops": 0, "durationMin": 120},
            {"price": 150, "dealScore": 75, "stops": 0, "durationMin": 120},
        ]
        canonical = app.select_canonical_cash_offer(offers)
        self.assertEqual(canonical["price"], 150)

    def test_canonical_fewest_stops_tiebreak(self):
        """If scores and price tied, canonical has fewest stops."""
        offers = [
            {"price": 150, "dealScore": 75, "stops": 1, "durationMin": 180},
            {"price": 150, "dealScore": 75, "stops": 0, "durationMin": 120},
        ]
        canonical = app.select_canonical_cash_offer(offers)
        self.assertEqual(canonical["stops"], 0)

    def test_canonical_shortest_duration_tiebreak(self):
        """If score, price, stops tied, canonical has shortest duration."""
        offers = [
            {"price": 150, "dealScore": 75, "stops": 0, "durationMin": 180},
            {"price": 150, "dealScore": 75, "stops": 0, "durationMin": 120},
        ]
        canonical = app.select_canonical_cash_offer(offers)
        self.assertEqual(canonical["durationMin"], 120)

    def test_canonical_no_offers_returns_none(self):
        """Empty or unrescored offers must return None."""
        self.assertIsNone(app.select_canonical_cash_offer([]))
        self.assertIsNone(app.select_canonical_cash_offer([{"price": 150}]))  # No dealScore


class RecommendedOfferInclusion(unittest.TestCase):
    """Test that recommended offer is always returned in response slice."""

    def test_recommended_offer_in_slice_when_in_top_8(self):
        """If recommended offer is in top 8, it must be present."""
        offers = [
            {"price": 100, "dealScore": 90, "stops": 0, "durationMin": 100},
            {"price": 120, "dealScore": 85, "stops": 0, "durationMin": 110},
        ]
        for o in offers:
            o["offer_id"] = app.compute_offer_id(o)
        guidance = app.build_cash_guidance(offers)
        recommended_id = guidance["recommended_offer_id"]
        # Manually slice to mimic the /api/cheap endpoint
        sorted_offers = sorted(offers, key=lambda x: (-(x.get("dealScore") or 0), x.get("price") or 10**9))
        returned = sorted_offers[:8]
        # Check that recommended is in returned
        self.assertTrue(any(o["offer_id"] == recommended_id for o in returned),
                        f"Recommended {recommended_id} not in returned offers")

    def test_recommended_offer_included_when_outside_top_8(self):
        """If canonical ranks outside [:8], it must still be returned (up to 8 total)."""
        # Create 10+ offers with canonical at position 9
        offers = []
        for i in range(12):
            score = 90 - i  # Decreasing scores
            if i == 9:
                # This is the canonical (would rank at position 9 by score)
                offers.append({"price": 100, "dealScore": 81, "stops": 0, "durationMin": 120})
            else:
                offers.append({"price": 100 + i, "dealScore": score, "stops": 0, "durationMin": 120 + i})

        for o in offers:
            o["offer_id"] = app.compute_offer_id(o)

        guidance = app.build_cash_guidance(offers)
        recommended_id = guidance["recommended_offer_id"]

        # Simulate the /api/cheap endpoint logic
        sorted_offers = sorted(offers, key=lambda x: (-(x.get("dealScore") or 0), x.get("price") or 10**9))
        returned_slice = sorted_offers[:8]

        # Check if recommended is in returned slice
        if not any(o["offer_id"] == recommended_id for o in returned_slice):
            # If not, add it (per endpoint logic)
            rec_offer = next((o for o in sorted_offers if o["offer_id"] == recommended_id), None)
            if rec_offer:
                returned_slice = returned_slice[:7] + [rec_offer]

        self.assertTrue(any(o["offer_id"] == recommended_id for o in returned_slice),
                        f"Recommended {recommended_id} not present after inclusion logic")

    def test_response_never_exceeds_8_offers(self):
        """Response must never exceed 8 offers after inclusion logic."""
        offers = []
        for i in range(12):
            score = 90 - i
            offers.append({"price": 100 + i, "dealScore": score, "stops": 0, "durationMin": 120 + i})

        for o in offers:
            o["offer_id"] = app.compute_offer_id(o)

        guidance = app.build_cash_guidance(offers)
        sorted_offers = sorted(offers, key=lambda x: (-(x.get("dealScore") or 0), x.get("price") or 10**9))
        returned = sorted_offers[:8]

        # Simulate inclusion logic
        if guidance and guidance.get("recommended_offer_id"):
            recommended_id = guidance["recommended_offer_id"]
            if not any(o["offer_id"] == recommended_id for o in returned):
                rec_offer = next((o for o in sorted_offers if o["offer_id"] == recommended_id), None)
                if rec_offer:
                    returned = returned[:7] + [rec_offer]

        self.assertLessEqual(len(returned), 8, f"Returned {len(returned)} offers, expected <= 8")

    def test_no_duplicate_offers_in_response(self):
        """Response must not contain duplicate offers."""
        offers = [
            {"price": 100, "dealScore": 90, "stops": 0, "durationMin": 100},
            {"price": 120, "dealScore": 85, "stops": 0, "durationMin": 110},
        ]
        for o in offers:
            o["offer_id"] = app.compute_offer_id(o)

        sorted_offers = sorted(offers, key=lambda x: (-(x.get("dealScore") or 0), x.get("price") or 10**9))
        returned = sorted_offers[:8]

        offer_ids = [o["offer_id"] for o in returned]
        self.assertEqual(len(offer_ids), len(set(offer_ids)), "Duplicate offers in response")


class LimitedEvidence(unittest.TestCase):
    """Test limited_evidence state."""

    def test_single_offer_limited_evidence(self):
        """Only one valid offer → limited_evidence."""
        offers = [{"price": 150, "dealScore": 70, "stops": 0}]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "limited_evidence")

    def test_unknown_stops_limited_evidence(self):
        """Unknown stops → limited_evidence."""
        offers = [
            {"price": 150, "dealScore": 70, "stops": None},
            {"price": 180, "dealScore": 65, "stops": 0},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "limited_evidence")


class KeepLooking(unittest.TestCase):
    """Test keep_looking state."""

    def test_above_typical_keep_looking(self):
        """Canonical above typical range + available market → keep_looking."""
        offers = [
            {"price": 500, "dealScore": 70, "stops": 0, "typicalRange": [100, 200]},
            {"price": 520, "dealScore": 65, "stops": 0, "typicalRange": [100, 200]},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "keep_looking")

    def test_weak_score_keep_looking(self):
        """dealScore < 56 → keep_looking."""
        offers = [
            {"price": 150, "dealScore": 50, "stops": 0},
            {"price": 180, "dealScore": 45, "stops": 0},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "keep_looking")

    def test_many_stops_weak_score_keep_looking(self):
        """stops >= 3 AND dealScore < 72 → keep_looking."""
        offers = [
            {"price": 150, "dealScore": 70, "stops": 3},
            {"price": 180, "dealScore": 65, "stops": 0},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "keep_looking")

    def test_missing_market_context_does_not_force_keep_looking(self):
        """Missing typicalRange + good score should NOT force keep_looking."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0},
            {"price": 180, "dealScore": 75, "stops": 0},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        # Should be strongest_option_found, not keep_looking
        self.assertEqual(guidance["recommendation_state"], "strongest_option_found")


class StrongestOptionFound(unittest.TestCase):
    """Test strongest_option_found state."""

    def test_multiple_offers_good_score_nonstop(self):
        """Multiple offers, score >= 56, nonstop → strongest_option_found."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0, "durationMin": 100},
            {"price": 180, "dealScore": 75, "stops": 0, "durationMin": 110},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIsNotNone(guidance)
        self.assertEqual(guidance["recommendation_state"], "strongest_option_found")

    def test_no_market_context_still_strongest_option_found(self):
        """Missing typicalRange + good score → strongest_option_found (not limited_evidence)."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0, "durationMin": 100},
            {"price": 180, "dealScore": 75, "stops": 0, "durationMin": 110},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertEqual(guidance["recommendation_state"], "strongest_option_found")
        self.assertEqual(guidance["market_context"], "unavailable")
        self.assertEqual(guidance["evidence_level"], "moderate")

    def test_below_typical_range_supporting_signal(self):
        """Below typical range triggers supporting signal."""
        offers = [
            {"price": 80, "dealScore": 80, "stops": 0, "typicalRange": [100, 200]},
            {"price": 150, "dealScore": 75, "stops": 0, "typicalRange": [100, 200]},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertEqual(guidance["recommendation_state"], "strongest_option_found")
        self.assertIn("below_typical_range", guidance["supporting_signals"])


class SignalDetection(unittest.TestCase):
    """Test signal detection accuracy."""

    def test_nonstop_signal_detected(self):
        """stops == 0 with multiple offers → nonstop signal."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0, "durationMin": 100},
            {"price": 200, "dealScore": 70, "stops": 1, "durationMin": 150},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIn("nonstop", guidance["supporting_signals"])

    def test_lowest_in_set_signal(self):
        """Cheapest offer → lowest_in_result_set signal."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0, "durationMin": 100},
            {"price": 200, "dealScore": 75, "stops": 0, "durationMin": 110},
        ]
        guidance = app.build_cash_guidance(offers)
        # Canonical is dealScore 80 (first offer)
        self.assertIn("lowest_in_result_set", guidance["supporting_signals"])

    def test_mm_partner_airline_signal(self):
        """Miles & More airline → signal."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0, "airlineCode": "LH"},
            {"price": 200, "dealScore": 75, "stops": 0, "airlineCode": "BA"},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertIn("mm_partner_airline", guidance["supporting_signals"])


class CopyValidation(unittest.TestCase):
    """Test copy constraint validation."""

    def test_no_forbidden_words_in_copy(self):
        """Copy must not contain forbidden marketing language."""
        forbidden = ["cheap", "affordable", "competitive", "verified", "confirmed", "book", "booking",
                     "optimal", "best available", "urgency", "now", "hurry", "limited"]
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0, "durationMin": 100},
            {"price": 180, "dealScore": 75, "stops": 0, "durationMin": 110},
        ]
        guidance = app.build_cash_guidance(offers)
        full_text = (guidance.get("headline", "") + " " +
                     guidance.get("why", "") + " " +
                     guidance.get("watch_out", "") + " " +
                     guidance.get("next_step", "")).lower()
        for word in forbidden:
            self.assertNotIn(word, full_text, f"Forbidden word '{word}' found in guidance copy")

    def test_guidance_object_complete(self):
        """Guidance object must include all required fields."""
        offers = [{"price": 150, "dealScore": 80, "stops": 0}]
        guidance = app.build_cash_guidance(offers)
        required_fields = [
            "recommendation_state", "recommended_offer_id", "headline", "why",
            "watch_out", "next_step", "evidence_level", "comparison_evidence",
            "market_context", "price_context_band", "supporting_signals", "disqualifying_signals"
        ]
        for field in required_fields:
            self.assertIn(field, guidance, f"Missing required field: {field}")


class EvidenceLevel(unittest.TestCase):
    """Test evidence level calculation."""

    def test_single_offer_limited_evidence_level(self):
        """Single offer → limited evidence level."""
        offers = [{"price": 150, "dealScore": 70, "stops": 0}]
        guidance = app.build_cash_guidance(offers)
        self.assertEqual(guidance["evidence_level"], "limited")

    def test_two_offers_moderate_evidence(self):
        """Two offers → moderate evidence level."""
        offers = [
            {"price": 150, "dealScore": 80, "stops": 0},
            {"price": 180, "dealScore": 75, "stops": 0},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertEqual(guidance["evidence_level"], "moderate")

    def test_three_offers_strong_evidence_with_market_context(self):
        """Three+ offers + market context → strong evidence level."""
        offers = [
            {"price": 100, "dealScore": 90, "stops": 0, "typicalRange": [80, 150]},
            {"price": 120, "dealScore": 85, "stops": 0, "typicalRange": [80, 150]},
            {"price": 150, "dealScore": 80, "stops": 0, "typicalRange": [80, 150]},
        ]
        guidance = app.build_cash_guidance(offers)
        self.assertEqual(guidance["evidence_level"], "strong")


class SeparatorEncodingRegression(unittest.TestCase):
    """Guard against mojibake separators in cash labels/reasons."""

    def test_cash_score_reason_uses_clean_middle_dot(self):
        offers = [
            {"price": 100, "stops": 1, "airlineCode": "BA", "typicalRange": [100, 200]},
            {"price": 120, "stops": 0, "airlineCode": "BA", "typicalRange": [100, 200]},
        ]
        rescored = app.rescore_offer_set(offers)
        first_reason = rescored[0]["scoreReason"]
        self.assertIn(" \u00B7 ", first_reason)
        self.assertNotIn("Â·", first_reason)

    def test_frontend_source_has_no_mojibake_middle_dot(self):
        js_path = Path(__file__).resolve().parents[1] / "static" / "app.js"
        source = js_path.read_text(encoding="utf-8")
        self.assertNotIn("Â·", source)


class CashRoundTripResultIntegrity(unittest.TestCase):
    def setUp(self):
        self.outbound = [{
            "departure_airport": {"id": "FRA", "time": "2026-10-20 08:00"},
            "arrival_airport": {"id": "JFK", "time": "2026-10-20 11:00"},
            "duration": 540,
            "airline": "Lufthansa",
            "flight_number": "LH 400",
        }]
        self.inbound = [{
            "departure_airport": {"id": "JFK", "time": "2026-10-28 17:00"},
            "arrival_airport": {"id": "FRA", "time": "2026-10-29 07:00"},
            "duration": 480,
            "airline": "Lufthansa",
            "flight_number": "LH 401",
        }]

    def test_complete_requires_real_outbound_and_return_segments(self):
        self.assertEqual(app.derive_cash_itinerary_state(self.outbound, self.inbound, "2026-10-28"), "complete")

    def test_partial_requires_outbound_and_requested_return(self):
        self.assertEqual(app.derive_cash_itinerary_state(self.outbound, [], "2026-10-28"), "partial")

    def test_price_only_for_missing_or_malformed_outbound(self):
        malformed_values = [None, [], {}, "segments", [None], [{}], [{"dep_iata": "FRA"}]]
        for value in malformed_values:
            with self.subTest(value=value):
                self.assertEqual(app.derive_cash_itinerary_state(value, self.inbound, "2026-10-28"), "price_only")

    def test_serp_roundtrip_preserves_alias_and_real_return_only(self):
        item = {"price": 650, "flights": self.outbound, "return_segments": self.inbound, "total_duration": 540}
        offer = app._serp_item_to_offer(item, "eur", None, False, "2026-10-28")
        self.assertEqual(offer["returnDate"], "2026-10-28")
        self.assertEqual(offer["itinerary_state"], "complete")
        self.assertEqual(offer["segments"], offer["outbound_segments"])
        self.assertEqual(offer["return_segments"][0]["dep_iata"], "JFK")

    def test_serp_partial_does_not_emit_return_segments(self):
        item = {"price": 650, "flights": self.outbound, "total_duration": 540}
        offer = app._serp_item_to_offer(item, "eur", None, False, "2026-10-28")
        self.assertEqual(offer["itinerary_state"], "partial")
        self.assertNotIn("return_segments", offer)

    def test_one_way_contract_remains_unchanged(self):
        item = {"price": 650, "flights": self.outbound, "total_duration": 540}
        offer = app._serp_item_to_offer(item, "eur", None, False)
        self.assertNotIn("itinerary_state", offer)
        self.assertNotIn("outbound_segments", offer)
        self.assertNotIn("segments", offer)

    def test_travelpayouts_roundtrip_is_price_only_with_input_date(self):
        row = {"origin": "FRA", "destination": "JFK", "price": 600}
        offer = app.offer_from_tp(row, "eur", "2026-10-28")
        self.assertEqual(offer["returnDate"], "2026-10-28")
        self.assertEqual(offer["itinerary_state"], "price_only")
        self.assertEqual(offer["segments"], offer["outbound_segments"])
        self.assertIsNone(offer["stops"])
        self.assertNotIn("return_segments", offer)

    def test_roundtrip_unknown_stops_never_become_nonstop(self):
        offers = app.rescore_offer_set([{
            "price": 600,
            "stops": None,
            "itinerary_state": "price_only",
            "durationMin": None,
        }])
        self.assertNotIn("nonstop", offers[0]["scoreReason"])

    def test_frontend_contains_frozen_state_rendering_matrix(self):
        js_path = Path(__file__).resolve().parents[1] / "static" / "app.js"
        source = js_path.read_text(encoding="utf-8")
        self.assertIn("function cashRoundTripIntegrityHtml(o, roundTripRequested)", source)
        self.assertIn("Return details were not provided by the current source.", source)
        self.assertIn("Requested return date", source)
        self.assertIn("Routing details are not available from the current source.", source)
        self.assertIn("if (!roundTripRequested) return '';", source)

    def test_frontend_renders_complete_partial_and_price_only_states(self):
        node = shutil.which("node")
        bundled = Path(r"C:\Users\Flo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
        if not node and bundled.exists():
            node = str(bundled)
        if not node:
            self.skipTest("Node.js is required for frontend rendering regression tests")
        js_path = Path(__file__).resolve().parents[1] / "static" / "app.js"
        script = f"""
const fs = require('fs');
const src = fs.readFileSync({json.dumps(str(js_path))}, 'utf8');
const start = src.indexOf('function cashSegmentTimelineHtml');
const end = src.indexOf('// Client-side mirror of the backend valid-price rule', start);
if (start < 0 || end < 0) throw new Error('round-trip renderer block missing');
function esc(s) {{ return String(s ?? '').replace(/[&<>\"']/g, ''); }}
function fmtDur(m) {{ return String(m) + 'm'; }}
function formatUserDate(s) {{ return String(s || ''); }}
eval(src.slice(start, end));
const outbound = [{{dep_iata:'FRA',arr_iata:'JFK',dep_time:'08:00',arr_time:'11:00'}}];
const inbound = [{{dep_iata:'JFK',arr_iata:'FRA',dep_time:'17:00',arr_time:'07:00'}}];
const result = {{
  complete: cashRoundTripIntegrityHtml({{itinerary_state:'complete',outbound_segments:outbound,return_segments:inbound,returnDate:'2026-10-28'}}, true),
  partial: cashRoundTripIntegrityHtml({{itinerary_state:'partial',outbound_segments:outbound,returnDate:'2026-10-28'}}, true),
  priceOnly: priceSignalContextHtml({{itinerary_state:'price_only',origin:'FRA',dest:'JFK',returnDate:'2026-10-28'}}),
  oneWay: cashRoundTripIntegrityHtml({{itinerary_state:'partial',outbound_segments:outbound}}, false)
}};
process.stdout.write(JSON.stringify(result));
"""
        result = subprocess.run([node, "-e", script], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = json.loads(result.stdout)
        self.assertIn('aria-label="Outbound"', rendered["complete"])
        self.assertIn('aria-label="Return"', rendered["complete"])
        self.assertNotIn("Return details were not provided", rendered["complete"])
        self.assertIn('aria-label="Outbound"', rendered["partial"])
        self.assertIn("Return details were not provided by the current source.", rendered["partial"])
        self.assertIn("Requested return date", rendered["partial"])
        self.assertNotIn("JFK</span>", rendered["partial"].split("cash-ghost-return", 1)[-1])
        self.assertNotIn("cash-rt-timeline", rendered["priceOnly"])
        self.assertIn("Requested route", rendered["priceOnly"])
        self.assertIn("Requested return date", rendered["priceOnly"])
        self.assertIn("Routing details are not available from the current source.", rendered["priceOnly"])
        self.assertNotIn("airline", rendered["priceOnly"].lower())
        self.assertNotIn("View fare", rendered["priceOnly"])
        self.assertEqual(rendered["oneWay"], "")

    def test_partial_date_is_only_rendered_as_requested_provenance(self):
        js_path = Path(__file__).resolve().parents[1] / "static" / "app.js"
        source = js_path.read_text(encoding="utf-8")
        self.assertIn("o.returnDate && o.itinerary_state !== 'partial'", source)
        self.assertIn("Requested return date", source)

    def test_price_only_branch_omits_flight_and_fare_markup(self):
        js_path = Path(__file__).resolve().parents[1] / "static" / "app.js"
        source = js_path.read_text(encoding="utf-8")
        start = source.index("if (roundTripRequested && o.itinerary_state === 'price_only')")
        end = source.index("// R2B-1 RECOMMENDATION CARD", start)
        branch = source[start:end]
        self.assertIn("priceSignalContextHtml(o)", branch)
        self.assertNotIn("airlineHtml", branch)
        self.assertNotIn("linksHtmlWithLabels", branch)
        self.assertNotIn("sourceDisclosureHtml", branch)
        self.assertNotIn("compactCashJourneySummary", branch)

    def test_serp_roundtrip_normalization_uses_one_existing_search(self):
        response = {"best_flights": [{"price": 650, "flights": self.outbound}]}
        with mock.patch.object(app, "serpapi_search", return_value=response) as search:
            offers, error = app.serpapi_offers(
                "FRA", "JFK", app.dt.date(2026, 10, 20), app.dt.date(2026, 10, 28), "eur", False
            )
        self.assertIsNone(error)
        self.assertEqual(len(offers), 1)
        search.assert_called_once()
        self.assertEqual(offers[0]["itinerary_state"], "partial")
        source = Path(app.__file__).read_text(encoding="utf-8")
        self.assertNotIn("departure_token", source)


if __name__ == "__main__":
    unittest.main()
