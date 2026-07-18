# CLAUDE.md — AwardRadar

Arbeitskontext für KI-assistierte Entwicklung. Der verifizierte Repository-Istzustand steht in [docs/canonical_state.md](docs/canonical_state.md), bindende Produktentscheidungen im [Decision Log](docs/decision_log.md), die aktuelle Release-Governance in [docs/deployment_governance.md](docs/deployment_governance.md). Dieses Dokument ist keine unabhängige Quelle für Deployment-, Provider- oder Produktstatus.

## Produkt und Scope

AwardRadar unterstützt Reisende beim Vergleich von Cash- und Meilenoptionen. Schwerpunkte sind Miles & More/Star Alliance, Cash-vs.-Meilen-Entscheidungen und erklärbare Verifikation. Keine Providerdaten oder Verfügbarkeit als Gewissheit darstellen.

## Verifizierte Oberflächen

| Bereich | Klassifikation | Implementierung |
|---|---|---|
| `/` | aktive Einstiegsoberfläche | React/Vite-Quelle unter `awardradar_sources/awardradar_sources/figma/`, Build unter `static/landing/` |
| `/app` | aktive kanonische Produktoberfläche, teilweise integriert | React/Vite-Quelle unter `awardradar_sources/awardradar_sources/google/`, Build unter `static/app_ui/`; aktuell nur One-way |
| `/tool` | aktive, für Produktentwicklung eingefrorene Legacy-Oberfläche | `templates/index.html`, `static/app.js`, `static/app.css` und weitere statische Dateien |
| `intelligence/` | isolierte Foundation, nicht in die Web-Runtime verdrahtet | Modelle, Validator, Gemini-Provider, Pipeline und SQLite-Storage ohne Import aus `app.py` |

Backend- oder `/tool`-Fähigkeiten sind erst nach Integration in `/app` kanonische Produktfeatures. `/tool` ist weiterhin erreichbar; „Legacy“ bedeutet nicht „technisch entfernt“.

## Architektur

```text
app.py                         Flask-Anwendung, Routen, APIs und Providerlogik
templates/landing.html         Shell für /
templates/app.html             Shell für /app
templates/index.html           Legacy-Oberfläche für /tool
static/landing/                generierter Landing-Build
static/app_ui/                 generierter /app-Build
static/app.js, static/app.css  handgepflegtes Legacy-Frontend
intelligence/                  isolierte, nicht runtime-verdrahtete Foundation
```

Der `Procfile` startet Gunicorn mit `app:app`. Daraus darf nicht auf die aktuell laufende Railway-Konfiguration oder einen erfolgreichen Deploy geschlossen werden.

## Deployment governance

- `main` ist der kanonische Integrationsbranch, kann aber Commits enthalten, die noch nicht in Production freigegeben oder deployed wurden.
- `staging` ist der Pre-Production-Branch; Railway Staging auto-deployt aus `staging`.
- Railway Production bleibt mit `main` verbunden, aber Production auto-deploy ist deaktiviert.
- Ein Push nach `main` beweist keinen Production-Release.
- Git belegt keinen Live-Deploy-Zustand; dafür sind Railway-Deploy-Metadaten die bevorzugte Evidenz.
- Jede Production-Freigabe braucht eine frische explizite `PRODUCTION GO`.
- Die Approval-Gates sind eng scoped: `COMMIT GO`, `PUSH GO`, `STAGING FAST-FORWARD GO`, `PRODUCTION GO`.

## Relevante Backend-Funktionen

| Funktion | Zweck |
|---|---|
| `deal_score()` / `rescore_offer_set()` | Cash-Angebote bewerten und relativ einordnen |
| `build_cash_guidance()` | kanonische Cash-Empfehlung strukturieren |
| `calc_cpm()` / `sweet_spot_grade()` | Meilenwert berechnen und einordnen |
| `build_decision()` | strukturiertes Decision-Ergebnis erzeugen |
| `_awards_inner()` | Award-Suche und Cash-Kontext zusammenführen |
| `fetch_seatsaero()` | optionalen seats.aero-Pfad hinter Budget-Guard ausführen |
| `_read_file_cache()` / `_write_file_cache()` | Top-Opportunities-Cache unter `/tmp` lesen/schreiben |
| `top_opportunities()` | Discovery-Endpunkt; enthält den internen Route-Scan |
| `links_for()` / `program_verify_url()` | Verifikations- und Buchungslinks erzeugen |

## Provider und Caches

- `PRICE_SOURCE=serpapi`: SerpApi/Google-Flights-Cashdaten, wenn ein Token vorhanden ist.
- `travelpayouts`: Cache-Fallback für Cashdaten und externe Quelle für Airport-Autocomplete; lokaler Airport-Fallback bleibt vorhanden.
- Es gibt keinen implementierten `fli`-Providerpfad.
- Awarddaten laufen über `AwardSource`; der Standard ist eine statische Schätzung. Der optionale seats.aero-Pfad benötigt Konfiguration und ist durch einen prozesslokalen Soft Guard begrenzt.
- Prozesslokale Locks oder Caches sind keine globalen Limits über mehrere Worker oder Railway-Replicas hinweg.
- Providerfreigabe, Quota und Live-Konfiguration sind nicht aus Git ableitbar.

## Routen

- `GET /`, `GET /app`, `GET /tool`
- `GET /about`, `GET /methodology`, `GET /impressum`, `GET /datenschutz`, `GET /privacy`
- `GET /api/airports`
- `POST /api/cheap`, `POST /api/return-leg`, `POST /api/skiplag`, `POST /api/awards`
- `GET /api/top-opportunities`, `GET /health`

## Änderungsregeln

- Neue Produktfeatures ausschließlich für `/app` planen.
- Keine Runtime-Fähigkeit als kanonisch dokumentieren, solange sie nur im Backend oder in `/tool` existiert.
- Generierte Dateien unter `static/landing/` und `static/app_ui/` nicht ohne die zugehörige Quelle und einen reproduzierbaren Build ändern.
- `static/world-land.js` nur über `scripts/generate_world_land.py` regenerieren.
- Keine Keys oder Tokens committen.
- Produktentscheidungen nicht still durch Implementierung oder Dokumentation überschreiben; dafür den Decision Log verwenden.
- Deployment-, Smoke-Test- oder Providerstatus nur mit externer, attribuierbarer Evidenz aktualisieren.

## Aktuell offene, repository-belegte Punkte

- React-Round-trip ist in `/app` nicht integriert.
- Gate C ist unentschieden; Gate A bleibt offen.
- Providerfreigabe für externe/kommerzielle seats.aero-Nutzung ist im Repository nicht belegt.
- `intelligence/` ist nicht in `app.py` integriert.
- Staging- und Production-Smokes sind nicht durch den Repositoryzustand belegt.
