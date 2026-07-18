import math
from unittest import mock

import pytest

import app as awardradar
from tests.fixture_loader import load_fixture


FIXTURE_FILES = (
    "cash_one_way_complete.json",
    "cash_round_trip_complete.json",
    "cash_round_trip_partial_return.json",
    "cash_round_trip_price_only.json",
    "cash_multiple_options.json",
    "cash_invalid_prices.json",
)


def _mark_offer_ids(offers):
    for offer in offers:
        offer["offer_id"] = awardradar.compute_offer_id(offer)
    return offers


def _provider_panic(*_args, **_kwargs):
    raise AssertionError("provider boundary should not be called in fixture contract tests")


@pytest.fixture
def fixture_provider_guard(monkeypatch):
    for name in (
        "serpapi_search",
        "serpapi_task",
        "flex_date_task",
        "fetch_cash_details",
        "fetch_seatsaero",
        "tp_prices",
        "verify_skiplag_serpapi",
        "serpapi_continuation_search",
        "continue_recommended_offer",
        "autocomplete_places",
    ):
        monkeypatch.setattr(awardradar, name, _provider_panic)
    monkeypatch.setattr(awardradar.HTTP, "get", _provider_panic)
    monkeypatch.setattr(awardradar.requests, "get", _provider_panic)


class TestFixtureFiles:
    @pytest.mark.parametrize("fixture_name", FIXTURE_FILES)
    def test_fixture_declares_non_live_provenance(self, fixture_name):
        data = load_fixture(fixture_name)
        assert data["source_provenance"] == "synthetic_test_fixture"
        assert data["live_availability_claimed"] is False

    def test_allowed_fixture_file_set_is_exact(self):
        actual = sorted(path.name for path in (load_fixture.__globals__["FIXTURE_DIR"]).glob("*.json"))
        assert actual == sorted(FIXTURE_FILES)


class TestFixtureContractBehavior:
    def test_one_way_fixture_has_deterministic_offer_ids_and_recommendation(self, fixture_provider_guard):
        offers = _mark_offer_ids(load_fixture("cash_one_way_complete.json")["offers"])
        rescored = awardradar.rescore_offer_set(offers)
        guidance = awardradar.build_cash_guidance(rescored)

        assert guidance is not None
        recommended_id = guidance["recommended_offer_id"]
        assert any(offer["offer_id"] == recommended_id for offer in rescored)
        assert [offer["offer_id"] for offer in rescored] == [awardradar.compute_offer_id(offer) for offer in rescored]

    def test_round_trip_complete_fixture_preserves_outbound_return_separation(self, fixture_provider_guard):
        offer = _mark_offer_ids(load_fixture("cash_round_trip_complete.json")["offers"])[0]

        assert offer["itinerary_state"] == "complete"
        assert offer["outbound_segments"]
        assert offer["return_segments"]
        assert offer["outbound_segments"][0]["dep_iata"] == "FRA"
        assert offer["return_segments"][0]["dep_iata"] == "JFK"
        assert offer["outbound_segments"][0]["dep_iata"] != offer["return_segments"][0]["dep_iata"]

    def test_round_trip_partial_fixture_has_no_invented_return_itinerary(self, fixture_provider_guard):
        offer = _mark_offer_ids(load_fixture("cash_round_trip_partial_return.json")["offers"])[0]

        assert offer["itinerary_state"] == "partial"
        assert offer["outbound_segments"]
        assert "return_segments" not in offer

    def test_round_trip_price_only_fixture_stays_explicit(self, fixture_provider_guard):
        offer = _mark_offer_ids(load_fixture("cash_round_trip_price_only.json")["offers"])[0]

        assert offer["itinerary_state"] == "price_only"
        assert "outbound_segments" not in offer
        assert "return_segments" not in offer

    def test_multiple_options_fixture_recommendation_points_to_existing_offer(self, fixture_provider_guard):
        offers = _mark_offer_ids(load_fixture("cash_multiple_options.json")["offers"])
        rescored = awardradar.rescore_offer_set(offers)
        guidance = awardradar.build_cash_guidance(rescored)

        assert guidance is not None
        recommended_id = guidance["recommended_offer_id"]
        ids = [offer["offer_id"] for offer in rescored]
        assert recommended_id in ids

    def test_invalid_prices_never_become_valid_offers(self, fixture_provider_guard):
        offers = _mark_offer_ids(load_fixture("cash_invalid_prices.json")["offers"])
        valid = [offer for offer in offers if awardradar._valid_price(offer.get("price")) is not None]

        assert len(valid) == 1
        assert valid[0]["airline"] == "Valid Control"
        assert awardradar._valid_price("NaN") is None
        assert awardradar._valid_price("Infinity") is None

    def test_fixture_suite_adds_no_mock_query_flag_or_mock_route(self, fixture_provider_guard):
        with open("app.py", encoding="utf-8") as handle:
            source = handle.read()
        assert "?mock=true" not in source
        assert "mock=true" not in source
        assert "/api/mock" not in source

    def test_zero_provider_calls_proved_by_fixture_contract_execution(self, fixture_provider_guard):
        offers = _mark_offer_ids(load_fixture("cash_one_way_complete.json")["offers"])
        rescored = awardradar.rescore_offer_set(offers)
        guidance = awardradar.build_cash_guidance(rescored)

        assert guidance is not None
