# Live-Data Trust Contract V1 — Award Data States

**Status: Draft for review** (AI-authored proposal; not a ratified product decision.)

## Purpose

AwardRadar must never sound more certain than its data allows. This contract
defines the exact, deterministic language the product is permitted to use for
each Award data state, so a provider *report* is never presented as a provider
*confirmation*, and a provider *failure* is never presented as "no availability".

Implementation (provider-free, deterministic):

- `awardradar_sources/awardradar_sources/google/src/trust/awardTrustContract.ts` — states, resolver, guardrails
- `.../src/trust/awardTrustFixtures.ts` — deterministic fixtures (fixed reference clock)
- `.../src/trust/AwardTrustNotice.tsx` — canonical presenter
- `.../src/trust/awardTrustContract.test.tsx` — guardrail tests

> Not yet wired into the live fetch path. Live wiring depends on provider
> clearance and is intentionally out of scope for V1.

## Canonical states

| State | Meaning |
|---|---|
| `live_provider_reported` | Provider response obtained during the current request. |
| `cached_recent` | Provider-reported data within the recent threshold. |
| `cached_stale` | Provider-reported data older than the recent threshold. |
| `estimated` | Historical / modeled / inferred; not direct availability. |
| `partial` | Only part of the itinerary or result set is reliable. |
| `no_results` | Provider responded successfully and reported no matches. |
| `rate_limited` | Provider returned 429 / quota response. |
| `provider_error` | Timeout, network failure, or provider 5xx. |
| `malformed_payload` | Response received but not safely interpretable. |
| `unavailable` | No trustworthy data state after internal handling. |

## Language matrix

| State | Freshness label | Allowed verdict | Verification |
|---|---|---|---|
| live_provider_reported | "Checked just now · Provider-reported" | external value verdict, if routing+ownership complete | mandatory |
| cached_recent | "Last checked X ago" | external value verdict, if complete | mandatory + "may have changed" |
| cached_stale | "Last checked X hours ago" | backend evidence-bounded signal only | "This result may no longer be available." |
| estimated | "Estimated, not confirmed availability" | backend evidence-bounded signal only; never `miles_value_supported` | mandatory; no seat claim |
| partial | "Partial result" (+ what is known/missing) | none | verify missing details |
| no_results | provider-reported | none | different dates/programs may differ |
| rate_limited | "Search temporarily unavailable due to provider limits." | none | retry later |
| provider_error | "Search temporarily unavailable." | none | retry later |
| malformed_payload | "We could not verify this result." | none | none |
| unavailable | "Availability data is currently unavailable." | none | none |

## Recommendation rules

A positive recommendation is blocked unless **all** hold:

- state is `live_provider_reported` or `cached_recent`
- `routingConfidence === 'complete'`
- `itineraryOwnershipVerified === true`
- not a round trip with a missing return leg
- backend verdict is one of the centralized recommendation-eligible values:
  `miles_value_supported`, `miles_value_leaning`, or `cash_value_supported`
  (Decision Contract V1 vocabulary; these replaced the pre-V1 internal tokens
  `book_miles`, `lean_miles` and `pay_cash`, which are no longer emitted — see
  [decision_contract_v1.md](decision_contract_v1.md))
- the decision carries the canonical `evaluated_cash_offer_id`

`cached_stale` and `estimated` never invent a generic verdict. They may show only
the backend's evidence-bounded decision signal and cannot produce a positive
booking recommendation.

## Paired cash identity

The canonical UI uses the paired `/api/cheap` → `/api/awards` flow.
`/api/awards` evaluates cash only when the request supplies the canonical
`cashOfferId` selected by `/api/cheap` and that ID resolves through the shared
cash-selection logic. Missing or mismatched identity does not trigger a second
cash selection: `selected_cash_offer_id` and `evaluated_cash_offer_id` remain
null, and the decision remains `insufficient_data`.

An `/api/awards` request without `cashOfferId` may still return award evidence,
but it has no standalone cash-comparison mode and cannot produce a cash-versus-
miles recommendation.

## Never list (forbidden language)

Guaranteed availability · guaranteed · Provider confirms · Confirmed seats ·
Book now · Reserve now · Transfer points now · Exact final taxes and fees ·
No seats available · No seats exist · No availability anywhere · Best option.

A concrete seat count is shown **only** with a provider basis **and** a timestamp.

## Freshness semantics

Provisional PRODUCT thresholds (not a provider guarantee), in
`FRESHNESS.RECENT_MAX_SECONDS`:

- **recent:** less than 4 hours
- **stale:** 4 hours or older

Kept as a single named constant so the policy is easy to change.

## Key distinctions

- **no_results vs provider_unavailable:** a successful "no matches" is never
  rendered with error language, and a failure (`rate_limited`, `provider_error`,
  `malformed_payload`, `unavailable`) is never rendered as "no seats".
- **provider-reported vs airline-verified:** provider data is always labelled
  "provider-reported" and always carries a verification requirement; it is never
  described as airline confirmation.

## Future provider-validation requirements

Before this contract is wired to live provider data:

- Seats.aero commercial clearance must be explicitly verified.
- A provider-backed end-to-end smoke must exercise each state with real
  responses mapped into the canonical states above.
- Seat counts, taxes/fees and routing must carry provider basis + timestamp
  before any concrete figure is rendered.
