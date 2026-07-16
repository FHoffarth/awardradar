# AwardRadar v5.3

Find miles. Fly better.

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
http://127.0.0.1:5000/?v=53
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

SerpApi-Outbound-Aufrufe sind in Railway Logs mit diesem exakten Filter auffindbar:

```text
event=serpapi_outbound_call
```

Das Event enthält `feature_path`, `request_fingerprint`, `worker_pid`,
`request_kind` und `engine`. Für die Session-basierten Initialsuchen liegt der
Logpunkt oberhalb der urllib3-Retries und zählt daher logische Aufrufe, nicht
einzelne physische Retry-Versuche.

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
