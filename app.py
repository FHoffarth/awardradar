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
SKIPLAG_MAX_SEARCHES = int(os.environ.get("SKIPLAG_MAX_SEARCHES", "6"))

# --- Echtzeitpreise via SerpApi (Google Flights) ---------------------------
# PRICE_SOURCE steuert die Quelle für /api/cheap:
#   "serpapi"       -> echte Google-Flights-Preise (Standard, wenn SERPAPI_TOKEN gesetzt)
#   "travelpayouts" -> alter Cache als Fallback
SERPAPI_TOKEN = os.environ.get("SERPAPI_TOKEN", "")
SERPAPI_BASE = "https://serpapi.com/search"
PRICE_SOURCE = (os.environ.get("PRICE_SOURCE") or ("serpapi" if SERPAPI_TOKEN else "travelpayouts")).lower()

# --- seats.aero live award availability ---
AWARD_SOURCE   = os.environ.get("AWARD_SOURCE", "estimated").lower()  # "estimated" | "seatsaero"
SEATSAERO_KEY  = os.environ.get("SEATSAERO_API_KEY", "")
SEATSAERO_BASE = "https://seats.aero/partnerapi"
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
    "cheap_note_live": {"de": "Marktpreise via Google Flights. Gecacht für Beta — zum Vergleich vor der Buchung bestätigen.", "en": "Market data via Google Flights. Cached during beta — confirm before booking."},
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


# seats.aero response field names per cabin class
SEATSAERO_CABIN_FIELDS: dict[str, tuple[str, str, str | None]] = {
    "Economy":    ("Economy",        "EconomyMiles",        "EconomyDirect"),
    "Premium Eco":("PremiumEconomy", "PremiumEconomyMiles", None),
    "Business":   ("Business",       "BusinessMiles",       "BusinessDirect"),
    "First":      ("First",          "FirstMiles",          None),
}
SEATSAERO_CABIN_PARAM: dict[str, str] = {
    "Economy": "economy", "Premium Eco": "premium", "Business": "business", "First": "first",
}
SEATSAERO_SOURCE_MAP: dict[str, str] = {
    "united":     "United MileagePlus",
    "aeroplan":   "Air Canada Aeroplan",
    "turkish":    "Turkish Miles&Smiles",
    "singapore":  "Singapore KrisFlyer",
    "lifemiles":  "Avianca LifeMiles",
    "aeromexico": "Aeromexico Club Premier",
    "delta":      "Delta SkyMiles",
    "virgin":     "Virgin Atlantic",
    "qantas":     "Qantas Frequent Flyer",
    "emirates":   "Emirates Skywards",
}


def fetch_seatsaero(origin: str, dest: str, cabin: str, dep: dt.date) -> list[dict]:
    """Call seats.aero cached-search API. Returns raw availability rows, or [] on any failure."""
    if not SEATSAERO_KEY:
        return []
    cabin_param = SEATSAERO_CABIN_PARAM.get(cabin, "economy")
    start = (dep - dt.timedelta(days=3)).isoformat()
    end   = (dep + dt.timedelta(days=3)).isoformat()
    try:
        r = HTTP.get(
            f"{SEATSAERO_BASE}/search",
            params={"origin_airport": origin, "destination_airport": dest,
                    "cabin": cabin_param, "start_date": start, "end_date": end, "take": 50},
            headers={"Partner-Authorization": SEATSAERO_KEY},
            timeout=12,
        )
        app.logger.info("seats.aero %s→%s %s status=%s", origin, dest, cabin_param, r.status_code)
        if r.status_code != 200:
            app.logger.warning("seats.aero non-200 body: %s", r.text[:500])
            return []
        rows = r.json().get("data", []) or []
        app.logger.info("seats.aero returned %d rows", len(rows))
        return rows
    except Exception as exc:
        app.logger.warning("seats.aero fetch failed %s→%s %s: %s", origin, dest, cabin, exc)
        return []


def build_seatsaero_programs(
    origin: str, dest: str, cabin: str, dep: dt.date,
    cash_eur: float | None, sa_rows: list[dict],
) -> list[dict]:
    """Build program comparison rows from seats.aero live data."""
    avail_field, miles_field, direct_field = SEATSAERO_CABIN_FIELDS.get(
        cabin, ("Economy", "EconomyMiles", None)
    )
    dz = airport_zone(dest)

    # Best option per source: prefer direct, then fewest miles, then closest date
    by_source: dict[str, dict] = {}
    for row in sa_rows:
        if not row.get(avail_field):
            continue
        src = (row.get("Source") or "").lower()
        miles = row.get(miles_field) or 0
        if not miles or not src:
            continue
        is_direct = bool(row.get(direct_field)) if direct_field else False
        row_date = row.get("Date", "")
        existing = by_source.get(src)
        if not existing:
            by_source[src] = {"miles": miles, "date": row_date, "direct": is_direct}
        else:
            better = (is_direct and not existing["direct"]) or \
                     (is_direct == existing["direct"] and miles < existing["miles"])
            if better:
                by_source[src] = {"miles": miles, "date": row_date, "direct": is_direct}

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
            "url":            f"https://seats.aero/search?origin={origin}&destination={dest}",
            "data_source":    "live",
            "available_date": best["date"],
            "direct":         best["direct"],
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


def sweet_spot_grade(cpm: float) -> dict:
    if cpm >= 2.5:
        return {"grade": "A+", "tier": "exceptional", "label": "Exceptional Redemption"}
    if cpm >= 1.8:
        return {"grade": "A",  "tier": "great",       "label": "Great Redemption"}
    if cpm >= 1.2:
        return {"grade": "B",  "tier": "good",        "label": "Good Redemption"}
    if cpm >= 0.7:
        return {"grade": "C",  "tier": "fair",        "label": "Fair Redemption"}
    return         {"grade": "D",  "tier": "poor",        "label": "Weak Redemption"}


def build_program_comparison(origin: str, dest: str, cabin: str, cash_eur: float | None) -> list[dict]:
    oz, dz = airport_zone(origin), airport_zone(dest)
    results = []
    for name, chart, url in AWARD_PROGRAMS:
        miles = get_miles(chart, oz, dz, cabin)
        if not miles:
            continue
        surcharge = SURCHARGES_EUR.get(name, {}).get(dz, 100)
        cpm = calc_cpm(cash_eur, miles, surcharge) if cash_eur else None
        grade = sweet_spot_grade(cpm) if cpm else None
        results.append({
            "program":     name,
            "miles":       miles,
            "surcharge":   surcharge,
            "cpm":         cpm,
            "grade":       grade,
            "url":         url,
            "data_source": "estimated",
        })
    # Sort by CPM descending (best value first), unknowns at end
    results.sort(key=lambda x: -(x["cpm"] or 0))
    return results


def fetch_cash_price(origin: str, dest: str, dep: dt.date, cabin: str, currency: str = "EUR") -> float | None:
    """Quick SerpApi lookup for cash price — returns cheapest price found or None."""
    if not SERPAPI_TOKEN:
        return None
    try:
        data = serpapi_search(origin, dest, dep, None, cabin, currency)
        items = (data.get("best_flights") or []) + (data.get("other_flights") or [])
        prices = [float(it["price"]) for it in items if it.get("price")]
        return min(prices) if prices else None
    except QuotaError:
        raise
    except Exception:
        return None


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

    # Deduplizieren (gleiche Airline + Ziel), dann nach Deal-Score sortieren
    offers = dedup_offers(offers)
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
                                "confidence": "verified" if lang == "en" else "verifiziert",
                                "candidateLabel": "Verified Hidden-City" if lang == "en" else "Verifizierter Hidden-City",
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
    note = ("Segment-verified via Google Flights. One-way only · no checked baggage · check airline T&Cs." if lang == "en" else "Segmentverifiziert via Google Flights. Nur Hinflug · kein Aufgabegepäck · AGB der Airline prüfen.") if use_serpapi else tx("skiplag_note", lang)
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
    cabin   = data.get("cabin") or "Economy"
    if not origins or not dests:
        return jsonify({"ok": False, "error": tx("missing_origin_dest", lang)}), 400

    use_seatsaero = AWARD_SOURCE == "seatsaero" and bool(SEATSAERO_KEY)
    results = []

    for origin in origins[:2]:
        for dest in dests[:3]:
            if origin == dest:
                continue
            cash_eur = fetch_cash_price(origin, dest, dep, cabin)

            # Live availability from seats.aero (if configured)
            if use_seatsaero:
                sa_rows = fetch_seatsaero(origin, dest, cabin, dep)
                live_programs = build_seatsaero_programs(origin, dest, cabin, dep, cash_eur, sa_rows)
            else:
                live_programs = []

            # Estimated values from award charts
            est_programs = build_program_comparison(origin, dest, cabin, cash_eur)

            # Merge: live programs first; skip estimated duplicates by program name
            live_names = {p["program"] for p in live_programs}
            combined = live_programs + [p for p in est_programs if p["program"] not in live_names]
            combined.sort(key=lambda x: (0 if x.get("data_source") == "live" else 1, -(x.get("cpm") or 0)))

            best = next((p for p in combined if p.get("grade") and p["grade"]["tier"] in ("exceptional", "great")), None)
            results.append({
                "route":          f"{origin} → {dest}",
                "origin":         origin,
                "dest":           dest,
                "date":           dep.isoformat(),
                "returnDate":     ret.isoformat() if ret else None,
                "cabin":          cabin,
                "cash_eur":       round(cash_eur, 0) if cash_eur else None,
                "programs":       combined,
                "best_program":   best["program"] if best else None,
                "has_live_data":  bool(live_programs),
                "links":          award_links(origin, dest, dep.isoformat(), ret.isoformat() if ret else None, cabin),
            })

    if use_seatsaero and any(r["has_live_data"] for r in results):
        note = "Live availability via seats.aero · Estimated values from award charts. Miles and surcharges for guidance — verify on program websites."
    elif use_seatsaero:
        note = "seats.aero returned no availability for this route. Showing estimated values from award charts."
    else:
        note = "Estimated values from award charts. Miles and surcharges for guidance — verify on program websites."

    return jsonify({"ok": True, "results": results, "note": note})


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
    return jsonify({"ok": True, "app": APP_NAME, "version": "6.0", "price_source": PRICE_SOURCE, "serpapi_token": bool(SERPAPI_TOKEN), "tp_token": bool(TP_TOKEN), "api_guard": bool(APP_TOKEN), "award_source": AWARD_SOURCE, "seatsaero_key": bool(SEATSAERO_KEY)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=os.environ.get("FLASK_DEBUG", "0") == "1")


