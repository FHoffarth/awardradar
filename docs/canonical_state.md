# AwardRadar Canonical Repository State

Last updated: 2026-07-18
Verified against: `origin/main` at `536e0b23665c2a36ec504dad928a9f79a9715799`

## Scope and authority

This document is the canonical description of the state represented by the
repository. The decision log remains authoritative for attributable product
decisions. The roadmap describes intended sequencing and open work.

Repository evidence does not establish the current Railway deployment,
environment variables, replica count, provider quota or approval, staging or
production smoke-test results, or live browser behaviour.

Railway deployment metadata is preferred evidence for live deployment state.
Git SHA alone does not prove Staging or Production deployment, and live asset
identity is supporting evidence only.

## Surface classification

| Surface | Repository classification | Wiring | Current boundary |
|---|---|---|---|
| `/` | **ACTIVE ENTRY SURFACE** | Flask renders `templates/landing.html`, which loads the React/Vite build in `static/landing/`. Source is in `awardradar_sources/awardradar_sources/figma/`. | Collects origin, destination and date, then navigates to `/app`. It is not the canonical decision workspace. |
| `/app` | **ACTIVE CANONICAL PRODUCT SURFACE — PARTIAL** | Flask renders `templates/app.html`, which loads the React/Vite build in `static/app_ui/`. Source is in `awardradar_sources/awardradar_sources/google/`. | Calls `/api/awards` and `/api/cheap`. The current React request is one-way only. Backend round-trip capability is not yet integrated here. |
| `/tool` | **ACTIVE LEGACY SURFACE — FROZEN FOR PRODUCT DEVELOPMENT** | Flask renders `templates/index.html` with hand-maintained `static/app.js`, `static/app.css` and supporting assets. | Still reachable and contains capabilities not present in `/app`, including the legacy round-trip continuation flow. Its availability does not make those capabilities canonical product features. |
| `intelligence/` | **ISOLATED FOUNDATION — NOT RUNTIME-WIRED** | Contains models, validation, a Gemini provider, a pipeline and SQLite storage. | No import or route wiring from `app.py` was found. It is not an active web surface or part of the current request path. |

“Canonical” and “frozen” above are product-governance classifications from
[AR-DEC-001](decision_log.md#ar-dec-001--canonical-product-surface). The code
confirms the route and asset wiring; Git cannot enforce the governance policy.

## Runtime architecture represented in Git

- Backend and server: Python, Flask and Gunicorn; application object `app:app`.
- React landing source: `awardradar_sources/awardradar_sources/figma/`.
- React application source: `awardradar_sources/awardradar_sources/google/`.
- Generated landing build: `static/landing/`.
- Generated application build: `static/app_ui/`.
- Legacy UI: `templates/index.html` plus hand-maintained files under `static/`.
- Cash providers: SerpApi with a process-local TTL cache; Travelpayouts as the
  configured fallback and airport-autocomplete source.
- Award data: `AwardSource` boundary, `StaticAwardSource`, and an optional
  seats.aero path guarded by configuration and a process-local remaining-budget
  signal.
- Decision support: cash scoring, cash guidance, cents-per-mile calculation,
  sweet-spot grading and structured decision output in `app.py`.
- Persistence in the active product paths: browser `localStorage` for legacy
  saved searches and an ephemeral `/tmp` file cache for top opportunities.
  No active server-side product database is wired into `app.py`.

## Active route groups

- User-facing: `/`, `/app`, `/tool`, `/about`, `/methodology`, `/impressum`,
  `/datenschutz`, `/privacy`.
- Search APIs: `/api/airports`, `/api/cheap`, `/api/return-leg`, `/api/skiplag`,
  `/api/awards`, `/api/top-opportunities`.
- Operations and metadata: `/health`, `/robots.txt`, `/sitemap.xml`, favicon and
  application-icon routes.

## Verified deployment governance

The following release-governance facts were verified outside Git on 2026-07-18
and are recorded here for canonical repository context:

- `main` is the canonical integration branch.
- `staging` is the pre-production deployment branch.
- Railway Staging auto-deploys from `staging`.
- Railway Production remains connected to `main`.
- Railway Production auto-deploy is disabled.
- A push to `main` does not by itself publish Production.
- Production release requires a fresh explicit `PRODUCTION GO`, an intentional
  manual Railway Production deployment, and post-deploy Production verification.

This governance model is documented in detail in
[deployment_governance.md](deployment_governance.md). The repository may record
the currently verified live commit as historical evidence, but Git alone never
proves that a commit is live.

## Current repository-backed gaps

- React `/app` does not expose the backend round-trip/continuation capability.
- Gate C is undecided: the repository does not select whether one-way-only
  `/app` is sufficient for controlled beta.
- Gate A remains open in the roadmap and must not be closed from Git evidence.
- Written provider approval for external/commercial seats.aero use is not
  evidenced in the repository.
- `intelligence/` is not integrated into the Flask application.
- Some historical work-package documents describe branch or planning states
  that no longer represent the current repository. Their status banners define
  how they should be read.

## Document roles

- `canonical_state.md`: current repository-backed architecture and surface state.
- `deployment_governance.md`: release model, approval gates, evidence rules and
  rollback procedure for Staging and Production.
- `decision_log.md`: attributable, durable product and architecture decisions.
- `awardradar_roadmap_memo.md`: current gates, open work and future sequencing.
- `README.md`: concise repository orientation.
- `CLAUDE.md`: working context derived from the canonical state; not an
  independent source of product truth.
- Foundation and work-package documents: historical scope and acceptance
  records unless their status banner explicitly says otherwise.
