# AwardRadar Decision Log

This log records attributable product and architecture decisions that must remain durable across sprints.

Related project documents:

- [Repository overview](../README.md)
- [AwardRadar roadmap](awardradar_roadmap_memo.md)
- [Deployment governance](deployment_governance.md)

## Decision lifecycle

```text
PROPOSED → REVIEWED → DECIDED → FROZEN → SUPERSEDED
```

- **PROPOSED:** a decision has been raised but not yet reviewed.
- **REVIEWED:** implications and evidence have been examined.
- **DECIDED:** an accountable human has selected an outcome.
- **FROZEN:** the decision is binding and must not be changed implicitly by implementation work.
- **SUPERSEDED:** a later attributable decision has explicitly replaced it.

## AR-DEC-001 — Canonical Product Surface

- **Decision ID:** AR-DEC-001
- **Date:** 2026-07-16
- **Status:** FROZEN
- **Decided by:** Florian Hoffarth

### Decision

AwardRadar uses `/app` as its only canonical product surface. The `/tool` route is a frozen legacy surface and receives no new product development.

### Consequences

- New product features are implemented only for `/app`.
- Backend or `/tool` capabilities are not considered canonical product features until integrated into `/app`.
- Cash Round-trip Result Integrity is implemented in the backend and legacy `/tool`, but remains incomplete for `/app`.
- The previous “Round-trip Performance & Rollout” scope targeting the legacy surface is superseded.
- A future React Round-trip Integration requires its own explicit scope and gates.
- `/tool` exposure, protection, and eventual retirement are handled separately.
- Gate C must explicitly decide whether One-way-only `/app` is sufficient for controlled beta or whether React Round-trip Integration is required first.

### Evidence

- Round-trip hardening branch: `feature/roundtrip-beta-hardening`
- Round-trip tip: `4bbd969c20b40eefca4217ef891f14a9799a6c1b`
- Round-trip merge: `15392bc4`
- Current product surfaces:
  - `/` — React/Vite landing
  - `/app` — canonical React/Vite application
  - `/tool` — frozen legacy Flask/Jinja/static-JS application

## AR-DEC-002 — Manual Production Release Governance

- **Decision ID:** AR-DEC-002
- **Date:** 2026-07-18
- **Status:** DECIDED
- **Confirmed by:** Florian Hoffarth

### Decision

Railway Production auto-deploy from `main` is disabled. Railway Staging auto-deploy from `staging` remains enabled. Production release now requires a fresh explicit `PRODUCTION GO` and an intentional manual Railway Production deployment of the approved `main` commit.

### Rationale

This preserves explicit founder approval over every Production release and prevents an ordinary push to `main` from publishing to Production by accident.

### Consequences

- `main` remains the canonical integration branch, but may contain commits that are not yet released to Production.
- `staging` remains the pre-production deployment branch and Railway Staging target.
- Successful push or merge to `main` does not by itself prove a Production release.
- Staging deployment and smoke remain required before Production release.
- Every Production release requires a fresh approval scoped to that exact release action; no prior approval carries forward.

### Evidence

- Verified Railway Production source branch: `main`
- Verified Railway Production auto-deploy state: disabled
- Verified Railway Staging source branch: `staging`
- Verified Railway Staging auto-deploy state: enabled
- Verified live commit on both environments at time of confirmation: `536e0b23665c2a36ec504dad928a9f79a9715799`

## AR-DEC-003 — Decision Contract V1

- **Decision ID:** AR-DEC-003
- **Date:** 2026-07-26
- **Status:** DECIDED
- **Decided by:** Flo (Florian Hoffarth)

### Decision

Decision Contract V1 is adopted as the binding contract for the `decision` block emitted by `build_decision()` and consumed by the `/app` Results UI. The full field reference, vocabularies and fail-closed matrix are specified in [decision_contract_v1.md](decision_contract_v1.md), which is the authoritative document; this entry records the decision and its policy.

### Contract policy

- Internal tier tokens (`book_miles`, `lean_miles`, `consider`, `pay_cash`) remain internal. They exist only in `_TIER_META` for tier calculation and must not appear in any emitted API value.
- The external verdict vocabulary is a closed set: `miles_value_supported`, `miles_value_leaning`, `comparison_inconclusive`, `cash_value_supported`, `availability_only`, `insufficient_data`.
- There are no compatibility aliases for `book_miles` or `pay_cash`. A consumer sending or expecting an old token receives the conservative fallback.
- Unknown or legacy input fails closed to `insufficient_data`, never to a value-bearing verdict.
- External verdicts describe evidence, not booking instructions. No emitted field may carry an imperative such as "book", "buy" or "pay now".
- Every external emission point routes through `normalize_verdict()`. A new surface that emits a verdict must do the same.
- Decision Contract V1 does not authorize live provider usage, Level 2, or any stronger recommendation framing.
- seats.aero remains disabled pending written commercial approval. This contract does not change that state.

### Consequences

- Changes to the field set, either vocabulary, or the fail-closed behaviour require explicit review and a corresponding change to `tests/test_decision_contract_v1.py`.
- The `Recommendation` vs `Decision signal` gate in `/app` keys exclusively on the external verdict vocabulary. Its semantics are unchanged by V1; only the token names changed.
- User-facing export copy (summary, forum, email, native share) is driven by `SIGNAL_COPY`, not by raw contract enums. No contract enum may be interpolated into user-visible text.
- This entry does not supersede AR-DEC-001: `/app` remains the only canonical product surface, and `/tool` remains frozen.

### Evidence

- Contract specification: [decision_contract_v1.md](decision_contract_v1.md)
- Implementation: PR #19 on `feature/decision-contract-v1` (merged 2026-07-26)
- Branch commits:
  - `2104a02d7cea2aa88088c2032a68c7c930f34690` — contract and verdict safety
  - `347b784c50dd67f27718a93dfa4b1a95ca457106` — governance record and export-copy tests
  - `ede7897d33c5c7341e69efefa33d9abe69db3da5` — duplicated signal label fix
- Merge commit into `main`: `322898066382f51d45ff385d4a8d5300a79551bf`
  (non-fast-forward; parents `140a3a6` and `ede7897`; merged tree identical to `ede7897`)
- Contract tests: `tests/test_decision_contract_v1.py`
- Export enum-leakage tests: `awardradar_sources/awardradar_sources/google/src/App.test.tsx`
- Staging smoke on `ede7897` (2026-07-26): bundle byte-identical, all six external
  verdicts correct, recommendation gate exact, no legacy tokens, no raw enums in
  exports, fail-closed behaviour intact, no provider calls. Verdict:
  READY WITH NON-BLOCKING NOTES.
- Production served the merged bundle `index-D7aC-1jM.js` on 2026-07-26,
  byte-identical to `main`. Deploy identity is asset-hash evidence; Railway
  deploy metadata was not available at the time of this entry.
