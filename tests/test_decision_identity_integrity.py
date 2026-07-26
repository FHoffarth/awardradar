from __future__ import annotations

from unittest import mock

import pytest

import app as awardradar


DATE = "2030-10-20"
RETURN_DATE = "2030-10-28"


def segment(origin, dest, dep_time, arr_time, duration, airline, flight_number):
    return {
        "departure_airport": {"id": origin, "time": f"{DATE} {dep_time}"},
        "arrival_airport": {"id": dest, "time": f"{DATE} {arr_time}"},
        "duration": duration,
        "airline": airline,
        "flight_number": flight_number,
    }


def provider_item(price, segments, total_duration):
    return {"price": price, "flights": segments, "total_duration": total_duration}


def search_payload(items, typical_range=None):
    payload = {
        "best_flights": items,
        "search_metadata": {"processed_at": "2030-01-01T12:00:00Z"},
    }
    if typical_range:
        payload["price_insights"] = {"typical_price_range": typical_range}
    return payload


@pytest.fixture(autouse=True)
def canonical_provider_mode(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "identity-test")
    monkeypatch.setattr(awardradar, "PRICE_SOURCE", "serpapi")
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "estimated")
    monkeypatch.setattr(awardradar, "CONTINUATION_INLINE", False)
    awardradar._SERP_CACHE.clear()


def replay(payload, *, dest="JFK", cabin="Economy", round_trip=False):
    request = {
        "origin": "FRA",
        "dest": dest,
        "date": DATE,
        "oneWay": not round_trip,
        "returnDate": RETURN_DATE if round_trip else None,
        "cabin": cabin,
        "cabins": [cabin.lower()],
        "currency": "eur",
        "flexDays": 0,
    }
    client = awardradar.app.test_client()
    with mock.patch.object(awardradar, "serpapi_search", return_value=payload):
        cash = client.post("/api/cheap", json=request).get_json()
        selected_id = cash.get("selected_cash_offer_id")
        award = client.post(
            "/api/awards",
            json={**request, "cashOfferId": selected_id},
        ).get_json()
    result = next(
        (
            row for row in award.get("results", [])
            if row.get("decision", {}).get("evaluated_cash_offer_id") == selected_id
        ),
        (award.get("results") or [{}])[0],
    )
    return cash, award, result


def assert_identity(cash, award, result):
    selected_id = cash["selected_cash_offer_id"]
    displayed = next(o for o in cash["offers"] if o["cash_offer_id"] == selected_id)
    decision = result["decision"]
    assert award["selected_cash_offer_id"] == selected_id
    assert decision["evaluated_cash_offer_id"] == selected_id
    assert displayed["offer_id"] == selected_id
    assert displayed["itinerary_ref"] == decision["itinerary_ref"]
    cash_evidence = next(e for e in decision["evidence"] if e["kind"] == "cash_offer")
    assert cash_evidence["cash_offer_id"] == selected_id
    assert cash_evidence["itinerary_ref"] == displayed["itinerary_ref"]
    assert cash_evidence["source"] == displayed["source"]
    assert cash_evidence["observed_at"] == "2030-01-01T12:00:00Z"
    refs = decision["evidence_refs"]
    assert refs["cash_offer_id"] == selected_id
    assert refs["award_option_id"] == decision["evaluated_award_option_id"]
    assert refs["itinerary_ref"] == displayed["itinerary_ref"]
    assert refs["trip_basis"]["cash"] == displayed["trip_basis"]
    assert refs["completeness"]["cash"] == displayed["completeness"]
    assert refs["source"]["cash"] == displayed["source"]
    assert refs["observed_at"]["cash"] == displayed["observed_at"]


def test_420_nonstop_identity_is_used_instead_of_360_connection():
    payload = search_payload([
        provider_item(360, [
            segment("FRA", "LHR", "08:00", "09:00", 60, "British Airways", "BA 901"),
            segment("LHR", "JFK", "11:00", "14:00", 480, "British Airways", "BA 117"),
        ], 720),
        provider_item(420, [
            segment("FRA", "JFK", "10:00", "13:00", 540, "Lufthansa", "LH 400"),
        ], 540),
        provider_item(610, [
            segment("FRA", "JFK", "13:00", "16:30", 570, "United", "UA 961"),
        ], 570),
    ], [400, 700])
    cash, award, result = replay(payload)
    assert next(o for o in cash["offers"] if o["cash_offer_id"] == cash["selected_cash_offer_id"])["price"] == 420
    assert result["cash_eur"] == 420
    assert_identity(cash, award, result)


def test_business_discarded_1900_connection_cannot_drive_verdict():
    payload = search_payload([
        provider_item(1900, [
            segment("FRA", "LHR", "08:00", "09:00", 60, "Lufthansa", "LH 900"),
            segment("LHR", "JFK", "11:00", "14:00", 480, "Lufthansa", "LH 901"),
        ], 720),
        provider_item(2200, [
            segment("FRA", "JFK", "10:00", "13:00", 540, "Lufthansa", "LH 400"),
        ], 540),
        provider_item(3100, [
            segment("FRA", "JFK", "13:00", "16:30", 570, "United", "UA 961"),
        ], 570),
    ], [1800, 3000])
    cash, award, result = replay(payload, cabin="Business")
    assert result["cash_eur"] == 2200
    assert result["decision"]["verdict"] != "book_miles"
    assert result["decision"]["evaluated_data_source"] == "estimated"
    assert_identity(cash, award, result)


def test_static_award_estimates_never_emit_book_miles():
    payload = search_payload([
        provider_item(2400, [
            segment("FRA", "JFK", "10:00", "13:00", 540, "Lufthansa", "LH 400"),
        ], 540),
    ], [1800, 3000])
    _, award, _ = replay(payload, cabin="Business")
    estimated_decisions = [
        row["decision"]
        for row in award["results"]
        if row["decision"]["evaluated_data_source"] == "estimated"
    ]
    assert estimated_decisions
    assert all(decision["verdict"] != "book_miles" for decision in estimated_decisions)


def test_shorthaul_110_nonstop_identity_replaces_90_connection():
    payload = search_payload([
        provider_item(90, [
            segment("FRA", "MUC", "07:00", "08:00", 60, "Lufthansa", "LH 100"),
            segment("MUC", "CDG", "09:30", "11:00", 90, "Lufthansa", "LH 200"),
        ], 240),
        provider_item(110, [
            segment("FRA", "CDG", "10:00", "11:15", 75, "Lufthansa", "LH 102"),
        ], 75),
        provider_item(180, [
            segment("FRA", "CDG", "14:00", "15:20", 80, "Air France", "AF 101"),
        ], 80),
    ], [100, 220])
    cash, award, result = replay(payload, dest="CDG")
    assert result["cash_eur"] == 110
    assert_identity(cash, award, result)


def test_incomplete_round_trip_blocks_strong_recommendation_and_caps_confidence():
    payload = search_payload([
        provider_item(650, [
            segment("FRA", "JFK", "10:00", "13:00", 540, "Lufthansa", "LH 400"),
        ], 540),
        provider_item(720, [
            segment("FRA", "LHR", "08:00", "09:00", 60, "British Airways", "BA 901"),
            segment("LHR", "JFK", "11:00", "14:00", 480, "British Airways", "BA 117"),
        ], 720),
    ], [500, 900])
    cash, award, result = replay(payload, round_trip=True)
    selected = next(o for o in cash["offers"] if o["cash_offer_id"] == cash["selected_cash_offer_id"])
    assert selected["completeness"] == "partial"
    assert selected["scoreConfidence"] == "low"
    assert cash["cash_guidance"]["recommendation_state"] == "limited_evidence"
    assert "incomplete_round_trip" in cash["cash_guidance"]["disqualifying_signals"]
    assert result["decision"]["verdict"] == "insufficient_data"
    assert result["decision"]["confidence"] == "low"
    assert_identity(cash, award, result)


def test_no_cash_results_never_infers_identity_or_positive_verdict():
    cash, award, result = replay(search_payload([]))
    assert cash["selected_cash_offer_id"] is None
    assert award["selected_cash_offer_id"] is None
    assert result["decision"]["evaluated_cash_offer_id"] is None
    assert result["decision"]["verdict"] == "insufficient_data"
    assert result["decision"]["signal"] == "insufficient_data"


def test_mismatched_requested_identity_is_insufficient_not_fallback():
    payload = search_payload([
        provider_item(420, [
            segment("FRA", "JFK", "10:00", "13:00", 540, "Lufthansa", "LH 400"),
        ], 540),
    ], [400, 700])
    request = {
        "origin": "FRA", "dest": "JFK", "date": DATE, "oneWay": True,
        "cabin": "Economy", "cabins": ["economy"], "currency": "eur",
        "cashOfferId": "offer_missing",
    }
    with mock.patch.object(awardradar, "serpapi_search", return_value=payload):
        body = awardradar.app.test_client().post("/api/awards", json=request).get_json()
    decision = body["results"][0]["decision"]
    assert body["selected_cash_offer_id"] is None
    assert decision["evaluated_cash_offer_id"] is None
    assert decision["verdict"] == "insufficient_data"
