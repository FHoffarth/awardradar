import datetime as dt
import logging
import threading
from unittest import mock

import pytest

import app as awardradar


class FakeResponse:
    status_code = 200
    text = "{}"
    content = b"{}"

    def __init__(self, payload=None, headers=None):
        self._payload = payload or {}
        self.headers = headers if headers is not None else {"X-RateLimit-Remaining": "999"}

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def _provider_events(caplog, provider=None):
    messages = [
        record.getMessage()
        for record in caplog.records
        if "event=provider_outbound_call" in record.getMessage()
    ]
    if provider:
        messages = [message for message in messages if f"provider={provider}" in message]
    return messages


def _enable_event_capture(caplog):
    caplog.set_level(logging.INFO, logger=awardradar.app.logger.name)


@pytest.fixture(autouse=True)
def _reset_seats_aero_guard(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_HARD_DISABLED", False)
    monkeypatch.setattr(awardradar, "SEATSAERO_SAFETY_FLOOR", 200)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", None)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", None)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_updated_at", None)
    monkeypatch.setattr(awardradar, "_seatsaero_bootstrap_utc_date", None)


def _isolate_awards_provider(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "secret-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", None)
    monkeypatch.setattr(awardradar, "fetch_cash_details", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        awardradar.STATIC_AWARD_SOURCE,
        "search",
        lambda *_args, **_kwargs: [],
    )


def test_valid_awards_request_emits_one_seats_aero_event(monkeypatch, caplog):
    _enable_event_capture(caplog)
    _isolate_awards_provider(monkeypatch)
    outbound = mock.Mock(return_value=FakeResponse({"data": []}))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={"origin": "FRA", "dest": "JFK", "date": "2030-01-15", "oneWay": True},
    )

    events = _provider_events(caplog, "seats_aero")
    assert response.status_code == 200
    assert outbound.call_count == 1
    assert outbound.call_args.kwargs["params"] == {
        "origin_airport": "FRA",
        "destination_airport": "JFK",
        "cabin": "economy",
        "start_date": "2030-01-12",
        "end_date": "2030-01-18",
        "take": 50,
    }
    assert len(events) == 1
    assert "feature_path=awards" in events[0]
    assert "request_kind=availability_search" in events[0]
    assert "request_fingerprint=" in events[0]
    assert "worker_pid=" in events[0]
    assert "secret-seats-key" not in "\n".join(record.getMessage() for record in caplog.records)
    assert "FRA" not in events[0]
    assert "JFK" not in events[0]
    assert "2030-01-15" not in events[0]


def test_top_opportunities_cache_hit_emits_no_provider_event(monkeypatch, caplog):
    _enable_event_capture(caplog)
    outbound = mock.Mock(side_effect=AssertionError("cache hit reached provider"))
    monkeypatch.setattr(awardradar, "_read_file_cache", lambda: [{"cached": True}])
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().get("/api/top-opportunities")

    assert response.status_code == 200
    assert response.get_json()["source"] == "cache"
    assert outbound.call_count == 0
    assert _provider_events(caplog) == []


def test_invalid_awards_date_emits_no_seats_aero_event(monkeypatch, caplog):
    _enable_event_capture(caplog)
    _isolate_awards_provider(monkeypatch)
    outbound = mock.Mock(side_effect=AssertionError("invalid request reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={"origin": "FRA", "dest": "JFK", "date": "not-a-date", "oneWay": True},
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_date"
    assert outbound.call_count == 0
    assert _provider_events(caplog, "seats_aero") == []


def test_missing_awards_input_emits_no_seats_aero_event(monkeypatch, caplog):
    _enable_event_capture(caplog)
    _isolate_awards_provider(monkeypatch)
    outbound = mock.Mock(side_effect=AssertionError("invalid request reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={"origin": "FRA", "date": "2030-01-15", "oneWay": True},
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_request"
    assert outbound.call_count == 0
    assert _provider_events(caplog, "seats_aero") == []


def test_seats_aero_budget_guard_emits_no_provider_event(monkeypatch, caplog):
    _enable_event_capture(caplog)
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "secret-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", 200)
    monkeypatch.setattr(
        awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today()
    )
    outbound = mock.Mock(side_effect=AssertionError("budget guard reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    with pytest.raises(awardradar.SeatsAeroGuardError) as exc_info:
        awardradar.fetch_seatsaero(
            "FRA", "JFK", "Business", dt.date(2030, 1, 15)
        )

    assert exc_info.value.code == "provider_budget_exhausted"
    assert outbound.call_count == 0
    assert _provider_events(caplog, "seats_aero") == []


def test_top_opportunities_provider_request_has_correct_event(monkeypatch, caplog):
    _enable_event_capture(caplog)
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "secret-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", None)
    monkeypatch.setattr(awardradar, "_read_file_cache", lambda: None)
    monkeypatch.setattr(awardradar, "_write_file_cache", lambda _rows: None)
    monkeypatch.setattr(awardradar, "_TOP_OPP_LOCK", threading.Lock())
    monkeypatch.setattr(awardradar, "TOP_OPP_ROUTES", [("FRA", "JFK", "Business")])
    monkeypatch.setattr(awardradar.time, "sleep", lambda _seconds: None)
    outbound = mock.Mock(return_value=FakeResponse({"data": []}))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().get("/api/top-opportunities")

    events = _provider_events(caplog, "seats_aero")
    assert response.status_code == 200
    assert response.get_json()["source"] == "live"
    assert outbound.call_count == 1
    assert len(events) == 1
    assert "feature_path=top_opportunities" in events[0]
    assert "request_kind=availability_search" in events[0]


def test_seats_aero_fingerprint_is_stable_and_provider_relevant():
    base = {
        "origin_airport": "FRA",
        "destination_airport": "JFK",
        "cabin": "business",
        "start_date": "2030-01-12",
        "end_date": "2030-01-18",
        "take": 50,
    }
    reordered = dict(reversed(list(base.items())))
    equivalent_case = {**base, "origin_airport": "fra", "cabin": "Business"}
    changed = {**base, "destination_airport": "SEA"}

    first = awardradar._seatsaero_request_fingerprint(base)
    assert first == awardradar._seatsaero_request_fingerprint(base)
    assert first == awardradar._seatsaero_request_fingerprint(reordered)
    assert first == awardradar._seatsaero_request_fingerprint(equivalent_case)
    assert first != awardradar._seatsaero_request_fingerprint(changed)
    assert len(first) == 16


def test_session_internal_retries_remain_one_logical_seats_aero_event(monkeypatch, caplog):
    """urllib3 retries occur below HTTP.get(), so the metric stays logical."""
    _enable_event_capture(caplog)
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "secret-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", None)
    adapter_send = mock.Mock(
        side_effect=[OSError("retry-1"), OSError("retry-2"), FakeResponse({"data": []})]
    )

    def session_get_with_internal_adapter_attempts(*_args, **_kwargs):
        for _ in range(3):
            try:
                return adapter_send()
            except OSError:
                continue
        raise AssertionError("mock adapter did not return a response")

    monkeypatch.setattr(awardradar.HTTP, "get", session_get_with_internal_adapter_attempts)
    with awardradar._seatsaero_feature_context("awards"):
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 15))

    assert adapter_send.call_count == 3
    assert len(_provider_events(caplog, "seats_aero")) == 1


def test_serpapi_initial_event_uses_common_safe_contract(monkeypatch, caplog):
    _enable_event_capture(caplog)
    awardradar._SERP_CACHE.clear()
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "secret-serpapi-key")
    outbound = mock.Mock(return_value=FakeResponse())
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    with awardradar._serpapi_feature_context("awards"):
        awardradar.serpapi_search(
            "FRA", "JFK", dt.date(2030, 1, 15), None, "Economy", "EUR"
        )

    events = _provider_events(caplog, "serpapi")
    assert outbound.call_count == 1
    assert len(events) == 1
    assert "feature_path=awards" in events[0]
    assert "request_kind=initial" in events[0]
    assert "secret-serpapi-key" not in events[0]
    assert "FRA" not in events[0]
    assert "JFK" not in events[0]
    assert "2030-01-15" not in events[0]


def test_serpapi_cache_hit_emits_zero_new_provider_events(monkeypatch, caplog):
    _enable_event_capture(caplog)
    awardradar._SERP_CACHE.clear()
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "secret-serpapi-key")
    outbound = mock.Mock(return_value=FakeResponse())
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    for _ in range(2):
        with awardradar._serpapi_feature_context("cheap"):
            awardradar.serpapi_search(
                "FRA", "SEA", dt.date(2031, 2, 17), None, "Economy", "EUR"
            )

    assert outbound.call_count == 1
    assert len(_provider_events(caplog, "serpapi")) == 1


def test_serpapi_continuation_event_never_logs_token(monkeypatch, caplog):
    _enable_event_capture(caplog)
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "secret-continuation-key")
    outbound = mock.Mock(return_value=FakeResponse())
    monkeypatch.setattr(awardradar.requests, "get", outbound)

    awardradar.serpapi_continuation_search(
        "FRA",
        "JFK",
        dt.date(2030, 1, 15),
        dt.date(2030, 1, 22),
        "Economy",
        "EUR",
        "provider-departure-token",
    )

    events = _provider_events(caplog, "serpapi")
    assert outbound.call_count == 1
    assert len(events) == 1
    assert "feature_path=continuation" in events[0]
    assert "request_kind=continuation" in events[0]
    assert "secret-continuation-key" not in events[0]
    assert "provider-departure-token" not in events[0]


def test_serpapi_fingerprint_excludes_api_key_and_changes_with_request():
    base = {
        "engine": "google_flights",
        "api_key": "first-secret",
        "departure_id": "FRA",
        "arrival_id": "JFK",
        "outbound_date": "2030-01-15",
        "type": "2",
        "currency": "EUR",
    }
    reordered_with_different_key = {
        "currency": "EUR",
        "type": "2",
        "outbound_date": "2030-01-15",
        "arrival_id": "JFK",
        "departure_id": "FRA",
        "api_key": "second-secret",
        "engine": "google_flights",
    }
    changed = {**base, "arrival_id": "SEA"}

    first = awardradar._serpapi_request_fingerprint(base)
    assert first == awardradar._serpapi_request_fingerprint(reordered_with_different_key)
    assert first != awardradar._serpapi_request_fingerprint(changed)
    assert len(first) == 16
