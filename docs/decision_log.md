# AwardRadar Decision Log

This log records attributable product and architecture decisions that must remain durable across sprints.

Related project documents:

- [Repository overview](../README.md)
- [AwardRadar roadmap](awardradar_roadmap_memo.md)

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
