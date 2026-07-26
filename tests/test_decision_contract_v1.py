"""Decision Contract V1 — contract and verdict-safety tests.

Locks the externally emitted `decision` block documented in
docs/decision_contract_v1.md (based on main commit 140a3a6):

- the exact required key set
- the allowed signal and verdict vocabularies
- that the internal tier tokens "book_miles" / "pay_cash" never leave the process
  on any path, including the live-award path
- fail-closed behaviour for missing / mismatched cash identity, incompatible trip
  basis, incomplete round trips and unknown or legacy tier tokens

Run: python -m pytest tests/test_decision_contract_v1.py
"""
from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as awardradar  # noqa: E402


# --- contract constants (duplicated on purpose: the test is the second source) --

REQUIRED_DECISION_KEYS = {
    "verdict",
    "tier",
    "confidence",
    "explanation",
    "cash_trip_type",
    "award_trip_type",
    "normalized_trip_type",
    "trip_basis_compatible",
    "cash_source",
    "cash_level",
    "cash_freshness",
    "evaluated_program",
    "evaluated_miles",
    "evaluated_surcharge",
    "evaluated_data_source",
    "evaluated_cash_offer_id",
    "evaluated_award_option_id",
    "itinerary_ref",
    "signal",
    "label",
    "estimated_value",
    "confidence_reason",
    "freshness_label",
    "verification_guidance",
    "evidence",
    "evidence_refs",
}

ALLOWED_SIGNALS = {
    "strong_miles_value",
    "promising_miles_value",
    "mixed_value",
    "cash_may_be_stronger",
    "insufficient_data",
}

ALLOWED_VERDICTS = {
    "miles_value_supported",
    "miles_value_leaning",
    "comparison_inconclusive",
    "cash_value_supported",
    "availability_only",
    "insufficient_data",
}

# Internal-only tokens plus any imperative phrasing that must never be emitted.
FORBIDDEN_VERDICT_TOKENS = ("book_miles", "pay_cash", "lean_miles", "consider")
IMPERATIVE_SUBSTRINGS = ("book ", "buy ", "pay now", "purchase ")


def _award(cpm, *, trip_type="one_way", data_source="estimated"):
    return {
        "award_option_id": f"award-contract-{trip_type}-{data_source}",
        "program": "Miles & More",
        "miles": 55000,
        "surcharge": 100,
        "cpm": cpm,
        "grade": awardradar.sweet_spot_grade(cpm) if cpm is not None else None,
        "trip_type": trip_type,
        "data_source": data_source,
    }


def _cash_offer(price=300, *, trip_type="one_way", completeness="complete", **overrides):
    offer = {
        "cash_offer_id": f"cash-contract-{trip_type}",
        "offer_id": f"cash-contract-{trip_type}",
        "itinerary_ref": f"itinerary-contract-{trip_type}",
        "origin": "FRA",
        "dest": "JFK",
        "price": float(price),
        "trip_basis": trip_type,
        "completeness": completeness,
        "source": "contract_test_cash_provider",
        "observed_at": "2030-01-01T00:00:00Z",
    }
    offer.update(overrides)
    return offer


def _decide(cpm=1.5, *, data_source="estimated", cash_eur=300, cash_is_real=True,
            cash_level="within_typical", requested_trip_type="one_way",
            award_trip_type="one_way", cash_trip_type="one_way", cash_offer=None,
            cash_completeness="complete"):
    if cash_offer is None:
        cash_offer = _cash_offer(trip_type=cash_trip_type, completeness=cash_completeness)
    return awardradar.build_decision(
        _award(cpm, trip_type=award_trip_type, data_source=data_source),
        cash_eur=cash_eur,
        cash_is_real=cash_is_real,
        cash_level=cash_level,
        requested_trip_type=requested_trip_type,
        cash_trip_type=cash_trip_type,
        cash_offer=cash_offer,
    )


# One cpm per tier of the value ladder: poor, fair, good, great, exceptional.
ALL_TIER_CPMS = [0.4, 0.9, 1.3, 2.0, 2.8]


def _all_decisions():
    """One decision per tier per award data source, plus the fail-closed paths."""
    out = []
    for cpm in ALL_TIER_CPMS:
        for source in ("estimated", "live", "cached"):
            out.append(_decide(cpm, data_source=source))
    out.append(_decide(cash_eur=None, cash_is_real=False))
    out.append(_decide(award_trip_type="round_trip"))
    out.append(_decide(requested_trip_type="round_trip", cash_trip_type="round_trip",
                       award_trip_type="round_trip", cash_completeness="partial"))
    out.append(awardradar.build_decision(None, cash_eur=300, cash_is_real=True,
                                         cash_level="within_typical",
                                         requested_trip_type="one_way",
                                         cash_offer=_cash_offer()))
    out.append(awardradar.build_decision(_award(1.5), cash_eur=300, cash_is_real=True,
                                         cash_level="within_typical",
                                         requested_trip_type="one_way"))
    return out


# --- 1. contract shape ------------------------------------------------------


def test_decision_emits_exactly_the_required_contract_keys():
    for decision in _all_decisions():
        assert set(decision) == REQUIRED_DECISION_KEYS


def test_evidence_refs_carry_the_documented_sub_keys():
    refs = _decide()["evidence_refs"]
    assert set(refs) == {
        "cash_offer_id", "award_option_id", "itinerary_ref",
        "trip_basis", "completeness", "source", "observed_at",
    }
    assert set(refs["trip_basis"]) == {"cash", "award"}
    for key in ("completeness", "source", "observed_at"):
        assert set(refs[key]) == {"cash", "award"}


def test_decision_block_is_json_serialisable():
    for decision in _all_decisions():
        json.loads(json.dumps(decision))


# --- 2. vocabulary ----------------------------------------------------------


def test_signal_vocabulary_is_closed():
    for decision in _all_decisions():
        assert decision["signal"] in ALLOWED_SIGNALS


def test_verdict_vocabulary_is_closed():
    for decision in _all_decisions():
        assert decision["verdict"] in ALLOWED_VERDICTS


def test_label_always_matches_the_signal_vocabulary():
    for decision in _all_decisions():
        assert decision["label"] == awardradar._SIGNAL_LABEL[decision["signal"]]


# --- 3. verdict safety ------------------------------------------------------


def test_no_internal_tier_token_is_ever_emitted_as_a_verdict():
    for decision in _all_decisions():
        assert decision["verdict"] not in FORBIDDEN_VERDICT_TOKENS


def test_no_externally_emitted_book_miles_or_pay_cash_anywhere_in_the_block():
    for decision in _all_decisions():
        blob = json.dumps(decision).lower()
        assert "book_miles" not in blob
        assert "pay_cash" not in blob


def test_no_user_facing_string_is_an_imperative_instruction():
    for decision in _all_decisions():
        for field in ("label", "explanation", "confidence_reason",
                      "verification_guidance", "freshness_label"):
            text = (decision[field] or "").lower()
            for bad in IMPERATIVE_SUBSTRINGS:
                assert bad not in text, (field, decision[field])


def test_static_award_estimates_stay_non_imperative_at_every_tier():
    for cpm in ALL_TIER_CPMS:
        decision = _decide(cpm, data_source="estimated")
        assert decision["verdict"] != "miles_value_supported"
        assert decision["verdict"] in ALLOWED_VERDICTS


def test_live_award_data_stays_non_imperative_at_every_tier():
    for cpm in ALL_TIER_CPMS:
        decision = _decide(cpm, data_source="live")
        assert decision["verdict"] in ALLOWED_VERDICTS
        assert decision["verdict"] not in FORBIDDEN_VERDICT_TOKENS


def test_tier_ladder_is_fully_covered_by_the_contract_fixtures():
    tiers = {awardradar.sweet_spot_grade(cpm)["tier"] for cpm in ALL_TIER_CPMS}
    assert tiers == set(awardradar._TIER_META)


def test_live_path_is_the_only_one_that_reaches_the_strongest_verdict():
    strong_cpm = 2.8
    assert _decide(strong_cpm, data_source="live")["verdict"] == "miles_value_supported"
    assert _decide(strong_cpm, data_source="estimated")["verdict"] == "comparison_inconclusive"


def test_weak_tier_never_emits_an_imperative_cash_verdict():
    for source in ("estimated", "live"):
        decision = _decide(0.4, data_source=source)
        assert decision["verdict"] == "cash_value_supported"
        assert decision["signal"] == "cash_may_be_stronger"


# --- 4. normalize_verdict fail-closed behaviour ------------------------------


@pytest.mark.parametrize("internal,is_live,expected", [
    ("book_miles", True, "miles_value_supported"),
    ("book_miles", False, "comparison_inconclusive"),
    ("lean_miles", True, "miles_value_leaning"),
    ("lean_miles", False, "miles_value_leaning"),
    ("consider", True, "comparison_inconclusive"),
    ("consider", False, "comparison_inconclusive"),
    ("pay_cash", True, "cash_value_supported"),
    ("pay_cash", False, "cash_value_supported"),
])
def test_normalize_verdict_maps_every_internal_token(internal, is_live, expected):
    assert awardradar.normalize_verdict(internal, is_live=is_live) == expected


@pytest.mark.parametrize("unknown", [
    None, "", "buy_now", "BOOK_MILES", "miles_value_supported", "legacy_token", 0,
])
def test_unknown_or_legacy_verdict_tokens_fail_closed(unknown):
    for is_live in (True, False):
        assert awardradar.normalize_verdict(unknown, is_live=is_live) == "insufficient_data"


def test_every_internal_tier_recommendation_has_a_safe_mapping():
    for meta in awardradar._TIER_META.values():
        assert meta["recommendation"] in awardradar._SAFE_VERDICT


def test_safe_verdict_values_never_reuse_an_internal_token():
    assert not set(awardradar._SAFE_VERDICT.values()) & set(awardradar._SAFE_VERDICT)
    assert awardradar._SAFE_VERDICT_STATES == ALLOWED_VERDICTS


# --- 5. fail-closed identity and basis --------------------------------------


def test_missing_cash_identity_stays_insufficient_data():
    decision = awardradar.build_decision(
        _award(2.4, data_source="live"), cash_eur=300, cash_is_real=True,
        cash_level="within_typical", requested_trip_type="one_way",
    )
    assert decision["verdict"] == "insufficient_data"
    assert decision["signal"] == "insufficient_data"
    assert decision["evaluated_cash_offer_id"] is None
    assert decision["estimated_value"] is None
    assert decision["tier"] is None


def test_cash_offer_without_itinerary_ref_stays_insufficient_data():
    decision = _decide(2.4, data_source="live",
                       cash_offer=_cash_offer(itinerary_ref=None))
    assert decision["verdict"] == "insufficient_data"
    assert decision["signal"] == "insufficient_data"


def test_mismatched_trip_basis_stays_insufficient_data():
    decision = _decide(2.4, data_source="live",
                       cash_trip_type="round_trip", award_trip_type="one_way",
                       requested_trip_type="round_trip")
    assert decision["trip_basis_compatible"] is False
    assert decision["verdict"] == "insufficient_data"
    assert decision["signal"] == "insufficient_data"
    assert decision["estimated_value"] is None


def test_incomplete_round_trip_stays_conservative():
    decision = _decide(2.4, data_source="live", requested_trip_type="round_trip",
                       cash_trip_type="round_trip", award_trip_type="round_trip",
                       cash_completeness="partial")
    assert decision["verdict"] == "insufficient_data"
    assert decision["signal"] == "insufficient_data"
    assert decision["tier"] is None


def test_missing_cash_context_is_availability_only_not_a_value_verdict():
    decision = _decide(2.4, data_source="live", cash_eur=None, cash_is_real=False)
    assert decision["verdict"] == "availability_only"
    assert decision["signal"] == "insufficient_data"
    assert decision["estimated_value"] is None


# --- 6. user-facing guidance stays verification-oriented ---------------------


def test_verification_guidance_is_always_present_and_verification_oriented():
    for decision in _all_decisions():
        guidance = decision["verification_guidance"]
        assert guidance == awardradar._VERIFY_GUIDANCE
        assert "confirm" in guidance.lower()


def test_signal_labels_stay_non_committal():
    for label in awardradar._SIGNAL_LABEL.values():
        lowered = label.lower()
        for bad in IMPERATIVE_SUBSTRINGS:
            assert bad not in lowered


# --- 7. discovery endpoint shares the same vocabulary ------------------------


def test_discovery_rows_normalize_the_internal_recommendation():
    """/api/top-opportunities is the live-award path most at risk of leaking tokens."""
    source = open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app.py"),
        encoding="utf-8",
    ).read()
    assert '"recommendation": normalize_verdict(' in source
    assert '"recommendation": g.get("recommendation", "book_miles")' not in source


# --- 8. documentation governance --------------------------------------------


def _doc() -> str:
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "docs", "decision_contract_v1.md",
    )
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def test_contract_document_records_its_governance_metadata():
    doc = _doc()
    for required in ("Decision Contract V1", "140a3a6", "Florian Hoffarth", "2026-07-26"):
        assert required in doc


def test_contract_document_scopes_out_level_2_and_provider_activation():
    doc = " ".join(_doc().lower().split())
    assert "does **not** authorize level 2" in doc
    assert "provider activation, seats.aero activation" in doc
    assert "requires explicit review" in doc


def test_contract_document_lists_every_contract_key():
    doc = _doc()
    for key in REQUIRED_DECISION_KEYS:
        assert f"`{key}`" in doc, key


def test_contract_document_lists_the_full_verdict_vocabulary():
    doc = _doc()
    for verdict in ALLOWED_VERDICTS:
        assert f"`{verdict}`" in doc, verdict
    for signal in ALLOWED_SIGNALS:
        assert f"`{signal}`" in doc, signal
