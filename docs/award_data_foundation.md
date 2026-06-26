# Award Data Foundation

Status: closed

Branch: `codex/award-data-foundation`

## Mission

AwardRadar should move from directly coupled static award estimates toward a provider boundary for real award availability.

The first implementation is intentionally small:

- `AwardSource` provider boundary
- `StaticAwardSource`
- `/api/awards` routes static estimates through `StaticAwardSource`

This sprint does not add seats.aero calls, scraping, OAuth, accounts, payments, alerts, or background jobs.

## Closure

Award Data Foundation is `CLOSED`.

The Railway raw `/api/awards` JSON spotcheck passed for:

```text
FRA -> JFK
Business
2026-08-15
```

Verified estimate-row contract:

- `miles_required` present
- `taxes_fees` present
- `is_estimate=true`
- `is_live_data=false`
- `last_seen_at=null`
- `freshness_label="estimate"`
- `confidence_level="low"`
- `source="StaticAwardSource"`
- `source_type="static_estimate"`
- `data_source="estimated"`

Live provider rows remain separated with `data_source="live"` and do not falsely inherit static-estimate flags.

Current sequence:

```text
Raw JSON Spotcheck
-> Award Data Foundation CLOSED
-> Provider Feasibility Review
-> Cost & Rate Limit Guardrail
-> Real Provider Adapter
   or
-> Decision Engine L1 on Static Estimates + Cash References
```

## Product Principles

- Magic before monetization
- Real data before premium
- Decision engine before subscriptions
- Trust over engagement

## Current Award-Data Audit

AwardRadar currently has two award-data concepts:

- Static zone-based chart estimates in `MM_CHART`, `AEROPLAN_CHART`, and `UNITED_CHART`
- Optional seats.aero live availability code path guarded by `AWARD_SOURCE=seatsaero` and `SEATSAERO_API_KEY`

The existing static estimates are still useful as fallback data, but they should not be the final interface consumed by future product logic.

The selected implementation path for this sprint is `/api/awards`.

Unchanged paths:

- `/api/cheap`
- `/api/skiplag`
- SerpApi cash pricing
- Travelpayouts fallback behavior
- Discovery scans
- Booking link generation

## AwardSource Boundary

`AwardSource` is the provider boundary for award data.

Initial implementation:

```text
AwardSource
  StaticAwardSource
```

`StaticAwardSource` uses the existing static chart and surcharge estimates. It keeps existing compatibility fields while adding normalized fields for future Decision Engine consumption.

Compatibility fields retained:

- `program`
- `miles`
- `surcharge`
- `cpm`
- `grade`
- `url`
- `data_source`

Normalized fields added:

- `origin`
- `destination`
- `departure_date`
- `return_date`
- `trip_type`
- `requested_trip_type`
- `cabin`
- `program`
- `miles_required`
- `taxes_fees`
- `currency`
- `source`
- `source_type`
- `is_estimate`
- `is_live_data`
- `fetched_at`
- `last_seen_at`
- `freshness_label`
- `confidence_level`
- `provider_limitations`

## StaticAwardSource Metadata

Static estimates must be labeled honestly:

```json
{
  "source": "StaticAwardSource",
  "source_type": "static_estimate",
  "is_estimate": true,
  "is_live_data": false,
  "fetched_at": null,
  "last_seen_at": null,
  "freshness_label": "estimate",
  "confidence_level": "low"
}
```

Reason:

Static chart values are not observed availability. They have no live seat count, no observed last-seen timestamp, and no real freshness guarantee.

## Static Estimate Limitations

`StaticAwardSource` must be treated as directional estimate data only.

Limitations:

- Zone-based static estimate, not observed award availability
- Taxes and surcharges are typical estimates, not live priced
- No seat count
- No last-seen timestamp
- No married-segment logic
- No program-specific routing rules
- No carrier-specific award inventory

These estimates can support early Decision Card reasoning, but they must never be presented as verified availability.

## One-Way / Round-Trip Normalization

Award values are normalized per direction / one-way unless explicitly marked otherwise.

For a future round-trip decision, the Decision Engine should sum directional award values itself:

```text
outbound AwardSource result
+ inbound AwardSource result
= round-trip decision input
```

Do not assume a static award value is already round-trip unless a provider result explicitly marks it as round-trip data.

Current `trip_type` describes the award value unit, not necessarily the user request.

For `StaticAwardSource`, `trip_type` is always:

- `one_way`

If the user requested a round trip, the request context may be carried as:

- `requested_trip_type="round_trip"`

This prevents future code from treating one-way static chart values as full round-trip prices.

## Decision Engine Dependency Notes

The future Decision Engine should consume normalized `AwardSource` results rather than direct chart dictionaries or provider-specific response bodies.

Minimum fields to consume:

- `miles_required`
- `taxes_fees`
- `currency`
- `cabin`
- `program`
- `trip_type`
- `source`
- `source_type`
- `is_estimate`
- `is_live_data`
- `fetched_at`
- `last_seen_at`
- `freshness_label`
- `confidence_level`
- `provider_limitations`

Decision logic should use source metadata when explaining confidence.

Example:

```text
Static estimate:
  Good for value approximation.
  Not enough to say "book now".

Live provider result:
  Can support availability-aware recommendations if provider freshness and terms allow it.
```

## Caching and Freshness Strategy

Provider data should expose freshness explicitly.

Static estimates:

- no network fetch
- no provider freshness
- `fetched_at=null`
- `last_seen_at=null`
- `freshness_label="estimate"`

Future live provider results may use:

- `fetched_at`: when AwardRadar fetched the provider result
- `last_seen_at`: when the provider last observed availability, if exposed
- `freshness_label`: `live`, `recent`, `cached`, `stale`, or provider-specific mapped labels
- `confidence_level`: `high`, `medium`, `low`

Cache behavior should be implemented provider-by-provider. Knowledge that a provider exists must not automatically imply extra API calls.

## Future seats.aero Integration Notes

No new seats.aero implementation is added in this sprint.

Before expanding the current integration, verify official seats.aero documentation or written provider guidance for:

- API access model
- required authorization headers
- OpenAPI specification availability
- `llms.txt` availability
- cache/update frequency
- usage-based call limits
- OAuth2 or "Login with seats.aero" feasibility
- per-user credential support
- terms around data use, resale, redistribution, caching, and user-linked access

Current public-web research during this sprint did not produce a stable official documentation source suitable for new implementation claims. Treat existing code assumptions as implementation history, not as new product policy.

## Credential Strategy

AwardSource should support two future credential modes:

1. Global provider credentials
2. Per-user provider credentials

Global credentials:

- AwardRadar owns one provider credential
- useful for product-wide search and discovery
- requires strict quota controls

Per-user credentials:

- user links their provider account or API access
- useful if provider terms require user-level access
- requires accounts, OAuth or token storage, revocation, and privacy review

This sprint implements neither. The shape is documented so the provider boundary does not block either model later.

## Non-Goals

- No scraping
- No paid provider calls
- No OAuth
- No account system
- No alerts
- No background jobs
- No subscription logic
- No UI redesign
- No broad cash-search refactor

## Success Criteria

The sprint is successful when:

- `AWARD_SOURCE` remains switchable
- `/api/awards` still works
- `/api/awards` uses `StaticAwardSource` for static estimates
- static program rows expose:
  - `is_estimate=true`
  - `is_live_data=false`
  - `freshness_label="estimate"`
  - `confidence_level="low"`
- Decision Engine input fields are documented
- current behavior remains stable
