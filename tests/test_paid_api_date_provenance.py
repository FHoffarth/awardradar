from unittest.mock import Mock

import pytest

import app as awardradar


VALID_ONE_WAY = {
    "origin": "FRA",
    "dest": "JFK",
    "date": "2026-10-20",
    "oneWay": True,
}

PROVIDER_BOUNDARIES = (
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
)


@pytest.fixture
def isolated_paid_providers(monkeypatch):
    monkeypatch.setattr(awardradar, "SERPAPI_TOKEN", "test-token")
    monkeypatch.setattr(awardradar, "PRICE_SOURCE", "serpapi")
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "estimated")
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "")
    monkeypatch.setattr(awardradar, "CONTINUATION_INLINE", False)
    monkeypatch.setattr(awardradar, "MAX_CONTINUATIONS_PER_SEARCH", 1)

    boundaries = {}
    for name in PROVIDER_BOUNDARIES:
        boundary = Mock(side_effect=AssertionError(f"unexpected provider boundary: {name}"))
        monkeypatch.setattr(awardradar, name, boundary)
        boundaries[name] = boundary

    http_get = Mock(side_effect=AssertionError("unexpected shared HTTP provider boundary"))
    plain_get = Mock(side_effect=AssertionError("unexpected continuation HTTP boundary"))
    monkeypatch.setattr(awardradar.HTTP, "get", http_get)
    monkeypatch.setattr(awardradar.requests, "get", plain_get)
    boundaries["HTTP.get"] = http_get
    boundaries["requests.get"] = plain_get

    return awardradar.app.test_client(), boundaries


def assert_error(response, status, code, message):
    assert response.status_code == status
    assert response.get_json() == {
        "ok": False,
        "error": code,
        "message": message,
        "retryable": False,
    }


def assert_no_provider_calls(boundaries):
    for name, boundary in boundaries.items():
        assert boundary.call_count == 0, f"{name} was called"


@pytest.mark.parametrize(
    "value",
    ["not-a-date", "2026-02-30", "2026/10/20", "20261020", "2026-10-20T00:00:00", 20261020],
)
def test_cheap_rejects_invalid_departure_dates_before_provider_access(
    isolated_paid_providers, value
):
    client, boundaries = isolated_paid_providers
    response = client.post("/api/cheap", json={**VALID_ONE_WAY, "date": value})

    assert_error(
        response,
        400,
        "invalid_date",
        "Enter a valid departure date in YYYY-MM-DD format.",
    )
    assert_no_provider_calls(boundaries)


def test_cheap_rejects_missing_departure_date_before_provider_access(isolated_paid_providers):
    client, boundaries = isolated_paid_providers
    payload = {key: value for key, value in VALID_ONE_WAY.items() if key != "date"}

    response = client.post("/api/cheap", json=payload)

    assert_error(response, 400, "invalid_request", "Departure date is required.")
    assert_no_provider_calls(boundaries)


def test_cheap_rejects_missing_round_trip_return_date_before_provider_access(
    isolated_paid_providers,
):
    client, boundaries = isolated_paid_providers

    response = client.post("/api/cheap", json={**VALID_ONE_WAY, "oneWay": False})

    assert_error(response, 400, "invalid_request", "Return date is required.")
    assert_no_provider_calls(boundaries)


@pytest.mark.parametrize("return_date", ["bad", "2026-02-30", "2026/10/28"])
def test_cheap_rejects_invalid_return_date_before_provider_access(
    isolated_paid_providers, return_date
):
    client, boundaries = isolated_paid_providers
    response = client.post(
        "/api/cheap",
        json={**VALID_ONE_WAY, "oneWay": False, "returnDate": return_date},
    )

    assert_error(
        response,
        400,
        "invalid_date",
        "Enter a valid return date in YYYY-MM-DD format.",
    )
    assert_no_provider_calls(boundaries)


def test_round_trip_rejects_return_before_departure_before_provider_access(
    isolated_paid_providers,
):
    client, boundaries = isolated_paid_providers
    response = client.post(
        "/api/cheap",
        json={**VALID_ONE_WAY, "oneWay": False, "returnDate": "2026-10-19"},
    )

    assert_error(
        response,
        400,
        "invalid_date",
        "Return date must be on or after departure date.",
    )
    assert_no_provider_calls(boundaries)


def test_skiplag_rejects_malformed_departure_before_provider_access(isolated_paid_providers):
    client, boundaries = isolated_paid_providers
    response = client.post("/api/skiplag", json={**VALID_ONE_WAY, "date": "bad"})

    assert_error(
        response,
        400,
        "invalid_date",
        "Enter a valid departure date in YYYY-MM-DD format.",
    )
    assert_no_provider_calls(boundaries)


def test_skiplag_rejects_missing_departure_before_provider_access(isolated_paid_providers):
    client, boundaries = isolated_paid_providers
    payload = {key: value for key, value in VALID_ONE_WAY.items() if key != "date"}

    response = client.post("/api/skiplag", json=payload)

    assert_error(response, 400, "invalid_request", "Departure date is required.")
    assert_no_provider_calls(boundaries)


def test_skiplag_rejects_malformed_json_as_400(isolated_paid_providers):
    client, boundaries = isolated_paid_providers
    response = client.post("/api/skiplag", data="{bad", content_type="application/json")

    assert_error(response, 400, "invalid_json", "Request body must be valid JSON.")
    assert_no_provider_calls(boundaries)


def test_return_leg_rejects_malformed_json_before_provider_access(isolated_paid_providers):
    client, boundaries = isolated_paid_providers
    response = client.post("/api/return-leg", data="{bad", content_type="application/json")

    assert_error(response, 400, "invalid_json", "Request body must be valid JSON.")
    assert_no_provider_calls(boundaries)


@pytest.mark.parametrize(
    ("payload_update", "code", "message"),
    [
        ({"date": ""}, "invalid_request", "Departure date is required."),
        ({"date": "bad"}, "invalid_date", "Enter a valid departure date in YYYY-MM-DD format."),
        ({"returnDate": ""}, "invalid_request", "Return date is required."),
        ({"returnDate": "bad"}, "invalid_date", "Enter a valid return date in YYYY-MM-DD format."),
        ({"returnDate": "2026-10-19"}, "invalid_date", "Return date must be on or after departure date."),
        ({"offer_id": ""}, "invalid_request", "Offer ID is required."),
        ({"origin": ""}, "invalid_request", "Origin and destination are required."),
    ],
)
def test_return_leg_rejects_invalid_required_context_before_continuation(
    isolated_paid_providers, payload_update, code, message
):
    client, boundaries = isolated_paid_providers
    payload = {
        "origin": "FRA",
        "dest": "JFK",
        "date": "2026-10-20",
        "returnDate": "2026-10-28",
        "offer_id": "offer_test",
    }
    payload.update(payload_update)

    response = client.post("/api/return-leg", json=payload)

    assert_error(response, 400, code, message)
    assert_no_provider_calls(boundaries)


def test_valid_one_way_cheap_request_does_not_require_return_date(isolated_paid_providers):
    client, boundaries = isolated_paid_providers
    boundaries["serpapi_task"].side_effect = lambda args: (args[0], args[1], [], None)

    response = client.post("/api/cheap", json=VALID_ONE_WAY)

    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert boundaries["serpapi_task"].call_count == 1
    for name, boundary in boundaries.items():
        if name != "serpapi_task":
            assert boundary.call_count == 0, f"{name} was called"


def test_valid_awards_behavior_remains_unchanged(isolated_paid_providers, monkeypatch):
    client, boundaries = isolated_paid_providers
    boundaries["fetch_cash_details"].side_effect = None
    boundaries["fetch_cash_details"].return_value = {}
    static_search = Mock(return_value=[])
    monkeypatch.setattr(awardradar.STATIC_AWARD_SOURCE, "search", static_search)

    response = client.post("/api/awards", json=VALID_ONE_WAY)

    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert boundaries["fetch_cash_details"].call_count == 1
    assert static_search.call_count == 1
