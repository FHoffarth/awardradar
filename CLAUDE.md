# CLAUDE.md — AwardRadar

Kontext für Claude Code und KI-Assistenten. Lies das zuerst, bevor du Änderungen machst.

## Was AwardRadar ist
Der **Sweet-Spot- und Hidden-City-Finder für Miles & More / Star Alliance** im deutschsprachigen Raum. Kein weiterer generischer Flugsucher. Der USP liegt in drei Dingen, die die Konkurrenz (PointsYeah, seats.aero, Roame, AwardTool) NICHT hat:
1. Deutsch & M&M-first
2. Klares Cash-vs-Meilen-Urteil (Cent-pro-Meile-Wertung + Empfehlung)
3. Verifizierte Hidden-City (Skiplagging mit Segment-Beweis)

**Anti-Scope (bewusst NICHT bauen):** keine eigene Award-Datenbank nachbauen (seats.aero konsumieren), keine US-Bankpunkte-Logik, vorerst keine Hotels, vorerst keine große Alert-Maschinerie.

---

## Team-Rollen (KI-Assisted Development)

| Rolle | Verantwortung |
|---|---|
| **Flo** | Product Owner & Founder — Vision, Priorisierung, Smoke Tests, Business |
| **Claude** | Lead Engineer / Architect — Architektur, Produktentscheidungen, komplexe Features |
| **Codex** | Junior Engineer — klar abgegrenzte Tasks, Tests, Docs, Audits, risikoarme Implementierungen |

---

## Stack & Hosting
- **Backend:** Python + Flask, ein File: `app.py`. Templates in `templates/`, Assets in `static/`.
- **Hosting:** Railway (Service heißt `web`, Production-Environment). Start via `Procfile` (gunicorn).
- **Lokal:** Windows + PowerShell. Git for Windows ist vorhanden.

---

## Architektur-Überblick

```
app.py              ← gesamtes Backend, alle Routen, alle Preisquellen
templates/
  index.html        ← Such-Tool (/app) — CSS/JS versioniert via ?v=NNN
  landing.html      ← Startseite (/)
  impressum.html    ← Rechtsseite
  datenschutz.html  ← Rechtsseite
static/
  app.js            ← gesamtes Frontend (aktuell v122)
  app.css           ← Styles, Dark/Light Theme (aktuell v121)
  world-land.js     ← Natural Earth 110m Küstenlinien (auto-generiert)
  world-land.js     ← NICHT manuell bearbeiten → scripts/generate_world_land.py
  flatpickr.min.*   ← selbst-gehostet (kein CDN)
  og-image.png      ← OG-Bild für Social Sharing
scripts/
  generate_world_land.py  ← erzeugt world-land.js aus Natural Earth GeoJSON
```

### Wichtige Backend-Funktionen

| Funktion | Zweck |
|---|---|
| `sweet_spot_grade(cpm)` | Zentrale Bewertungsfunktion → gibt tier, label, recommendation, reasoning zurück |
| `calc_cpm(cash, miles, surcharge)` | Berechnet Cent-pro-Meile-Wert |
| `_awards_inner()` | Awards-Suche: SerpApi (Cash) + seats.aero (Meilen) |
| `fetch_seatsaero()` | seats.aero Partner API — 1000 Calls/Tag, Budget bewachen |
| `booking_deep_url()` | Deep Links pro Programm (United, Aeroplan, KrisFlyer, BA...) |
| `_write_file_cache()` / `_read_file_cache()` | Shared File Cache unter /tmp/ (alle Gunicorn-Worker) |
| `scan_top_opportunities()` | Discovery-Scan über 8 Routen, TTL 4h, IntersectionObserver lazy-load |

### Frontend-Architektur (app.js)

Der gesamte Frontend-Code ist in einer einzigen Datei. Wichtige Bereiche:
- `globeAnimation()` — Canvas 2D Globe (KEIN three.js, NIEMALS migrieren ohne Review)
- `render(data)` — zentrale Render-Funktion für alle Suchergebnisse
- `initDiscovery()` — Top Opportunities Widget (IIFE am Ende der Datei)
- `booking*` — Booking Decision Card Logik (innerhalb von `render()`)
- `actionLinksHtml()`, `buildItinerary()` — Ergebnisdarstellung

---

## Preisquellen — das zentrale Konzept
Gesteuert über die Env-Variable `PRICE_SOURCE`. Umschaltbar, reversibel:
- `serpapi` (Default, wenn `SERPAPI_TOKEN` gesetzt) — echte Google-Flights-Preise, bezahlt, schnell, stabil. Liefert auch `price_insights` (Preis-Range) und Segmentketten → wird für Sweet-Spot und Skiplag gebraucht.
- `fli` — gratis Google-Flights-Daten via `flights`-Package (reverse-engineerte API). **Rate-limitiert**: von Railway-IP kann Google drosseln (HTTP 429). Nur für `/api/cheap` verdrahtet.
- `travelpayouts` — Cache-Fallback, oft leer.

`/api/cheap` respektiert alle drei. `/api/skiplag` und `/api/awards` brauchen SerpApi und fallen sonst auf Travelpayouts/Schätzung zurück.

---

## Features & Routen
- `GET /` Landing · `GET /app` Tool · `GET /impressum` · `GET /datenschutz`
- `GET /health` — zeigt `price_source`, `serpapi_token`, `seatsaero_remaining` etc.
- `POST /api/cheap` — Cash-Suche, Deal-Score-Badge
- `POST /api/skiplag` — verifizierte Hidden-City via SerpApi-Segmentkette
- `POST /api/awards` — Sweet-Spot: Cash vs. Meilen, cpm, Booking Decision Card Data
- `GET /api/top-opportunities` — Discovery Widget, 4h Cache, lazy-loaded
- `POST /api/airports` — Autocomplete

---

## Env-Variablen (Railway → Variables)
`SERPAPI_TOKEN`, `PRICE_SOURCE`, `SERPAPI_TTL`, `SERPAPI_MAX_PAIRS`, `FLI_MAX_PAIRS`, `SKIPLAG_MAX_SEARCHES`, `AWARDS_MAX_SEARCHES`, `TRAVELPAYOUTS_TOKEN`, `APP_TOKEN`, `WEB_CONCURRENCY`. Werte ohne Anführungszeichen eintragen.

---

## Konventionen & Coding-Standards

### Vor jedem Commit
```bash
python -m py_compile app.py   # Backend: muss sauber sein
# JS: Klammer-Balance prüfen (öffnende = schließende)
```

### CSS/JS Versionierung
`index.html` referenziert `app.css?v=NNN` und `app.js?v=NNN`. Bei jeder Änderung an diesen Dateien die Version hochzählen. Aktuelle Versionen: CSS v121, JS v122.

### Commits
- Aussagekräftige Messages, ein Thema pro Commit
- Format: `Kurzbezeichnung: Was wurde warum geändert`

### Stil
- Kein unnötiger Code, keine Abstraktionen für hypothetische Anforderungen
- Keine Kommentare außer für nicht-offensichtliche Invarianten
- Kein Error-Handling für Szenarien die nicht eintreten können

### MM_AWARD_CHART
Schätzwerte. Flo ist M&M-Experte — bei Änderungen seine echten Chart-Zahlen verwenden, nie erfinden.

---

## Branch-Strategie

```
main          ← Production. Nur sauberer, getesteter Code.
codex/*       ← Codex-Branches für klar abgegrenzte Tasks
feature/*     ← Größere neue Features (von Claude oder Flo)
```

**Regel:** Codex arbeitet NIEMALS direkt auf `main`. Jeder Codex-Branch wird von Claude reviewed bevor Merge.

---

## Geeignete Codex-Tasks ✅

- Smoke Tests / manuelles Test-Protokoll dokumentieren
- Booking Links Audit (alle Programme testen, Deep Links verifizieren)
- README.md aktualisieren
- GA4 Event-Tracking für neue Interaktionen hinzufügen
- SEO-Optimierungen an Landing Pages (meta tags, alt text)
- Impressum/Datenschutz Platzhalter ausfüllen
- Refactoring mit klar definierten Grenzen (z.B. Konstanten extrahieren)
- Typos, Copy-Optimierungen, i18n-Strings
- Test-Coverage für `calc_cpm()`, `sweet_spot_grade()`

## Nicht für Codex geeignet ❌ (erfordert Claude Review)

- `globeAnimation()` — iOS-Fixes sind fragil, rAF-Loop darf nie gestoppt werden
- `sweet_spot_grade()` / `calc_cpm()` — Kernbewertungslogik, Produktentscheidung
- Caching-Architektur (`_write_file_cache`, TTL, Budget-Guards)
- `_awards_inner()` / seats.aero Integration — Budget-kritisch (1000 Calls/Tag)
- Booking Decision Card Logik — Produktpositionierung
- Jede Änderung an API-Routen oder Response-Struktur
- Authentifizierung / Accounts / Alerts (noch nicht gebaut)
- `world-land.js` — nur via `scripts/generate_world_land.py` regenerieren

---

## Sicherheit / Gotchas
- Niemals echte Keys/Tokens committen. `.env` ist in `.gitignore`.
- Hidden-City verstößt gegen Airline-AGB → Rechtshinweise im Skiplag-Output und Impressum müssen bleiben.
- Bei öffentlicher Domain: Impressum + Datenschutz Pflicht.
- seats.aero: 1000 Calls/Tag, Reset 00:00 UTC — `X-RateLimit-Remaining` beachten, bei <50 stoppen.
- SerpApi-Quota: `QuotaError` abfangen, awards darf nicht komplett sterben wenn SerpApi leer.

---

## Aktueller Stand (Juni 2026)

**Decision Engine v1 deployed:**
- Premium Globe v2 (Natural Earth 110m, Earth-at-Night, iOS-stabil)
- Booking Decision Card (3 States: Cash/NoCash/Estimated)
- Top Opportunities Widget v2 (Recommendation + Reason + CTA)
- GA4 Integration (`G-MGN0MCDQKB`)
- SEO: OG Tags, Twitter Cards, Schema.org, og-image.png
- seats.aero Integration mit Shared File Cache

**Nächste Schritte:**
1. Production Smoke Test (Discovery → CTA → Awards → Decision Card)
2. Booking Links Audit (alle Programme, alle Deep Links)
3. Accounts / Watchlists / Alerts (eigener großer Sprint)
