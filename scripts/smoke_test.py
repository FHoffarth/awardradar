"""Production smoke test for AwardRadar.

The script only performs HTTP checks against the deployed app. It does not
import application code, modify state, or require third-party dependencies.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib import error, request


BASE_URL = os.environ.get("BASE_URL", "https://awardradar.app").rstrip("/")
# /api/awards can take ~45-60s when external cash/award providers are slow.
TIMEOUT_SECONDS = 75


@dataclass
class Response:
    status: int
    data: dict[str, Any] | None
    raw: str
    transport_error: str | None = None


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    critical: bool = True


def fetch_json(path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Response:
    headers = {"Accept": "application/json", "User-Agent": "AwardRadar smoke_test.py"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
            raw = res.read().decode("utf-8", errors="replace")
            status = res.status
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        status = exc.code
    except error.URLError as exc:
        return Response(0, None, "", str(exc))

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = None
    return Response(status, data, raw)


def bool_label(value: Any) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    if value is None:
        return "unknown"
    return str(value)


def check_health() -> Check:
    res = fetch_json("/health")
    if res.transport_error:
        return Check("/health", False, f"endpoint unavailable: {res.transport_error}")
    if not isinstance(res.data, dict):
        return Check("/health", False, f"invalid JSON, status={res.status}")

    details = (
        f"status={res.status}, ok={res.data.get('ok')}, "
        f"version={res.data.get('version', 'unknown')}, "
        f"seatsaero_remaining={res.data.get('seatsaero_remaining', 'unknown')}, "
        f"serpapi_token={bool_label(res.data.get('serpapi_token'))}, "
        f"seatsaero_key={bool_label(res.data.get('seatsaero_key'))}"
    )
    return Check("/health", res.status == 200 and res.data.get("ok") is True, details)


def check_top_opportunities() -> tuple[Check, dict[str, Any] | None]:
    res = fetch_json("/api/top-opportunities")
    if res.transport_error:
        return Check("/api/top-opportunities", False, f"endpoint unavailable: {res.transport_error}"), None
    if not isinstance(res.data, dict):
        return Check("/api/top-opportunities", False, f"invalid JSON, status={res.status}"), None

    opportunities = res.data.get("opportunities")
    count = len(opportunities) if isinstance(opportunities, list) else 0
    metadata = []
    for key in ("source", "cache", "cached", "cache_age", "generated_at", "error"):
        if key in res.data:
            metadata.append(f"{key}={res.data.get(key)}")
    detail = f"status={res.status}, opportunities={count}"
    if metadata:
        detail += ", " + ", ".join(metadata)

    hard_failure = res.status >= 500 and not res.data.get("error")
    return Check("/api/top-opportunities", not hard_failure, detail), res.data


def awards_payload() -> dict[str, Any]:
    return {
        "origin": "FRA",
        "dest": "JFK",
        "cabin": "business",
        "date": "2026-08-15",
    }


def is_graceful_error(res: Response) -> bool:
    return isinstance(res.data, dict) and res.data.get("ok") is False and bool(res.data.get("error"))


def check_awards() -> tuple[Check, dict[str, Any] | None]:
    res = fetch_json("/api/awards", method="POST", payload=awards_payload())
    if res.transport_error:
        return Check("/api/awards", False, f"endpoint unavailable: {res.transport_error}"), None
    if not isinstance(res.data, dict):
        return Check("/api/awards", False, f"invalid JSON, status={res.status}"), None

    results = res.data.get("results")
    result_count = len(results) if isinstance(results, list) else 0
    program_count = 0
    live_data = False
    if isinstance(results, list):
        for result in results:
            if not isinstance(result, dict):
                continue
            live_data = live_data or bool(result.get("has_live_data"))
            programs = result.get("programs")
            if isinstance(programs, list):
                program_count += len(programs)
                live_data = live_data or any(
                    isinstance(program, dict) and program.get("data_source") == "live"
                    for program in programs
                )

    graceful = res.status == 200 or is_graceful_error(res)
    detail = (
        f"status={res.status}, ok={res.data.get('ok')}, "
        f"results={result_count}, programs={program_count}, "
        f"live_seatsaero_data={bool_label(live_data)}, "
        f"timeout={TIMEOUT_SECONDS}s"
    )
    if res.data.get("error"):
        detail += f", error={res.data.get('error')}"
    return Check("/api/awards", graceful, detail), res.data


def value_present(item: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return any(item.get(key) is not None for key in keys)


def check_decision_card_readiness(awards_data: dict[str, Any] | None) -> Check:
    results = awards_data.get("results") if isinstance(awards_data, dict) else None
    if not isinstance(results, list) or not results:
        return Check(
            "Booking Decision Card readiness",
            True,
            "no award results returned",
            critical=False,
        )

    missing: list[str] = []
    checked_programs = 0
    for result_index, result in enumerate(results):
        if not isinstance(result, dict):
            missing.append(f"result#{result_index}: not an object")
            continue
        programs = result.get("programs")
        if not isinstance(programs, list) or not programs:
            continue
        for program_index, program in enumerate(programs):
            if not isinstance(program, dict):
                missing.append(f"result#{result_index}/program#{program_index}: not an object")
                continue
            checked_programs += 1
            program_missing = []
            if not value_present(program, ("miles", "mileage")):
                program_missing.append("miles")
            if not value_present(program, ("program", "program_name", "name")):
                program_missing.append("program")
            if "surcharge" not in program and "taxes" not in program:
                program_missing.append("surcharge/taxes")
            grade = program.get("grade")
            if grade is not None and isinstance(grade, dict):
                if "tier" not in grade:
                    program_missing.append("grade.tier")
                if "recommendation" not in grade:
                    program_missing.append("grade.recommendation")
            if "data_source" not in program and "has_live_data" not in result:
                program_missing.append("data_source/live signal")
            if program_missing:
                missing.append(
                    f"result#{result_index}/program#{program_index}: {', '.join(program_missing)}"
                )

    if missing:
        return Check(
            "Booking Decision Card readiness",
            False,
            "; ".join(missing[:3]),
        )
    return Check(
        "Booking Decision Card readiness",
        True,
        f"checked_programs={checked_programs}",
    )


def print_summary(checks: list[Check]) -> int:
    print(f"AwardRadar smoke test: {BASE_URL}\n")
    for check in checks:
        status = "PASS" if check.passed else "FAIL"
        print(f"[{status}] {check.name} - {check.detail}")

    failures = [check for check in checks if not check.passed]
    critical_failures = [check for check in failures if check.critical]
    print(
        f"\nSummary: {len(checks) - len(failures)}/{len(checks)} passed; "
        f"critical failures: {len(critical_failures)}"
    )
    return 1 if critical_failures else 0


def main() -> int:
    checks: list[Check] = []

    checks.append(check_health())
    top_check, _top_data = check_top_opportunities()
    checks.append(top_check)
    awards_check, awards_data = check_awards()
    checks.append(awards_check)
    checks.append(check_decision_card_readiness(awards_data))

    return print_summary(checks)


if __name__ == "__main__":
    raise SystemExit(main())
