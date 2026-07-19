import datetime as dt

import pytest
import requests

import app as awardradar


class FakeResponse:
    def __init__(self, status=200, payload=None, text=""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"status_code": 402, "payload": {"error": "Your account has run out of searches."}}, "quota_exhausted"),
        ({"status_code": 429, "payload": {"error": "Too many requests"}}, "rate_limited"),
        ({"status_code": 503}, "provider_5xx"),
        ({"exc": requests.Timeout()}, "provider_timeout"),
    ],
)
def test_serpapi_failure_classifier(kwargs, expected):
    assert awardradar.classify_serpapi_failure(**kwargs) == expected


def test_serpapi_search_classifies_malformed_success(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar.HTTP, "get", lambda *a, **k: FakeResponse(payload=ValueError("bad json")))
    awardradar._SERP_CACHE.clear()

    with pytest.raises(awardradar.SerpApiError) as caught:
        awardradar.serpapi_search("FRA", "JFK", dt.date(2030, 1, 1), None, "Economy", "EUR")

    assert caught.value.reason == "parser_error"


def test_cheap_quota_is_http_200_degraded_and_not_retried(monkeypatch):
    monkeypatch.setattr(awardradar, "PRICE_SOURCE", "serpapi")
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    calls = 0

    def quota_task(_args):
        nonlocal calls
        calls += 1
        raise awardradar.QuotaError()

    monkeypatch.setattr(awardradar, "serpapi_task", quota_task)
    response = awardradar.app.test_client().post("/api/cheap", json={
        "origin": "FRA", "dest": "JFK", "date": "2030-01-01",
        "oneWay": True, "currency": "eur", "cabins": ["Economy"], "flexDays": 0,
    })

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["offers"] == []
    assert body["cash_provenance"] == {
        "status": "unavailable", "provider": "serpapi", "observed_at": None,
        "cache_age_seconds": None, "fallback_reason": "quota_exhausted",
    }
    assert calls == 1
    assert "run out" not in response.get_data(as_text=True).lower()


def test_cheap_normal_success_contract_is_unchanged(monkeypatch):
    monkeypatch.setattr(awardradar, "PRICE_SOURCE", "serpapi")
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar, "serpapi_task", lambda args: ("FRA", "JFK", [], None))
    response = awardradar.app.test_client().post("/api/cheap", json={
        "origin": "FRA", "dest": "JFK", "date": "2030-01-01",
        "oneWay": True, "currency": "eur", "cabins": ["Economy"], "flexDays": 0,
    })

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["offers"] == []
    assert "cash_provenance" not in body


def test_awards_survives_quota_without_changing_backend_signal(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    calls = 0

    def quota_cash(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise awardradar.QuotaError()

    monkeypatch.setattr(awardradar, "fetch_cash_details", quota_cash)
    response = awardradar.app.test_client().post("/api/awards", json={
        "origin": "FRA", "dest": "JFK", "date": "2030-01-01",
        "oneWay": True, "cabin": "Economy",
    })

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True and body["results"]
    result = body["results"][0]
    assert result["cash_eur"] is None
    assert result["cash_provenance"]["fallback_reason"] == "quota_exhausted"
    assert result["decision"]["signal"] == "insufficient_data"
    assert calls == 1
    assert "run out" not in response.get_data(as_text=True).lower()
