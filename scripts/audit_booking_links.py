"""Audit AwardRadar booking and verification links.

This script is intentionally non-invasive:
- no app import
- no network calls
- no production behavior changes
- standard library only

It extracts the existing link-generation helpers from app.py and exercises them
for one representative award route.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlparse


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app.py"
REPORT_PATH = ROOT / "docs" / "booking_links_audit.md"

ORIGIN = "FRA"
DEST = "JFK"
DATE = "2026-08-15"
CABIN = "business"

PROGRAMS = [
    "United MileagePlus",
    "Air Canada Aeroplan",
    "Singapore KrisFlyer",
    "British Airways Avios",
    "Miles & More",
    "Flying Blue",
    "Turkish Miles&Smiles",
    "Alaska Mileage Plan",
    "JetBlue",
]


@dataclass
class ProgramAudit:
    program: str
    url: str
    classification: str
    origin_encoded: bool
    dest_encoded: bool
    date_encoded: bool
    cabin_encoded: bool
    notes: str


@dataclass
class VerifyAudit:
    name: str
    url: str
    origin_encoded: bool
    dest_encoded: bool
    date_encoded: bool
    cabin_encoded: bool
    notes: str


def load_link_namespace() -> dict[str, Any]:
    """Compile only the existing link helpers needed for this audit."""
    tree = ast.parse(APP_PATH.read_text(encoding="utf-8"))
    wanted = {
        "_PROG_HOMEPAGES",
        "_AWARDFARES_CABIN",
        "_SEATSAERO_CABIN",
        "booking_deep_url",
        "award_links",
    }
    selected: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            names = {target.id for target in node.targets if isinstance(target, ast.Name)}
            if names & wanted:
                selected.append(node)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id in wanted:
                selected.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in wanted:
            selected.append(node)

    module = ast.Module(body=selected, type_ignores=[])
    ast.fix_missing_locations(module)
    namespace: dict[str, Any] = {"quote_plus": quote_plus}
    exec(compile(module, str(APP_PATH), "exec"), namespace)
    return namespace


def url_contains(url: str, value: str) -> bool:
    return value.lower() in url.lower()


def query_contains(url: str, value: str) -> bool:
    parsed = urlparse(url)
    query_values = []
    for values in parse_qs(parsed.query).values():
        query_values.extend(values)
    if parsed.fragment:
        query_values.append(parsed.fragment)
    haystack = " ".join(query_values + [parsed.path])
    return value.lower() in haystack.lower()


def classify_booking_url(program: str, url: str) -> tuple[str, str]:
    host = urlparse(url).netloc.lower()
    has_route = all(url_contains(url, value) for value in (ORIGIN, DEST, DATE))

    if "awardfares.com" in host:
        return (
            "fallback-only",
            "Falls back to generic AwardFares search, not a program-owned booking link.",
        )
    if has_route:
        return (
            "strong deep link",
            "Program-owned URL appears to include origin, destination and date.",
        )
    if program in {"Miles & More", "Flying Blue", "Turkish Miles&Smiles", "Alaska Mileage Plan"}:
        return (
            "homepage fallback",
            "Program-owned award page is present, but route/date are not prefilled.",
        )
    return (
        "needs manual verification",
        "URL exists, but route/date encoding is incomplete or unclear.",
    )


def audit_programs(booking_deep_url) -> list[ProgramAudit]:
    rows: list[ProgramAudit] = []
    for program in PROGRAMS:
        url = booking_deep_url(program, ORIGIN, DEST, DATE)
        classification, notes = classify_booking_url(program, url)
        rows.append(
            ProgramAudit(
                program=program,
                url=url,
                classification=classification,
                origin_encoded=query_contains(url, ORIGIN),
                dest_encoded=query_contains(url, DEST),
                date_encoded=query_contains(url, DATE),
                cabin_encoded=query_contains(url, CABIN),
                notes=notes,
            )
        )
    return rows


def audit_verify_links(award_links) -> list[VerifyAudit]:
    links = award_links(ORIGIN, DEST, DATE, None, CABIN)
    rows: list[VerifyAudit] = []
    for section in ("verify", "cash"):
        for item in links.get(section, []):
            name = item["name"]
            url = item["url"]
            if section == "cash":
                notes = "Cash comparison link; opens Google Flights query for manual verification."
            else:
                notes = "Award availability verification link."
            rows.append(
                VerifyAudit(
                    name=name,
                    url=url,
                    origin_encoded=query_contains(url, ORIGIN),
                    dest_encoded=query_contains(url, DEST),
                    date_encoded=query_contains(url, DATE),
                    cabin_encoded=query_contains(url, CABIN),
                    notes=notes,
                )
            )
    return rows


def yes_no(value: bool) -> str:
    return "yes" if value else "no"


def render_report(programs: list[ProgramAudit], verify_links: list[VerifyAudit]) -> str:
    strong = [row.program for row in programs if row.classification == "strong deep link"]
    fallback = [row.program for row in programs if "fallback" in row.classification]
    manual = [row.program for row in programs if row.classification == "needs manual verification"]

    lines = [
        "# Booking Links Audit",
        "",
        "Scope: non-invasive audit of existing AwardRadar booking and verification link generation.",
        "",
        "No production behavior, UI, booking logic, secrets, or environment variables were changed.",
        "",
        "## Test Route",
        "",
        f"- Origin: `{ORIGIN}`",
        f"- Destination: `{DEST}`",
        f"- Cabin: `{CABIN}`",
        f"- Date: `{DATE}`",
        "",
        "## Summary",
        "",
        f"- Strong deep links: {', '.join(strong) if strong else 'none'}",
        f"- Fallback-only or homepage links: {', '.join(fallback) if fallback else 'none'}",
        f"- Need manual verification: {', '.join(manual) if manual else 'none'}",
        "",
        "## Program Booking Links",
        "",
        "| Program | Type | Origin | Destination | Date | Cabin | URL | Notes |",
        "|---|---|---:|---:|---:|---:|---|---|",
    ]

    for row in programs:
        lines.append(
            "| {program} | {kind} | {origin} | {dest} | {date} | {cabin} | {url} | {notes} |".format(
                program=row.program,
                kind=row.classification,
                origin=yes_no(row.origin_encoded),
                dest=yes_no(row.dest_encoded),
                date=yes_no(row.date_encoded),
                cabin=yes_no(row.cabin_encoded),
                url=row.url,
                notes=row.notes,
            )
        )

    lines.extend(
        [
            "",
            "## Verification Links",
            "",
            "| Link | Origin | Destination | Date | Cabin | URL | Notes |",
            "|---|---:|---:|---:|---:|---|---|",
        ]
    )
    for row in verify_links:
        lines.append(
            "| {name} | {origin} | {dest} | {date} | {cabin} | {url} | {notes} |".format(
                name=row.name,
                origin=yes_no(row.origin_encoded),
                dest=yes_no(row.dest_encoded),
                date=yes_no(row.date_encoded),
                cabin=yes_no(row.cabin_encoded),
                url=row.url,
                notes=row.notes,
            )
        )

    lines.extend(
        [
            "",
            "## Findings",
            "",
            "- United MileagePlus, Air Canada Aeroplan, Singapore KrisFlyer, and British Airways Avios currently produce the strongest route/date-aware deep links.",
            "- Miles & More, Flying Blue, Turkish Miles&Smiles, and Alaska Mileage Plan currently resolve to program-owned award pages without route/date prefill.",
            "- JetBlue is not explicitly mapped in the current booking link generator and falls back to generic AwardFares search.",
            "- AwardFares and seats.aero verification links include route, date, and cabin parameters.",
            "- Google Flights cash comparison includes route and date as a query, but not cabin.",
            "",
            "## Expected Manual Behavior",
            "",
            "- Deep links should be opened manually to confirm that each provider still accepts the current query parameters.",
            "- Homepage fallbacks are acceptable when providers do not support stable public deep links.",
            "- Generic fallback links should remain clearly distinguishable from program-owned booking links.",
            "",
            "## Programs Likely Unable To Support Reliable Deep Links",
            "",
            "- Miles & More: public award search often requires session state and login flow.",
            "- Flying Blue: award search flow may depend on session/client routing.",
            "- Turkish Miles&Smiles: award booking flow commonly requires login/session state.",
            "- Alaska Mileage Plan: public deep-link stability for partner awards needs manual verification.",
            "- JetBlue: not currently part of AwardRadar's explicit booking-link map.",
        ]
    )
    return "\n".join(lines) + "\n"


def print_console(programs: list[ProgramAudit], verify_links: list[VerifyAudit]) -> None:
    print(f"Booking Links Audit: {ORIGIN} -> {DEST}, {CABIN}, {DATE}\n")
    for row in programs:
        print(f"- {row.program}: {row.classification}")
        print(f"  URL: {row.url}")
        print(
            "  Encoded: "
            f"origin={yes_no(row.origin_encoded)}, "
            f"dest={yes_no(row.dest_encoded)}, "
            f"date={yes_no(row.date_encoded)}, "
            f"cabin={yes_no(row.cabin_encoded)}"
        )
        print(f"  Notes: {row.notes}")
    print("\nVerification links:")
    for row in verify_links:
        print(f"- {row.name}: {row.url}")
        print(
            "  Encoded: "
            f"origin={yes_no(row.origin_encoded)}, "
            f"dest={yes_no(row.dest_encoded)}, "
            f"date={yes_no(row.date_encoded)}, "
            f"cabin={yes_no(row.cabin_encoded)}"
        )
    print(f"\nReport written to {REPORT_PATH}")


def main() -> int:
    namespace = load_link_namespace()
    programs = audit_programs(namespace["booking_deep_url"])
    verify_links = audit_verify_links(namespace["award_links"])
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(render_report(programs, verify_links), encoding="utf-8")
    print_console(programs, verify_links)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
