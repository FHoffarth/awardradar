import datetime as dt
import logging
from unittest import mock

import app as awardradar


class FakeResponse:
    status_code = 200
    text = "{}"
    content = b"{}"

    def __init__(self, payload=None):
        self._payload = payload or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def _event_messages(caplog):
    return [record.getMessage() for record in caplog.records if "event=serpapi_outbound_call" in record.getMessage()]


def test_initial_outbound_boundary_emits_one_safe_structured_event(caplog):
    awardradar._SERP_CACHE.clear()
    caplog.set_level(logging.INFO, logger=awardradar.app.logger.name)
    with mock.patch.object(awardradar, "SERPAPI_TOKEN", "secret-test-api-key"), mock.patch.object(
        awardradar.HTTP, "get", return_value=FakeResponse()
    ) as outbound:
        with awardradar._serpapi_feature_context("awards"):
            awardradar.serpapi_search(
                "FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR"
            )

    messages = _event_messages(caplog)
    assert outbound.call_count == 1
    assert len(messages) == 1
    assert "feature_path=awards" in messages[0]
    assert "request_kind=initial" in messages[0]
    assert "engine=google_flights" in messages[0]
    assert "worker_pid=" in messages[0]
    assert "request_fingerprint=" in messages[0]
    assert "secret-test-api-key" not in messages[0]
    assert "FRA" not in messages[0]
    assert "JFK" not in messages[0]
    assert "2030-01-01" not in messages[0]


def test_continuation_outbound_boundary_emits_one_safe_structured_event(caplog):
    caplog.set_level(logging.INFO, logger=awardradar.app.logger.name)
    with mock.patch.object(awardradar, "SERPAPI_TOKEN", "secret-continuation-key"), mock.patch.object(
        awardradar.requests, "get", return_value=FakeResponse()
    ) as outbound:
        awardradar.serpapi_continuation_search(
            "FRA", "JFK", dt.date(2030, 1, 1), dt.date(2030, 1, 8),
            "Economy", "EUR", "provider-departure-token",
        )

    messages = _event_messages(caplog)
    assert outbound.call_count == 1
    assert len(messages) == 1
    assert "feature_path=continuation" in messages[0]
    assert "request_kind=continuation" in messages[0]
    assert "secret-continuation-key" not in messages[0]
    assert "provider-departure-token" not in messages[0]
    assert "FRA" not in messages[0]
    assert "JFK" not in messages[0]


def test_fingerprint_is_stable_and_provider_relevant():
    base = {
        "engine": "google_flights",
        "api_key": "first-secret",
        "departure_id": "FRA",
        "arrival_id": "JFK",
        "outbound_date": "2030-01-01",
        "type": "2",
        "currency": "EUR",
    }
    reordered_with_different_key = {
        "currency": "EUR",
        "type": "2",
        "outbound_date": "2030-01-01",
        "arrival_id": "JFK",
        "departure_id": "FRA",
        "api_key": "second-secret",
        "engine": "google_flights",
    }
    changed_route = {**base, "arrival_id": "LAX"}

    first = awardradar._serpapi_request_fingerprint(base)
    assert first == awardradar._serpapi_request_fingerprint(base)
    assert first == awardradar._serpapi_request_fingerprint(reordered_with_different_key)
    assert first != awardradar._serpapi_request_fingerprint(changed_route)
    assert len(first) == 16


def test_repeated_outbound_calls_emit_the_same_fingerprint(caplog):
    caplog.set_level(logging.INFO, logger=awardradar.app.logger.name)
    with mock.patch.object(awardradar, "SERPAPI_TOKEN", "test-key"), mock.patch.object(
        awardradar.HTTP, "get", return_value=FakeResponse()
    ):
        for _ in range(2):
            awardradar._SERP_CACHE.clear()
            with awardradar._serpapi_feature_context("cheap"):
                awardradar.serpapi_search(
                    "FRA", "JFK", dt.date(2032, 3, 3), None, "Economy", "EUR"
                )

    messages = _event_messages(caplog)
    assert len(messages) == 2
    fingerprints = [message.split("request_fingerprint=", 1)[1].split(" ", 1)[0] for message in messages]
    assert fingerprints[0] == fingerprints[1]


def test_session_internal_attempts_emit_one_logical_invocation_event(caplog):
    """Retries occur below HTTP.get(), so this event does not count physical attempts."""
    awardradar._SERP_CACHE.clear()
    caplog.set_level(logging.INFO, logger=awardradar.app.logger.name)
    adapter_send = mock.Mock(side_effect=[OSError("retry-1"), OSError("retry-2"), FakeResponse()])

    def session_get_with_internal_adapter_attempts(*_args, **_kwargs):
        for _ in range(3):
            try:
                return adapter_send()
            except OSError:
                continue
        raise AssertionError("mock adapter did not return a response")

    with mock.patch.object(awardradar, "SERPAPI_TOKEN", "test-key"), mock.patch.object(
        awardradar.HTTP, "get", side_effect=session_get_with_internal_adapter_attempts
    ):
        with awardradar._serpapi_feature_context("cheap"):
            awardradar.serpapi_search(
                "FRA", "JFK", dt.date(2031, 2, 2), None, "Economy", "EUR"
            )

    assert adapter_send.call_count == 3
    assert len(_event_messages(caplog)) == 1
