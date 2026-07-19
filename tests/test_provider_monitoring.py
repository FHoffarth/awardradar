import threading
import datetime as dt
import os
import json

import pytest

import app as awardradar


def setup_function():
    awardradar._reset_provider_monitoring_for_tests()
    awardradar._SERP_CACHE.clear()
    awardradar._serpapi_paid_calls = 0
    awardradar.SERPAPI_HARD_CALL_LIMIT = None


def test_health_contains_public_safe_provider_monitoring_summary():
    data = awardradar.app.test_client().get("/health").get_json()
    assert data["ok"] is True
    assert "provider_monitoring" in data
    assert "degraded_states" in data
    assert data["provider_monitoring"]["scope"] == "process_local"
    assert set(data["provider_monitoring"].keys()) == {"scope", "serpapi", "seats_aero"}


def test_health_preserves_existing_fields():
    data = awardradar.app.test_client().get("/health").get_json()
    for field in (
        "ok",
        "app",
        "version",
        "price_source",
        "serpapi_token",
        "tp_token",
        "award_source",
        "seatsaero_key",
        "seats_aero_budget",
        "serpapi_paid_calls",
        "serpapi_max_pairs",
        "continuation_enabled",
        "continuation_mode",
        "continuation_timeout_ms",
    ):
        assert field in data


def test_health_provider_states_use_allowed_enum():
    data = awardradar.app.test_client().get("/health").get_json()
    allowed = {"healthy", "degraded", "disabled", "exhausted", "unknown"}
    assert data["provider_monitoring"]["serpapi"]["state"] in allowed
    assert data["provider_monitoring"]["seats_aero"]["state"] in allowed


def test_health_initial_state_is_unknown():
    data = awardradar.app.test_client().get("/health").get_json()
    assert data["provider_monitoring"]["serpapi"]["state"] == "unknown"
    assert data["provider_monitoring"]["seats_aero"]["state"] == "unknown"
    assert data["degraded_states"] == []


def test_health_disabled_state_is_exposed_correctly():
    awardradar._record_provider_monitoring_failure("seats_aero", "provider_disabled")
    data = awardradar.app.test_client().get("/health").get_json()
    seats = data["provider_monitoring"]["seats_aero"]
    assert seats["state"] == "disabled"
    assert {"provider": "seats_aero", "state": "disabled", "reason": "provider_disabled"} in data["degraded_states"]


def test_health_exhausted_state_is_exposed_correctly():
    awardradar._record_provider_monitoring_failure("serpapi", "quota_exhausted")
    data = awardradar.app.test_client().get("/health").get_json()
    serp = data["provider_monitoring"]["serpapi"]
    assert serp["state"] == "exhausted"
    assert {"provider": "serpapi", "state": "exhausted", "reason": "quota_exhausted"} in data["degraded_states"]


def test_health_degraded_state_and_reason_are_exposed_correctly():
    awardradar._record_provider_monitoring_failure("serpapi", "provider_timeout")
    data = awardradar.app.test_client().get("/health").get_json()
    serp = data["provider_monitoring"]["serpapi"]
    assert serp["state"] == "degraded"
    assert serp["last_error_kind"] == "provider_timeout"
    assert {"provider": "serpapi", "state": "degraded", "reason": "provider_timeout"} in data["degraded_states"]


def test_later_success_removes_provider_from_degraded_states():
    awardradar._record_provider_monitoring_failure("serpapi", "provider_timeout")
    awardradar._record_provider_monitoring_success("serpapi")
    data = awardradar.app.test_client().get("/health").get_json()
    assert data["provider_monitoring"]["serpapi"]["state"] == "healthy"
    assert all(item["provider"] != "serpapi" for item in data["degraded_states"])


def test_health_response_mutation_cannot_affect_internal_state():
    response = awardradar.app.test_client().get("/health").get_json()
    response["provider_monitoring"]["serpapi"]["requests_total"] = 999
    response["degraded_states"].append({"provider": "serpapi", "state": "degraded", "reason": "provider_timeout"})
    fresh = awardradar.app.test_client().get("/health").get_json()
    assert fresh["provider_monitoring"]["serpapi"]["requests_total"] == 0
    assert fresh["degraded_states"] == []


def test_health_response_contains_no_secret_keys_or_values():
    awardradar._record_provider_monitoring_failure("serpapi", "provider_timeout")
    rendered = json.dumps(awardradar.app.test_client().get("/health").get_json()).lower()
    forbidden = [
        "api_key",
        "authorization",
        "cookie",
        "departure_id",
        "arrival_id",
        "origin",
        "destination",
        "request_fingerprint",
        "partner-authorization",
    ]
    for item in forbidden:
        assert item not in rendered


def test_health_response_contains_no_threshold_or_quota_value_fields():
    rendered = json.dumps(awardradar.app.test_client().get("/health").get_json()).lower()
    forbidden = [
        "hard_call_limit",
        "remaining_quota",
        "x-ratelimit-remaining",
        "seatsaero_safety_floor",
        "provider_remaining_unknown_total",
        "provider_disabled_total",
        "quota_exhausted_total",
    ]
    for item in forbidden:
        assert item not in rendered


def test_health_response_is_json_serializable():
    data = awardradar.app.test_client().get("/health").get_json()
    assert isinstance(json.dumps(data), str)


def test_clean_initial_snapshot():
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["state"] == "unknown"
    assert snapshot["serpapi"]["requests_total"] == 0
    assert snapshot["serpapi"]["last_success_at"] is None
    assert snapshot["seats_aero"]["state"] == "unknown"
    assert snapshot["top_opportunities"]["cache_hits"] == 0


def test_provider_stores_are_independent():
    awardradar._increment_provider_monitoring("serpapi", "requests_total", 2)
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["requests_total"] == 2
    assert snapshot["seats_aero"]["requests_total"] == 0


def test_counter_increment_helper():
    awardradar._increment_provider_monitoring("serpapi", "requests_total")
    awardradar._increment_provider_monitoring("serpapi", "requests_total", 3)
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["requests_total"] == 4


def test_success_records_timestamp_and_can_become_healthy():
    awardradar._record_provider_monitoring_success("serpapi")
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["last_success_at"] is not None
    assert snapshot["serpapi"]["state"] == "healthy"


def test_failure_classification_maps_to_correct_counter_and_last_error():
    awardradar._record_provider_monitoring_failure("serpapi", "provider_5xx")
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["provider_5xx_total"] == 1
    assert snapshot["serpapi"]["last_error_kind"] == "provider_5xx"
    assert snapshot["serpapi"]["last_error_at"] is not None
    assert snapshot["serpapi"]["degraded_total"] == 1


def test_cache_hit_and_known_age_are_recorded():
    awardradar._record_provider_monitoring_cache_result("serpapi", hit=True, age_seconds=37)
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["cache_hits"] == 1
    assert snapshot["serpapi"]["cache_misses"] == 0
    assert snapshot["serpapi"]["last_cache_age_seconds"] == 37


def test_unknown_cache_age_remains_null():
    awardradar._record_provider_monitoring_cache_result("top_opportunities", hit=False, age_seconds=None)
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["top_opportunities"]["cache_misses"] == 1
    assert snapshot["top_opportunities"]["last_cache_age_seconds"] is None


def test_disabled_outranks_all_other_states():
    awardradar._record_provider_monitoring_success("serpapi")
    awardradar._record_provider_monitoring_failure("serpapi", "provider_timeout")
    awardradar._record_provider_monitoring_failure("serpapi", "provider_disabled")
    assert awardradar._derive_provider_monitoring_state("serpapi") == "disabled"


def test_exhausted_outranks_degraded():
    awardradar._record_provider_monitoring_failure("serpapi", "provider_timeout")
    awardradar._record_provider_monitoring_failure("serpapi", "quota_exhausted")
    assert awardradar._derive_provider_monitoring_state("serpapi") == "exhausted"


def test_degradation_outranks_prior_success():
    awardradar._record_provider_monitoring_success("serpapi")
    awardradar._record_provider_monitoring_failure("serpapi", "rate_limited")
    assert awardradar._derive_provider_monitoring_state("serpapi") == "degraded"


def test_success_clears_active_degradation_but_not_historical_counters():
    awardradar._record_provider_monitoring_failure("serpapi", "provider_timeout")
    awardradar._record_provider_monitoring_success("serpapi")
    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["state"] == "healthy"
    assert snapshot["serpapi"]["timeout_total"] == 1
    assert snapshot["serpapi"]["last_error_kind"] is None


def test_snapshot_is_immutable_from_caller_perspective():
    snapshot = awardradar._provider_monitoring_snapshot()
    snapshot["serpapi"]["requests_total"] = 999
    fresh_snapshot = awardradar._provider_monitoring_snapshot()
    assert fresh_snapshot["serpapi"]["requests_total"] == 0


def test_concurrent_increments_do_not_lose_updates():
    def worker():
        for _ in range(200):
            awardradar._increment_provider_monitoring("serpapi", "requests_total")

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["requests_total"] == 2000


def test_snapshot_contains_no_secrets_or_raw_request_fields():
    snapshot = awardradar._provider_monitoring_snapshot()
    rendered = str(snapshot)
    forbidden = ["api_key", "authorization", "cookie", "origin", "destination", "date", "token", "request_fingerprint"]
    for item in forbidden:
        assert item not in rendered.lower()


def test_parse_optional_non_negative_int_unset(monkeypatch):
    monkeypatch.delenv("SERPAPI_HARD_CALL_LIMIT", raising=False)
    assert awardradar._parse_optional_non_negative_int("SERPAPI_HARD_CALL_LIMIT") is None


def test_parse_optional_non_negative_int_empty(monkeypatch):
    monkeypatch.setenv("SERPAPI_HARD_CALL_LIMIT", "")
    assert awardradar._parse_optional_non_negative_int("SERPAPI_HARD_CALL_LIMIT") is None


def test_parse_optional_non_negative_int_positive(monkeypatch):
    monkeypatch.setenv("SERPAPI_HARD_CALL_LIMIT", "7")
    assert awardradar._parse_optional_non_negative_int("SERPAPI_HARD_CALL_LIMIT") == 7


def test_parse_optional_non_negative_int_zero(monkeypatch):
    monkeypatch.setenv("SERPAPI_HARD_CALL_LIMIT", "0")
    assert awardradar._parse_optional_non_negative_int("SERPAPI_HARD_CALL_LIMIT") == 0


def test_parse_optional_non_negative_int_malformed_fails_closed(monkeypatch):
    monkeypatch.setenv("SERPAPI_HARD_CALL_LIMIT", "abc")
    assert awardradar._parse_optional_non_negative_int("SERPAPI_HARD_CALL_LIMIT") == 0


def test_parse_optional_non_negative_int_negative_fails_closed(monkeypatch):
    monkeypatch.setenv("SERPAPI_HARD_CALL_LIMIT", "-5")
    assert awardradar._parse_optional_non_negative_int("SERPAPI_HARD_CALL_LIMIT") == 0


class FakeSerpResponse:
    def __init__(self, *, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            err = awardradar.requests.HTTPError(f"status={self.status_code}")
            err.response = self
            raise err


class FakeSeatsResponse:
    def __init__(self, *, status_code=200, payload=None, headers=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"data": []}
        self.headers = headers if headers is not None else {"X-RateLimit-Remaining": "999"}
        self.text = text

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


def test_serpapi_successful_outbound_attempt_increments_requests(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: FakeSerpResponse(payload={"best_flights": [], "other_flights": []}))

    awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["requests_total"] == 1
    assert snapshot["serpapi"]["state"] == "healthy"


def test_serpapi_cache_hit_does_not_increment_requests(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: FakeSerpResponse(payload={"best_flights": [], "other_flights": []}))

    args = ("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")
    awardradar.serpapi_search(*args)
    awardradar.serpapi_search(*args)

    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["serpapi"]["requests_total"] == 1
    assert snapshot["serpapi"]["cache_hits"] == 1
    assert snapshot["serpapi"]["cache_misses"] == 1


def test_serpapi_http_429_increments_rate_limited(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        lambda *a, **k: FakeSerpResponse(status_code=429, payload={"error": "Too many requests"}, text="Too many requests"),
    )

    with pytest.raises(awardradar.SerpApiError) as caught:
        awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.reason == "rate_limited"
    assert snapshot["serpapi"]["rate_limited_total"] == 1
    assert snapshot["serpapi"]["last_error_kind"] == "rate_limited"


def test_serpapi_http_5xx_increments_provider_5xx(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        lambda *a, **k: FakeSerpResponse(status_code=503, payload={"error": "Down"}, text="Down"),
    )

    with pytest.raises(awardradar.SerpApiError) as caught:
        awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.reason == "provider_5xx"
    assert snapshot["serpapi"]["provider_5xx_total"] == 1


def test_serpapi_timeout_increments_timeout_counter(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: (_ for _ in ()).throw(awardradar.requests.Timeout()))

    with pytest.raises(awardradar.SerpApiError) as caught:
        awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.reason == "provider_timeout"
    assert snapshot["serpapi"]["timeout_total"] == 1


def test_serpapi_parser_error_increments_counter(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: FakeSerpResponse(payload=ValueError("bad json")))

    with pytest.raises(awardradar.SerpApiError) as caught:
        awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.reason == "parser_error"
    assert snapshot["serpapi"]["parser_error_total"] == 1


def test_serpapi_hard_limit_blocks_without_outbound_request(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar, "SERPAPI_HARD_CALL_LIMIT", 0)
    called = {"count": 0}

    def should_not_run(*args, **kwargs):
        called["count"] += 1
        return FakeSerpResponse(payload={"best_flights": [], "other_flights": []})

    monkeypatch.setattr(awardradar.HTTP, "get", should_not_run)

    with pytest.raises(awardradar.QuotaError):
        awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    snapshot = awardradar._provider_monitoring_snapshot()
    assert called["count"] == 0
    assert snapshot["serpapi"]["requests_total"] == 0
    assert snapshot["serpapi"]["quota_exhausted_total"] == 1
    assert snapshot["serpapi"]["state"] == "exhausted"


def test_seatsaero_successful_outbound_attempt_increments_requests(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "test-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", 999)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today())
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: FakeSeatsResponse(payload={"data": []}))

    with awardradar._seatsaero_reserved_capacity():
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 1))

    snapshot = awardradar._provider_monitoring_snapshot()
    assert snapshot["seats_aero"]["requests_total"] == 1
    assert snapshot["seats_aero"]["state"] == "healthy"


def test_seatsaero_hard_disabled_blocks_without_outbound_request(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_HARD_DISABLED", True)
    called = {"count": 0}

    def should_not_run(*args, **kwargs):
        called["count"] += 1
        return FakeSeatsResponse()

    monkeypatch.setattr(awardradar.HTTP, "get", should_not_run)

    with pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar._reserve_seatsaero_capacity(1)

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.code == "provider_disabled"
    assert called["count"] == 0
    assert snapshot["seats_aero"]["requests_total"] == 0
    assert snapshot["seats_aero"]["provider_disabled_total"] == 1
    assert snapshot["seats_aero"]["state"] == "disabled"


def test_seatsaero_unknown_remaining_blocks_without_outbound_request(monkeypatch):
    monkeypatch.setattr(awardradar, "_seatsaero_bootstrap_utc_date", awardradar._seatsaero_utc_today())

    with pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar._reserve_seatsaero_capacity(1)

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.code == "provider_remaining_unknown"
    assert snapshot["seats_aero"]["requests_total"] == 0
    assert snapshot["seats_aero"]["provider_remaining_unknown_total"] == 1
    assert snapshot["seats_aero"]["last_error_kind"] == "provider_remaining_unknown"
    assert snapshot["seats_aero"]["state"] == "degraded"


def test_seatsaero_http_429_records_rate_limit_and_exhaustion(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "test-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", 999)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today())
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        lambda *a, **k: FakeSeatsResponse(
            status_code=429,
            payload={"error": "limited"},
            headers={"X-RateLimit-Remaining": "0"},
            text="limited",
        ),
    )

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 1))

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.code == "provider_budget_exhausted"
    assert snapshot["seats_aero"]["requests_total"] == 1
    assert snapshot["seats_aero"]["rate_limited_total"] == 1
    assert snapshot["seats_aero"]["quota_exhausted_total"] == 1
    assert snapshot["seats_aero"]["state"] == "exhausted"


def test_seatsaero_http_5xx_is_not_treated_as_empty_success(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "test-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", 999)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today())
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        lambda *a, **k: FakeSeatsResponse(status_code=503, payload={"error": "down"}, text="down"),
    )

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 1))

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.code == "provider_remaining_unknown"
    assert snapshot["seats_aero"]["requests_total"] == 1
    assert snapshot["seats_aero"]["provider_5xx_total"] == 1
    assert snapshot["seats_aero"]["state"] == "degraded"


def test_seatsaero_timeout_records_timeout(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "test-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", 999)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today())
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: (_ for _ in ()).throw(awardradar.requests.Timeout()))

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 1))

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.code == "provider_remaining_unknown"
    assert snapshot["seats_aero"]["requests_total"] == 1
    assert snapshot["seats_aero"]["timeout_total"] == 1
    assert snapshot["seats_aero"]["state"] == "degraded"


def test_seatsaero_parser_error_records_parser_failure(monkeypatch):
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "test-seats-key")
    monkeypatch.setattr(awardradar, "_seatsaero_remaining", 999)
    monkeypatch.setattr(awardradar, "_seatsaero_remaining_utc_date", awardradar._seatsaero_utc_today())
    monkeypatch.setattr(
        awardradar.HTTP,
        "get",
        lambda *a, **k: FakeSeatsResponse(payload=ValueError("bad json")),
    )

    with awardradar._seatsaero_reserved_capacity(), pytest.raises(awardradar.SeatsAeroGuardError) as caught:
        awardradar.fetch_seatsaero("FRA", "JFK", "Business", dt.date(2030, 1, 1))

    snapshot = awardradar._provider_monitoring_snapshot()
    assert caught.value.code == "provider_remaining_unknown"
    assert snapshot["seats_aero"]["requests_total"] == 1
    assert snapshot["seats_aero"]["parser_error_total"] == 1
    assert snapshot["seats_aero"]["state"] == "degraded"
