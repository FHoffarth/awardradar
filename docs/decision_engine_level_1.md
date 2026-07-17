# Work Package — decision-engine-level-1

> **Document status: STALE PLANNING SNAPSHOT / PARTIALLY SUPERSEDED.** The
> repository now contains decision construction, cash guidance, scoring and
> dedicated tests. This work package is retained for its original guardrails;
> its `PLANNED` label is not the current project status. See
> [Canonical Repository State](canonical_state.md).

Status when written:

```text
PLANNED — after award-data-foundation, preferably after first real provider integration
```

Branch:

```text
codex/decision-engine-level-1
```

## Herkunft dieses Pakets

Dieses Work Package materialisiert die Stufe **Level 1: Static valuation verdicts**
aus der Decision-Engine-Reifegradleiter (`docs/awardradar_roadmap_memo.md`, §6.5
`decision-engine-foundation`). Der ursprüngliche Level-1-Scope ist unten unter
„Ursprüngliches Paket" **unverändert** übernommen. Die beiden Abschnitte
„Guardrail A" und „Guardrail B" sind die von Flo am 2026-07-05 verbindlich
ergänzten Guardrails. Sonst wurde am ursprünglichen Paket nichts geändert.

---

## Ursprüngliches Paket (unverändert)

### Mission

```text
Turn award data into booking intelligence.
```

### Kernprinzip

```text
Consolidate existing valuation logic before inventing new recommendation logic.
```

Bestehende Bewertungslogik wie `sweet_spot_grade()` und die CPM-Schwellen sind
der **initiale Decision-Engine-Seed**, nicht durch ein paralleles neues System zu
duplizieren.

### First-stage Verdicts

- good value
- poor value
- excellent redemption
- high taxes
- better via another program
- estimate only
- verify externally
- data freshness warning

### Nicht in Level 1

- book now
- wait
- price trend prediction
- availability trend prediction
- urgency scoring

Grund: „Book now" / „wait" brauchen Zeitreihen, historische Verfügbarkeit,
wiederholte Checks und Trend-Signale — abhängig von Saved Searches, periodischen
Checks und Alert-Infrastruktur.

### Reifegrade (Kontext)

```text
Level 1: Static valuation verdicts.
Level 2: Provider-aware verdicts with freshness and confidence.
Level 3: Cross-program comparison.
Level 4: Historical trend-aware recommendations.
Level 5: Personalized traveler-aware recommendations.
```

### Ursprüngliche Guardrails

- No duplicated valuation engine.
- No unsupported urgency claims.
- No "book now/wait" before trend data exists.
- No hidden commercial bias.
- No provider data overclaiming.
- Always distinguish estimate, cached observation, and verified availability.
- Decision Engine must consume normalized AwardSource results.
- Decision Engine must not directly read `MM_AWARD_CHART` or provider-specific raw data structures.

---

## Guardrail A — Trip-Direction-Normalisierung (verbindlich)

**Regel:** Vor **jeder** Value-Berechnung müssen Cash Fare und Award Requirement
dieselbe Reiserichtung abbilden.

### Ausgangslage im Code (erst prüfen, dann bauen)

- Miles-&-More-Award-Estimates liegen als **One-way**-Werte vor.
  `MM_AWARD_CHART` ist als „one-way Saver miles — Schätzwerte Stand 2024"
  dokumentiert (`app.py`, Kommentar oberhalb der Chart-Definition).
- Der Static AwardSource setzt `"trip_type": "one_way"` fest und führt zusätzlich
  `requested_trip_type` mit (`app.py`, `STATIC_AWARD_SOURCE`).
- `_awards_inner()` leitet bereits `trip_type = "one_way" if one_way else "round_trip"`
  aus dem Request ab (`app.py`), aber der Cash-Wert kommt aus SerpApi/Zone-Fallback
  und ist **nicht garantiert** auf dieselbe Basis normalisiert.
- `STATIC_AWARD_LIMITATIONS` hält bereits fest: „Values are normalized per
  direction / one-way unless a caller explicitly marks otherwise." — diese Zusage
  muss die Decision Engine einhalten, nicht unterlaufen.

### Anforderungen

1. SerpApi-/Cash-Fare-Daten können One-way **oder** Round-trip sein — die
   tatsächliche Basis muss ermittelt und mitgeführt werden, nicht angenommen.
2. Ein Round-trip-Cash-Preis darf **nicht** direkt durch eine One-way-Meilenzahl
   geteilt werden.
3. Vor der CPM-/Value-Berechnung werden **beide** Inputs auf dieselbe Basis
   normalisiert. Bevorzugt: explizit One-way gegen One-way **oder** Round-trip
   gegen Round-trip.
4. Ist eine Round-trip-Darstellung nötig, summiert die Decision Engine gerichtete
   Award-Werte selbst — sie nimmt **nicht** an, dass ein statischer Award-Wert
   bereits Round-trip ist, außer er ist explizit so markiert (konsistent mit
   Roadmap §6.3 „Trip direction rule").
5. Ist eine **sichere** Normalisierung nicht möglich, wird **kein** Value Score
   vorgetäuscht. Stattdessen:
   - `insufficient_data` **oder** `low confidence`
   - mit sichtbarer Erklärung, dass die Trip-Basis nicht eindeutig vergleichbar ist.

### Pflichtfelder im strukturierten Decision-Result

- `cash_trip_type` — `"one_way" | "round_trip" | "unknown"`
- `award_trip_type` — `"one_way" | "round_trip" | "unknown"`
- `normalized_trip_type` — die Basis, auf der tatsächlich gerechnet wurde
- `trip_basis_compatible` — `true | false`

Wenn `trip_basis_compatible = false`, darf kein positives Value-Signal ausgegeben
werden; das Result trägt `insufficient_data` oder `low confidence`, und die finale
Erklärung nennt die verwendete Trip-Basis transparent.

---

## Guardrail B — Schwellenwerte nicht als Wahrheit erfinden (verbindlich)

**Regel:** Die CPM-/Value-Schwellen müssen zentral definiert, dokumentiert, leicht
änderbar und klar als **vorläufige Kalibrierungswerte** markiert sein.

### Bestehende Schwellen zuerst wiederverwenden

Es existiert bereits genau **eine** Schwellenquelle. Sie ist wiederzuverwenden,
**keine** zweite konkurrierende Schwellenlogik einführen:

- `calc_cpm(cash_eur, miles, surcharge_eur)` in `app.py` — `net = cash − surcharge`,
  `cpm = net / miles * 100`, gerundet auf 2 Nachkommastellen.
- `sweet_spot_grade(cpm)` in `app.py` — die autoritative Tier-Grenze:

  | cpm ≥ | tier         | recommendation |
  |-------|--------------|----------------|
  | 2.5   | exceptional  | book_miles     |
  | 1.8   | great        | book_miles     |
  | 1.2   | good         | lean_miles     |
  | 0.7   | fair         | consider       |
  | < 0.7 | poor         | pay_cash       |

### Herkunft dokumentieren

Diese Grenzen sind **Produkt-Kalibrierung durch den Founder**, keine allgemein
gültige oder marktübliche M&M-Bewertung. Beim Zentralisieren ist die Herkunft im
Code als Kommentar festzuhalten. Falls die Schwellen aus `sweet_spot_grade()`
extrahiert/zentralisiert werden, bleibt `sweet_spot_grade()` der einzige Konsument
— kein Parallelsystem.

### Falls neue Schwellen nötig werden

- als vorläufige Produktkalibrierung kennzeichnen
- mit klarem Kommentar versehen, z. B.:
  `# TODO: calibrate with real Miles & More redemption data and founder review`
- sichtbare Sprache vorsichtig halten (Wortlaut wie bestehend: „Meilenwert",
  „prüfen", „Cash-Alternativen prüfen" — keine absoluten Versprechen)
- **nicht** behaupten, die Schwellen seien allgemein gültig oder marktüblich

---

## Provider-Status & CashFareSource (Stand 2026-07-05)

**SerpApi ist für Flugsuchen reaktiviert.** Aktueller Plan:

- Starter
- 1.000 Suchen/Monat
- Google Flights API verfügbar
- Nutzung aktuell zurückgesetzt / verfügbar

### Rolle in Decision Engine Level 1

- SerpApi ist der aktuelle **CashFareSource**-Input für Level 1.
- SerpApi-Daten sind **externer Cash-Fare-Kontext**, keine unhinterfragte Wahrheit.
- `source`, `freshness`, `trip_type` und `confidence` müssen erhalten bleiben und
  in das Decision-Result durchgereicht werden.

**Kernregel bleibt:** Provider-Daten sind Input. AwardRadars
Entscheidungsunterstützung ist das Produkt.

### Bestehende Infrastruktur zuerst wiederverwenden (nicht duplizieren)

- **TTL-Cache gegen Doppelabrechnung existiert:** `serpapi_search()` cached über
  `_SERP_CACHE` mit `SERPAPI_TTL` (default 6h), Key inkl. Trip-Type
  (`"1"` = round trip, `"2"` = one way) — `app.py`. Kein Parallel-Cache einführen.
- **Kostengrenze existiert:** `SERPAPI_MAX_PAIRS` (default 2) begrenzt bezahlte
  Suchen pro Klick — `app.py`. Diese Grenze respektieren.
- **Quota-Handling existiert:** `QuotaError` bei HTTP 402/429; Awards dürfen bei
  leerer Quota **nicht** komplett sterben (Zone-Fallback) — `app.py`
  `fetch_cash_details` / `_awards_inner`.

### Konsequenzen für die Umsetzung

- Cash-Input über die bestehende `serpapi_search()`/`fetch_cash_details()`-Kette
  beziehen; **keine unnötigen Doppel-Calls**.
- Bestehende Ergebnisse wiederverwenden, wo möglich (TTL-Cache greift bereits).
- **Keine** neuen Provider-Calls für rein kosmetische UI-Änderungen auslösen.
- **Trip-Basis-Hinweis (verweist auf Guardrail A):** `fetch_cash_details()` ruft
  SerpApi mit `ret=None` → der Cash-Wert ist dort **deterministisch One-way**.
  Der CashFareSource-Wrapper muss `cash_trip_type = "one_way"` daher **explizit
  aus dem tatsächlichen Call** ableiten, nicht aus der angezeigten Sucheingabe.
  Bei Round-trip-Sucheingabe entsteht sonst genau der Basis-Mismatch aus
  Guardrail A.
- **Metadaten ergänzen:** `fetch_cash_details()` liefert aktuell keine
  `source` / `freshness` / `trip_type` / `confidence`. Der CashFareSource-Boundary
  ergänzt sie — analog zum bestehenden `award_source_metadata()` (`app.py`) als
  `cash_source_metadata()`, **kein** konkurrierendes zweites Schema.

### Beobachtbarkeit (für spätere Volumen-Überwachung)

- Provider-Nutzung so kapseln, dass das monatliche Suchvolumen später messbar ist
  (z. B. ein Zählpunkt an der einen Stelle, an der ein **bezahlter** Call ausgeht —
  nicht bei Cache-Treffern).
- `/health` führt bereits Provider-Signale (`price_source`, `serpapi_token`,
  `seatsaero_remaining`); Cash-Provider-Beobachtbarkeit dort andocken, kein neues
  Telemetrie-System bauen.

---

## Abnahmekriterien

Ursprüngliche Level-1-Kriterien plus die folgenden verbindlichen Ergänzungen:

### Testfälle (Guardrail A)

1. **Round-trip Cash vs. One-way Award Estimate** — die Basis wird normalisiert
   (nicht direkt geteilt); `trip_basis_compatible` spiegelt das Ergebnis; bei
   erzwungener Annahme sinkt die Confidence.
2. **One-way Cash vs. One-way Award Estimate** — kompatible Basis,
   `trip_basis_compatible = true`, voller Value Score erlaubt.
3. **Unklare Trip-Basis** (`cash_trip_type = "unknown"` oder nicht sicher
   ableitbar) — **kein** Value Signal; Ausgabe `insufficient_data` /
   `low confidence` mit sichtbarer Erklärung.

### Weitere Kriterien

- Kein Value Signal bei inkompatibler oder nicht sicher normalisierbarer Basis.
- Confidence muss bei Annahmen oder Normalisierung **sinken** (nicht gleich bleiben).
- Die finale Erklärung nennt die verwendete Trip-Basis transparent
  (`normalized_trip_type` im Result und in der sichtbaren Erklärung).
- Schwellen zentral, dokumentiert, als vorläufig markiert; keine zweite
  Schwellenlogik.

### Kriterien (Provider / CashFareSource)

- SerpApi-Cash-Werte tragen `source`, `freshness`, `trip_type`, `confidence` ins
  Decision-Result.
- Keine doppelten Provider-Calls: ein wiederholter identischer Request innerhalb
  der TTL trifft den `_SERP_CACHE`, nicht das Netz.
- Kosmetische UI-Änderungen (Theme, Layout, Re-Render) lösen **keinen** neuen
  Provider-Call aus.
- `SERPAPI_MAX_PAIRS` wird respektiert; bezahlte Calls sind an einem Punkt zählbar.
- Bei `QuotaError` bleibt die Award-Bewertung funktionsfähig (Zone-Fallback),
  Confidence sinkt entsprechend.

---

## Umsetzungshinweise

- Dieses Dokument ist die **Spezifikation**, nicht die Implementierung. Codex
  implementiert gegen diese Kriterien auf `codex/decision-engine-level-1`.
- `sweet_spot_grade()` / `calc_cpm()` sind laut `CLAUDE.md` Kernbewertungslogik →
  jede Änderung an ihnen erfordert Claude-Review vor Merge.
- Nicht nach `main` mergen ohne Review.
