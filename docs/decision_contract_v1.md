# Decision Contract V1

**Status:** binding
**Based on main commit:** `140a3a6`
**Decided by:** Florian Hoffarth
**Decision date:** 2026-07-26
**Enforced by:** `tests/test_decision_contract_v1.py`

This document defines the exact `decision` block emitted by `build_decision()` in
[app.py](../app.py) and consumed by the Results UI in
[App.tsx](../awardradar_sources/awardradar_sources/google/src/App.tsx).

## Governance

- This contract does **not** authorize Level 2, provider activation, seats.aero
  activation, or stronger recommendations.
- Any change to the field set, the signal vocabulary, the verdict vocabulary or
  the fail-closed behaviour requires explicit review **and** a corresponding
  change to `tests/test_decision_contract_v1.py`.
- Compatibility aliasing (silently accepting an old value name) is not permitted
  without a test that pins the alias.
- CPM thresholds (`VALUE_TIER_THRESHOLDS`) and value calibration are **not** part
  of this contract change and were not modified.

## Field reference

`build_decision()` always returns the same 26 keys. The block is never partially
emitted: on every fail-closed path the full key set is present, with value-bearing
fields set to `null` / neutral defaults.

| Field | Type | Source | Classification | Allowed values | Safe for user-facing decisions |
|---|---|---|---|---|---|
| `verdict` | string | derived from tier via `normalize_verdict()` | **normalized** | see [Verdict vocabulary](#verdict-vocabulary) | yes — describes evidence, never an instruction |
| `signal` | string | derived from award tier (`_TIER_SIGNAL`) | derived | see [Signal vocabulary](#signal-vocabulary) | yes |
| `label` | string | `_SIGNAL_LABEL[signal]` | UI-only | one label per signal | yes |
| `tier` | string \| null | `sweet_spot_grade()` | authoritative (internal calibration) | `exceptional`, `great`, `good`, `fair`, `poor`, `null` | no — internal calibration token, not a product statement |
| `confidence` | string | input-quality score | derived | `high`, `medium`, `low` | yes |
| `confidence_reason` | string | assembled from input quality | derived | free text (`;`-joined reasons) | yes |
| `explanation` | string | assembled per signal | derived | free text | yes |
| `estimated_value` | number \| null | `round(best["cpm"], 1)` | derived | cents per mile, `null` when no safe comparison | yes, with `verification_guidance` |
| `verification_guidance` | string | `_VERIFY_GUIDANCE` constant | authoritative | single constant string | yes — this is the only action the product asks for |
| `freshness_label` | string | `_freshness_label()` | derived | `"<award state> · <cash state>"` | yes |
| `cash_source` | string | `cash_source_metadata()["source"]` | authoritative | provider-dependent | no — provenance metadata |
| `cash_level` | string | `assess_cash_level()` | authoritative | `below_typical`, `within_typical`, `above_typical`, `unknown` | yes |
| `cash_freshness` | string | derived from `cash_is_real` / `cash_eur` | derived | `live_query`, `estimate`, `none` | yes |
| `cash_trip_type` | string | cash offer / caller | normalized | `one_way`, `round_trip`, `unknown` | no — basis metadata |
| `award_trip_type` | string | award option | normalized | `one_way`, `round_trip`, `unknown` | no — basis metadata |
| `normalized_trip_type` | string \| null | `normalize_trip_basis()` | normalized | `one_way`, `round_trip`, `null` | no |
| `trip_basis_compatible` | boolean | `normalize_trip_basis()` | **authoritative gate** | `true`, `false` | yes — a `false` here must block any value claim |
| `evaluated_program` | string \| null | award option | authoritative | program name | yes |
| `evaluated_miles` | number \| null | award option | authoritative | mileage requirement | yes |
| `evaluated_surcharge` | number \| null | award option | authoritative | surcharge in EUR | yes |
| `evaluated_data_source` | string \| null | award option | authoritative | `live`, `estimated`, `cached`, `null` | yes |
| `evaluated_cash_offer_id` | string \| null | `cash_offer["cash_offer_id"]` | **authoritative identity** | opaque id, `null` | yes |
| `evaluated_award_option_id` | string \| null | award option | **authoritative identity** | opaque id, `null` | yes |
| `itinerary_ref` | string \| null | `cash_offer["itinerary_ref"]` | **authoritative identity** | opaque ref, `null` | yes |
| `evidence` | array of objects | assembled from cash offer + award option | derived | see [Evidence](#evidence) | yes |
| `evidence_refs` | object | assembled from cash offer + award option | derived | see [Evidence](#evidence) | yes |

### Identity chain

The identity chain is the core safety invariant and must not be broken:

```
/api/cheap  selected_cash_offer_id
        ->  /api/awards request field  cashOfferId
        ->  decision.evaluated_cash_offer_id
        ->  decision.evidence_refs.cash_offer_id
        ->  decision.evidence[kind="cash_offer"].cash_offer_id
```

`itinerary_ref` travels with the same offer. If either `evaluated_cash_offer_id`
or `itinerary_ref` is missing, the decision **must** fail closed to
`insufficient_data` — no fallback inference from route, price or provider order is
permitted. This is enforced by `tests/test_decision_identity_integrity.py` and by
`test_missing_cash_identity_stays_insufficient_data` in the contract tests.

Stale-response protection: the caller selects the result row whose
`evaluated_cash_offer_id` equals the cash search's `selected_cash_offer_id`. A
response that evaluated a different offer is therefore never rendered as the
answer to the current search.

### Signal vocabulary

`signal` is the **value-assessment axis**. It answers "what does the evidence say
about cash versus miles?".

| Signal | `label` | Emitted when |
|---|---|---|
| `strong_miles_value` | `Miles may make sense here` | award tier `exceptional` or `great` |
| `promising_miles_value` | `Estimated value looks promising` | award tier `good` |
| `mixed_value` | `The comparison is currently mixed` | award tier `fair` |
| `cash_may_be_stronger` | `Cash may be stronger here` | award tier `poor` |
| `insufficient_data` | `Not enough data for a reliable comparison` | any fail-closed path |

### Verdict vocabulary

`verdict` is the **decision-state axis**. It answers "how far may the UI go in
framing this?". It is produced exclusively by `normalize_verdict()` and is the
only field the Results UI uses to decide between the `Recommendation` and
`Decision signal` framings.

| Verdict | Internal tier token it replaces | Meaning | Recommendation-eligible |
|---|---|---|---|
| `miles_value_supported` | `book_miles` | live award evidence supports the miles side | yes |
| `miles_value_leaning` | `lean_miles` | evidence leans towards miles | yes |
| `comparison_inconclusive` | `consider` | evidence does not separate cash and miles | no |
| `cash_value_supported` | `pay_cash` | evidence supports the cash side | yes |
| `availability_only` | — | award availability visible, no cash context to compare | no |
| `insufficient_data` | — | any fail-closed path | no |

`miles_value_supported` is reachable **only** when `evaluated_data_source ==
"live"`. Static (estimated) award data at the same tier is downgraded to
`comparison_inconclusive`, which is exactly the pre-V1 behaviour (`book_miles` →
`consider`) under safe names.

### Verdict safety rule

`book_miles` and `pay_cash` are **internal tier tokens only**. They live in
`_TIER_META[...]["recommendation"]`, are used for tier calculation, and must never
be emitted on any external surface — including future live-award paths.

Every external emission point routes through `normalize_verdict()`:

- `build_decision()["verdict"]`
- `/api/top-opportunities` rows (`recommendation`)

`normalize_verdict()` is fail-closed: unknown, missing, legacy or already-normalized
input returns `insufficient_data`, never a value-bearing verdict.

No externally emitted field contains an imperative product decision — no "book",
"buy", "pay now" or equivalent. The only action the product asks the user to take
is the one in `verification_guidance`.

### Freshness fields

| Field | Meaning |
|---|---|
| `cash_freshness` | `live_query` (observed cash), `estimate` (derived), `none` (no cash context) |
| `freshness_label` | UI-only summary combining award liveness and cash recency |
| `evidence_refs.observed_at.cash` | provider timestamp of the evaluated cash offer |
| `evidence_refs.observed_at.award` | `fetched_at` / `last_seen_at` of the evaluated award option |

Freshness never upgrades a verdict. A recent timestamp on estimated award data
still cannot reach `miles_value_supported`.

### Completeness fields

| Field | Meaning |
|---|---|
| `evidence_refs.completeness.cash` | `complete`, `partial`, or provider-specific state |
| `evidence_refs.completeness.award` | `provider_reported` (live) or `estimated` |

A round-trip search whose cash side is not `complete` fails closed to
`insufficient_data` — an incomplete round trip must never produce a value claim.

### Evidence

`evidence` is an array of 0–2 rows; `evidence_refs` is the flattened index of the
same facts.

```json
{
  "kind": "cash_offer",
  "cash_offer_id": "cash-1",
  "award_option_id": null,
  "itinerary_ref": "itin-1",
  "trip_basis": "one_way",
  "completeness": "complete",
  "source": "serpapi",
  "observed_at": "2030-01-01T00:00:00Z"
}
```

`evidence_refs` keys: `cash_offer_id`, `award_option_id`, `itinerary_ref`,
`trip_basis` (`{cash, award}`), `completeness` (`{cash, award}`), `source`
(`{cash, award}`), `observed_at` (`{cash, award}`).

## Fail-closed behaviour

Ordered as evaluated in `build_decision()`. The first matching condition wins and
returns immediately.

| Condition | `verdict` | `signal` | `tier` | `estimated_value` |
|---|---|---|---|---|
| no award option | `insufficient_data` | `insufficient_data` | `null` | `null` |
| missing `cash_offer_id` or `itinerary_ref` | `insufficient_data` | `insufficient_data` | `null` | `null` |
| no cash context or no cpm | `availability_only` | `insufficient_data` | `null` | `null` |
| trip basis not compatible | `insufficient_data` | `insufficient_data` | `null` | `null` |
| round-trip request with incomplete cash | `insufficient_data` | `insufficient_data` | `null` | `null` |
| unknown / legacy tier token | `insufficient_data` | `mixed_value` | tier value | cpm |

## Compatibility expectations

- The key set is **exact**. Consumers may not rely on extra keys, and the backend
  may not drop keys, without a contract revision.
- The `signal` and `verdict` vocabularies are **closed sets**. A consumer that
  receives an unrecognised value must degrade to the most conservative framing
  (`Decision signal` + `More Evidence Required`), never to a stronger one.
- `tier` is internal calibration. It is exposed for debugging and must not drive
  user-facing copy on its own.
- V1 replaces the pre-V1 verdict tokens `book_miles`, `lean_miles`, `consider` and
  `pay_cash` outright. There is no aliasing: a consumer sending or expecting an old
  token receives the conservative fallback.

## Examples

### `strong_miles_value` (live award, complete identity)

```json
{
  "signal": "strong_miles_value",
  "label": "Miles may make sense here",
  "verdict": "miles_value_supported",
  "tier": "great",
  "confidence": "high",
  "confidence_reason": "live award data; recent cash context; official availability not yet confirmed",
  "estimated_value": 2.4,
  "evaluated_data_source": "live",
  "evaluated_cash_offer_id": "cash-1",
  "itinerary_ref": "itin-1",
  "trip_basis_compatible": true,
  "explanation": "About 2.4 cents per mile. The estimated cash fare is relatively high compared with the estimated mileage requirement."
}
```

The same award as a **static estimate** keeps `signal: "strong_miles_value"` but
its verdict is downgraded to `comparison_inconclusive`, so the UI shows
`Decision signal`, not `Recommendation`.

### `promising_miles_value`

```json
{
  "signal": "promising_miles_value",
  "label": "Estimated value looks promising",
  "verdict": "miles_value_leaning",
  "tier": "good",
  "estimated_value": 1.3,
  "explanation": "About 1.3 cents per mile. The estimated mileage requirement compares reasonably well with the estimated cash fare."
}
```

### `mixed_value`

```json
{
  "signal": "mixed_value",
  "label": "The comparison is currently mixed",
  "verdict": "comparison_inconclusive",
  "tier": "fair",
  "estimated_value": 0.9,
  "explanation": "About 0.9 cents per mile. Cash and miles are currently close in estimated value."
}
```

### `cash_may_be_stronger`

```json
{
  "signal": "cash_may_be_stronger",
  "label": "Cash may be stronger here",
  "verdict": "cash_value_supported",
  "tier": "poor",
  "estimated_value": 0.4,
  "explanation": "About 0.4 cents per mile. The mileage requirement is high relative to the estimated cash fare, so cash may be the simpler choice."
}
```

### `insufficient_data` (missing cash identity)

```json
{
  "signal": "insufficient_data",
  "label": "Not enough data for a reliable comparison",
  "verdict": "insufficient_data",
  "tier": null,
  "estimated_value": null,
  "confidence": "low",
  "evaluated_cash_offer_id": null,
  "itinerary_ref": null,
  "explanation": "The evaluated cash offer has no canonical identity.",
  "confidence_reason": "Missing cash-offer identity; no fallback inference is permitted."
}
```

## UI contract (`/app`)

`RECOMMENDATION_ELIGIBLE_VERDICTS` in `App.tsx` is the single gate between the
`Recommendation` and `Decision signal` framings. A decision qualifies for
`Recommendation` only when **all** hold:

1. `decision.evaluated_cash_offer_id` is present,
2. `decision.trip_basis_compatible === true`,
3. `decision.verdict` ∈ {`miles_value_supported`, `miles_value_leaning`, `cash_value_supported`},
4. the award trust layer independently allows a recommendation.

Any other verdict — including an unrecognised one — renders `Decision signal`.
The headline copy remains driven by `signal` (see `SIGNAL_COPY`), which stays
verification-oriented in every state.

## Related documents

- [docs/decision_engine_level_1.md](decision_engine_level_1.md) — Level 1 guardrails
- [docs/trust-contract.md](trust-contract.md) — award data-state trust layer
- [docs/decision_log.md](decision_log.md) — binding product decisions
