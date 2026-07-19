import threading
import datetime as dt
import os

import pytest

import app as awardradar


def setup_function():
    awardradar._reset_provider_monitoring_for_tests()
    awardradar._SERP_CACHE.clear()
    awardradar._serpapi_paid_calls = 0
    awardradar.SERPAPI_HARD_CALL_LIMIT = None


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
