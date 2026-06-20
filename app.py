#!/usr/bin/env python3
"""AwardRadar v6.0 – Find miles. Fly better.

Produktionsnäherer Flask-Build:
- Gunicorn-ready
- optionaler APP_TOKEN schützt API-Endpunkte, Landingpage bleibt sichtbar
- dynamische Airport-Suche über Travelpayouts/Aviasales Autocomplete + lokaler Fallback
- Cheap Flights / Skiplag Finder / Awards klar getrennt
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import os
import re
import time
from functools import lru_cache
from urllib.parse import quote_plus

import requests
from flask import Flask, jsonify, make_response, render_template, request
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

APP_NAME = "AwardRadar"
TAGLINE = "Find miles. Fly better."
TP_TOKEN = os.environ.get("TRAVELPAYOUTS_TOKEN", "")
APP_TOKEN = os.environ.get("APP_TOKEN", "")
TP_BASE = "https://api.travelpayouts.com"
AUTOCOMPLETE_BASE = "https://autocomplete.travelpayouts.com/places2"
PORT = int(os.environ.get("PORT", "5000"))
SKIPLAG_MAX_WORKERS = int(os.environ.get("SKIPLAG_MAX_WORKERS", "8"))
SKIPLAG_MAX_CANDIDATES = int(os.environ.get("SKIPLAG_MAX_CANDIDATES", "16"))

app = Flask(__name__)


def make_session() -> requests.Session:
    retry = Retry(
        total=2,
        connect=2,
        read=2,
        backoff_factor=0.35,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
    )
    session = requests.Session()
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({"User-Agent": "AwardRadar/6.0"})
    return session


HTTP = make_session()


def lang_from_payload(data: dict | None = None) -> str:
    if isinstance(data, dict):
        lang = (data.get("lang") or "").lower()
    else:
        lang = (request.args.get("lang") or request.headers.get("X-Lang") or "").lower()
    return "en" if lang.startswith("en") else "de"


TEXT = {
    "missing_origin_dest": {"de": "Bitte Start und Ziel eingeben, z. B. Frankfurt und Tokio.", "en": "Please enter origin and destination, e.g. Frankfurt and Tokyo."},
    "missing_hidden": {"de": "Bitte Start und eigentliches Ziel eingeben.", "en": "Please enter origin and intended destination."},
    "api_guard": {"de": "API geschützt. Öffne die App einmal mit ?key=DEIN_APP_TOKEN.", "en": "API protected. Open the app once with ?key=YOUR_APP_TOKEN."},
    "cheap_note": {"de": "Travelpayouts ist cache-basiert. Wenn keine Preise kommen, nutze die Live-Links; v6 zeigt echte Cachepreise, wenn verfügbar, und kennzeichnet Hidden-City nur als prüfpflichtige Kandidaten.", "en": "Travelpayouts is cache-based. If no prices appear, use the live links; v6 displays cached fares when available and labels hidden-city results as candidates that must be verified."},
    "skiplag_note": {"de": "Hidden-City bleibt Kandidatenlogik: Travelpayouts bestätigt keine tatsächliche Umstiegsroute über dein Ziel. Routing vor Buchung prüfen; nur One-way und ohne Aufgabegepäck.", "en": "Hidden-city remains candidate logic: Travelpayouts does not confirm that the itinerary actually connects via your intended destination. Verify routing before booking; one-way only and no checked baggage."},
    "awards_note": {"de": "Live-Award-Verfügbarkeiten brauchen später eine echte Award-Datenquelle; MileHunter erzeugt Suchstarts für Eco bis First.", "en": "Live award availability will require a real award data source later; MileHunter creates search starts from Economy to First."},
    "normal_price": {"de": "Normalpreis", "en": "Normal fare"},
    "candidate_label": {"de": "Hidden-City-Kandidat", "en": "Hidden-city candidate"},
    "verify_routing": {"de": "Routing vor Buchung prüfen", "en": "Verify routing before booking"},
    "unverified": {"de": "nicht segmentbestätigt", "en": "not segment-verified"},
    "high": {"de": "prüfenswert", "en": "worth checking"},
    "check": {"de": "prüfen", "en": "check"},
    "link_check": {"de": "Link-Check", "en": "link check"},
    "google_search": {"de": "Google Suche", "en": "Google Search"},
    "google_via": {"de": "Google: via prüfen", "en": "Google: check via"},
    "ticket_check": {"de": "Ticketziel prüfen", "en": "Check ticket destination"},
}


def tx(key: str, lang: str = "de") -> str:
    return TEXT.get(key, {}).get(lang, TEXT.get(key, {}).get("de", key))

AIRPORTS = {
    "FRA": {"name": "Frankfurt am Main", "city": "Frankfurt", "country": "DE"},
    "MUC": {"name": "München", "city": "München", "country": "DE"},
    "DUS": {"name": "Düsseldorf", "city": "Düsseldorf", "country": "DE"},
    "BER": {"name": "Berlin Brandenburg", "city": "Berlin", "country": "DE"},
    "HAM": {"name": "Hamburg", "city": "Hamburg", "country": "DE"},
    "CGN": {"name": "Köln/Bonn", "city": "Köln", "country": "DE"},
    "STR": {"name": "Stuttgart", "city": "Stuttgart", "country": "DE"},
    "ZRH": {"name": "Zürich", "city": "Zürich", "country": "CH"},
    "VIE": {"name": "Wien", "city": "Wien", "country": "AT"},
    "LHR": {"name": "London Heathrow", "city": "London", "country": "GB"},
    "LGW": {"name": "London Gatwick", "city": "London", "country": "GB"},
    "LCY": {"name": "London City", "city": "London", "country": "GB"},
    "STN": {"name": "London Stansted", "city": "London", "country": "GB"},
    "CDG": {"name": "Paris Charles de Gaulle", "city": "Paris", "country": "FR"},
    "ORY": {"name": "Paris Orly", "city": "Paris", "country": "FR"},
    "AMS": {"name": "Amsterdam Schiphol", "city": "Amsterdam", "country": "NL"},
    "MAD": {"name": "Madrid Barajas", "city": "Madrid", "country": "ES"},
    "BCN": {"name": "Barcelona", "city": "Barcelona", "country": "ES"},
    "FCO": {"name": "Rom Fiumicino", "city": "Rom", "country": "IT"},
    "MXP": {"name": "Mailand Malpensa", "city": "Mailand", "country": "IT"},
    "ATH": {"name": "Athen", "city": "Athen", "country": "GR"},
    "IST": {"name": "Istanbul", "city": "Istanbul", "country": "TR"},
    "JFK": {"name": "New York JFK", "city": "New York", "country": "US"},
    "EWR": {"name": "Newark", "city": "New York", "country": "US"},
    "LGA": {"name": "LaGuardia", "city": "New York", "country": "US"},
    "BOS": {"name": "Boston Logan", "city": "Boston", "country": "US"},
    "IAD": {"name": "Washington Dulles", "city": "Washington", "country": "US"},
    "ORD": {"name": "Chicago O'Hare", "city": "Chicago", "country": "US"},
    "MIA": {"name": "Miami", "city": "Miami", "country": "US"},
    "LAX": {"name": "Los Angeles", "city": "Los Angeles", "country": "US"},
    "SFO": {"name": "San Francisco", "city": "San Francisco", "country": "US"},
    "SEA": {"name": "Seattle", "city": "Seattle", "country": "US"},
    "YYZ": {"name": "Toronto Pearson", "city": "Toronto", "country": "CA"},
    "YUL": {"name": "Montréal", "city": "Montréal", "country": "CA"},
    "SIN": {"name": "Singapore Changi", "city": "Singapur", "country": "SG"},
    "HKG": {"name": "Hongkong", "city": "Hongkong", "country": "HK"},
    "BKK": {"name": "Bangkok Suvarnabhumi", "city": "Bangkok", "country": "TH"},
    "HND": {"name": "Tokio Haneda", "city": "Tokio", "country": "JP"},
    "NRT": {"name": "Tokio Narita", "city": "Tokio", "country": "JP"},
    "ICN": {"name": "Seoul Incheon", "city": "Seoul", "country": "KR"},
    "TPE": {"name": "Taipei", "city": "Taipei", "country": "TW"},
    "SYD": {"name": "Sydney", "city": "Sydney", "country": "AU"},
    "MEL": {"name": "Melbourne", "city": "Melbourne", "country": "AU"},
    "DXB": {"name": "Dubai", "city": "Dubai", "country": "AE"},
    "DOH": {"name": "Doha", "city": "Doha", "country": "QA"},
}

ALIASES = {
    "frankfurt": ["FRA"], "fra": ["FRA"],
    "münchen": ["MUC"], "muenchen": ["MUC"], "munich": ["MUC"], "muc": ["MUC"],
    "berlin": ["BER"], "london": ["LHR", "LGW", "LCY", "STN"],
    "paris": ["CDG", "ORY"], "tokio": ["HND", "NRT"], "tokyo": ["HND", "NRT"], "tyo": ["HND", "NRT"],
    "new york": ["JFK", "EWR", "LGA"], "nyc": ["JFK", "EWR", "LGA"],
    "singapur": ["SIN"], "singapore": ["SIN"], "bangkok": ["BKK"], "hongkong": ["HKG"], "hong kong": ["HKG"],
    "los angeles": ["LAX"], "la": ["LAX"], "chicago": ["ORD"], "miami": ["MIA"],
    "toronto": ["YYZ"], "dubai": ["DXB"], "doha": ["DOH"], "seoul": ["ICN"], "sydney": ["SYD"],
}

MM_AIRLINES = {"LH", "LX", "OS", "SN", "EN", "UA", "AC", "NH", "SQ", "TG", "OZ", "CA", "NZ", "SK", "TK", "TP", "A3", "BR", "ET", "LO"}
SKIPLAG_ENDINGS = ["ATH", "IST", "BCN", "MAD", "FCO", "MXP", "AMS", "CDG", "LHR", "BOS", "MIA", "ORD", "YYZ", "YUL", "LAX", "SFO", "SEA", "DUB", "CPH", "ARN", "OSL", "WAW", "LIS"]


def wants_access() -> bool:
    if not APP_TOKEN:
        return True
    return (
        request.args.get("key") == APP_TOKEN
        or request.headers.get("X-App-Token") == APP_TOKEN
        or request.cookies.get("app_token") == APP_TOKEN
    )


@app.before_request
def api_guard():
    if not APP_TOKEN:
        return None
    # Landingpage, static assets, health and airport suggestions stay reachable.
    public_prefixes = ("/static/",)
    public_paths = {"/", "/health", "/api/airports"}
    if request.path in public_paths or request.path.startswith(public_prefixes):
        return None
    if request.path.startswith("/api/") and not wants_access():
        return jsonify({"ok": False, "error": tx("api_guard", lang_from_payload())}), 401
    return None


@app.after_request
def remember_app_token(response):
    if APP_TOKEN and request.args.get("key") == APP_TOKEN:
        response.set_cookie("app_token", APP_TOKEN, max_age=60 * 60 * 24 * 180, httponly=True, samesite="Lax")
    return response


def unique(seq: list[str]) -> list[str]:
    out = []
    for item in seq:
        item = item.upper().strip()
        if item and item not in out:
            out.append(item)
    return out


def local_codes(value: str) -> list[str]:
    raw = (value or "").strip()
    if not raw:
        return []
    parts = [p.strip() for p in re.split(r"[,;/]+", raw) if p.strip()]
    codes: list[str] = []
    for part in parts:
        upper = part.upper()
        if re.fullmatch(r"[A-Z]{3}", upper):
            codes.append(upper)
            continue
        match = re.search(r"\(([A-Z]{3}(?:\s*\+\s*[A-Z]{3})*)\)", part)
        if match:
            codes.extend([c.strip() for c in match.group(1).split("+")])
            continue
        alias = ALIASES.get(part.lower())
        if alias:
            codes.extend(alias)
    return unique(codes)


@lru_cache(maxsize=512)
def autocomplete_places(term: str, locale: str = "de") -> tuple[dict, ...]:
    term = (term or "").strip()
    if len(term) < 2:
        return tuple()
    params = [("term", term), ("locale", locale), ("types[]", "airport"), ("types[]", "city")]
    try:
        r = HTTP.get(AUTOCOMPLETE_BASE, params=params, timeout=7)
        r.raise_for_status()
        rows = r.json()
    except Exception:
        return tuple()
    out = []
    for row in rows[:12]:
        code = (row.get("code") or "").upper()
        if not re.fullmatch(r"[A-Z]{3}", code):
            continue
        name = row.get("name") or row.get("city_name") or code
        city = row.get("city_name") or name
        country = row.get("country_code") or row.get("country_name") or ""
        typ = row.get("type") or "airport"
        out.append({"code": code, "name": name, "city": city, "country": country, "type": typ})
    return tuple(out)


def resolve_codes(value: str) -> list[str]:
    codes = local_codes(value)
    if codes:
        return codes
    # Last resort: dynamic autocomplete for unknown city/airport names.
    places = autocomplete_places((value or "").strip())
    return unique([p["code"] for p in places])[:4]


def parse_date(value: str, default_days: int = 60) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except Exception:
        return dt.date.today() + dt.timedelta(days=default_days)


def tp_headers():
    if not TP_TOKEN:
        raise RuntimeError("TRAVELPAYOUTS_TOKEN fehlt.")
    return {"X-Access-Token": TP_TOKEN, "Accept": "application/json"}


def tp_prices(origin: str, dest: str, dep: dt.date, ret: dt.date | None, direct: bool, currency="eur", limit=20, timeout=14) -> list[dict]:
    params = {
        "origin": origin,
        "destination": dest,
        "departure_at": dep.isoformat(),
        "sorting": "price",
        "direct": "true" if direct else "false",
        "currency": currency,
        "limit": limit,
        "one_way": "false" if ret else "true",
    }
    if ret:
        params["return_at"] = ret.isoformat()
    response = HTTP.get(f"{TP_BASE}/aviasales/v3/prices_for_dates", params=params, headers=tp_headers(), timeout=timeout)
    response.raise_for_status()
    return (response.json() or {}).get("data") or []


def cheapest_price(rows: list[dict]) -> float:
    return min([float(r.get("price") or 0) for r in rows if r.get("price")] or [0])


def tp_price_task(args: tuple[str, str, dt.date, dt.date | None, bool, str, int]) -> tuple[str, str, list[dict] | None, str | None]:
    origin, dest, dep, ret, direct, currency, limit = args
    try:
        return origin, dest, tp_prices(origin, dest, dep, ret, direct, currency=currency, limit=limit, timeout=12), None
    except Exception as exc:
        return origin, dest, None, str(exc)


def fmt_dateish(value: str) -> str:
    return (value or "")[:10]


def links_for(origin: str, dest: str, dep: str, ret: str | None = None, cabin: str = "economy") -> dict[str, str]:
    q = quote_plus(f"{origin} to {dest} {dep}" + (f" return {ret}" if ret else ""))
    av = f"https://www.aviasales.com/search/{origin}{dep.replace('-', '')}{dest}1"
    return {
        "Google Flights": f"https://www.google.com/travel/flights?q={q}",
        "Skiplagged": f"https://skiplagged.com/flights/{origin}/{dest}/{dep}" + (f"/{ret}" if ret else ""),
        "Aviasales": av,
        "Kayak": f"https://www.kayak.de/flights/{origin}-{dest}/{dep}" + (f"/{ret}" if ret else ""),
        "Momondo": f"https://www.momondo.de/flight-search/{origin}-{dest}/{dep}" + (f"/{ret}" if ret else ""),
    }


def offer_from_tp(row: dict, currency: str) -> dict:
    origin = row.get("origin", "")
    dest = row.get("destination", "")
    airline = row.get("airline", "")
    dep = fmt_dateish(row.get("departure_at", ""))
    ret = fmt_dateish(row.get("return_at", "")) or None
    link = row.get("link")
    return {
        "source": "Travelpayouts",
        "price": float(row.get("price") or 0),
        "currency": currency.upper(),
        "origin": origin,
        "dest": dest,
        "date": dep,
        "returnDate": ret,
        "airline": airline,
        "stops": row.get("transfers", 0),
        "bookUrl": "https://www.aviasales.com" + link if link else links_for(origin, dest, dep, ret).get("Aviasales"),
        "links": links_for(origin, dest, dep, ret),
    }


def award_links(origin: str, dest: str, dep: str, ret: str | None, cabin: str) -> list[dict]:
    q = quote_plus(f"award flight {origin} {dest} {dep} {cabin}")
    return [
        {"name": "Miles & More", "url": "https://www.miles-and-more.com/"},
        {"name": "Lufthansa", "url": f"https://www.lufthansa.com/de/de/fluege/flugsuche?origin={origin}&destination={dest}&departureDate={dep}"},
        {"name": "United Awards", "url": f"https://www.united.com/en/us/fsr/choose-flights?f={origin}&t={dest}&d={dep}&sc=7&tt=1"},
        {"name": "Air Canada Aeroplan", "url": "https://www.aircanada.com/aeroplan/redeem/availability/outbound"},
        {"name": "AwardFares", "url": f"https://awardfares.com/search?origin={origin}&destination={dest}"},
        {"name": "Seats.aero", "url": f"https://seats.aero/search?origin={origin}&destination={dest}"},
        {"name": "Singapore KrisFlyer", "url": "https://www.singaporeair.com/"},
        {"name": "Google Search", "url": f"https://www.google.com/search?q={q}"},
    ]


@app.route("/")
def index():
    return render_template("index.html", app_name=APP_NAME, tagline=TAGLINE, version="v6.0")


@app.route("/api/airports")
def airports():
    q = (request.args.get("q") or "").lower().strip()
    locale = "en" if (request.args.get("lang") or "").lower().startswith("en") else "de"
    results = []
    if q:
        for alias, codes in ALIASES.items():
            if q in alias:
                results.append({"label": f"{alias.title()} ({' + '.join(codes)})", "value": ",".join(codes), "source": "local"})
        for code, meta in AIRPORTS.items():
            hay = f"{code} {meta['name']} {meta['city']} {meta['country']}".lower()
            if q in hay:
                results.append({"label": f"{meta['name']} ({code})", "value": code, "source": "local"})
        for place in autocomplete_places(q, locale=locale):
            label = f"{place['name']} ({place['code']})"
            if place.get("city") and place["city"] not in place["name"]:
                label = f"{place['city']} · {label}"
            results.append({"label": label, "value": place["code"], "source": "dynamic"})
    seen, out = set(), []
    for item in results:
        key = item["value"]
        if key not in seen:
            out.append(item); seen.add(key)
    return jsonify(out[:15])


@app.route("/api/cheap", methods=["POST"])
def cheap():
    data = request.get_json(force=True) or {}
    lang = lang_from_payload(data)
    origins = resolve_codes(data.get("origin", ""))
    dests = resolve_codes(data.get("dest", ""))
    dep = parse_date(data.get("date", ""), 60)
    one_way = bool(data.get("oneWay", True))
    ret = None if one_way else parse_date(data.get("returnDate", ""), 67)
    direct = bool(data.get("direct", False))
    mm_only = bool(data.get("mmOnly", False))
    currency = (data.get("currency") or "eur").lower()
    if not origins or not dests:
        return jsonify({"ok": False, "error": tx("missing_origin_dest", lang)}), 400

    started = time.time()
    offers, warnings = [], []
    tasks = [(origin, dest, dep, ret, direct, currency, 20) for origin in origins[:3] for dest in dests[:4] if origin != dest]
    # Parallelisierung hilft besonders beim Hosting: mehrere Cache-/API-Abfragen blockieren nicht seriell.
    with cf.ThreadPoolExecutor(max_workers=min(8, max(1, len(tasks)))) as pool:
        for origin, dest, rows, err in pool.map(tp_price_task, tasks):
            if err:
                warnings.append(f"{origin}→{dest}: {err}")
                continue
            for row in rows or []:
                airline = row.get("airline", "")
                if mm_only and airline and airline not in MM_AIRLINES:
                    continue
                offers.append(offer_from_tp(row, currency))
    offers.sort(key=lambda x: x.get("price") or 10**9)
    fallback = [{"route": f"{o} → {d}", "links": links_for(o, d, dep.isoformat(), ret.isoformat() if ret else None)} for o in origins[:2] for d in dests[:3] if o != d]
    return jsonify({
        "ok": True,
        "offers": offers[:30],
        "fallback": fallback,
        "warnings": warnings[:8],
        "debug": {"origins": origins, "dests": dests, "seconds": round(time.time() - started, 2)},
        "note": tx("cheap_note", lang),
    })


@app.route("/api/skiplag", methods=["POST"])
def skiplag():
    data = request.get_json(force=True) or {}
    lang = lang_from_payload(data)
    origins = resolve_codes(data.get("origin", ""))
    true_dests = resolve_codes(data.get("dest", ""))
    dep = parse_date(data.get("date", ""), 60)
    currency = (data.get("currency") or "eur").lower()
    if not origins or not true_dests:
        return jsonify({"ok": False, "error": tx("missing_hidden", lang)}), 400
    started = time.time()
    results, warnings = [], []
    candidate_endings = SKIPLAG_ENDINGS[:SKIPLAG_MAX_CANDIDATES]
    for origin in origins[:2]:
        for true_dest in true_dests[:2]:
            normal_rows = []
            try:
                normal_rows = tp_prices(origin, true_dest, dep, None, False, currency=currency, limit=5, timeout=12)
            except Exception as exc:
                warnings.append(f"{tx('normal_price', lang)} {origin}→{true_dest}: {exc}")
            normal_price = cheapest_price(normal_rows)

            tasks = [(origin, final_dest, dep, None, False, currency, 5) for final_dest in candidate_endings if final_dest not in (origin, true_dest)]
            with cf.ThreadPoolExecutor(max_workers=min(SKIPLAG_MAX_WORKERS, max(1, len(tasks)))) as pool:
                for _origin, final_dest, rows, err in pool.map(tp_price_task, tasks):
                    price = 0 if err else cheapest_price(rows or [])
                    savings = (normal_price - price) if normal_price and price else None
                    # Auch ohne Preis bleibt es ein manueller Kandidat; mit Ersparnis wird er priorisiert.
                    if savings is None or savings > 0:
                        results.append({
                            "origin": origin,
                            "hiddenCity": true_dest,
                            "ticketDestination": final_dest,
                            "date": dep.isoformat(),
                            "normalPrice": normal_price or None,
                            "candidatePrice": price or None,
                            "savings": savings,
                            "confidence": tx("high", lang) if savings and savings > 50 else (tx("check", lang) if price else tx("link_check", lang)),
                            "candidateLabel": tx("candidate_label", lang),
                            "verifyRouting": tx("verify_routing", lang),
                            "verified": False,
                            "links": {
                                "Skiplagged candidate search": f"https://skiplagged.com/flights/{origin}/{true_dest}/{dep.isoformat()}",
                                tx("google_via", lang): f"https://www.google.com/travel/flights?q={quote_plus(f'{origin} to {final_dest} via {true_dest} {dep.isoformat()}')}",
                                tx("ticket_check", lang): links_for(origin, final_dest, dep.isoformat())["Google Flights"],
                            },
                        })
    results.sort(key=lambda x: (-(x.get("savings") or -9999), x.get("ticketDestination")))
    return jsonify({"ok": True, "results": results[:24], "warnings": warnings[:8], "debug": {"origins": origins, "dests": true_dests, "seconds": round(time.time()-started, 2), "candidates": len(candidate_endings)}, "note": tx("skiplag_note", lang)})


@app.route("/api/awards", methods=["POST"])
def awards():
    data = request.get_json(force=True) or {}
    lang = lang_from_payload(data)
    origins = resolve_codes(data.get("origin", ""))
    dests = resolve_codes(data.get("dest", ""))
    dep = parse_date(data.get("date", ""), 60)
    one_way = bool(data.get("oneWay", True))
    ret = None if one_way else parse_date(data.get("returnDate", ""), 67)
    cabins = data.get("cabins") or ["Economy", "Premium Eco", "Business"]
    if not origins or not dests:
        return jsonify({"ok": False, "error": tx("missing_origin_dest", lang)}), 400
    cards = []
    for origin in origins[:3]:
        for dest in dests[:4]:
            if origin == dest:
                continue
            for cabin in cabins:
                cards.append({"route": f"{origin} → {dest}", "date": dep.isoformat(), "returnDate": ret.isoformat() if ret else None, "cabin": cabin, "score": score_award(origin, dest, cabin, lang), "links": award_links(origin, dest, dep.isoformat(), ret.isoformat() if ret else None, cabin)})
    return jsonify({"ok": True, "cards": cards, "debug": {"origins": origins, "dests": dests}, "note": tx("awards_note", lang)})


def score_award(origin: str, dest: str, cabin: str, lang: str = "de") -> dict:
    longhaul = dest in {"JFK", "EWR", "BOS", "YYZ", "YUL", "SIN", "HKG", "BKK", "HND", "NRT", "LAX", "SFO", "SEA", "DXB", "DOH", "ICN", "TPE", "SYD", "MEL"}
    if lang == "en":
        if cabin == "Economy":
            return {"label": "🟢 good chance", "text": "Economy awards are often available, but compare cents-per-mile value against cash fares."}
        if cabin == "Premium Eco":
            return {"label": "🟡 interesting", "text": "Premium Economy can be a useful sweet spot, especially on long-haul routes."}
        if cabin == "Business" and longhaul:
            return {"label": "🟡 hunt", "text": "Business is possible, but search flexibly: ±7 days and multiple airports."}
        if cabin == "First":
            return {"label": "🔴 rare", "text": "First depends heavily on airline and last-minute release patterns."}
        return {"label": "🟢 solid", "text": "Short-haul awards are usually easier, but compare against cash fares."}
    if cabin == "Economy":
        return {"label": "🟢 gute Chance", "text": "Eco-Awards sind oft verfügbar, Wert pro Meile aber mit Cashpreis vergleichen."}
    if cabin == "Premium Eco":
        return {"label": "🟡 interessant", "text": "Premium Eco kann ein guter Sweet Spot sein, vor allem auf Langstrecke."}
    if cabin == "Business" and longhaul:
        return {"label": "🟡 jagen", "text": "Business ist möglich, aber flexibel suchen: ±7 Tage und mehrere Airports."}
    if cabin == "First":
        return {"label": "🔴 selten", "text": "First ist stark abhängig von Airline und kurzfristiger Freigabe."}
    return {"label": "🟢 solide", "text": "Kurzstrecke eher verfügbar, aber Cashpreise vergleichen."}


@app.route("/health")
def health():
    return jsonify({"ok": True, "app": APP_NAME, "version": "6.0", "tp_token": bool(TP_TOKEN), "api_guard": bool(APP_TOKEN)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=os.environ.get("FLASK_DEBUG", "0") == "1")

