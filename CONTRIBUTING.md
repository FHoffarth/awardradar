# Codex Constitution

## Mandatory Pre-Flight Checklist

Before every task:

```bash
git status
git branch --show-current
```

Confirm:

- Current branch is NOT `main`
- Current branch matches the assigned task

Allowed branches:

- `codex/*`
- `feature/*`
- explicitly assigned branch

## Forbidden Actions

Never:

```bash
git add .
```

Never:

- work directly on `main`
- merge branches
- stage `.claude/`
- stage `AGENTS.md`
- modify secrets
- modify environment variables
- push unreviewed changes to production

## Staging Rule

Stage only explicit task files.

Example:

```bash
git add scripts/smoke_test.py README.md
```

## Commit Rule

Before every commit:

- review changed files
- verify no secrets are included
- verify no unintended production behavior changed

## Merge Rule

All merges require human review.

Codex never merges.

---

# Contributing to AwardRadar

## Team-Rollen

| Rolle | Wer | Verantwortung |
|---|---|---|
| Product Owner | Flo | Vision, Priorisierung, finale Freigabe |
| Lead Engineer | Claude | Architektur, Reviews, kritische Features |
| Junior Engineer | Codex | Klar abgegrenzte Tasks, nie direkt auf `main` |

---

## Branch-Strategie

```
main          ← Production. Nur reviewed, getesteter Code.
codex/*       ← Codex-Branches (z.B. codex/booking-links-audit)
feature/*     ← Größere Features von Claude oder Flo
```

### Regeln

1. **Codex arbeitet NIEMALS direkt auf `main`** — immer `codex/` Branch erstellen
2. Jeder Codex-PR wird von Claude gereviewed, bevor er gemergt wird
3. Vor jedem Push: `python -m py_compile app.py` muss sauber sein
4. CSS/JS: Version in `index.html` hochzählen (`?v=NNN`) bei jeder Änderung

---

## Für Codex: Geeignete Tasks ✅

Diese Tasks können mit einem `codex/*` Branch selbstständig bearbeitet werden:

- **Booking Links Audit** — alle Programme testen, Deep Links verifizieren, Ergebnisse in `docs/booking-links-audit.md`
- **Test-Protokoll** — manuelles Smoke-Test-Protokoll als `docs/smoke-test.md`
- **SEO-Optimierungen** — meta tags, alt text, Schema.org in `landing.html`
- **Copy & Typos** — Texte, UI-Labels, deutschsprachige Strings
- **GA4 Event-Tracking** — neue `gtag()` Calls für Interaktionen hinzufügen
- **Unit Tests** — pytest Tests für `calc_cpm()` und `sweet_spot_grade()`
- **Impressum/Datenschutz** — Platzhalter-Texte ausfüllen (Flo gibt Inhalte vor)
- **Konstanten extrahieren** — Magic Numbers in benannte Konstanten umwandeln (nur `app.py`, kein Verhalten ändern)

---

## Für Codex: NICHT anfassen ❌

Folgende Bereiche erfordern Lead-Engineer-Review vor jeder Änderung:

| Bereich | Grund |
|---|---|
| `globeAnimation()` in `app.js` | iOS-fragil: rAF-Loop darf nie stoppen, `prefers-reduced-motion` Spezialfall |
| `sweet_spot_grade()` in `app.py` | Kernbewertungslogik — Produktentscheidung von Flo |
| `_awards_inner()`, `scan_top_opportunities()` | seats.aero Budget-kritisch (1000 Calls/Tag) |
| Booking Decision Card Logik | Produktpositionierung — 3 States müssen konsistent bleiben |
| Alle API-Routen (`/api/*`) | Response-Struktur: Frontend hängt direkt dran |
| `_write_file_cache()` / `_read_file_cache()` | Shared Cache über alle Gunicorn-Worker |
| `world-land.js` | Auto-generiert — nur via `scripts/generate_world_land.py` regenerieren |
| Accounts / Auth / Alerts | Noch nicht gebaut — kein Scope für Codex |

---

## Pull-Request-Checkliste

Vor jedem PR:

- [ ] `python -m py_compile app.py` gibt keine Fehler
- [ ] CSS/JS Version in `index.html` hochgezählt (falls `app.css` / `app.js` geändert)
- [ ] Kein API-Key oder Secret im Code
- [ ] Branch-Name beginnt mit `codex/` (für Codex-Tasks)
- [ ] PR-Beschreibung: Was wurde geändert und warum

---

## Lokale Entwicklung

```powershell
# .env anlegen (nie committen!)
# SERPAPI_TOKEN=...
# PRICE_SOURCE=serpapi

python app.py   # startet auf http://localhost:5000
```

Für `world-land.js` neu generieren:
```powershell
python scripts/generate_world_land.py
```

---

## Sicherheits-Hinweise

- Hidden-City (Skiplagging) verstößt gegen Airline-AGB → Rechtshinweise im Output und Impressum dürfen NICHT entfernt werden
- seats.aero: Non-Commercial Only — vor öffentlichem Launch schriftliche Freigabe einholen
- Niemals echte Keys in Git committen — `.env` ist in `.gitignore`
