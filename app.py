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


class QuotaError(RuntimeError):
    """SerpApi search quota exhausted."""
from flask import Flask, jsonify, make_response, redirect, render_template, request, send_from_directory, url_for
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
SKIPLAG_MAX_SEARCHES = int(os.environ.get("SKIPLAG_MAX_SEARCHES", "6"))

# --- Echtzeitpreise via SerpApi (Google Flights) ---------------------------
# PRICE_SOURCE steuert die Quelle für /api/cheap:
#   "serpapi"       -> echte Google-Flights-Preise (Standard, wenn SERPAPI_TOKEN gesetzt)
#   "travelpayouts" -> alter Cache als Fallback
SERPAPI_TOKEN = os.environ.get("SERPAPI_TOKEN", "")
SERPAPI_BASE = "https://serpapi.com/search"
PRICE_SOURCE = (os.environ.get("PRICE_SOURCE") or ("serpapi" if SERPAPI_TOKEN else "travelpayouts")).lower()

# --- seats.aero live award availability ---
AWARD_SOURCE   = os.environ.get("AWARD_SOURCE", "estimated").lower()  # "estimated" | "static" | "seatsaero"
SEATSAERO_KEY  = os.environ.get("SEATSAERO_API_KEY", "")
SEATSAERO_BASE = "https://seats.aero/partnerapi"
SEATSAERO_DAILY_BUDGET = 500        # soft cap: reserve half of 1000/day for user searches
_seatsaero_remaining: int | None = None  # updated from X-RateLimit-Remaining header
_serpapi_paid_calls: int = 0  # billed SerpApi calls this process — cache hits excluded
SERPAPI_TTL = int(os.environ.get("SERPAPI_TTL", "21600"))      # Cache-Lebensdauer in Sekunden (default 6h)
SERPAPI_MAX_PAIRS = int(os.environ.get("SERPAPI_MAX_PAIRS", "2"))  # max. Origin/Dest-Paare pro Klick (= Anzahl bezahlter Suchen)
SERPAPI_DEEP = (os.environ.get("SERPAPI_DEEP", "0") == "1")    # exakt wie im Browser, aber langsamer
FLEX_MAX_DAYS = int(os.environ.get("FLEX_MAX_DAYS", "3"))       # max. Flex-Tage (±N) für Datums-Kalender

app = Flask(__name__)


def make_session() -> requests.Session:
    retry = Retry(
        total=2,
        connect=2,
        read=2,
        backoff_factor=0.35,
        status_forcelist=(500, 502, 503, 504),  # 429 handled per-call with manual backoff
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
    "cheap_note": {"de": "Travelpayouts ist cache-basiert. Wenn kein Preiskontext erscheint, nutze die Prüflinks; Cachepreise werden gezeigt, wenn verfügbar, und Routing-Muster enthalten Risikokontext.", "en": "Travelpayouts is cache-based. If no fare context appears, use the verification links; cached fares are shown when available and overlooked routing results include risk context."},
    "cheap_note_live": {"de": "Cash-Fare-Kontext aus externen Preisquellen. Während der Beta gecacht — vor Kauf prüfen.", "en": "Cash fare context from external fare sources. Cached during beta - verify before purchase."},
    "skiplag_note": {"de": "Overlooked Routing bleibt Risikokontext: Travelpayouts bestätigt keine tatsächliche Umstiegsroute über dein Ziel. Routing vor Kauf prüfen; nur One-way und ohne Aufgabegepäck.", "en": "Overlooked routing remains risk-context logic: Travelpayouts does not confirm that the itinerary actually connects via your intended destination. Verify routing before purchase; one-way only and no checked baggage."},
    "awards_note": {"de": "Award-Redemption-Verfügbarkeiten brauchen eine offizielle Datenquelle; AwardRadar erzeugt Search-to-verify-Starts von Eco bis First.", "en": "Award redemption availability requires an official data source; AwardRadar creates search-to-verify starts from Economy to First."},
    "normal_price": {"de": "Normalpreis", "en": "Normal fare"},
    "candidate_label": {"de": "Overlooked-Routing-Signal", "en": "Overlooked routing signal"},
    "verify_routing": {"de": "Routing vor Kauf prüfen", "en": "Verify routing before purchase"},
    "unverified": {"de": "Verifizierungskontext nicht verfügbar", "en": "verification context unavailable"},
    "high": {"de": "prüfenswert", "en": "worth checking"},
    "check": {"de": "prüfen", "en": "check"},
    "link_check": {"de": "Link-Check", "en": "link check"},
    "google_search": {"de": "Suchanbieter", "en": "Search provider"},
    "google_via": {"de": "Preisquelle: via prüfen", "en": "Fare source: check via"},
    "ticket_check": {"de": "Ticketziel prüfen", "en": "Check ticket destination"},
}


def tx(key: str, lang: str = "de") -> str:
    return TEXT.get(key, {}).get(lang, TEXT.get(key, {}).get("de", key))

AIRPORTS = {
    # Germany
    "FRA": {"name": "Frankfurt am Main", "city": "Frankfurt", "country": "DE"},
    "MUC": {"name": "München", "city": "München", "country": "DE"},
    "DUS": {"name": "Düsseldorf", "city": "Düsseldorf", "country": "DE"},
    "BER": {"name": "Berlin Brandenburg", "city": "Berlin", "country": "DE"},
    "HAM": {"name": "Hamburg", "city": "Hamburg", "country": "DE"},
    "CGN": {"name": "Köln/Bonn", "city": "Köln", "country": "DE"},
    "STR": {"name": "Stuttgart", "city": "Stuttgart", "country": "DE"},
    "NUE": {"name": "Nürnberg", "city": "Nürnberg", "country": "DE"},
    "HAJ": {"name": "Hannover", "city": "Hannover", "country": "DE"},
    "LEJ": {"name": "Leipzig/Halle", "city": "Leipzig", "country": "DE"},
    "DRS": {"name": "Dresden", "city": "Dresden", "country": "DE"},
    "BRE": {"name": "Bremen", "city": "Bremen", "country": "DE"},
    "FMO": {"name": "Münster/Osnabrück", "city": "Münster", "country": "DE"},
    "NRN": {"name": "Weeze (Niederrhein)", "city": "Düsseldorf", "country": "DE"},
    "HHN": {"name": "Frankfurt Hahn", "city": "Frankfurt", "country": "DE"},
    # Austria
    "VIE": {"name": "Wien", "city": "Wien", "country": "AT"},
    "SZG": {"name": "Salzburg", "city": "Salzburg", "country": "AT"},
    "INN": {"name": "Innsbruck", "city": "Innsbruck", "country": "AT"},
    "GRZ": {"name": "Graz", "city": "Graz", "country": "AT"},
    "LNZ": {"name": "Linz", "city": "Linz", "country": "AT"},
    # Switzerland
    "ZRH": {"name": "Zürich", "city": "Zürich", "country": "CH"},
    "GVA": {"name": "Genf", "city": "Genf", "country": "CH"},
    "BSL": {"name": "Basel/Mulhouse", "city": "Basel", "country": "CH"},
    "BRN": {"name": "Bern", "city": "Bern", "country": "CH"},
    # UK
    "LHR": {"name": "London Heathrow", "city": "London", "country": "GB"},
    "LGW": {"name": "London Gatwick", "city": "London", "country": "GB"},
    "LCY": {"name": "London City", "city": "London", "country": "GB"},
    "STN": {"name": "London Stansted", "city": "London", "country": "GB"},
    "LTN": {"name": "London Luton", "city": "London", "country": "GB"},
    "MAN": {"name": "Manchester", "city": "Manchester", "country": "GB"},
    "EDI": {"name": "Edinburgh", "city": "Edinburgh", "country": "GB"},
    "GLA": {"name": "Glasgow", "city": "Glasgow", "country": "GB"},
    "BHX": {"name": "Birmingham", "city": "Birmingham", "country": "GB"},
    # France
    "CDG": {"name": "Paris Charles de Gaulle", "city": "Paris", "country": "FR"},
    "ORY": {"name": "Paris Orly", "city": "Paris", "country": "FR"},
    "NCE": {"name": "Nizza", "city": "Nizza", "country": "FR"},
    "LYS": {"name": "Lyon", "city": "Lyon", "country": "FR"},
    "MRS": {"name": "Marseille", "city": "Marseille", "country": "FR"},
    "TLS": {"name": "Toulouse", "city": "Toulouse", "country": "FR"},
    "BOD": {"name": "Bordeaux", "city": "Bordeaux", "country": "FR"},
    # Netherlands / Belgium / Luxembourg
    "AMS": {"name": "Amsterdam Schiphol", "city": "Amsterdam", "country": "NL"},
    "EIN": {"name": "Eindhoven", "city": "Eindhoven", "country": "NL"},
    "BRU": {"name": "Brüssel", "city": "Brüssel", "country": "BE"},
    "CRL": {"name": "Brüssel Charleroi", "city": "Brüssel", "country": "BE"},
    "LUX": {"name": "Luxemburg", "city": "Luxemburg", "country": "LU"},
    # Spain
    "MAD": {"name": "Madrid Barajas", "city": "Madrid", "country": "ES"},
    "BCN": {"name": "Barcelona", "city": "Barcelona", "country": "ES"},
    "AGP": {"name": "Málaga", "city": "Málaga", "country": "ES"},
    "PMI": {"name": "Palma de Mallorca", "city": "Palma", "country": "ES"},
    "VLC": {"name": "Valencia", "city": "Valencia", "country": "ES"},
    "SVQ": {"name": "Sevilla", "city": "Sevilla", "country": "ES"},
    "TFS": {"name": "Teneriffa Süd", "city": "Teneriffa", "country": "ES"},
    "LPA": {"name": "Gran Canaria", "city": "Las Palmas", "country": "ES"},
    "IBZ": {"name": "Ibiza", "city": "Ibiza", "country": "ES"},
    # Italy
    "FCO": {"name": "Rom Fiumicino", "city": "Rom", "country": "IT"},
    "CIA": {"name": "Rom Ciampino", "city": "Rom", "country": "IT"},
    "MXP": {"name": "Mailand Malpensa", "city": "Mailand", "country": "IT"},
    "LIN": {"name": "Mailand Linate", "city": "Mailand", "country": "IT"},
    "BGY": {"name": "Bergamo", "city": "Mailand", "country": "IT"},
    "VCE": {"name": "Venedig", "city": "Venedig", "country": "IT"},
    "NAP": {"name": "Neapel", "city": "Neapel", "country": "IT"},
    "CTA": {"name": "Catania", "city": "Catania", "country": "IT"},
    "PMO": {"name": "Palermo", "city": "Palermo", "country": "IT"},
    "BLQ": {"name": "Bologna", "city": "Bologna", "country": "IT"},
    "PSA": {"name": "Pisa", "city": "Pisa", "country": "IT"},
    "FLR": {"name": "Florenz", "city": "Florenz", "country": "IT"},
    # Portugal
    "LIS": {"name": "Lissabon", "city": "Lissabon", "country": "PT"},
    "OPO": {"name": "Porto", "city": "Porto", "country": "PT"},
    "FAO": {"name": "Faro", "city": "Faro", "country": "PT"},
    # Scandinavia
    "CPH": {"name": "Kopenhagen", "city": "Kopenhagen", "country": "DK"},
    "ARN": {"name": "Stockholm Arlanda", "city": "Stockholm", "country": "SE"},
    "OSL": {"name": "Oslo Gardermoen", "city": "Oslo", "country": "NO"},
    "HEL": {"name": "Helsinki", "city": "Helsinki", "country": "FI"},
    "GOT": {"name": "Göteborg", "city": "Göteborg", "country": "SE"},
    "BGO": {"name": "Bergen", "city": "Bergen", "country": "NO"},
    "TRD": {"name": "Trondheim", "city": "Trondheim", "country": "NO"},
    # Eastern Europe
    "WAW": {"name": "Warschau Chopin", "city": "Warschau", "country": "PL"},
    "KRK": {"name": "Krakau", "city": "Krakau", "country": "PL"},
    "PRG": {"name": "Prag", "city": "Prag", "country": "CZ"},
    "BUD": {"name": "Budapest", "city": "Budapest", "country": "HU"},
    "OTP": {"name": "Bukarest", "city": "Bukarest", "country": "RO"},
    "SOF": {"name": "Sofia", "city": "Sofia", "country": "BG"},
    "LJU": {"name": "Ljubljana", "city": "Ljubljana", "country": "SI"},
    "ZAG": {"name": "Zagreb", "city": "Zagreb", "country": "HR"},
    "SKP": {"name": "Skopje", "city": "Skopje", "country": "MK"},
    "BEG": {"name": "Belgrad", "city": "Belgrad", "country": "RS"},
    "TIA": {"name": "Tirana", "city": "Tirana", "country": "AL"},
    "RIX": {"name": "Riga", "city": "Riga", "country": "LV"},
    "TLL": {"name": "Tallinn", "city": "Tallinn", "country": "EE"},
    "VNO": {"name": "Vilnius", "city": "Vilnius", "country": "LT"},
    "KBP": {"name": "Kiew Boryspil", "city": "Kiew", "country": "UA"},
    "SVO": {"name": "Moskau Scheremetjewo", "city": "Moskau", "country": "RU"},
    "DME": {"name": "Moskau Domodedowo", "city": "Moskau", "country": "RU"},
    # Greece / Cyprus / Turkey
    "ATH": {"name": "Athen", "city": "Athen", "country": "GR"},
    "SKG": {"name": "Thessaloniki", "city": "Thessaloniki", "country": "GR"},
    "HER": {"name": "Heraklion", "city": "Kreta", "country": "GR"},
    "RHO": {"name": "Rhodos", "city": "Rhodos", "country": "GR"},
    "CFU": {"name": "Korfu", "city": "Korfu", "country": "GR"},
    "MYK": {"name": "Mykonos", "city": "Mykonos", "country": "GR"},
    "JTR": {"name": "Santorin", "city": "Santorin", "country": "GR"},
    "LCA": {"name": "Larnaka", "city": "Larnaka", "country": "CY"},
    "PFO": {"name": "Paphos", "city": "Paphos", "country": "CY"},
    "IST": {"name": "Istanbul", "city": "Istanbul", "country": "TR"},
    "SAW": {"name": "Istanbul Sabiha Gökçen", "city": "Istanbul", "country": "TR"},
    "AYT": {"name": "Antalya", "city": "Antalya", "country": "TR"},
    "ADB": {"name": "Izmir", "city": "Izmir", "country": "TR"},
    "ESB": {"name": "Ankara", "city": "Ankara", "country": "TR"},
    # Middle East
    "DXB": {"name": "Dubai", "city": "Dubai", "country": "AE"},
    "AUH": {"name": "Abu Dhabi", "city": "Abu Dhabi", "country": "AE"},
    "DOH": {"name": "Doha", "city": "Doha", "country": "QA"},
    "BAH": {"name": "Bahrain", "city": "Bahrain", "country": "BH"},
    "KWI": {"name": "Kuwait City", "city": "Kuwait", "country": "KW"},
    "MCT": {"name": "Maskat", "city": "Maskat", "country": "OM"},
    "RUH": {"name": "Riad", "city": "Riad", "country": "SA"},
    "JED": {"name": "Jeddah", "city": "Jeddah", "country": "SA"},
    "AMM": {"name": "Amman", "city": "Amman", "country": "JO"},
    "BEY": {"name": "Beirut", "city": "Beirut", "country": "LB"},
    "TLV": {"name": "Tel Aviv", "city": "Tel Aviv", "country": "IL"},
    "CAI": {"name": "Kairo", "city": "Kairo", "country": "EG"},
    # Africa
    "NBO": {"name": "Nairobi", "city": "Nairobi", "country": "KE"},
    "ADD": {"name": "Addis Abeba", "city": "Addis Abeba", "country": "ET"},
    "JNB": {"name": "Johannesburg", "city": "Johannesburg", "country": "ZA"},
    "CPT": {"name": "Kapstadt", "city": "Kapstadt", "country": "ZA"},
    "CMN": {"name": "Casablanca", "city": "Casablanca", "country": "MA"},
    "RAK": {"name": "Marrakesch", "city": "Marrakesch", "country": "MA"},
    "TUN": {"name": "Tunis", "city": "Tunis", "country": "TN"},
    "ALG": {"name": "Algier", "city": "Algier", "country": "DZ"},
    "LOS": {"name": "Lagos", "city": "Lagos", "country": "NG"},
    "ACC": {"name": "Accra", "city": "Accra", "country": "GH"},
    "DAR": {"name": "Daressalam", "city": "Daressalam", "country": "TZ"},
    "EBB": {"name": "Entebbe", "city": "Kampala", "country": "UG"},
    "HRE": {"name": "Harare", "city": "Harare", "country": "ZW"},
    "MRU": {"name": "Mauritius", "city": "Port Louis", "country": "MU"},
    "SEZ": {"name": "Seychellen", "city": "Mahé", "country": "SC"},
    # North America
    "JFK": {"name": "New York JFK", "city": "New York", "country": "US"},
    "EWR": {"name": "Newark", "city": "New York", "country": "US"},
    "LGA": {"name": "LaGuardia", "city": "New York", "country": "US"},
    "BOS": {"name": "Boston Logan", "city": "Boston", "country": "US"},
    "IAD": {"name": "Washington Dulles", "city": "Washington", "country": "US"},
    "DCA": {"name": "Washington Reagan", "city": "Washington", "country": "US"},
    "ORD": {"name": "Chicago O'Hare", "city": "Chicago", "country": "US"},
    "MDW": {"name": "Chicago Midway", "city": "Chicago", "country": "US"},
    "MIA": {"name": "Miami", "city": "Miami", "country": "US"},
    "FLL": {"name": "Fort Lauderdale", "city": "Miami", "country": "US"},
    "LAX": {"name": "Los Angeles", "city": "Los Angeles", "country": "US"},
    "SFO": {"name": "San Francisco", "city": "San Francisco", "country": "US"},
    "SJC": {"name": "San Jose", "city": "San Jose", "country": "US"},
    "OAK": {"name": "Oakland", "city": "San Francisco", "country": "US"},
    "SEA": {"name": "Seattle", "city": "Seattle", "country": "US"},
    "LAS": {"name": "Las Vegas", "city": "Las Vegas", "country": "US"},
    "PHX": {"name": "Phoenix", "city": "Phoenix", "country": "US"},
    "DFW": {"name": "Dallas/Fort Worth", "city": "Dallas", "country": "US"},
    "IAH": {"name": "Houston Intercontinental", "city": "Houston", "country": "US"},
    "HOU": {"name": "Houston Hobby", "city": "Houston", "country": "US"},
    "ATL": {"name": "Atlanta", "city": "Atlanta", "country": "US"},
    "DEN": {"name": "Denver", "city": "Denver", "country": "US"},
    "MSP": {"name": "Minneapolis", "city": "Minneapolis", "country": "US"},
    "DTW": {"name": "Detroit", "city": "Detroit", "country": "US"},
    "PHL": {"name": "Philadelphia", "city": "Philadelphia", "country": "US"},
    "CLT": {"name": "Charlotte", "city": "Charlotte", "country": "US"},
    "MCO": {"name": "Orlando", "city": "Orlando", "country": "US"},
    "TPA": {"name": "Tampa", "city": "Tampa", "country": "US"},
    "PDX": {"name": "Portland", "city": "Portland", "country": "US"},
    "SLC": {"name": "Salt Lake City", "city": "Salt Lake City", "country": "US"},
    "HNL": {"name": "Honolulu", "city": "Honolulu", "country": "US"},
    "ANC": {"name": "Anchorage", "city": "Anchorage", "country": "US"},
    "YYZ": {"name": "Toronto Pearson", "city": "Toronto", "country": "CA"},
    "YUL": {"name": "Montréal", "city": "Montréal", "country": "CA"},
    "YVR": {"name": "Vancouver", "city": "Vancouver", "country": "CA"},
    "YYC": {"name": "Calgary", "city": "Calgary", "country": "CA"},
    "YEG": {"name": "Edmonton", "city": "Edmonton", "country": "CA"},
    "YOW": {"name": "Ottawa", "city": "Ottawa", "country": "CA"},
    # Mexico / Caribbean / Central America
    "MEX": {"name": "Mexiko-Stadt", "city": "Mexiko-Stadt", "country": "MX"},
    "CUN": {"name": "Cancún", "city": "Cancún", "country": "MX"},
    "GDL": {"name": "Guadalajara", "city": "Guadalajara", "country": "MX"},
    "MTY": {"name": "Monterrey", "city": "Monterrey", "country": "MX"},
    "MBJ": {"name": "Montego Bay", "city": "Montego Bay", "country": "JM"},
    "KIN": {"name": "Kingston", "city": "Kingston", "country": "JM"},
    "NAS": {"name": "Nassau", "city": "Nassau", "country": "BS"},
    "HAV": {"name": "Havanna", "city": "Havanna", "country": "CU"},
    "SJO": {"name": "San José", "city": "San José", "country": "CR"},
    "PTY": {"name": "Panama City", "city": "Panama City", "country": "PA"},
    # South America
    "GRU": {"name": "São Paulo Guarulhos", "city": "São Paulo", "country": "BR"},
    "CGH": {"name": "São Paulo Congonhas", "city": "São Paulo", "country": "BR"},
    "GIG": {"name": "Rio de Janeiro", "city": "Rio de Janeiro", "country": "BR"},
    "BSB": {"name": "Brasília", "city": "Brasília", "country": "BR"},
    "EZE": {"name": "Buenos Aires", "city": "Buenos Aires", "country": "AR"},
    "AEP": {"name": "Buenos Aires Aeroparque", "city": "Buenos Aires", "country": "AR"},
    "SCL": {"name": "Santiago de Chile", "city": "Santiago", "country": "CL"},
    "BOG": {"name": "Bogotá", "city": "Bogotá", "country": "CO"},
    "LIM": {"name": "Lima", "city": "Lima", "country": "PE"},
    "UIO": {"name": "Quito", "city": "Quito", "country": "EC"},
    "GYE": {"name": "Guayaquil", "city": "Guayaquil", "country": "EC"},
    "CCS": {"name": "Caracas", "city": "Caracas", "country": "VE"},
    # Asia Pacific
    "SIN": {"name": "Singapore Changi", "city": "Singapur", "country": "SG"},
    "HKG": {"name": "Hongkong", "city": "Hongkong", "country": "HK"},
    "BKK": {"name": "Bangkok Suvarnabhumi", "city": "Bangkok", "country": "TH"},
    "DMK": {"name": "Bangkok Don Mueang", "city": "Bangkok", "country": "TH"},
    "HND": {"name": "Tokio Haneda", "city": "Tokio", "country": "JP"},
    "NRT": {"name": "Tokio Narita", "city": "Tokio", "country": "JP"},
    "ICN": {"name": "Seoul Incheon", "city": "Seoul", "country": "KR"},
    "GMP": {"name": "Seoul Gimpo", "city": "Seoul", "country": "KR"},
    "TPE": {"name": "Taipei Taoyuan", "city": "Taipei", "country": "TW"},
    "TSA": {"name": "Taipei Songshan", "city": "Taipei", "country": "TW"},
    "PEK": {"name": "Peking", "city": "Peking", "country": "CN"},
    "PKX": {"name": "Peking Daxing", "city": "Peking", "country": "CN"},
    "PVG": {"name": "Shanghai Pudong", "city": "Shanghai", "country": "CN"},
    "SHA": {"name": "Shanghai Hongqiao", "city": "Shanghai", "country": "CN"},
    "CAN": {"name": "Guangzhou", "city": "Guangzhou", "country": "CN"},
    "CTU": {"name": "Chengdu", "city": "Chengdu", "country": "CN"},
    "SZX": {"name": "Shenzhen", "city": "Shenzhen", "country": "CN"},
    "KIX": {"name": "Osaka Kansai", "city": "Osaka", "country": "JP"},
    "ITM": {"name": "Osaka Itami", "city": "Osaka", "country": "JP"},
    "NGO": {"name": "Nagoya", "city": "Nagoya", "country": "JP"},
    "FUK": {"name": "Fukuoka", "city": "Fukuoka", "country": "JP"},
    "OKA": {"name": "Okinawa", "city": "Okinawa", "country": "JP"},
    "CJU": {"name": "Jeju", "city": "Jeju", "country": "KR"},
    "KUL": {"name": "Kuala Lumpur", "city": "Kuala Lumpur", "country": "MY"},
    "CGK": {"name": "Jakarta", "city": "Jakarta", "country": "ID"},
    "DPS": {"name": "Bali", "city": "Denpasar", "country": "ID"},
    "SUB": {"name": "Surabaya", "city": "Surabaya", "country": "ID"},
    "MNL": {"name": "Manila", "city": "Manila", "country": "PH"},
    "CEB": {"name": "Cebu", "city": "Cebu", "country": "PH"},
    "SGN": {"name": "Ho-Chi-Minh-Stadt", "city": "Ho-Chi-Minh-Stadt", "country": "VN"},
    "HAN": {"name": "Hanoi", "city": "Hanoi", "country": "VN"},
    "DAD": {"name": "Da Nang", "city": "Da Nang", "country": "VN"},
    "RGN": {"name": "Yangon", "city": "Yangon", "country": "MM"},
    "PNH": {"name": "Phnom Penh", "city": "Phnom Penh", "country": "KH"},
    "REP": {"name": "Siem Reap", "city": "Siem Reap", "country": "KH"},
    "VTE": {"name": "Vientiane", "city": "Vientiane", "country": "LA"},
    "DEL": {"name": "Delhi", "city": "Delhi", "country": "IN"},
    "BOM": {"name": "Mumbai", "city": "Mumbai", "country": "IN"},
    "BLR": {"name": "Bengaluru", "city": "Bengaluru", "country": "IN"},
    "MAA": {"name": "Chennai", "city": "Chennai", "country": "IN"},
    "HYD": {"name": "Hyderabad", "city": "Hyderabad", "country": "IN"},
    "CCU": {"name": "Kolkata", "city": "Kolkata", "country": "IN"},
    "COK": {"name": "Kochi", "city": "Kochi", "country": "IN"},
    "CMB": {"name": "Colombo", "city": "Colombo", "country": "LK"},
    "KTM": {"name": "Kathmandu", "city": "Kathmandu", "country": "NP"},
    "DAC": {"name": "Dhaka", "city": "Dhaka", "country": "BD"},
    "KHI": {"name": "Karachi", "city": "Karachi", "country": "PK"},
    "LHE": {"name": "Lahore", "city": "Lahore", "country": "PK"},
    "ISB": {"name": "Islamabad", "city": "Islamabad", "country": "PK"},
    "KBL": {"name": "Kabul", "city": "Kabul", "country": "AF"},
    "TAS": {"name": "Taschkent", "city": "Taschkent", "country": "UZ"},
    "ALA": {"name": "Almaty", "city": "Almaty", "country": "KZ"},
    # Australia / New Zealand / Pacific
    "SYD": {"name": "Sydney", "city": "Sydney", "country": "AU"},
    "MEL": {"name": "Melbourne", "city": "Melbourne", "country": "AU"},
    "BNE": {"name": "Brisbane", "city": "Brisbane", "country": "AU"},
    "PER": {"name": "Perth", "city": "Perth", "country": "AU"},
    "ADL": {"name": "Adelaide", "city": "Adelaide", "country": "AU"},
    "AKL": {"name": "Auckland", "city": "Auckland", "country": "NZ"},
    "CHC": {"name": "Christchurch", "city": "Christchurch", "country": "NZ"},
    "WLG": {"name": "Wellington", "city": "Wellington", "country": "NZ"},
    "NAN": {"name": "Nadi", "city": "Nadi", "country": "FJ"},
    "PPT": {"name": "Papeete", "city": "Tahiti", "country": "PF"},
}

ALIASES = {
    # Germany
    "frankfurt": ["FRA"], "fra": ["FRA"],
    "münchen": ["MUC"], "muenchen": ["MUC"], "munich": ["MUC"], "muc": ["MUC"],
    "berlin": ["BER"], "hamburg": ["HAM"], "düsseldorf": ["DUS"], "duesseldorf": ["DUS"],
    "köln": ["CGN"], "koeln": ["CGN"], "cologne": ["CGN"], "bonn": ["CGN"],
    "stuttgart": ["STR"], "nürnberg": ["NUE"], "nuernberg": ["NUE"], "nuremberg": ["NUE"],
    "hannover": ["HAJ"], "leipzig": ["LEJ"], "dresden": ["DRS"], "bremen": ["BRE"],
    # Austria / Switzerland
    "wien": ["VIE"], "vienna": ["VIE"],
    "zürich": ["ZRH"], "zuerich": ["ZRH"], "zurich": ["ZRH"],
    "genf": ["GVA"], "geneva": ["GVA"], "genève": ["GVA"],
    "basel": ["BSL"], "salzburg": ["SZG"], "innsbruck": ["INN"], "graz": ["GRZ"],
    # UK
    "london": ["LHR", "LGW", "LCY", "STN"], "manchester": ["MAN"],
    "edinburgh": ["EDI"], "glasgow": ["GLA"], "birmingham": ["BHX"],
    # France
    "paris": ["CDG", "ORY"], "nizza": ["NCE"], "nice": ["NCE"],
    "lyon": ["LYS"], "marseille": ["MRS"], "toulouse": ["TLS"], "bordeaux": ["BOD"],
    # Benelux
    "amsterdam": ["AMS"], "brüssel": ["BRU"], "brussels": ["BRU"], "bruxelles": ["BRU"],
    "luxemburg": ["LUX"], "luxembourg": ["LUX"],
    # Spain
    "madrid": ["MAD"], "barcelona": ["BCN"], "palma": ["PMI"], "mallorca": ["PMI"],
    "málaga": ["AGP"], "malaga": ["AGP"], "sevilla": ["SVQ"], "seville": ["SVQ"],
    "teneriffa": ["TFS"], "tenerife": ["TFS"], "gran canaria": ["LPA"], "ibiza": ["IBZ"],
    # Italy
    "rom": ["FCO"], "rome": ["FCO"], "mailand": ["MXP", "LIN"], "milan": ["MXP", "LIN"],
    "venedig": ["VCE"], "venice": ["VCE"], "neapel": ["NAP"], "naples": ["NAP"],
    "florenz": ["FLR"], "florence": ["FLR"], "bologna": ["BLQ"], "pisa": ["PSA"],
    "catania": ["CTA"], "palermo": ["PMO"],
    # Portugal
    "lissabon": ["LIS"], "lisbon": ["LIS"], "porto": ["OPO"], "faro": ["FAO"],
    # Scandinavia
    "kopenhagen": ["CPH"], "copenhagen": ["CPH"],
    "stockholm": ["ARN"], "oslo": ["OSL"], "helsinki": ["HEL"],
    "göteborg": ["GOT"], "gothenburg": ["GOT"], "bergen": ["BGO"],
    # Eastern Europe
    "warschau": ["WAW"], "warsaw": ["WAW"], "krakau": ["KRK"], "krakow": ["KRK"],
    "prag": ["PRG"], "prague": ["PRG"], "budapest": ["BUD"],
    "bukarest": ["OTP"], "bucharest": ["OTP"], "sofia": ["SOF"],
    "belgrad": ["BEG"], "belgrade": ["BEG"], "riga": ["RIX"],
    "tallinn": ["TLL"], "vilnius": ["VNO"],
    "kiew": ["KBP"], "kyiv": ["KBP"], "kiev": ["KBP"],
    "moskau": ["SVO", "DME"], "moscow": ["SVO", "DME"],
    # Greece / Cyprus / Turkey
    "athen": ["ATH"], "athens": ["ATH"], "thessaloniki": ["SKG"],
    "kreta": ["HER"], "crete": ["HER"], "heraklion": ["HER"],
    "rhodos": ["RHO"], "rhodes": ["RHO"], "korfu": ["CFU"], "corfu": ["CFU"],
    "mykonos": ["MYK"], "santorin": ["JTR"], "santorini": ["JTR"],
    "larnaka": ["LCA"], "larnaca": ["LCA"], "paphos": ["PFO"],
    "istanbul": ["IST", "SAW"], "antalya": ["AYT"], "izmir": ["ADB"], "ankara": ["ESB"],
    # Middle East
    "dubai": ["DXB"], "abu dhabi": ["AUH"], "doha": ["DOH"],
    "bahrain": ["BAH"], "kuwait": ["KWI"], "maskat": ["MCT"], "muscat": ["MCT"],
    "riad": ["RUH"], "riyadh": ["RUH"], "jeddah": ["JED"],
    "amman": ["AMM"], "beirut": ["BEY"], "tel aviv": ["TLV"], "kairo": ["CAI"], "cairo": ["CAI"],
    # Africa
    "nairobi": ["NBO"], "addis abeba": ["ADD"], "addis ababa": ["ADD"],
    "johannesburg": ["JNB"], "kapstadt": ["CPT"], "cape town": ["CPT"],
    "casablanca": ["CMN"], "marrakesch": ["RAK"], "marrakech": ["RAK"],
    "tunis": ["TUN"], "lagos": ["LOS"], "accra": ["ACC"],
    "mauritius": ["MRU"], "seychellen": ["SEZ"], "seychelles": ["SEZ"],
    # North America
    "new york": ["JFK", "EWR", "LGA"], "nyc": ["JFK", "EWR", "LGA"],
    "boston": ["BOS"], "washington": ["IAD", "DCA"],
    "chicago": ["ORD", "MDW"], "miami": ["MIA", "FLL"],
    "los angeles": ["LAX"], "la": ["LAX"],
    "san francisco": ["SFO"], "sf": ["SFO"],
    "seattle": ["SEA"], "las vegas": ["LAS"], "vegas": ["LAS"],
    "phoenix": ["PHX"], "dallas": ["DFW"], "houston": ["IAH"],
    "atlanta": ["ATL"], "denver": ["DEN"], "minneapolis": ["MSP"],
    "detroit": ["DTW"], "philadelphia": ["PHL"], "orlando": ["MCO"],
    "portland": ["PDX"], "honolulu": ["HNL"], "hawaii": ["HNL"],
    "toronto": ["YYZ"], "montreal": ["YUL"], "montréal": ["YUL"],
    "vancouver": ["YVR"], "calgary": ["YYC"], "ottawa": ["YOW"],
    # Mexico / Caribbean
    "mexiko": ["MEX"], "mexico city": ["MEX"], "cancún": ["CUN"], "cancun": ["CUN"],
    "guadalajara": ["GDL"], "monterrey": ["MTY"],
    "kingston": ["KIN"], "havanna": ["HAV"], "havana": ["HAV"],
    "panama": ["PTY"], "san josé costa rica": ["SJO"],
    # South America
    "são paulo": ["GRU"], "sao paulo": ["GRU"],
    "rio de janeiro": ["GIG"], "rio": ["GIG"], "brasília": ["BSB"], "brasilia": ["BSB"],
    "buenos aires": ["EZE"], "santiago": ["SCL"],
    "bogotá": ["BOG"], "bogota": ["BOG"], "lima": ["LIM"], "quito": ["UIO"],
    # Asia
    "singapur": ["SIN"], "singapore": ["SIN"],
    "hongkong": ["HKG"], "hong kong": ["HKG"],
    "bangkok": ["BKK"], "tokio": ["HND", "NRT"], "tokyo": ["HND", "NRT"], "tyo": ["HND", "NRT"],
    "osaka": ["KIX", "ITM"], "nagoya": ["NGO"], "fukuoka": ["FUK"], "okinawa": ["OKA"],
    "seoul": ["ICN", "GMP"], "taipei": ["TPE"],
    "peking": ["PEK"], "beijing": ["PEK"],
    "shanghai": ["PVG", "SHA"], "guangzhou": ["CAN"], "shenzhen": ["SZX"],
    "kuala lumpur": ["KUL"], "kl": ["KUL"],
    "jakarta": ["CGK"], "bali": ["DPS"], "denpasar": ["DPS"],
    "manila": ["MNL"], "cebu": ["CEB"],
    "ho chi minh": ["SGN"], "saigon": ["SGN"], "hanoi": ["HAN"], "da nang": ["DAD"],
    "yangon": ["RGN"], "rangoon": ["RGN"],
    "delhi": ["DEL"], "neu delhi": ["DEL"], "new delhi": ["DEL"],
    "mumbai": ["BOM"], "bombay": ["BOM"], "bangalore": ["BLR"], "bengaluru": ["BLR"],
    "chennai": ["MAA"], "madras": ["MAA"], "hyderabad": ["HYD"], "kolkata": ["CCU"],
    "colombo": ["CMB"], "kathmandu": ["KTM"], "dhaka": ["DAC"],
    "karachi": ["KHI"], "lahore": ["LHE"], "islamabad": ["ISB"],
    # Australia / NZ
    "sydney": ["SYD"], "melbourne": ["MEL"], "brisbane": ["BNE"],
    "perth": ["PER"], "adelaide": ["ADL"],
    "auckland": ["AKL"], "christchurch": ["CHC"], "wellington": ["WLG"],
    "nadi": ["NAN"], "fiji": ["NAN"], "tahiti": ["PPT"],
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


@app.after_request
def set_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net fonts.googleapis.com; "
        "img-src 'self' data: content.airhex.com; "
        "connect-src 'self'; "
        "font-src 'self' cdn.jsdelivr.net fonts.gstatic.com; "
        "frame-ancestors 'none';"
    )
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


def deal_score(price: float, stops: int, airline: str = "", typical_range: list | None = None) -> int:
    score = 50

    # Wenn Google einen typischen Preisbereich liefert, bewerten wir relativ dazu
    # (objektiver als feste Schwellen). Sonst greifen die festen Staffeln.
    if typical_range and len(typical_range) == 2 and price:
        low, high = float(typical_range[0] or 0), float(typical_range[1] or 0)
        if low and price <= low:
            score += 30
        elif high and price >= high:
            score += 2
        elif high > low:
            # lineare Einordnung innerhalb des typischen Bereichs (30 .. 8 Punkte)
            frac = (price - low) / (high - low)
            score += int(round(30 - frac * 22))
        else:
            score += 14
    elif price and price < 300:
        score += 30
    elif price and price < 500:
        score += 22
    elif price and price < 700:
        score += 14
    elif price and price < 1000:
        score += 6

    try:
        stops = int(stops or 0)
    except Exception:
        stops = 0

    if stops == 0:
        score += 15
    elif stops == 1:
        score += 7
    else:
        score -= 5

    if airline in MM_AIRLINES:
        score += 5

    return max(0, min(100, score))


def score_reason(price: float, stops: int, airline_code: str, typical_range: list | None) -> str:
    parts = []
    if typical_range and len(typical_range) == 2:
        low, high = float(typical_range[0] or 0), float(typical_range[1] or 0)
        if low and high and price:
            if price <= low:
                parts.append(f"below typical low ({int(low)} EUR)")
            elif price <= (low + high) / 2:
                parts.append("below average")
            else:
                parts.append("average price range")
    try:
        s = int(stops or 0)
    except Exception:
        s = 0
    if s == 0:
        parts.append("nonstop")
    elif s == 1:
        parts.append("1 stop")
    if airline_code in MM_AIRLINES:
        parts.append("Star Alliance")
    return " · ".join(parts)


# ===== Relative Cash Result Intelligence =====
# A cash result is only valuable RELATIVE to the best comparable alternative in
# the same search. Relative ranking finds the best option; an absolute reality
# check decides whether that best option is actually good value. Top labels stay
# scarce. Airline/alliance is a minor modifier, never a dominant factor.
#
# Founder calibration — NOT universal or market-standard truth.
# TODO: calibrate with real route data and founder review
CASH_SCORE_CONFIG = {
    "base": 62,                     # anchor for the cheapest, itinerary-neutral result
    "premium_penalty_per_100pct": 55,  # points removed per +100% price over cheapest
    "premium_penalty_cap": 60,      # max points a price premium can remove
    "stop_penalty": {0: 0, 1: 12, 2: 26},  # 2 == "2 or more"
    "nonstop_bonus": 10,            # meaningful advantage for a true nonstop
    "duration_penalty_per_hour": 2.0,  # per hour longer than the fastest in the set
    "duration_penalty_cap": 14,
    "alliance_bonus": 3,            # minor modifier only
    "below_typical_bonus": 20,      # genuinely cheap vs Google's typical range
    "within_low_half_bonus": 8,     # cheaper half of the typical range
    # score → (tier, grade, label). First threshold met wins. Exceptional is rare.
    "grade_bands": [
        (88, "exceptional", "A+", "Exceptional Value"),
        (72, "great",       "A",  "Strong Value"),
        (56, "good",        "B",  "Fair Value"),
        (38, "fair",        "C",  "Pricey for This Search"),
        (0,  "poor",        "D",  "Weak Relative Value"),
    ],
}

# Caps are derived from the bands so they can never contradict them:
# an active weak/expensive-field cap must stay below Strong (→ max "Fair Value"),
# and any limited-comparison cap must stay below Exceptional.
_BAND_MIN = {tier: threshold for threshold, tier, _g, _l in CASH_SCORE_CONFIG["grade_bands"]}
# Weak/expensive field → max Fair Value (one point below the Strong threshold).
CASH_SCORE_CONFIG["expensive_field_cap"] = _BAND_MIN["great"] - 1   # 71
# A single result is the weakest possible field (no comparison at all) → also
# capped at Fair Value; this likewise keeps it below Exceptional.
CASH_SCORE_CONFIG["single_result_cap"] = _BAND_MIN["great"] - 1     # 71


def _cash_grade(score: int) -> dict:
    for threshold, tier, grade, label in CASH_SCORE_CONFIG["grade_bands"]:
        if score >= threshold:
            return {"tier": tier, "grade": grade, "label": label}
    return {"tier": "poor", "grade": "D", "label": "Weak Relative Value"}


def _below_typical(price, typical_range) -> str:
    """Absolute reality check against Google's typical price range."""
    if not price or not typical_range or len(typical_range) != 2:
        return "unknown"
    low, high = float(typical_range[0] or 0), float(typical_range[1] or 0)
    if low <= 0 or high <= 0:
        return "unknown"
    if price <= low:
        return "below"
    if price <= (low + high) / 2:
        return "low_half"
    if price >= high:
        return "above"
    return "within"


def rescore_offer_set(offers: list[dict]) -> list[dict]:
    """Recompute each offer's value score RELATIVE to the set (single source of
    truth for result-card scoring). Sets dealScore, grade, label, tier, plus a
    scoreContext and scoreConfidence. Leaves the flex calendar's own dots alone.
    """
    priced = [o for o in offers if (o.get("price") or 0) > 0]
    if not priced:
        return offers
    cfg = CASH_SCORE_CONFIG
    cheapest = min(o["price"] for o in priced)
    durations = [o.get("durationMin") for o in priced if o.get("durationMin")]
    best_dur = min(durations) if durations else None
    n = len(priced)
    any_below_typical = False

    for o in priced:
        price = float(o["price"])
        try:
            stops = int(o.get("stops") or 0)
        except Exception:
            stops = 0

        score = float(cfg["base"])
        reasons = []

        # 1) Relative price position — the dominant factor.
        premium = (price / cheapest) - 1.0 if cheapest else 0.0
        if premium > 0:
            penalty = min(cfg["premium_penalty_cap"], premium * cfg["premium_penalty_per_100pct"])
            score -= penalty
            if premium >= 0.5:
                reasons.append(f"{round(premium * 100)}% pricier than cheapest")
            elif premium >= 0.12:
                reasons.append("higher than cheapest")
        else:
            reasons.append("cheapest in this search")

        # 2) Itinerary quality.
        score -= cfg["stop_penalty"].get(min(stops, 2), cfg["stop_penalty"][2])
        if stops == 0:
            score += cfg["nonstop_bonus"]
            reasons.append("nonstop")
        elif stops == 1:
            reasons.append("1 stop")
        else:
            reasons.append(f"{stops} stops")

        confidence = "high"
        dur = o.get("durationMin")
        if dur and best_dur:
            over_h = max(0.0, (dur - best_dur) / 60.0)
            if over_h > 0:
                score -= min(cfg["duration_penalty_cap"], over_h * cfg["duration_penalty_per_hour"])
        elif not dur:
            confidence = "medium"  # incomplete itinerary data → degrade gracefully

        # 3) Airline/alliance — minor modifier only.
        if (o.get("airlineCode") or "") in MM_AIRLINES:
            score += cfg["alliance_bonus"]

        # 4) Absolute reality check.
        band = _below_typical(price, o.get("typicalRange"))
        context = None
        if band == "below":
            score += cfg["below_typical_bonus"]
            any_below_typical = True
        elif band == "low_half":
            score += cfg["within_low_half_bonus"]
        else:
            # Not demonstrably cheap → cannot be Exceptional.
            score = min(score, cfg["expensive_field_cap"])

        # Single-result / weak-field handling.
        if n == 1:
            score = min(score, cfg["single_result_cap"])
            context = "limited_comparison"
            confidence = "low"

        score = int(max(0, min(100, round(score))))
        o["dealScore"] = score
        o["scoreReason"] = " · ".join(reasons)
        o["scoreConfidence"] = confidence
        grade = _cash_grade(score)
        o.update(grade)
        o["scoreContext"] = context

    # Field-wide reality note: best option that is still not actually cheap.
    if n > 1 and not any_below_typical:
        top = max(priced, key=lambda x: x.get("dealScore") or 0)
        if not top.get("scoreContext"):
            top["scoreContext"] = "best_available_not_cheap"

    return offers


def dedup_offers(offers: list[dict]) -> list[dict]:
    seen: dict[tuple, dict] = {}
    for o in offers:
        key = (o.get("dest", ""), (o.get("airlineCode") or o.get("airline", "")).upper())
        existing = seen.get(key)
        if not existing or (o.get("dealScore") or 0) > (existing.get("dealScore") or 0):
            seen[key] = o
    return list(seen.values())


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
        "airlineCode": airline,
        "stops": row.get("transfers", 0),
        "bookUrl": "https://www.aviasales.com" + link if link else links_for(origin, dest, dep, ret).get("Aviasales"),
        "dealScore": deal_score(float(row.get("price") or 0), row.get("transfers", 0), airline),
        "scoreReason": score_reason(float(row.get("price") or 0), row.get("transfers", 0), airline, None),
        "links": links_for(origin, dest, dep, ret),
    }


# --- SerpApi / Google Flights -----------------------------------------------
_SERP_CACHE: dict[tuple, tuple[float, dict]] = {}
CABIN_TO_CLASS = {"economy": 1, "premium eco": 2, "premium economy": 2, "business": 3, "first": 4}


def iata_from_flight_number(flight_number: str) -> str:
    # "LH 401" -> "LH" ; nutzbar für mmOnly-Filter und M&M-Bonus
    m = re.match(r"\s*([A-Z0-9]{2})\s*\d", (flight_number or "").upper())
    return m.group(1) if m else ""


def serpapi_search(origin: str, dest: str, dep: dt.date, ret: dt.date | None, cabin: str, currency: str, lang: str = "de") -> dict:
    """Eine Google-Flights-Suche über SerpApi. Mit TTL-Cache gegen Doppelabrechnung."""
    if not SERPAPI_TOKEN:
        raise RuntimeError("SERPAPI_TOKEN fehlt.")
    travel_class = CABIN_TO_CLASS.get((cabin or "economy").lower(), 1)
    trip_type = "1" if ret else "2"  # 1=Round trip (Preis = Gesamtpreis), 2=One way
    key = (origin, dest, dep.isoformat(), ret.isoformat() if ret else "", travel_class, currency, lang, trip_type)
    now = time.time()
    cached = _SERP_CACHE.get(key)
    if cached and now - cached[0] < SERPAPI_TTL:
        return cached[1]
    params = {
        "engine": "google_flights",
        "api_key": SERPAPI_TOKEN,
        "departure_id": origin,
        "arrival_id": dest,
        "outbound_date": dep.isoformat(),
        "type": trip_type,
        "travel_class": str(travel_class),
        "currency": currency.upper(),
        "hl": "en" if lang == "en" else "de",
        "gl": "de",
        "adults": "1",
    }
    if ret:
        params["return_date"] = ret.isoformat()
    if SERPAPI_DEEP:
        params["deep_search"] = "true"
    # Observability: count only billed calls (cache misses reach this point).
    global _serpapi_paid_calls
    _serpapi_paid_calls += 1
    r = HTTP.get(SERPAPI_BASE, params=params, timeout=30)
    if r.status_code in (402, 429):
        raise QuotaError("Search quota exhausted.")
    r.raise_for_status()
    data = r.json() or {}
    err = data.get("error", "")
    if err:
        if "run out of searches" in err.lower() or "quota" in err.lower():
            raise QuotaError(err)
        raise RuntimeError(err)
    _SERP_CACHE[key] = (now, data)
    return data


def _serp_item_to_offer(item: dict, currency: str, typical_range: list | None, mm_only: bool) -> dict | None:
    segs = item.get("flights") or []
    if not segs:
        return None
    first, last = segs[0], segs[-1]
    origin = (first.get("departure_airport") or {}).get("id", "")
    dest = (last.get("arrival_airport") or {}).get("id", "")
    airline_code = iata_from_flight_number(first.get("flight_number", ""))
    if mm_only and airline_code and airline_code not in MM_AIRLINES:
        return None
    airline_name = first.get("airline") or airline_code
    dep_date = ((first.get("departure_airport") or {}).get("time") or "")[:10]
    stops = max(0, len(segs) - 1)
    price = float(item.get("price") or 0)
    via_airports = [(s.get("arrival_airport") or {}).get("id", "") for s in segs[:-1]] if stops > 0 else []
    return {
        "source": "Google Flights (SerpApi)",
        "price": price,
        "currency": currency.upper(),
        "origin": origin,
        "dest": dest,
        "date": dep_date,
        "returnDate": None,
        "airline": airline_name,
        "airlineCode": airline_code,
        "stops": stops,
        "via": [v for v in via_airports if v],
        "durationMin": item.get("total_duration"),
        "typicalRange": typical_range,
        "bookUrl": links_for(origin, dest, dep_date).get("Google Flights"),
        "dealScore": deal_score(price, stops, airline_code, typical_range),
        "scoreReason": score_reason(price, stops, airline_code, typical_range),
        "links": links_for(origin, dest, dep_date),
    }


def serpapi_offers(origin: str, dest: str, dep: dt.date, ret: dt.date | None, currency: str, mm_only: bool, lang: str = "de", cabin: str = "economy") -> tuple[list[dict], str | None]:
    """Liefert Offers im Karten-Schema (oder Fehlermeldung)."""
    try:
        data = serpapi_search(origin, dest, dep, ret, cabin, currency, lang)
    except QuotaError:
        raise
    except Exception as exc:
        app.logger.warning("serpapi_offers %s→%s: %s", origin, dest, exc)
        return [], str(exc)
    insights = data.get("price_insights") or {}
    typical_range = insights.get("typical_price_range")
    items = (data.get("best_flights") or []) + (data.get("other_flights") or [])
    offers = []
    for item in items:
        offer = _serp_item_to_offer(item, currency, typical_range, mm_only)
        if offer:
            offers.append(offer)
    return offers, None


def serpapi_task(args: tuple) -> tuple[str, str, list[dict], str | None]:
    origin, dest, dep, ret, currency, mm_only, lang, cabin = args
    offers, err = serpapi_offers(origin, dest, dep, ret, currency, mm_only, lang, cabin)
    return origin, dest, offers, err


def flex_date_task(args: tuple) -> tuple[str, list[dict], str | None]:
    origin, dest, check_date, ret, currency, mm_only, lang, cabin = args
    offers, err = serpapi_offers(origin, dest, check_date, ret, currency, mm_only, lang, cabin)
    return check_date.isoformat(), offers, err


# ── Sweet-Spot-Engine V1 ────────────────────────────────────────────────────
# Schätzwerte — Flo prüft echte Chart-Zahlen auf den Programmseiten.

AIRPORT_ZONES: dict[str, str] = {
    **{k: "europe"        for k in ["FRA","MUC","DUS","BER","HAM","CGN","STR","ZRH","VIE",
                                     "LHR","LGW","LCY","STN","CDG","ORY","AMS","MAD","BCN",
                                     "FCO","MXP","ATH","IST","BRU","CPH","ARN","OSL","WAW",
                                     "LIS","HEL","GVA","DUB","PRG","BUD","OTP","TXL"]},
    **{k: "north_america" for k in ["JFK","EWR","LGA","BOS","IAD","ORD","MIA","LAX","SFO",
                                     "SEA","YYZ","YUL","DEN","ATL","DFW","IAH","MSP","DTW"]},
    **{k: "asia"          for k in ["SIN","HKG","BKK","HND","NRT","ICN","TPE","PEK","PVG",
                                     "CAN","KUL","CGK","MNL","SGN","HAN","DEL","BOM","CMB"]},
    **{k: "middle_east"   for k in ["DXB","DOH","AUH","CAI","AMM","BEY","TLV","MCT"]},
    **{k: "pacific"       for k in ["SYD","MEL","BNE","AKL","PER","CHC"]},
    **{k: "south_america" for k in ["GRU","EZE","BOG","LIM","SCL","GIG","MVD"]},
    **{k: "africa"        for k in ["JNB","CPT","NBO","ADD","LOS","CMN","ACC"]},
}

def airport_zone(iata: str) -> str:
    return AIRPORT_ZONES.get((iata or "").upper(), "other")

# one-way Saver miles — Schätzwerte Stand 2024
MM_CHART: dict[tuple, dict[str, int]] = {
    ("europe",        "europe"):        {"Economy": 12500, "Premium Eco": 20000, "Business": 37500, "First": 60000},
    ("europe",        "north_america"): {"Economy": 30000, "Premium Eco": 50000, "Business": 55000, "First": 87500},
    ("europe",        "asia"):          {"Economy": 35000, "Premium Eco": 60000, "Business": 65000, "First": 105000},
    ("europe",        "middle_east"):   {"Economy": 22500, "Premium Eco": 40000, "Business": 45000, "First": 75000},
    ("europe",        "pacific"):       {"Economy": 50000, "Premium Eco": 85000, "Business": 90000, "First": 130000},
    ("europe",        "south_america"): {"Economy": 37500, "Premium Eco": 65000, "Business": 70000, "First": 110000},
    ("europe",        "africa"):        {"Economy": 27500, "Premium Eco": 47500, "Business": 52500, "First": 85000},
    ("north_america", "asia"):          {"Economy": 30000, "Premium Eco": 50000, "Business": 57500, "First": 87500},
    ("north_america", "pacific"):       {"Economy": 40000, "Premium Eco": 70000, "Business": 75000, "First": 115000},
    ("asia",          "pacific"):       {"Economy": 22500, "Premium Eco": 40000, "Business": 45000, "First": 70000},
    ("asia",          "middle_east"):   {"Economy": 17500, "Premium Eco": 30000, "Business": 37500, "First": 55000},
}

AEROPLAN_CHART: dict[tuple, dict[str, int]] = {
    ("europe",        "europe"):        {"Economy": 10000, "Premium Eco": 15000, "Business": 25000, "First": 35000},
    ("europe",        "north_america"): {"Economy": 35000, "Premium Eco": 55000, "Business": 60000, "First": 85000},
    ("europe",        "asia"):          {"Economy": 40000, "Premium Eco": 65000, "Business": 75000, "First": 100000},
    ("europe",        "middle_east"):   {"Economy": 27500, "Premium Eco": 45000, "Business": 55000, "First": 75000},
    ("europe",        "pacific"):       {"Economy": 45000, "Premium Eco": 75000, "Business": 90000, "First": 115000},
    ("europe",        "south_america"): {"Economy": 40000, "Premium Eco": 65000, "Business": 75000, "First": 100000},
    ("europe",        "africa"):        {"Economy": 30000, "Premium Eco": 50000, "Business": 60000, "First": 85000},
    ("north_america", "asia"):          {"Economy": 35000, "Premium Eco": 55000, "Business": 65000, "First": 90000},
    ("north_america", "pacific"):       {"Economy": 40000, "Premium Eco": 65000, "Business": 75000, "First": 100000},
}

UNITED_CHART: dict[tuple, dict[str, int]] = {
    ("europe",        "europe"):        {"Economy": 10000, "Premium Eco": 15000, "Business": 22500, "First": 40000},
    ("europe",        "north_america"): {"Economy": 30000, "Premium Eco": 45000, "Business": 57500, "First": 80000},
    ("europe",        "asia"):          {"Economy": 35000, "Premium Eco": 55000, "Business": 70000, "First": 105000},
    ("europe",        "middle_east"):   {"Economy": 25000, "Premium Eco": 42500, "Business": 50000, "First": 70000},
    ("europe",        "pacific"):       {"Economy": 40000, "Premium Eco": 70000, "Business": 80000, "First": 110000},
    ("europe",        "south_america"): {"Economy": 35000, "Premium Eco": 60000, "Business": 65000, "First": 95000},
    ("north_america", "asia"):          {"Economy": 35000, "Premium Eco": 55000, "Business": 70000, "First": 100000},
    ("north_america", "pacific"):       {"Economy": 40000, "Premium Eco": 65000, "Business": 80000, "First": 105000},
}

# Typical YQ/YR fuel surcharges in EUR per program per dest zone (estimate)
SURCHARGES_EUR: dict[str, dict[str, int]] = {
    "Miles & More": {"europe": 35, "north_america": 280, "asia": 320, "middle_east": 200,
                     "pacific": 380, "south_america": 300, "africa": 250, "other": 200},
    "Aeroplan":     {"europe": 30, "north_america": 55,  "asia": 55,  "middle_east": 55,
                     "pacific": 55,  "south_america": 55,  "africa": 55,  "other": 55},
    "United":       {"europe": 20, "north_america": 20,  "asia": 20,  "middle_east": 20,
                     "pacific": 20,  "south_america": 20,  "africa": 20,  "other": 20},
}

AWARD_PROGRAMS = [
    ("Miles & More", MM_CHART, "https://www.miles-and-more.com/"),
    ("Aeroplan",     AEROPLAN_CHART, "https://www.aircanada.com/aeroplan/redeem/"),
    ("United",       UNITED_CHART, "https://www.united.com/en/us/fsr/choose-flights"),
]

# Typical one-way cash prices (EUR) per dest-zone + cabin — used as fallback when SerpApi has no result
TYPICAL_CASH_EUR: dict[str, dict[str, int]] = {
    "europe":        {"Economy": 200,  "Premium Eco": 380,  "Business": 700,   "First": 1400},
    "north_america": {"Economy": 600,  "Premium Eco": 950,  "Business": 1800,  "First": 3500},
    "asia":          {"Economy": 700,  "Premium Eco": 1100, "Business": 2200,  "First": 5000},
    "middle_east":   {"Economy": 400,  "Premium Eco": 650,  "Business": 1300,  "First": 2800},
    "pacific":       {"Economy": 1000, "Premium Eco": 1600, "Business": 3200,  "First": 7000},
    "south_america": {"Economy": 700,  "Premium Eco": 1100, "Business": 2200,  "First": 5000},
    "africa":        {"Economy": 500,  "Premium Eco": 800,  "Business": 1600,  "First": 3500},
    "other":         {"Economy": 500,  "Premium Eco": 800,  "Business": 1500,  "First": 3000},
}


# seats.aero response field names per cabin class
# (avail, miles, direct, airlines, remaining_seats)
SEATSAERO_CABIN_FIELDS: dict[str, tuple[str, str, str | None, str, str]] = {
    "Economy":    ("YAvailable", "YMileageCost", "YDirect",  "YAirlines", "YRemainingSeats"),
    "Premium Eco":("WAvailable", "WMileageCost", "WDirect",  "WAirlines", "WRemainingSeats"),
    "Business":   ("JAvailable", "JMileageCost", "JDirect",  "JAirlines", "JRemainingSeats"),
    "First":      ("FAvailable", "FMileageCost", None,       "FAirlines", "FRemainingSeats"),
}
SEATSAERO_CABIN_PARAM: dict[str, str] = {
    "Economy": "economy", "Premium Eco": "premium", "Business": "business", "First": "first",
}
SEATSAERO_SOURCE_MAP: dict[str, str] = {
    "united":        "United MileagePlus",
    "aeroplan":      "Air Canada Aeroplan",
    "turkish":       "Turkish Miles&Smiles",
    "singapore":     "Singapore KrisFlyer",
    "lifemiles":     "Avianca LifeMiles",
    "aeromexico":    "Aeromexico Club Premier",
    "delta":         "Delta SkyMiles",
    "virgin":        "Virgin Atlantic",
    "qantas":        "Qantas Frequent Flyer",
    "emirates":      "Emirates Skywards",
    "ana":           "ANA Mileage Club",
    "lufthansa":     "Miles & More",
    "flyingblue":    "Flying Blue",
    "british":       "British Airways Avios",
    "alaska":        "Alaska Mileage Plan",
    "american":      "American AAdvantage",
    "southwest":     "Southwest Rapid Rewards",
    "cathay":        "Cathay Pacific Asia Miles",
    "etihad":        "Etihad Guest",
    "korean":        "Korean Air SKYPASS",
}


def fetch_seatsaero(origin: str, dest: str, cabin: str, dep: dt.date, window_days: int = 3) -> list[dict]:
    """Call seats.aero cached-search API. Returns raw availability rows, or [] on any failure."""
    if not SEATSAERO_KEY:
        return []
    cabin_param = SEATSAERO_CABIN_PARAM.get(cabin, "economy")
    start = (dep - dt.timedelta(days=window_days)).isoformat()
    end   = (dep + dt.timedelta(days=window_days)).isoformat()
    try:
        global _seatsaero_remaining
        # Budget guard: stop if we're running low
        if _seatsaero_remaining is not None and _seatsaero_remaining < 50:
            app.logger.warning("seats.aero budget guard: only %d calls remaining, skipping", _seatsaero_remaining)
            return []
        r = HTTP.get(
            f"{SEATSAERO_BASE}/search",
            params={"origin_airport": origin, "destination_airport": dest,
                    "cabin": cabin_param, "start_date": start, "end_date": end, "take": 50},
            headers={"Partner-Authorization": SEATSAERO_KEY},
            timeout=15,
        )
        # Track remaining budget from header
        remaining_hdr = r.headers.get("X-RateLimit-Remaining")
        if remaining_hdr is not None:
            try:
                _seatsaero_remaining = int(remaining_hdr)
                app.logger.info("seats.aero remaining calls today: %d", _seatsaero_remaining)
            except ValueError:
                pass
        app.logger.info("seats.aero %s→%s %s status=%s remaining=%s", origin, dest, cabin_param, r.status_code, _seatsaero_remaining)
        if r.status_code == 429:
            app.logger.warning("seats.aero 429 — daily limit hit, not retrying")
            return []
        if r.status_code != 200:
            app.logger.warning("seats.aero non-200 body: %s", r.text[:500])
            return []
        rows = r.json().get("data", []) or []
        app.logger.info("seats.aero returned %d rows for %s→%s", len(rows), origin, dest)
        return rows
    except Exception as exc:
        app.logger.warning("seats.aero fetch failed %s→%s %s: %s", origin, dest, cabin, exc)
        return []


def build_seatsaero_programs(
    origin: str, dest: str, cabin: str, dep: dt.date,
    cash_eur: float | None, sa_rows: list[dict],
) -> list[dict]:
    """Build program comparison rows from seats.aero live data."""
    avail_field, miles_field, direct_field, airlines_field, seats_field = SEATSAERO_CABIN_FIELDS.get(
        cabin, ("YAvailable", "YMileageCost", "YDirect", "YAirlines", "YRemainingSeats")
    )
    # Fall back to zone-based typical price so cpm/grade can still be computed
    if not cash_eur:
        dz_fallback = airport_zone(dest)
        cash_eur = TYPICAL_CASH_EUR.get(dz_fallback, {}).get(cabin)
    dz = airport_zone(dest)

    # Best option per source: prefer direct, then fewest miles, then closest date
    by_source: dict[str, dict] = {}
    for row in sa_rows:
        if not row.get(avail_field):
            continue
        src = (row.get("Source") or "").lower()
        miles = int(row.get(miles_field) or 0)
        seats = int(row.get(seats_field) or 0)
        if not miles or not src or (seats == 0 and not row.get(direct_field)):
            continue
        is_direct = bool(row.get(direct_field)) if direct_field else False
        row_date = row.get("Date", "")
        airlines = (row.get(airlines_field) or "").split(",")[0].strip()
        existing = by_source.get(src)
        if not existing:
            by_source[src] = {"miles": miles, "date": row_date, "direct": is_direct, "airlines": airlines, "seats": seats}
        else:
            better = (is_direct and not existing["direct"]) or \
                     (is_direct == existing["direct"] and miles < existing["miles"])
            if better:
                by_source[src] = {"miles": miles, "date": row_date, "direct": is_direct, "airlines": airlines, "seats": seats}

    programs: list[dict] = []
    for src, best in by_source.items():
        prog_name = SEATSAERO_SOURCE_MAP.get(src, src.replace("-", " ").title())
        miles = best["miles"]
        surcharge = SURCHARGES_EUR.get(prog_name, {}).get(dz, 80)
        cpm = calc_cpm(cash_eur, miles, surcharge) if cash_eur else None
        grade = sweet_spot_grade(cpm) if cpm else None
        programs.append({
            "program":        prog_name,
            "miles":          miles,
            "surcharge":      surcharge,
            "cpm":            cpm,
            "grade":          grade,
            "url":            program_verify_url(prog_name),
            "verification_note": program_verify_note(prog_name),
            "verification_level": "manual_program_search",
            "data_source":    "live",
            "available_date": best["date"],
            "direct":         best["direct"],
            "airlines":       best["airlines"],
            "seats":          best["seats"],
        })

    programs.sort(key=lambda x: -(x["cpm"] or 0))
    return programs


def get_miles(chart: dict, oz: str, dz: str, cabin: str) -> int | None:
    for key in [(oz, dz), (dz, oz)]:
        row = chart.get(key)
        if row:
            return row.get(cabin) or row.get("Economy")
    return None


def calc_cpm(cash_eur: float, miles: int, surcharge_eur: float) -> float:
    net = cash_eur - surcharge_eur
    if miles <= 0 or net <= 0:
        return 0.0
    return round(net / miles * 100, 2)


# --- Value tier calibration (single source of truth) ---
# Provisional product calibration by the founder — NOT a universally valid or
# market-standard Miles & More valuation. `sweet_spot_grade()` is the ONLY
# consumer of these boundaries; do not introduce a second CPM/threshold ladder.
# TODO: calibrate with real Miles & More redemption data and founder review
VALUE_TIER_THRESHOLDS: list[tuple[float, str]] = [
    (2.5, "exceptional"),
    (1.8, "great"),
    (1.2, "good"),
    (0.7, "fair"),
]  # cpm below the lowest boundary → "poor"

_TIER_META: dict[str, dict] = {
    "exceptional": {"grade": "A+", "label": "Exceptional Value", "recommendation": "book_miles",
                    "reasoning": "Sehr hoher Meilenwert – weit über dem M&M-Durchschnitt. Meilen-Buchung klar die bessere Wahl."},
    "great":       {"grade": "A",  "label": "Great Value",       "recommendation": "book_miles",
                    "reasoning": "Guter Meilenwert gegenüber dem Cash-Preis. Meilen-Buchung empfohlen."},
    "good":        {"grade": "B",  "label": "Good Value",        "recommendation": "lean_miles",
                    "reasoning": "Solider Meilenwert – Meilen haben leichten Vorteil. Lohnt sich bei ausreichend Meilen."},
    "fair":        {"grade": "C",  "label": "Fair",              "recommendation": "consider",
                    "reasoning": "Knapper Meilenwert – Cash-Alternativen prüfen, bevor du buchst."},
    "poor":        {"grade": "D",  "label": "Weak",              "recommendation": "pay_cash",
                    "reasoning": "Meilenwert zu niedrig – Cash-Buchung ist bei diesem Preis die günstigere Option."},
}


def sweet_spot_grade(cpm: float) -> dict:
    tier = "poor"
    for min_cpm, tier_name in VALUE_TIER_THRESHOLDS:
        if cpm >= min_cpm:
            tier = tier_name
            break
    return {"tier": tier, **_TIER_META[tier]}


_PROG_HOMEPAGES: dict[str, str] = {
    "Miles & More":          "https://www.miles-and-more.com/",
    "Aeroplan":              "https://www.aircanada.com/aeroplan/redeem/",
    "Air Canada Aeroplan":   "https://www.aircanada.com/aeroplan/redeem/",
    "United":                "https://www.united.com/en/us/fsr/choose-flights",
    "United MileagePlus":    "https://www.united.com/en/us/fsr/choose-flights",
    "ANA Mileage Club":      "https://aswbe-i.ana.co.jp/international_asw/pages/award/search/roundTrip/input.xhtml?lang=en",
    "Singapore KrisFlyer":   "https://www.singaporeair.com/en_UK/ppsclub-krisflyer/kf-plan-redeem/",
    "Turkish Miles&Smiles":  "https://www.turkishairlines.com/en-int/miles-and-smiles/award-tickets/",
    "Flying Blue":           "https://www.flyingblue.com/en/spend/flights/award-tickets",
    "British Airways Avios": "https://www.britishairways.com/en-gb/executive-club/spending-avios/redeem-flights",
    "Alaska Mileage Plan":   "https://www.alaskaair.com/content/mileage-plan/use-miles",
    "American AAdvantage":   "https://www.aa.com/booking/choose-flights/1",
    "Cathay Asia Miles":     "https://www.cathaypacific.com/cx/en_HK/asia-miles/use-miles/flights.html",
    "Etihad Guest":          "https://www.etihad.com/en/etihad-guest/earn-and-spend/spend-miles/award-flights",
    "Korean SKYPASS":        "https://www.koreanair.com/us/en/skypass/skypass-award",
}

def program_verify_url(program: str) -> str:
    """Return a stable program page for manual award verification."""
    return _PROG_HOMEPAGES.get(program, "https://www.staralliance.com/en/earn-and-redeem")


def program_verify_note(program: str) -> str:
    """Explain manual verification without implying a guaranteed deep link."""
    if program == "Miles & More":
        return "Miles & More award search can be login- and region-dependent. Open the program site and search manually with the route, date and cabin shown here."
    return "Open the loyalty program site and search manually with the route, date and cabin shown here."


STATIC_AWARD_LIMITATIONS = [
    "Zone-based static estimate, not observed award availability.",
    "Taxes and surcharges are typical estimates, not live priced.",
    "No seat count, last-seen timestamp, married-segment logic, or program-specific availability rules.",
    "Values are normalized per direction / one-way unless a caller explicitly marks otherwise.",
]


def _date_iso(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value) if value else None


def _award_source_mode() -> str:
    mode = (AWARD_SOURCE or "estimated").strip().lower()
    if mode in {"estimated", "estimate", "static", "static_estimate"}:
        return "static"
    if mode == "seatsaero":
        return "seatsaero"
    return "static"


class AwardSource:
    name = "AwardSource"
    source_type = "unknown"

    def search(
        self,
        origin: str,
        dest: str,
        cabin: str,
        cash_eur: float | None,
        dep,
        ret=None,
        trip_type: str = "one_way",
        currency: str = "EUR",
    ) -> list[dict]:
        raise NotImplementedError


class StaticAwardSource(AwardSource):
    name = "StaticAwardSource"
    source_type = "static_estimate"

    def search(
        self,
        origin: str,
        dest: str,
        cabin: str,
        cash_eur: float | None,
        dep,
        ret=None,
        trip_type: str = "one_way",
        currency: str = "EUR",
    ) -> list[dict]:
        oz, dz = airport_zone(origin), airport_zone(dest)
        effective_cash = cash_eur or TYPICAL_CASH_EUR.get(dz, {}).get(cabin)
        departure_date = _date_iso(dep) or ""
        return_date = _date_iso(ret)
        results: list[dict] = []

        for name, chart, url in AWARD_PROGRAMS:
            miles = get_miles(chart, oz, dz, cabin)
            if not miles:
                continue
            surcharge = SURCHARGES_EUR.get(name, {}).get(dz, 100)
            cpm = calc_cpm(effective_cash, miles, surcharge) if effective_cash else None
            grade = sweet_spot_grade(cpm) if cpm else None
            verify_url = program_verify_url(name)
            results.append({
                "program": name,
                "miles": miles,
                "miles_required": miles,
                "surcharge": surcharge,
                "taxes_fees": surcharge,
                "currency": currency,
                "cpm": cpm,
                "grade": grade,
                "url": verify_url,
                "verification_note": program_verify_note(name),
                "verification_level": "manual_program_search",
                "data_source": "estimated",
                "source": self.name,
                "source_type": self.source_type,
                "origin": origin,
                "destination": dest,
                "departure_date": departure_date,
                "return_date": return_date,
                "trip_type": "one_way",
                "requested_trip_type": trip_type,
                "cabin": cabin,
                "is_estimate": True,
                "is_live_data": False,
                "fetched_at": None,
                "last_seen_at": None,
                "freshness_label": "estimate",
                "confidence_level": "low",
                "provider_limitations": STATIC_AWARD_LIMITATIONS,
            })

        results.sort(key=lambda x: -(x["cpm"] or 0))
        return results


STATIC_AWARD_SOURCE = StaticAwardSource()


def build_program_comparison(origin: str, dest: str, cabin: str, cash_eur: float | None, dep: str = "") -> list[dict]:
    return STATIC_AWARD_SOURCE.search(origin, dest, cabin, cash_eur, dep, trip_type="one_way")


def award_source_metadata() -> dict:
    mode = _award_source_mode()
    live_source_enabled = mode == "seatsaero" and bool(SEATSAERO_KEY)
    return {
        "configured_source": AWARD_SOURCE or "estimated",
        "active_static_source": STATIC_AWARD_SOURCE.name,
        "provider_mode": mode,
        "live_source_enabled": live_source_enabled,
        "supports_global_credentials": mode == "seatsaero",
        "supports_user_credentials": False,
    }


# ===== Decision Engine Level 1 =====
# Turns external cash-fare context + award estimate into ONE trip-basis-safe
# verdict. Reuses calc_cpm() + sweet_spot_grade() as the only valuation logic —
# no parallel score/CPM ladder (Guardrail B).

def cash_source_metadata() -> dict:
    """Provider metadata for the current CashFareSource, mirroring award_source_metadata()."""
    has_serp = bool(SERPAPI_TOKEN)
    return {
        "provider": "serpapi" if has_serp else "none",
        "source": "Google Flights (SerpApi)" if has_serp else "zone_estimate",
        "source_type": "external_cash_context",
        "plan_hint": "serpapi_starter_1000_per_month" if has_serp else None,
    }


def assess_cash_level(price, typical_range) -> str:
    """Decision-Engine view of the cash fare's position vs the typical range.

    Reuses the relative-cash foundation `_below_typical()` — the single source of
    the price-vs-typical assessment — instead of recomputing it independently.
    """
    return {
        "below": "below_typical",
        "low_half": "within_typical",
        "within": "within_typical",
        "above": "above_typical",
        "unknown": "unknown",
    }[_below_typical(price, typical_range)]


def normalize_trip_basis(cash_trip_type, award_trip_type, requested_trip_type) -> dict:
    """Guardrail A: cash and award must describe the same direction before any CPM use.

    Never allow a round-trip cash price to be divided by a one-way mileage number.
    When a safe normalization is not possible, no value score is faked.
    """
    ct = cash_trip_type or "unknown"
    at = award_trip_type or "unknown"
    out = {
        "cash_trip_type": ct,
        "award_trip_type": at,
        "normalized_trip_type": None,
        "trip_basis_compatible": False,
        "confidence_penalty": 0,
        "note": None,
    }
    if ct == "unknown" or at == "unknown":
        out["note"] = "Trip-Basis nicht eindeutig vergleichbar – kein belastbarer Meilenwert."
        return out
    if ct == at:
        out["normalized_trip_type"] = ct
        out["trip_basis_compatible"] = True
        if requested_trip_type and requested_trip_type != ct:
            # We computed on one direction while the search asked for round-trip.
            out["confidence_penalty"] = 1
            out["note"] = ("Bewertung auf Basis einer Richtung (one-way), "
                           "die Suche war round-trip – Werte gelten pro Richtung.")
        else:
            out["note"] = f"Cash und Meilen auf {ct.replace('_', ' ')}-Basis verglichen."
        return out
    # e.g. round-trip cash vs one-way award — not safely normalizable here.
    out["note"] = ("Cash- und Meilen-Basis unterschiedlich (round-trip vs. one-way) – "
                   "keine sichere Normalisierung, daher kein Meilenwert ausgewiesen.")
    return out


# Cautious internal value signals → visible, non-committal English labels.
_SIGNAL_LABEL = {
    "strong_miles_value":   "Miles may make sense here",
    "promising_miles_value": "Estimated value looks promising",
    "mixed_value":          "The comparison is currently mixed",
    "cash_may_be_stronger": "Cash may be stronger here",
    "insufficient_data":    "Not enough data for a reliable comparison",
}
# Award value tier (from sweet_spot_grade) → decision signal. Cash side is trusted
# input; the Decision Engine never recomputes the cash score itself.
_TIER_SIGNAL = {
    "exceptional": "strong_miles_value",
    "great":       "strong_miles_value",
    "good":        "promising_miles_value",
    "fair":        "mixed_value",
    "poor":        "cash_may_be_stronger",
}
_VERIFY_GUIDANCE = ("Confirm final availability, mileage price, taxes and fees with "
                    "the official airline or loyalty program.")


def _freshness_label(is_live_award: bool, cash_is_real: bool) -> str:
    award = "Award data signal" if is_live_award else "Award estimate"
    cash = "cash context checked recently" if cash_is_real else "no live cash context"
    return f"{award} · {cash.capitalize()}"


def build_decision(best: dict | None, cash_eur, cash_is_real: bool,
                   cash_level: str, requested_trip_type: str) -> dict:
    """Assemble the Level-1 decision block for the best program on a route.

    Additive shape (existing keys preserved): also emits `signal`, `label`,
    `estimated_value`, `confidence_reason`, `freshness_label`,
    `verification_guidance`. Consumes the trusted cash input; never recomputes it.
    """
    cash_trip = "one_way" if cash_eur else "unknown"   # fetch_cash_details always one-way
    award_trip = (best or {}).get("trip_type", "unknown")
    basis = normalize_trip_basis(cash_trip, award_trip, requested_trip_type)
    is_live = bool(best) and best.get("data_source") == "live"

    decision = {
        # existing keys (unchanged, additive contract)
        "verdict": "insufficient_data",
        "tier": None,
        "confidence": "low",
        "explanation": "",
        "cash_trip_type": basis["cash_trip_type"],
        "award_trip_type": basis["award_trip_type"],
        "normalized_trip_type": basis["normalized_trip_type"],
        "trip_basis_compatible": basis["trip_basis_compatible"],
        "cash_source": cash_source_metadata()["source"],
        "cash_level": cash_level,
        "cash_freshness": "live_query" if cash_is_real else ("estimate" if cash_eur else "none"),
        # new Level-1 fields
        "signal": "insufficient_data",
        "label": _SIGNAL_LABEL["insufficient_data"],
        "estimated_value": None,
        "confidence_reason": "",
        "freshness_label": _freshness_label(is_live, cash_is_real),
        "verification_guidance": _VERIFY_GUIDANCE,
    }

    if not best:
        decision["explanation"] = "No award option was found for this route."
        decision["confidence_reason"] = "No award availability or estimate to compare."
        return decision

    # No observed cash context → cannot compare; availability only.
    if not cash_eur or best.get("cpm") is None:
        decision["verdict"] = "availability_only"
        decision["explanation"] = ("Award availability is visible, but there is no cash "
                                   "context to compare against, so no mileage value is shown.")
        decision["confidence_reason"] = "Missing cash fare context for this route."
        return decision

    # Trip basis not safely comparable → no value signal (Guardrail A).
    if not basis["trip_basis_compatible"]:
        decision["explanation"] = ("Cash and miles could not be normalized to the same "
                                   "trip direction, so no mileage value is shown.")
        decision["confidence_reason"] = "Incompatible or unclear trip basis (cash vs award)."
        return decision

    # Compatible basis → reuse the single award valuation ladder (sweet_spot_grade).
    grade = best.get("grade") or sweet_spot_grade(best["cpm"])
    signal = _TIER_SIGNAL.get(grade["tier"], "mixed_value")
    decision["tier"] = grade["tier"]
    decision["verdict"] = grade["recommendation"]   # legacy key kept
    decision["signal"] = signal
    decision["label"] = _SIGNAL_LABEL[signal]
    decision["estimated_value"] = round(best["cpm"], 1)

    # Confidence reflects input quality: award liveness + real cash − basis assumption.
    score = (2 if is_live else 1) + (1 if cash_is_real else 0) - basis["confidence_penalty"]
    decision["confidence"] = "high" if score >= 3 else ("medium" if score == 2 else "low")
    reasons = []
    reasons.append("live award data" if is_live else "static award estimate")
    reasons.append("recent cash context" if cash_is_real else "no live cash context")
    if basis["confidence_penalty"]:
        reasons.append("per-direction trip-basis assumption")
    reasons.append("official availability not yet confirmed")
    decision["confidence_reason"] = "; ".join(reasons)

    # Visible "why" — cautious English, names the trip basis.
    why = {
        "strong_miles_value":   "The estimated cash fare is relatively high compared with the estimated mileage requirement.",
        "promising_miles_value": "The estimated mileage requirement compares reasonably well with the estimated cash fare.",
        "mixed_value":          "Cash and miles are currently close in estimated value.",
        "cash_may_be_stronger": "The mileage requirement is high relative to the estimated cash fare, so cash may be the simpler choice.",
    }[signal]
    extra = ""
    if cash_level == "below_typical":
        extra = " The cash fare is already low for this search."
    elif cash_level == "above_typical":
        extra = " The cash fare is high for this search."
    perdir = ""
    if basis["confidence_penalty"]:
        perdir = " Values are compared per direction (one-way) while the search was round-trip."
    decision["explanation"] = (
        f"About {best['cpm']:.1f} cents per mile. " + why + extra + perdir
    )
    return decision


def _fmt_duration(minutes: int | None) -> str | None:
    if not minutes:
        return None
    h, m = divmod(int(minutes), 60)
    return f"{h}h {m:02d}m" if m else f"{h}h"


def fetch_cash_details(origin: str, dest: str, dep: dt.date, cabin: str, currency: str = "EUR") -> dict:
    """Quick SerpApi lookup — returns {price, dep_time, arr_time, duration, stops, flight_number} for cheapest flight."""
    empty: dict = {}
    if not SERPAPI_TOKEN:
        return empty
    try:
        data = serpapi_search(origin, dest, dep, None, cabin, currency)
        items = (data.get("best_flights") or []) + (data.get("other_flights") or [])
        if not items:
            return empty
        best = min((it for it in items if it.get("price")), key=lambda x: float(x["price"]), default=None)
        if not best:
            return empty
        segs = best.get("flights") or []
        first = segs[0] if segs else {}
        last  = segs[-1] if segs else {}
        dep_time_raw = ((first.get("departure_airport") or {}).get("time") or "")
        arr_time_raw = ((last.get("arrival_airport")  or {}).get("time") or "")
        dep_time = dep_time_raw[11:16] if len(dep_time_raw) > 10 else None
        arr_time = arr_time_raw[11:16] if len(arr_time_raw) > 10 else None
        stops = max(0, len(segs) - 1)
        flight_number = first.get("flight_number") or None
        via = [((s.get("arrival_airport") or {}).get("id") or "") for s in segs[:-1]] if stops > 0 else []
        # Full per-segment data for Itinerary Intelligence (Sprint 2B)
        segments = []
        for seg in segs:
            da = seg.get("departure_airport") or {}
            aa = seg.get("arrival_airport") or {}
            dt_raw = da.get("time") or ""
            at_raw = aa.get("time") or ""
            segments.append({
                "flight_number": seg.get("flight_number"),
                "airline":       seg.get("airline"),
                "aircraft":      seg.get("airplane"),
                "dep_iata":      da.get("id"),
                "dep_time":      dt_raw[11:16] if len(dt_raw) > 10 else None,
                "arr_iata":      aa.get("id"),
                "arr_time":      at_raw[11:16] if len(at_raw) > 10 else None,
                "duration_min":  seg.get("duration"),
                "overnight":     seg.get("overnight", False),
            })
        layovers = [
            {"iata": l.get("id"), "duration_min": l.get("duration"), "overnight": l.get("overnight", False)}
            for l in (best.get("layovers") or [])
        ]
        # Relative cash context — same response, no extra provider call.
        insights = data.get("price_insights") or {}
        typical_range = insights.get("typical_price_range")
        return {
            "price":         float(best["price"]),
            "dep_time":      dep_time,
            "arr_time":      arr_time,
            "duration":      _fmt_duration(best.get("total_duration")),
            "duration_min":  best.get("total_duration"),
            "stops":         stops,
            "via":           [v for v in via if v],
            "flight_number": flight_number,
            "segments":      segments,
            "layovers":      layovers,
            "typical_range": typical_range,
            "cash_trip_type": "one_way",
        }
    except QuotaError:
        raise
    except Exception:
        return empty


def fetch_cash_price(origin: str, dest: str, dep: dt.date, cabin: str, currency: str = "EUR") -> float | None:
    """Wrapper kept for compatibility — returns price only."""
    d = fetch_cash_details(origin, dest, dep, cabin, currency)
    return d.get("price")


def award_links(origin: str, dest: str, dep: str, ret: str | None, cabin: str) -> dict:
    return {}


@app.route("/")
def index():
    return render_template("index.html", app_name=APP_NAME, tagline=TAGLINE, version="v6.0")


@app.route("/impressum")
def impressum():
    return render_template("impressum.html")


@app.route("/datenschutz")
def datenschutz():
    return render_template("datenschutz.html")


@app.route("/robots.txt")
def robots():
    body = "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://awardradar.app/sitemap.xml\n"
    return make_response(body, 200, {"Content-Type": "text/plain"})


@app.route("/sitemap.xml")
def sitemap():
    today = dt.date.today().isoformat()
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://awardradar.app/</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://awardradar.app/impressum</loc><lastmod>{today}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
  <url><loc>https://awardradar.app/datenschutz</loc><lastmod>{today}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>"""
    return make_response(body, 200, {"Content-Type": "application/xml"})


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

    cabin = (data.get("cabins") or ["economy"])[0].lower()
    flex_days = min(int(data.get("flexDays", 0)), FLEX_MAX_DAYS)
    use_serpapi = PRICE_SOURCE == "serpapi" and bool(SERPAPI_TOKEN)
    started = time.time()
    offers, warnings = [], []
    calendar: list[dict] = []

    if use_serpapi:
        pairs = [(o, d) for o in origins[:2] for d in dests[:2] if o != d][:SERPAPI_MAX_PAIRS]
        tasks = [(o, d, dep, ret, currency, mm_only, lang, cabin) for o, d in pairs]
        try:
            with cf.ThreadPoolExecutor(max_workers=min(SERPAPI_MAX_PAIRS, max(1, len(tasks)))) as pool:
                for origin, dest, found, err in pool.map(serpapi_task, tasks):
                    if err:
                        app.logger.warning("cheap %s→%s: %s", origin, dest, err)
                    else:
                        offers.extend(found)
        except QuotaError:
            return jsonify({"ok": False, "error": "quota_exhausted"}), 503

        if flex_days > 0 and origins and dests:
            flex_origin, flex_dest = origins[0], dests[0]
            date_range = [dep + dt.timedelta(days=i) for i in range(-flex_days, flex_days + 1)]
            flex_tasks = [(flex_origin, flex_dest, d, ret, currency, mm_only, lang, cabin) for d in date_range]
            with cf.ThreadPoolExecutor(max_workers=min(len(flex_tasks), 7)) as pool:
                for date_str, found, _err in pool.map(flex_date_task, flex_tasks):
                    if found:
                        best = min(found, key=lambda x: x.get("price") or 99999)
                        calendar.append({
                            "date": date_str,
                            "price": best.get("price"),
                            "currency": best.get("currency", currency.upper()),
                            "dealScore": best.get("dealScore"),
                            "airline": best.get("airline"),
                            "airlineCode": best.get("airlineCode"),
                            "stops": best.get("stops"),
                            "isSelected": date_str == dep.isoformat(),
                        })
            calendar.sort(key=lambda x: x["date"])
            if calendar:
                prices = [c["price"] for c in calendar if c.get("price")]
                best_price = min(prices) if prices else None
                for c in calendar:
                    c["isBest"] = bool(best_price and c.get("price") == best_price)

        note_key = "cheap_note_live"
    else:
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
        note_key = "cheap_note"

    # Deduplizieren (gleiche Airline + Ziel), dann relativ zum Ergebnis-Set
    # bewerten (zentrale Cash Result Intelligence), dann sortieren.
    offers = dedup_offers(offers)
    offers = rescore_offer_set(offers)
    offers.sort(key=lambda x: (-(x.get("dealScore") or 0), x.get("price") or 10**9))
    fallback = [{"route": f"{o} → {d}", "links": links_for(o, d, dep.isoformat(), ret.isoformat() if ret else None)} for o in origins[:2] for d in dests[:3] if o != d]
    return jsonify({
        "ok": True,
        "offers": offers[:8],
        "calendar": calendar,
        "fallback": fallback,
        "warnings": [],
        "debug": {"origins": origins, "dests": dests, "seconds": round(time.time() - started, 2), "source": PRICE_SOURCE if use_serpapi else "travelpayouts"},
        "note": tx(note_key, lang),
    })


def verify_skiplag_serpapi(origin: str, true_dest: str, final_dest: str, dep: dt.date, currency: str, lang: str) -> dict | None:
    """Search origin→final_dest via SerpApi; return verification data if true_dest appears as layover."""
    try:
        data = serpapi_search(origin, final_dest, dep, None, "economy", currency, lang)
    except QuotaError:
        raise
    except Exception:
        return None
    insights = data.get("price_insights") or {}
    typical_range = insights.get("typical_price_range")
    all_flights = (data.get("best_flights") or []) + (data.get("other_flights") or [])
    for flight in all_flights:
        segs = flight.get("flights") or []
        if len(segs) < 2:
            continue
        layover_ids = [(s.get("arrival_airport") or {}).get("id", "") for s in segs[:-1]]
        if true_dest not in layover_ids:
            continue
        price = float(flight.get("price") or 0)
        first_seg = segs[0]
        airline_code = iata_from_flight_number(first_seg.get("flight_number", ""))
        airline_name = first_seg.get("airline") or airline_code
        layovers = flight.get("layovers") or []
        layover_at_hidden = next((l for l in layovers if (l.get("id") or "") == true_dest), {})
        all_airports = [(s.get("departure_airport") or {}).get("id", "?") for s in segs] + [(segs[-1].get("arrival_airport") or {}).get("id", "?")]
        seg_chain = " → ".join(dict.fromkeys(all_airports))  # deduplicate consecutive identical
        return {
            "verified": True,
            "candidatePrice": price,
            "currency": currency.upper(),
            "airline": airline_name,
            "airlineCode": airline_code,
            "stops": len(segs) - 1,
            "layoverDuration": layover_at_hidden.get("duration"),
            "segmentChain": seg_chain,
            "typicalRange": typical_range,
            "links": {
                "Google Flights (ticket)": links_for(origin, final_dest, dep.isoformat()).get("Google Flights", ""),
                "Skiplagged": f"https://skiplagged.com/flights/{origin}/{true_dest}/{dep.isoformat()}",
                "Kayak": links_for(origin, final_dest, dep.isoformat()).get("Kayak", ""),
                "Momondo": links_for(origin, final_dest, dep.isoformat()).get("Momondo", ""),
            },
        }
    return None


@app.route("/api/skiplag", methods=["POST"])
def skiplag():
    try:
        return _skiplag_inner()
    except QuotaError:
        return jsonify({"ok": False, "error": "quota_exhausted"}), 503
    except Exception as exc:
        app.logger.error("skiplag unhandled: %s", exc, exc_info=True)
        return jsonify({"ok": False, "error": "analysis_unavailable"}), 500

def _skiplag_inner():
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
    use_serpapi = PRICE_SOURCE == "serpapi" and bool(SERPAPI_TOKEN)

    for origin in origins[:2]:
        for true_dest in true_dests[:2]:
            # Normal price for savings comparison (cheap TP call)
            normal_price = 0
            try:
                normal_rows = tp_prices(origin, true_dest, dep, None, False, currency=currency, limit=5, timeout=12)
                normal_price = cheapest_price(normal_rows)
            except Exception as exc:
                app.logger.debug("skiplag normal price %s→%s: %s", origin, true_dest, exc)

            if use_serpapi:
                candidates = [e for e in SKIPLAG_ENDINGS if e not in (origin, true_dest)][:SKIPLAG_MAX_SEARCHES]

                def _verify(final_dest: str) -> tuple[str, dict | None]:
                    return final_dest, verify_skiplag_serpapi(origin, true_dest, final_dest, dep, currency, lang)

                try:
                    with cf.ThreadPoolExecutor(max_workers=min(SKIPLAG_MAX_SEARCHES, max(1, len(candidates)))) as pool:
                        for final_dest, v in pool.map(_verify, candidates):
                            if not v:
                                continue
                            savings = (normal_price - v["candidatePrice"]) if normal_price and v["candidatePrice"] else None
                            results.append({
                                "origin": origin,
                                "hiddenCity": true_dest,
                                "ticketDestination": final_dest,
                                "date": dep.isoformat(),
                                "normalPrice": normal_price or None,
                                "candidatePrice": v["candidatePrice"],
                                "currency": v["currency"],
                                "savings": savings,
                                "airline": v.get("airline"),
                                "airlineCode": v.get("airlineCode"),
                                "stops": v.get("stops"),
                                "layoverDuration": v.get("layoverDuration"),
                                "segmentChain": v.get("segmentChain"),
                                "verified": True,
                                "confidence": "verification context" if lang == "en" else "Verifizierungskontext",
                                "candidateLabel": "Overlooked routing signal" if lang == "en" else "Overlooked-Routing-Signal",
                                "verifyRouting": tx("verify_routing", lang),
                                "links": v.get("links", {}),
                            })
                except QuotaError:
                    return jsonify({"ok": False, "error": "quota_exhausted"}), 503
            else:
                # Fallback: TP candidate logic
                candidate_endings = SKIPLAG_ENDINGS[:SKIPLAG_MAX_CANDIDATES]
                tasks = [(origin, fd, dep, None, False, currency, 5) for fd in candidate_endings if fd not in (origin, true_dest)]
                with cf.ThreadPoolExecutor(max_workers=min(SKIPLAG_MAX_WORKERS, max(1, len(tasks)))) as pool:
                    for _o, final_dest, rows, err in pool.map(tp_price_task, tasks):
                        price = 0 if err else cheapest_price(rows or [])
                        savings = (normal_price - price) if normal_price and price else None
                        if savings is None or savings > 0:
                            results.append({
                                "origin": origin,
                                "hiddenCity": true_dest,
                                "ticketDestination": final_dest,
                                "date": dep.isoformat(),
                                "normalPrice": normal_price or None,
                                "candidatePrice": price or None,
                                "savings": savings,
                                "verified": False,
                                "confidence": tx("high", lang) if savings and savings > 50 else (tx("check", lang) if price else tx("link_check", lang)),
                                "candidateLabel": tx("candidate_label", lang),
                                "verifyRouting": tx("verify_routing", lang),
                                "links": {
                                    "Skiplagged": f"https://skiplagged.com/flights/{origin}/{true_dest}/{dep.isoformat()}",
                                    tx("google_via", lang): f"https://www.google.com/travel/flights?q={quote_plus(f'{origin} to {final_dest} via {true_dest} {dep.isoformat()}')}",
                                    tx("ticket_check", lang): links_for(origin, final_dest, dep.isoformat())["Google Flights"],
                                },
                            })

    results.sort(key=lambda x: (0 if x.get("verified") else 1, -(x.get("savings") or -9999)))
    note = ("Verification context from fare-source segments. One-way only · no checked baggage · verify airline T&Cs." if lang == "en" else "Verifizierungskontext aus Preisquellen-Segmenten. Nur Hinflug · kein Aufgabegepäck · AGB der Airline prüfen.") if use_serpapi else tx("skiplag_note", lang)
    return jsonify({
        "ok": True,
        "results": results[:10],
        "provider_available": use_serpapi or bool(results),
        "note": note,
    })


@app.route("/api/awards", methods=["POST"])
def awards():
    try:
        return _awards_inner()
    except QuotaError:
        # Cash quota exhausted AND somehow not caught inside — return 503 only as last resort
        return jsonify({"ok": False, "error": "quota_exhausted"}), 503
    except Exception as exc:
        app.logger.error("awards unhandled: %s", exc, exc_info=True)
        return jsonify({"ok": False, "error": "analysis_unavailable"}), 500


def _awards_inner():
    data = request.get_json(force=True) or {}
    lang = lang_from_payload(data)
    origins = resolve_codes(data.get("origin", ""))
    dests   = resolve_codes(data.get("dest",   ""))
    dep     = parse_date(data.get("date", ""), 60)
    one_way = bool(data.get("oneWay", True))
    ret     = None if one_way else parse_date(data.get("returnDate", ""), 67)
    cabin   = data.get("cabin") or (data.get("cabins") or ["Economy"])[0]
    if not origins or not dests:
        return jsonify({"ok": False, "error": tx("missing_origin_dest", lang)}), 400

    trip_type = "one_way" if one_way else "round_trip"
    award_source_meta = award_source_metadata()
    use_seatsaero = award_source_meta["provider_mode"] == "seatsaero" and bool(SEATSAERO_KEY)
    results = []

    for origin in origins[:4]:
        for dest in dests[:3]:
            if origin == dest:
                continue
            try:
                cash_details = fetch_cash_details(origin, dest, dep, cabin)
            except QuotaError:
                cash_details = {}   # SerpApi quota empty — use zone fallback, don't abort
            cash_eur = cash_details.get("price")

            # Live availability from seats.aero (if configured)
            if use_seatsaero:
                sa_rows = fetch_seatsaero(origin, dest, cabin, dep)
                live_programs = build_seatsaero_programs(origin, dest, cabin, dep, cash_eur, sa_rows)
            else:
                live_programs = []

            # Static estimates are routed through the AwardSource boundary.
            est_programs = STATIC_AWARD_SOURCE.search(origin, dest, cabin, cash_eur, dep, ret, trip_type=trip_type)

            # Merge: live programs first; skip estimated duplicates by program name
            live_names = {p["program"] for p in live_programs}
            combined = live_programs + [p for p in est_programs if p["program"] not in live_names]
            combined.sort(key=lambda x: (0 if x.get("data_source") == "live" else 1, -(x.get("cpm") or 0)))

            best = next((p for p in combined if p.get("grade") and p["grade"]["tier"] in ("exceptional", "great")), None)
            flight_info = {k: v for k, v in cash_details.items() if k != "price"} if cash_details else None

            # Decision Engine Level 1 — trip-basis-safe verdict on the top program.
            top = combined[0] if combined else None
            cash_level = assess_cash_level(cash_eur, cash_details.get("typical_range"))
            decision = build_decision(top, cash_eur, bool(cash_eur), cash_level, trip_type)

            results.append({
                "route":          f"{origin} → {dest}",
                "origin":         origin,
                "dest":           dest,
                "date":           dep.isoformat(),
                "returnDate":     ret.isoformat() if ret else None,
                "cabin":          cabin,
                "cash_eur":       round(cash_eur, 0) if cash_eur else None,
                "cash_level":     cash_level,
                "cash_source":    cash_source_metadata(),
                "flight":         flight_info,
                "programs":       combined,
                "best_program":   best["program"] if best else None,
                "has_live_data":  bool(live_programs),
                "award_source":   award_source_meta,
                "decision":       decision,
                "links":          award_links(origin, dest, dep.isoformat(), ret.isoformat() if ret else None, cabin),
            })

    if use_seatsaero and any(r["has_live_data"] for r in results):
        note = "Award redemption data signal · Verify before purchase"
    elif use_seatsaero:
        note = "No current availability signal found for this route · Showing estimated values"
    else:
        note = "Estimated values · Verify before purchase"

    return jsonify({"ok": True, "results": results, "note": note, "award_source": award_source_meta})


def score_award(origin: str, dest: str, cabin: str, lang: str = "de") -> dict:
    longhaul = dest in {"JFK", "EWR", "BOS", "YYZ", "YUL", "SIN", "HKG", "BKK", "HND", "NRT", "LAX", "SFO", "SEA", "DXB", "DOH", "ICN", "TPE", "SYD", "MEL"}
    if lang == "en":
        if cabin == "Economy":
            return {"label": "🟢 good chance", "text": "Economy award redemptions may be available, but compare cents-per-mile value against cash fare context."}
        if cabin == "Premium Eco":
            return {"label": "🟡 interesting", "text": "Premium Economy can be a useful sweet spot, especially on long-haul routes."}
        if cabin == "Business" and longhaul:
            return {"label": "🟡 hunt", "text": "Business is possible, but search flexibly: ±7 days and multiple airports."}
        if cabin == "First":
            return {"label": "🔴 rare", "text": "First depends heavily on airline and last-minute release patterns."}
        return {"label": "🟢 solid", "text": "Short-haul award redemptions may be easier, but compare against cash fare context."}
    if cabin == "Economy":
        return {"label": "🟢 gute Chance", "text": "Eco-Award-Redemptions können verfügbar sein; Wert pro Meile aber mit Cash-Fare-Kontext vergleichen."}
    if cabin == "Premium Eco":
        return {"label": "🟡 interessant", "text": "Premium Eco kann einen guten Award-Redemption-Wert bieten, vor allem auf Langstrecke."}
    if cabin == "Business" and longhaul:
        return {"label": "🟡 jagen", "text": "Business ist möglich, aber flexibel suchen: ±7 Tage und mehrere Airports."}
    if cabin == "First":
        return {"label": "🔴 selten", "text": "First ist stark abhängig von Airline und kurzfristiger Freigabe."}
    return {"label": "🟢 solide", "text": "Kurzstrecke eher verfügbar, aber Cashpreise vergleichen."}


# Popular longhaul routes for the Discovery widget — DACH-first, kept small to protect daily budget.
# Max 8 routes × 3 Gunicorn workers = 24 calls per cold-start worst case.
# Expand only after file-based shared cache is in place.
TOP_OPP_ROUTES: list[tuple[str, str, str]] = [
    ("FRA", "JFK", "Business"), ("FRA", "HND", "Business"), ("FRA", "SIN", "Business"),
    ("MUC", "JFK", "Business"), ("MUC", "SIN", "Business"),
    ("ZRH", "HND", "Business"),
    ("FRA", "JFK", "First"),    ("FRA", "HND", "First"),
]

TOP_OPP_TTL   = 14400  # 4h
_TOP_OPP_FILE = "/tmp/awardradar_top_opportunities_cache.json"
_TOP_OPP_LOCK = __import__("threading").Lock()   # guards the scan (one scan at a time per worker)


def _read_file_cache() -> list | None:
    """Return cached opportunities if file exists and is fresh, else None."""
    try:
        import json as _json
        p = __import__("pathlib").Path(_TOP_OPP_FILE)
        if not p.exists():
            return None
        data = _json.loads(p.read_text())
        if time.time() - data["ts"] < TOP_OPP_TTL:
            return data["opportunities"]
    except Exception:
        pass
    return None


def _write_file_cache(opportunities: list) -> None:
    """Atomic write: temp file → rename, so readers never see partial data."""
    try:
        import json as _json, pathlib, tempfile, os
        payload = _json.dumps({"ts": time.time(), "opportunities": opportunities})
        tmp = _TOP_OPP_FILE + ".tmp"
        pathlib.Path(tmp).write_text(payload)
        os.replace(tmp, _TOP_OPP_FILE)
    except Exception as exc:
        app.logger.warning("top-opp file cache write failed: %s", exc)


@app.route("/api/top-opportunities")
def top_opportunities():
    # 1. Try shared file cache first — all workers share this
    cached = _read_file_cache()
    if cached is not None:
        return jsonify({"ok": True, "opportunities": cached, "source": "cache"})

    if not (AWARD_SOURCE == "seatsaero" and SEATSAERO_KEY):
        return jsonify({"ok": False, "error": "seats.aero not configured"}), 503

    # 2. Lock prevents concurrent scans within the same worker process
    if not _TOP_OPP_LOCK.acquire(blocking=False):
        # Another thread in this worker is already scanning — wait briefly and try cache again
        _TOP_OPP_LOCK.acquire(blocking=True, timeout=30)
        _TOP_OPP_LOCK.release()
        cached = _read_file_cache()
        if cached is not None:
            return jsonify({"ok": True, "opportunities": cached, "source": "cache"})

    today = dt.date.today()
    dep = today + dt.timedelta(days=30)  # midpoint for cash price lookup
    results: list[dict] = []

    rate_lock = __import__("threading").Semaphore(2)  # max 2 concurrent seats.aero calls

    def scan_route(args: tuple) -> list[dict]:
        origin, dest, cabin = args
        with rate_lock:
            try:
                time.sleep(2.0)  # 2s spacing → max ~30 calls/min, well within daily budget
                rows = fetch_seatsaero(origin, dest, cabin, dep, window_days=30)
            except Exception:
                rows = []
        if not rows:
            return []
        try:
            cash = None  # Discovery scan uses zone fallback only — never burns SerpApi budget
            programs = build_seatsaero_programs(origin, dest, cabin, dep, cash, rows)
            out = []
            for p in programs:
                g = p.get("grade") or {}
                if g.get("tier") in ("exceptional", "great"):
                    out.append({
                        "origin": origin, "dest": dest, "cabin": cabin,
                        "program": p["program"], "miles": p["miles"],
                        "surcharge": p["surcharge"], "cpm": p["cpm"],
                        "grade_tier": g["tier"], "grade_label": g.get("label", ""),
                        "recommendation": g.get("recommendation", "book_miles"),
                        "reasoning": g.get("reasoning", ""),
                        "direct": p.get("direct", False), "seats": p.get("seats", 0),
                        "airlines": p.get("airlines", ""),
                        "available_date": p.get("available_date", dep.isoformat()),
                        "url": p["url"],
                        "cash_eur": round(cash, 0) if cash else None,
                    })
            return out
        except Exception:
            return []

    with cf.ThreadPoolExecutor(max_workers=3) as pool:
        for batch in pool.map(scan_route, TOP_OPP_ROUTES):
            results.extend(batch)

    # Only cache if we got actual data (don't cache 429-induced empty results)
    grade_order = {"exceptional": 0, "great": 1}
    results.sort(key=lambda x: (grade_order.get(x["grade_tier"], 9), -(x["cpm"] or 0)))

    seen, deduped = set(), []
    for r in results:
        key = (r["program"], r["origin"], r["dest"], r["cabin"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    top = deduped[:12]
    if top:  # only cache non-empty results
        _write_file_cache(top)
    try:
        _TOP_OPP_LOCK.release()
    except RuntimeError:
        pass  # wasn't acquired (non-blocking path)
    return jsonify({"ok": True, "opportunities": top, "source": "live"})




@app.route("/health")
def health():
    return jsonify({"ok": True, "app": APP_NAME, "version": "6.1", "price_source": PRICE_SOURCE, "serpapi_token": bool(SERPAPI_TOKEN), "tp_token": bool(TP_TOKEN), "api_guard": bool(APP_TOKEN), "award_source": AWARD_SOURCE, "seatsaero_key": bool(SEATSAERO_KEY), "seatsaero_remaining": _seatsaero_remaining, "serpapi_paid_calls": _serpapi_paid_calls, "serpapi_max_pairs": SERPAPI_MAX_PAIRS})


def _serve_png(filename: str, fallback_svg: str = "icon.svg"):
    """Serve a static PNG if it exists, otherwise redirect to SVG fallback."""
    import pathlib
    png_path = pathlib.Path(app.static_folder) / filename
    if png_path.exists():
        return send_from_directory(app.static_folder, filename,
                                   mimetype="image/png",
                                   max_age=86400)
    return redirect(url_for("static", filename=fallback_svg))


@app.route("/apple-touch-icon.png")
@app.route("/apple-touch-icon-precomposed.png")
@app.route("/static/apple-touch-icon.png")
def apple_touch_icon():
    return _serve_png("apple-touch-icon.png")


@app.route("/favicon.ico")
@app.route("/static/favicon.ico")
def favicon():
    # Serve favicon.ico if present, else send the SVG icon as fallback
    import pathlib
    ico_path = pathlib.Path(app.static_folder) / "favicon.ico"
    if ico_path.exists():
        return send_from_directory(app.static_folder, "favicon.ico",
                                   mimetype="image/x-icon", max_age=86400)
    return redirect(url_for("static", filename="icon.svg"))


@app.route("/static/icon-<int:size>.png")
def pwa_icon(size: int):
    if size not in (192, 512):
        return ("Not found", 404)
    return _serve_png(f"icon-{size}.png")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
