import threading

import app as awardradar


def setup_function():
    awardradar._reset_provider_monitoring_for_tests()


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
