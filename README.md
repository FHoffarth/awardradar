# AwardRadar v5.3

Find miles. Fly better.

## Product architecture

Flask remains AwardRadar's backend and server layer. The product has three distinct web surfaces:

```text
/       React/Vite landing
/app    canonical React/Vite application
/tool   frozen legacy Flask/Jinja/static-JS application
```

`/app` is the only canonical product surface. New product development targets `/app` only. Backend or `/tool` capabilities do not count as canonical product features until they are integrated into `/app`.

Project state and product decisions:

- [Decision Log](docs/decision_log.md)
- [Roadmap & Programming Memo](docs/awardradar_roadmap_memo.md)

## Neu in v5.3

- Skiplag-Kandidaten werden parallel geprüft statt seriell.
- `Procfile` nutzt Gunicorn mit Workers + Threads + längerem Timeout.
- Static-Dateien bleiben öffentlich erreichbar, API kann weiterhin per `APP_TOKEN` geschützt werden.
- Frontend-Fehlerhandling ist robuster, falls eine API keine JSON-Antwort liefert.
- DE/EN-Umschalter bleibt erhalten.

## Lokal starten

```powershell
cd "C:\Users\Flo\Desktop\MM\mm-flugsucher\awardradar_v5_3"
python -m pip install -r requirements.txt
$env:TRAVELPAYOUTS_TOKEN="DEIN_TOKEN"
python app.py
```

Dann öffnen:

```text
http://127.0.0.1:5000/       # React/Vite landing
http://127.0.0.1:5000/app    # canonical React/Vite application
http://127.0.0.1:5000/tool   # frozen legacy application
```

## Hosting

```text
web: gunicorn -w ${WEB_CONCURRENCY:-1} --threads 4 --timeout 90 -b 0.0.0.0:$PORT app:app
```

Die asynchrone Round-trip-Continuation ist in der Railway-Beta nur mit genau
einer Service-Replica und `WEB_CONCURRENCY=1` freigegeben. Die Threads teilen
sich den prozesslokalen, gesperrten Cache; mehrere Worker oder Replicas tun das
nicht. Die Skalierungsgrenze und der Redis-Migrationspfad stehen in
`docs/round_trip_continuation_scaling.md`.

## Cash Round-trip Result Integrity

- Backend/API implementation: merged into `main`.
- Legacy `/tool` rendering and continuation flow: merged into `main`.
- React `/app` integration: not implemented.
- Credentialed staging smoke: not evidenced.
- Production round-trip smoke: not evidenced.

Cash Round-trip Result Integrity is therefore not complete as a canonical `/app` feature. The legacy-targeting “Round-trip Performance & Rollout” scope is superseded by [AR-DEC-001](docs/decision_log.md#ar-dec-001--canonical-product-surface).

## Provider outbound observability

Logical SerpApi and seats.aero outbound calls are visible in Railway logs with:

```text
event=provider_outbound_call
```

Provider-specific filters are `provider=serpapi` and `provider=seats_aero`.
Each event contains `feature_path`, `request_kind`, a 16-character SHA-256
`request_fingerprint`, and `worker_pid`. The fingerprint contains no credential:
SerpApi hashes its provider parameters except `api_key`; seats.aero hashes the
normalized `origin_airport`, `destination_airport`, `cabin`, `start_date`,
`end_date`, and `take` search parameters. Raw parameter values are not logged.

The log point is immediately above `HTTP.get()` for session-based requests.
It therefore counts logical calls after validation/cache/budget guards, while
urllib3 retries performed inside the shared session remain one logical event.
SerpApi continuation uses its separate plain `requests.get()` boundary.

Optionale Umgebungsvariablen:

```text
APP_TOKEN=geheimes-passwort
TRAVELPAYOUTS_TOKEN=...
SKIPLAG_MAX_WORKERS=8
SKIPLAG_MAX_CANDIDATES=16
WEB_CONCURRENCY=1
CONTINUATION_INLINE=0
MAX_CONTINUATIONS_PER_SEARCH=1
CONTINUATION_TIMEOUT_MS=12000
```
