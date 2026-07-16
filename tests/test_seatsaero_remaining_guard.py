import datetime as dt
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import pytest

import app as awardradar


class FakeResponse:
    text = "{}"
    content = b"{}"

    def __init__(self, payload=None, *, status_code=200, headers=None):
        self._payload = payload or {}
        self.status_code = status_code
        self.headers = headers if headers is not None else {"X-RateLimit-Remaining": "999"}

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def isolated_guard(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "test-seats-key")
    monkeypatch.setattr(awardradar, "SEATSAERO_HARD_DISABLED", False)
    monkeypatch.setattr(awardradar, "SEATSAERO_SAFETY_FLOOR", 200)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", None)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", None)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_updated_at", None)
    monkeypatch.setattr(awardradar, "_seatsaero_bootstrap_utc_date", None)
    monkeypatch.setattr(awardradar, "_SEATSAERO_BUDGET_LOCK", threading.Lock())


def set_remaining(monkeypatch, value):
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", value)
    monkeypatch.setattr(
        awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today()
    )
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_updated_at", 1.0)


def provider_events(caplog):
    return [
        record.getMessage()
        for record in caplog.records
        if "event=provider_outbound_call provider=seats_aero" in record.getMessage()
    ]


def test_lower_header_is_accepted_and_delayed_higher_header_is_ignored(monkeypatch):
    assert awardradar._update_seatsaero_remaining("850") is True
    first_updated = awardradar._seatsaero_remaining_updated_at

    assert awardradar._update_seatsaero_remaining("849") is True
    assert awardradar._seatsaero_remaining == 849
    assert awardradar._seatsaero_remaining_updated_at >= first_updated

    accepted_at = awardradar._seatsaero_remaining_updated_at
    assert awardradar._update_seatsaero_remaining("900") is False
    assert awardradar._seatsaero_remaining == 849
    assert awardradar._seatsaero_remaining_updated_at == accepted_at


def test_new_utc_day_discards_old_value(monkeypatch):
    days = iter((dt.date(2030, 1, 1), dt.date(2030, 1, 2)))
    monkeypatch.setattr(awardradar, "_seatsaero_utc_today", lambda: next(days))

    assert awardradar._update_seatsaero_remaining("700") is True
    assert awardradar._seatsaero_budget_status() == "unknown"
    assert awardradar._seatsaero_remaining is None


@pytest.mark.parametrize("headers", [{}, {"X-RateLimit-Remaining": "not-a-number"}])
def test_missing_or_non_numeric_header_makes_state_unknown(monkeypatch, headers):
    set_remaining(monkeypatch, 800)
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        mock.Mock(return_value=FakeResponse({"data": []}, headers=headers)),
    )

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(
        awardradar.SeatsAeroGuardError, match="provider_remaining_unknown"
    ):
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 15))

    assert awardradar._seatsaero_budget_status() == "unknown"


def test_request_exception_makes_state_unknown(monkeypatch):
    set_remaining(monkeypatch, 800)
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        mock.Mock(side_effect=awardradar.requests.ConnectionError("offline")),
    )

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(
        awardradar.SeatsAeroGuardError, match="provider_remaining_unknown"
    ):
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 15))

    assert awardradar._seatsaero_budget_status() == "unknown"


def test_valid_header_on_429_updates_before_error_handling(monkeypatch):
    set_remaining(monkeypatch, 800)
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        mock.Mock(
            return_value=FakeResponse(
                {"error": "limited"},
                status_code=429,
                headers={"X-RateLimit-Remaining": "0"},
            )
        ),
    )

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(
        awardradar.SeatsAeroGuardError, match="provider_budget_exhausted"
    ):
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 15))

    assert awardradar._seatsaero_remaining == 0
    assert awardradar._seatsaero_budget_status() == "exhausted"


@pytest.mark.parametrize(
    ("remaining", "allowed"),
    [(202, True), (201, True), (200, False), (199, False)],
)
def test_exact_safety_threshold(monkeypatch, remaining, allowed):
    set_remaining(monkeypatch, remaining)
    if allowed:
        awardradar._reserve_seatsaero_capacity(1)
        assert awardradar._seatsaero_remaining == remaining - 1
    else:
        with pytest.raises(awardradar.SeatsAeroGuardError) as caught:
            awardradar._reserve_seatsaero_capacity(1)
        assert caught.value.code == "provider_budget_exhausted"


def test_awards_fanout_rejected_before_provider_or_estimates(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    set_remaining(monkeypatch, 203)
    outbound = mock.Mock(side_effect=AssertionError("guard reached provider"))
    static_search = mock.Mock(side_effect=AssertionError("guard reached estimates"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)
    monkeypatch.setattr(awardradar.STATIC_AWARD_SOURCE, "search", static_search)
    monkeypatch.setattr(awardradar, "fetch_cash_details", lambda *_args, **_kwargs: {})

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={
            "origin": "FRA,MUC",
            "dest": "JFK,SEA",
            "date": "2030-01-15",
            "oneWay": True,
        },
    )

    assert response.status_code == 503
    assert response.get_json()["error"] == "provider_budget_exhausted"
    assert outbound.call_count == 0
    assert static_search.call_count == 0


def test_top_opportunities_insufficient_capacity_emits_zero_calls(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    monkeypatch.setattr(awardradar, "TOP_OPP_ROUTES", [("FRA", "JFK", "Business")] * 2)
    monkeypatch.setattr(awardradar, "_TOP_OPP_LOCK", threading.Lock())
    monkeypatch.setattr(awardradar, "_read_file_cache", lambda: None)
    set_remaining(monkeypatch, 201)
    outbound = mock.Mock(side_effect=AssertionError("guard reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().get("/api/top-opportunities")

    assert response.status_code == 503
    assert response.get_json()["error"] == "provider_budget_exhausted"
    assert outbound.call_count == 0


def test_top_opportunities_unknown_state_fails_closed_without_bootstrap(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    monkeypatch.setattr(
        awardradar,
        "TOP_OPP_ROUTES",
        [("FRA", "JFK", "Business"), ("MUC", "JFK", "Business")],
    )
    monkeypatch.setattr(awardradar, "_TOP_OPP_LOCK", threading.Lock())
    monkeypatch.setattr(awardradar, "_read_file_cache", lambda: None)
    outbound = mock.Mock(side_effect=AssertionError("unknown guard reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().get("/api/top-opportunities")

    assert response.status_code == 503
    assert response.get_json()["error"] == "provider_remaining_unknown"
    assert outbound.call_count == 0


def test_sufficient_capacity_permits_complete_planned_fanout(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=awardradar.app.logger.name)
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    monkeypatch.setattr(
        awardradar,
        "TOP_OPP_ROUTES",
        [("FRA", "JFK", "Business"), ("MUC", "JFK", "Business")],
    )
    monkeypatch.setattr(awardradar, "_TOP_OPP_LOCK", threading.Lock())
    monkeypatch.setattr(awardradar, "_read_file_cache", lambda: None)
    monkeypatch.setattr(awardradar, "_write_file_cache", lambda _rows: None)
    monkeypatch.setattr(awardradar.time, "sleep", lambda _seconds: None)
    set_remaining(monkeypatch, 202)
    outbound = mock.Mock(
        side_effect=[
            FakeResponse({"data": []}, headers={"X-RateLimit-Remaining": "201"}),
            FakeResponse({"data": []}, headers={"X-RateLimit-Remaining": "200"}),
        ]
    )
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().get("/api/top-opportunities")

    assert response.status_code == 200
    assert outbound.call_count == 2
    assert len(provider_events(caplog)) == 2


def test_only_one_unknown_bootstrap_is_allowed_per_worker_day():
    awardradar._reserve_seatsaero_capacity(1)
    with pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar._reserve_seatsaero_capacity(1)
    assert caught.value.code == "provider_remaining_unknown"


def test_threads_cannot_oversubscribe_local_snapshot(monkeypatch):
    set_remaining(monkeypatch, 204)

    def reserve_one(_index):
        try:
            awardradar._reserve_seatsaero_capacity(1)
            return True
        except awardradar.SeatsAeroGuardError:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(reserve_one, range(8)))

    assert results.count(True) == 4
    assert awardradar._seatsaero_remaining == 200


def test_hard_disable_blocks_endpoint_and_health_is_coarse(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    monkeypatch.setattr(awardradar, "SEATSAERO_HARD_DISABLED", True)
    outbound = mock.Mock(side_effect=AssertionError("disabled guard reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={"origin": "FRA", "dest": "JFK", "date": "2030-01-15", "oneWay": True},
    )
    health = awardradar.app.test_client().get("/health")

    assert response.status_code == 503
    assert response.get_json() == {
        "ok": False,
        "error": "provider_disabled",
        "message": "Live provider access is temporarily disabled.",
        "retryable": False,
    }
    assert outbound.call_count == 0
    assert health.status_code == 200
    assert health.get_json()["seats_aero_budget"] == "disabled"
    assert "seatsaero_remaining" not in health.get_json()


def test_invalid_awards_input_still_reaches_no_provider(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    outbound = mock.Mock(side_effect=AssertionError("invalid request reached provider"))
    monkeypatch.setattr(awardradar.HTTP, "get", outbound)

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={"origin": "FRA", "dest": "JFK", "date": "bad", "oneWay": True},
    )

    assert response.status_code == 400
    assert outbound.call_count == 0


def test_budget_failure_does_not_fall_back_to_estimates(monkeypatch):
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "seatsaero")
    set_remaining(monkeypatch, 200)
    static_search = mock.Mock(side_effect=AssertionError("budget failure reached estimates"))
    monkeypatch.setattr(awardradar.STATIC_AWARD_SOURCE, "search", static_search)
    monkeypatch.setattr(awardradar, "fetch_cash_details", lambda *_args, **_kwargs: {})

    response = awardradar.app.test_client().post(
        "/api/awards",
        json={"origin": "FRA", "dest": "JFK", "date": "2030-01-15", "oneWay": True},
    )

    assert response.status_code == 503
    assert response.get_json()["error"] == "provider_budget_exhausted"
    assert static_search.call_count == 0
