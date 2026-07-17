# Provider Feasibility Review

> **Document status: STALE PLANNING SNAPSHOT.** An optional seats.aero adapter,
> endpoint wiring and budget guard now exist in the repository, so the original
> “implementation authorization: none” statement no longer describes the code
> state. This file still provides no evidence of commercial/external provider
> approval. See [Canonical Repository State](canonical_state.md).

Status when written: documentation-only planning dossier

Provider approval: none

Implementation authorization when written: none

## Why This Review Exists

AwardRadar needs real award data eventually, but it must not assume that a provider is legally, technically, commercially, or economically suitable before verification.

AwardSource is the strategy. Providers are adapters.

The provider layer must protect AwardRadar from:

- provider lock-in
- unsupported commercial use
- unclear redistribution rights
- hidden caching restrictions
- rate-limit and cost shocks
- terms-of-service workarounds
- scraping-based architecture
- ranking or recommendation corruption

Seats.aero is a candidate, not the foundation.

## Core Principles

- AwardSource is the strategy.
- Providers are adapters.
- Seats.aero is a candidate, not the foundation.
- No scraping.
- No ToS workaround.
- No provider lock-in.
- Provider first. Provider lock-in never.
- Credits are welcome. Lock-in is not.
- Funding is welcome. Scope distortion is not.
- Social presence is useful. Social media is not the product.
- Partnerships are welcome. Ranking corruption is not.

## Provider Candidate Table

| Provider | API access known? | Authentication model | Commercial use allowed? | Redistribution allowed? | Caching allowed? | Rate limits | Cost risk | European program coverage | Data freshness | Technical fit | Legal/commercial risk | Go / No-Go / Later | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| seats.aero | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | likely relevant, requires verification | unknown / requires official verification | likely candidate, requires verification | unknown until official terms reviewed | Later | Candidate only. Do not implement further without official documentation and terms review. |
| Alternative award availability provider TBD | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | unknown / requires official verification | Later | Keep provider-neutral. Do not design AwardRadar around a single vendor. |
| Static Estimates + Cash References fallback | yes, internal | none | yes, internal | yes, internal | yes, internal | none beyond AwardRadar infrastructure | low | limited by internal chart coverage | estimate only | strong fallback | low if labeled honestly | Go as fallback | Suitable for Decision Engine L1 if live provider access is blocked, too expensive, legally unclear, or strategically risky. |

## Review Dimensions

### API Access

Verify whether an official API exists, whether it is documented, and whether AwardRadar is allowed to use it in production.

Required evidence:

- official documentation
- formal partner terms or written permission
- endpoint list and supported query patterns
- availability of production and test access

Unknown claims must remain unknown until verified.

### Authentication

Verify the authentication model before writing adapter code.

Questions:

- Is access based on global provider credentials?
- Is access tied to a user account?
- Are user-provided credentials allowed?
- Is OAuth or provider login supported?
- How are tokens revoked?
- Are credentials allowed to be stored by AwardRadar?

Do not implement credential storage before privacy, accounts, and security foundations exist.

### Commercial Use

Verify whether AwardRadar can use provider data in a commercial product.

Questions:

- Is commercial use allowed?
- Is commercial use allowed for a startup MVP?
- Does usage require a paid plan, contract, or written permission?
- Are there restrictions on paid products, affiliate use, or premium recommendations?

If commercial use is unclear, the provider is not approved.

### Redistribution

Verify what AwardRadar can display to users.

Questions:

- Can AwardRadar display availability?
- Can AwardRadar display mileage costs?
- Can AwardRadar display seat counts?
- Can AwardRadar display last-seen timestamps?
- Can AwardRadar store or show derived recommendations based on provider data?
- Are screenshots, exports, or cached displays restricted?

If redistribution or display rules are unclear, the provider is not approved.

### Caching

Verify caching rules before adding or changing cache behavior.

Questions:

- Is caching allowed?
- What cache duration is allowed?
- Can provider data be persisted?
- Can provider data be shared across users?
- Must cached data be deleted after a period?
- Must stale data be labeled?

AwardRadar must surface freshness and uncertainty explicitly.

### Rate Limits

Verify quota and rate-limit behavior before production use.

Questions:

- What are daily, hourly, and per-minute limits?
- Are limits global or per user?
- Are there burst limits?
- Are headers exposed for remaining quota?
- What happens on 429 responses?
- Are retries allowed?

Rate limits must fit AwardRadar's discovery and user-search patterns without budget surprises.

### Cost Risk

Verify cost exposure before implementation.

Questions:

- Is pricing fixed, usage-based, or negotiated?
- Can one user create excessive cost?
- Can discovery scans create runaway cost?
- Can provider failures cause retry storms?
- Are there hard spend caps?

Provider adapters need explicit cost and rate-limit guardrails.

### European Program Coverage

AwardRadar's early edge is DACH / Europe / Star Alliance intelligence.

Review:

- Miles & More relevance
- Lufthansa Group relevance
- Star Alliance coverage
- Flying Blue, Avios, Turkish, Aeroplan, United and other partner relevance
- Europe-to-long-haul route coverage
- cabin coverage from economy to first

A provider with weak European coverage may still be useful, but should not define the product foundation.

### Data Freshness

Verify what freshness means for each provider.

Questions:

- Is data live, cached, crowd-sourced, or periodically scanned?
- Is `last_seen_at` available?
- Is `fetched_at` available or generated by AwardRadar?
- Is seat count current or historical?
- Are married-segment or origin/destination quirks represented?

AwardSource results must expose freshness metadata rather than hide uncertainty.

### Provider Limitations

Each provider adapter must document limitations in the normalized AwardSource result.

Examples:

- cache age
- unsupported cabins
- missing taxes and surcharges
- no seat count
- incomplete program coverage
- source-specific availability quirks

### Fallback Behavior

Provider failure must not collapse AwardRadar's decision layer.

Fallback order may include:

1. live provider data when approved and available
2. cached provider data if allowed and labeled
3. Static Estimates + Cash References
4. explicit no-data state

Fallback must be honest. Estimate data must not be presented as live availability.

### Go / No-Go Recommendation

Every provider review should end with one of:

- Go
- No-Go
- Later

No provider should receive a Go recommendation until official documentation and terms are verified.

## Provider Decision Gates

### Gate 1 - Official Documentation Found

Official provider documentation, partner terms, or written provider guidance exists and is accessible for review.

### Gate 2 - API Access Confirmed

Production API access is confirmed, including endpoints, query patterns, and availability of credentials.

### Gate 3 - Commercial Use Allowed

Commercial use is explicitly allowed or contractually approved.

### Gate 4 - Redistribution / Display Rules Clear

AwardRadar knows exactly what data can be displayed, transformed, cached, and used in recommendations.

### Gate 5 - Caching Rules Clear

Cache duration, storage scope, deletion requirements, and stale-data labeling requirements are clear.

### Gate 6 - Rate Limits Acceptable

The provider's limits can support AwardRadar usage without unstable product behavior or budget exhaustion.

### Gate 7 - Cost Risk Acceptable

Costs are predictable, capped, or otherwise manageable for the current stage.

### Gate 8 - European Program Coverage Useful

Coverage is useful for AwardRadar's DACH / Europe / Star Alliance positioning.

### Gate 9 - Integration Does Not Corrupt AwardSource Contract

The adapter can normalize provider data into the AwardSource contract without leaking provider-specific assumptions into the Decision Engine.

### Gate 10 - Go / No-Go Decision

The provider receives an explicit decision:

- Go: adapter implementation may be planned
- Later: revisit after missing evidence or partnership work
- No-Go: do not implement

## Fallback Paths

### Path A - Real Provider Adapter

Use this path only if provider terms, rate limits, caching, costs, and technical fit are acceptable.

Requirements:

- official documentation reviewed
- commercial use approved
- caching and display rules clear
- cost and rate-limit guardrails designed
- AwardSource normalization preserved

### Path B - Decision Engine L1 on Static Estimates + Cash References

Use this path if live provider access is blocked, too expensive, legally unclear, or strategically risky.

This path can still improve AwardRadar by combining:

- static award estimates
- cash references
- taxes and surcharge estimates
- route and cabin context
- transparent confidence labels

Decision Engine L1 must not claim live availability when using estimates.

### Path C - Partnership-First Path

Use this path if provider API access requires explicit commercial agreement.

Recommended work:

- provider contact list
- partner narrative
- usage summary
- commercial permission request
- data display and caching proposal

No adapter work should start until permission is clear.

### Path D - User-Provided Credentials / BYO Provider

Future only.

This path requires:

- accounts
- privacy review
- credential storage design
- revocation design
- security review
- user-facing provider connection flow

Not MVP.

## Explicit Exclusions

This sprint does not authorize:

- scraping
- ToS workarounds
- committed credentials
- provider code
- live API calls
- Decision Engine implementation
- UI changes
- monetization logic
- account or credential storage
- provider-specific assumptions without official source verification

## Recommended Next Action

Next step: official source review of candidate providers.

Do not recommend implementation until provider documentation and terms are verified.

Recommended review artifacts:

- official documentation links
- terms and commercial-use excerpts
- rate-limit evidence
- caching and display rules
- cost model
- coverage notes
- go / no-go recommendation

## Relation to Current Award Data Gate

The Award Data Foundation is:

```text
CLOSED
```

The raw `/api/awards` metadata spotcheck is:

```text
PASSED
```

Reason:

```text
Railway raw JSON verified the AwardSource metadata contract.
```

This provider feasibility review did not close the Award Data Foundation by itself. The separate Railway raw JSON spotcheck closed it.

Verified estimate rows include:

- `miles_required`
- `taxes_fees`
- `is_estimate=true`
- `is_live_data=false`
- `last_seen_at=null`
- `freshness_label="estimate"`
- `confidence_level="low"`

Live provider rows remain separated with `data_source="live"` and do not falsely inherit static-estimate flags.
