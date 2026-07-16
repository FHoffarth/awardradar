import datetime as dt

import pytest

import app
from conftest import (
    LIVE_PROVIDER_OPT_IN,
    LIVE_SERPAPI_FORBIDDEN_MESSAGE,
    LiveSerpApiAccessForbidden,
    _block_live_serpapi,
)


class FakeResponse:
    status_code = 200
    text = ""

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def _initial_search():
    return app.serpapi_search(
        "FRA", "SEA", dt.date(2030, 2, 17), None, "Economy", "EUR"
    )


def test_unmocked_serpapi_access_is_blocked(monkeypatch):
    monkeypatch.setattr(app, "SERPAPI_TOKEN", "real-token-could-be-present")
    app._SERP_CACHE.clear()

    with pytest.raises(LiveSerpApiAccessForbidden, match=LIVE_SERPAPI_FORBIDDEN_MESSAGE):
        _initial_search()


def test_unmocked_continuation_access_is_blocked(monkeypatch):
    monkeypatch.setattr(app, "SERPAPI_TOKEN", "real-token-could-be-present")

    with pytest.raises(LiveSerpApiAccessForbidden, match=LIVE_SERPAPI_FORBIDDEN_MESSAGE):
        app.serpapi_continuation_search(
            "FRA",
            "SEA",
            dt.date(2030, 2, 17),
            dt.date(2030, 2, 24),
            "Economy",
            "EUR",
            "departure-token",
        )


def test_mocked_provider_call_still_works(monkeypatch):
    payload = {"best_flights": [], "other_flights": []}
    calls = []

    def mocked_get(url, **kwargs):
        calls.append((url, kwargs))
        return FakeResponse(payload)

    monkeypatch.setattr(app, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(app.HTTP, "get", mocked_get)
    app._SERP_CACHE.clear()

    assert _initial_search() == payload
    assert len(calls) == 1


def test_manual_live_provider_tests_require_explicit_opt_in(monkeypatch):
    delegated = []
    guarded = _block_live_serpapi(
        lambda url, **kwargs: delegated.append((url, kwargs)) or "mocked-response"
    )

    monkeypatch.delenv(LIVE_PROVIDER_OPT_IN, raising=False)
    with pytest.raises(LiveSerpApiAccessForbidden, match=LIVE_SERPAPI_FORBIDDEN_MESSAGE):
        guarded(app.SERPAPI_BASE, timeout=1)
    assert delegated == []

    monkeypatch.setenv(LIVE_PROVIDER_OPT_IN, "1")
    assert guarded(app.SERPAPI_BASE, timeout=1) == "mocked-response"
    assert len(delegated) == 1


def test_non_serpapi_runtime_request_behavior_is_unchanged(monkeypatch):
    monkeypatch.delenv(LIVE_PROVIDER_OPT_IN, raising=False)
    guarded = _block_live_serpapi(
        lambda url, **kwargs: {"url": url, "timeout": kwargs["timeout"]}
    )

    assert guarded("https://example.com/provider", timeout=7) == {
        "url": "https://example.com/provider",
        "timeout": 7,
    }
