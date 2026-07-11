# Round-trip continuation: Beta-Betrieb und Skalierung

## Railway-Beta

Der asynchrone Continuation-Pfad darf in der Beta mit genau **einer Railway
Service-Replica** und **einem Gunicorn-Worker** betrieben werden:

```text
WEB_CONCURRENCY=1
CONTINUATION_INLINE=0
MAX_CONTINUATIONS_PER_SEARCH=1
CONTINUATION_TIMEOUT_MS=12000
```

Der Gunicorn-Worker darf mehrere Threads verwenden. Alle Threads teilen sich
denselben prozesslokalen SerpApi-Cache. Ein Lock schützt Cache-Zugriff und das
atomare Entfernen des `departure_token`. Damit kann innerhalb dieses Prozesses
nur eine Continuation für den gespeicherten Treffer ausgeführt werden. Fehlt
der Cache-Eintrag, bleibt das Ergebnis `partial`; der Return-Leg-Endpunkt startet
keine neue Initialsuche.

Die Railway-Replica-Anzahl muss separat auf **1** stehen. `WEB_CONCURRENCY=1`
begrenzt nur die Gunicorn-Worker innerhalb einer Replica.

## Nicht freigegeben

Der asynchrone Pfad ist mit dem aktuellen prozesslokalen Zustand nicht für
mehrere Gunicorn-Worker oder mehrere Railway-Replicas freigegeben. Prozesse und
Replicas teilen weder Cache noch Lock. Dadurch wären Cache-Misses und ein
mehrfacher Verbrauch desselben Provider-Tokens möglich.

## Produktions-Skalierungsplan

Vor horizontaler Skalierung wird der prozesslokale Continuation-Zustand durch
einen gemeinsamen Redis-Cache ersetzt. Der kleinste erforderliche Umfang ist:

- ein kurzlebiger Cache-Eintrag pro initialer Suche mit dem serverseitigen
  Continuation-Kontext und einer TTL höchstens in Höhe von `SERPAPI_TTL`;
- atomarer Einmal-Verbrauch per Redis `GETDEL` oder äquivalentem Lua-Skript;
- derselbe Cache-Miss-Fallback auf `partial`, ohne zusätzlichen Provider-Call;
- keine Ausgabe des `departure_token` an den Client;
- kein Retry und weiterhin höchstens eine Continuation pro Suche.

Erst nach einem Parallelitäts-Test über mehrere Worker und Replicas dürfen
`WEB_CONCURRENCY` oder die Railway-Replica-Anzahl erhöht werden.
