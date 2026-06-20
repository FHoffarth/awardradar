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
web: gunicorn -w 4 --threads 4 --timeout 90 -b 0.0.0.0:$PORT app:app
```

Optionale Umgebungsvariablen:

```text
APP_TOKEN=geheimes-passwort
TRAVELPAYOUTS_TOKEN=...
SKIPLAG_MAX_WORKERS=8
SKIPLAG_MAX_CANDIDATES=16
```
