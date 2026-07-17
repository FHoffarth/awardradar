# AwardRadar Roadmap & Programming Memo

Version: v1.5
Status: Active Product & Engineering Roadmap
Last updated: 2026-07-17
Project: AwardRadar
Positioning: Premium Travel Intelligence for Frequent Flyers

## 1. Current Status

The repository-backed current state is maintained in
[Canonical Repository State](canonical_state.md). Flask remains AwardRadar's
backend and server layer. The repository contains three web surfaces and one
isolated foundation:

```text
/             active React/Vite entry surface
/app          active canonical React/Vite application; one-way only
/tool         active frozen legacy Flask/Jinja/static-JS application
intelligence/ isolated foundation; not wired into app.py
```

New product development targets `/app` only. Backend or `/tool` capabilities do not count as canonical product features until integrated into `/app`.

Authoritative cross-references:

- [Decision Log](decision_log.md)
- [Canonical Repository State](canonical_state.md)
- [Repository overview](../README.md)

The project has moved from a pure award-flight search tool toward a broader product vision:

```text
AwardRadar is building premium travel intelligence for frequent flyers.
```

Current repository-backed foundation:

- Flask/Gunicorn application and API routes;
- React/Vite landing and canonical one-way decision workspace;
- reachable legacy `/tool` surface with additional non-canonical capabilities;
- AwardSource boundary with static estimates and an optional seats.aero path;
- SerpApi cash context, Travelpayouts fallback and provider observability;
- consent and browser-local saved-search foundations on the legacy surface;
- process-local provider guards and caches with documented scaling limits;
- an isolated `intelligence/` foundation that is not part of the web runtime.

The repository does not prove a current production deployment, Railway
configuration, smoke-test result, provider quota or provider approval.

Current product boundary:

```text
/app is canonical but currently one-way only.
/tool remains reachable legacy.
intelligence/ is not runtime-integrated.
```

## 2. Core Product Vision

AwardRadar is not just an award search engine.

AwardRadar is building an operating system for frequent flyers.

The product should help travelers answer:

- Which flight should I book with my miles?
- Which loyalty program gives me the best value?
- When should I book?
- How do I maintain or achieve elite status?
- What should I know before I travel?
- Which option is best for my personal travel profile?

Core product statement:

```text
AwardRadar remembers.
AwardRadar understands.
AwardRadar recommends.
```

## 3. Strategic Positioning

Category:

```text
Premium Travel Intelligence
```

Primary user group:

```text
Frequent flyers, premium travelers, miles & points users, business travelers, status optimizers.
```

Core promise:

```text
Know when to book.
```

Supporting promises:

- Find where your miles go further.
- Travel is complicated. AwardRadar makes it intelligible.
- Users think in journeys. AwardRadar searches the system behind them.

Near-term product wedge:

```text
Find where your miles go further.
```

AwardRadar must not become a well-governed shell around static estimates. The product core must move toward real award data and reliable booking intelligence.

## 4. Core Product Principles

Product sequencing:

```text
Memory before identity.
Identity before personalization.
Personalization before automation.
Automation before notifications.
```

Product core:

```text
Magic before monetization.
Real data before premium.
Decision engine before subscriptions.
```

Privacy principles:

```text
Consent before measurement.
No analytics without consent.
First privacy. Then identity.
Collect only what we need.
```

Commercial principles:

```text
Trust first. Revenue second.
No revenue before money layer.
No payment code before provider strategy.
No private money routing.
Never build our own payment processor.
```

AI principle:

```text
AI does not replace AwardRadar's Decision Engine.
AI makes decisions easier to understand and act on.
```

## 5. Current Gate Logic

Product-surface decision:

- [AR-DEC-001 — Canonical Product Surface](decision_log.md#ar-dec-001--canonical-product-surface) is **FROZEN**.
- `/app` is the only canonical product surface.
- `/tool` is frozen legacy and receives no new product development.

### Gate A

Status:

```text
OPEN
```

Gate A remains open because:

- the Decision Log is established through the AR-DEC-001 documentation patch;
- GitHub Security S1 remains open;
- Nebentätigkeit clarification remains open;
- Round-trip scope is clarified, but React `/app` integration is not complete.

### Gate C Round-trip Requirement

Unresolved binary decision:

```text
A. One-way-only /app is sufficient for controlled beta
or
B. React Round-trip Integration is required before controlled beta
```

Status:

```text
UNDECIDED
```

Neither A nor B is selected by this documentation patch.

### Cash Round-trip Result Integrity

Current status:

- Backend/API implementation: merged into `main`.
- Legacy `/tool` rendering and continuation flow: merged into `main`.
- React `/app` integration: not implemented.
- Credentialed staging smoke: not evidenced.
- Production round-trip smoke: not evidenced.
- Therefore Cash Round-trip Result Integrity is not complete as a canonical `/app` feature.

Process deviation:

- Round-trip hardening was merged without a retained, attributable staging-smoke record.
- Itinerary Ownership & Comparison Integrity is a separate merged stream:
  - branch: `fix/itinerary-ownership-integrity`
  - commit: `63f46ca`
  - merge: `94c8abc`
- These streams must not be merged or conflated.

### Round-trip Performance & Rollout

Legacy-targeting status:

```text
SUPERSEDED by AR-DEC-001
```

Future scope placeholder:

```text
React Round-trip Integration
```

Prerequisites:

- binary Gate-C decision on One-way-only beta sufficiency;
- explicit React UX/API scope;
- fresh acceptance criteria;
- staging and production smoke definitions;
- provider quota available for credentialed validation.

No implementation sprint is created by this placeholder.

### Historical foundation sequence

The following sequence is retained as roadmap history and is not the current
sprint declaration. Statuses in Section 6 are historical work-package records;
they must not override `canonical_state.md` or be read as live deployment
evidence.

1. consent-management-foundation
2. saved-searches-foundation
3. award-data-foundation
4. award-source-seatsaero
5. decision-engine-foundation
6. privacy-review-accounts
7. email-infrastructure-foundation
8. money-layer-strategy
9. accounts-foundation
10. payment-provider-strategy
11. premium/freemium-foundation
12. traveler-profile-foundation
13. flight-result-cards-v2
14. award-alerts-foundation
15. status-intelligence-foundation

One-line roadmap:

```text
Consent -> Memory -> AwardSource -> Real Data -> Decision Engine -> Privacy -> Email -> Money -> Identity -> Payments -> Premium -> Personalization -> Context -> Alerts -> Status
```

Strategic principle:

```text
Trust architecture first. Product memory second. Motor before monetization.
```

## 6. Roadmap Detail

> **Historical catalog.** Branch names, completion labels, verification notes
> and sequencing below record the state of individual work packages when they
> were written. They are not the current repository or deployment status unless
> restated in Sections 1 or 5 above.

## 6.1 consent-management-foundation

Status:

```text
DONE / merged / production verified
```

Branch:

```text
codex/consent-management-foundation
```

Commit:

```text
48d6613 Add consent management foundation
```

Mission:

```text
Implement a privacy-first consent management foundation for AwardRadar.
```

Principles:

```text
Consent before measurement.
No analytics without consent.
```

Completed scope:

- Cookie/Consent Banner Foundation
- Analytics category
- Consent storage
- Change/withdraw preferences
- GTM/GA4 blocked until consent
- Clarity indirectly blocked because GTM only loads after consent
- Datenschutz update
- Consent stored in `awardradar_consent`
- Privacy settings button for later changes
- GA cookies removed on withdrawal
- Production browser test completed

Verified:

- First visit shows banner.
- Reject loads no GTM/GA4/Clarity.
- Accept loads GTM/GA4.
- Reload after accept keeps analytics active.
- Privacy settings -> Reject removes analytics again.
- `py_compile app.py` passes.
- `node --check static/consent.js` passes.
- Existing pages remain live.
- No `.claude/` or `AGENTS.md` staged.

## 6.2 saved-searches-foundation

Status:

```text
IN PROGRESS / current Codex branch
```

Branch:

```text
codex/saved-searches-foundation
```

Mission:

```text
Create the foundation for saved searches in AwardRadar.
```

Product principle:

```text
Memory before identity.
```

Goal:

```text
Search -> Save -> Return
```

Context:

AwardRadar must introduce product memory without introducing user identity yet.

Scope:

- Create a SavedSearch foundation.
- Keep it minimal, internal, and maintainable.
- Prepare the data model/structure for future accounts.
- Allow saved searches to exist without requiring user accounts for now.
- Add a small service or persistence layer if appropriate.
- Add minimal API/internal functions only if useful.
- Document how saved searches will later connect to accounts and alerts.

Suggested SavedSearch fields:

- `id`
- `user_id` nullable for now
- `origin`
- `destination`
- `departure_date`
- `return_date`
- `cabin`
- `programs`
- `passengers`
- `created_at`
- `updated_at`
- `is_active`

Document-only future fields:

- `alert_frequency`
- `last_checked_at`
- `notification_channels`
- `traveler_profile_id`

Guardrails:

- No accounts.
- No login.
- No email collection.
- No alerts.
- No notifications.
- No background jobs.
- No major UI redesign.
- No traveler profiles.
- No product logic regressions.
- Do not change consent logic unless strictly necessary.
- Do not stage `.claude/` or `AGENTS.md`.
- Never use `git add .`.
- Work only on the dedicated branch.
- Do not merge.

Acceptance criteria:

- Existing search functionality remains unchanged.
- SavedSearch foundation exists.
- Saved searches can be created/stored/retrieved in a minimal form, or persistence foundation is clearly documented if UI/API activation is intentionally deferred.
- Future connection to accounts is documented.
- Future connection to alerts is documented.
- `python -m py_compile app.py` passes.
- If JavaScript is changed, `node --check` passes for changed JS files.
- Existing pages still return 200 where applicable.
- Only explicit task files are staged.
- `.claude/` and `AGENTS.md` remain untracked.

## 6.3 award-data-foundation

Status:

```text
PLANNED - immediately after saved-searches-foundation
```

Branch:

```text
codex/award-data-foundation
```

Mission:

```text
Prepare AwardRadar to move from static award-chart estimates toward real award availability and verified award data sources.
```

Core principles:

```text
Magic before monetization.
Real data before premium.
Decision engine before subscriptions.
```

Primary sprint goal:

```text
Create a working AwardSource abstraction layer and route the existing static award estimate logic through it.
```

This sprint must not be documentation-only. It must include at least one functioning AwardSource implementation:

```text
StaticAwardSource
```

The existing `MM_AWARD_CHART` / estimate logic should become the first implementation behind the AwardSource interface.

Suggested architecture:

- AwardSource interface/provider boundary
- StaticAwardSource implementation using existing static estimate logic
- Configurable `AWARD_SOURCE` setting if appropriate
- Future SeatsAeroAwardSource placeholder or documentation
- Cache/freshness-aware metadata shape
- Provider limitation documentation

Narrow implementation rule:

```text
Route only the award-data path through AwardSource in this sprint.
```

Preferred first code path:

```text
/api/awards or the existing sweet-spot/award endpoint that currently consumes MM_AWARD_CHART or static award estimates
```

Do not refactor unrelated cash-search flows:

- cheap/cash search remains untouched
- skiplag/cash logic remains untouched
- pricing/SerpApi cash logic remains untouched unless strictly necessary for preserving existing behavior

Required StaticAwardSource metadata:

- `is_estimate=true`
- `is_live_data=false`
- `last_seen_at=null`
- `freshness_label="estimate"`
- `confidence_level="low"`

Reason:

Static estimates do not have observed availability or freshness. Future real providers may later populate `last_seen_at`, `fetched_at`, `freshness_label`, and `confidence_level` with stronger data.

Required normalized result fields for future Decision Engine compatibility:

- `origin`
- `destination`
- `departure_date`
- `return_date` where available
- `trip_type`
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

Trip direction rule:

Award values should be normalized per direction / one-way.

If a round-trip search is represented, the future Decision Engine should sum directional award values itself rather than assuming a static award value is already round-trip unless explicitly marked.

Decision Engine dependency notes:

The Decision Engine must later consume normalized AwardSource results rather than directly reading `MM_AWARD_CHART` or provider-specific data structures.

At minimum, the future Decision Engine should consume:

- `miles_required`
- `taxes_fees`
- `currency`
- `cabin`
- `program`
- `trip_type`
- `source`
- `is_estimate`
- `is_live_data`
- `fetched_at`
- `last_seen_at`
- `freshness_label`
- `confidence_level`

seats.aero research assumptions to verify against official documentation before treating as implementation facts:

- API access model
- Partner-Authorization header
- OpenAPI specification availability
- `llms.txt` availability
- cache/update frequency
- usage-based call limits
- OAuth2 / Login with Seats.aero flow
- per-user credential support
- terms of service around data use, resale, redistribution, and user-linked access

Important future requirement:

AwardSource should be designed so it can later support both:

1. global provider credentials
2. per-user provider credentials

This prepares AwardRadar for a possible future provider-linked model such as "Login with seats.aero", without implementing OAuth in this sprint.

Guardrails:

- No seats.aero integration yet unless valid credentials and official docs are available.
- No scraping.
- No Terms-of-Service violations.
- No paid provider calls required.
- No OAuth implementation.
- No user accounts.
- No payments.
- No alerts.
- No background jobs.
- No major UI redesign.
- Do not refactor unrelated cash-search paths.
- Do not remove the existing static fallback behavior.
- Do not break current search behavior.
- Do not stage `.claude/` or `AGENTS.md`.
- Never use `git add .`.
- Work only on the dedicated branch.
- Do not merge.

Deliverables:

- Working AwardSource abstraction
- Working StaticAwardSource implementation
- Existing estimate/static award logic routed through StaticAwardSource for at least one real award endpoint/path
- `docs/award_data_foundation.md`
- Current award-data audit
- Static estimate limitations
- seats.aero integration research notes
- Caching and freshness strategy
- Future per-user credential strategy
- Concrete Decision Engine dependency notes
- One-way / round-trip normalization notes

Acceptance criteria:

- Existing search behavior remains stable.
- StaticAwardSource is functional.
- At least one real code path uses the AwardSource boundary.
- Existing static estimate logic is no longer only a free-floating direct dependency for the selected award path.
- Normalized AwardSource result fields are documented.
- Static estimates honestly expose `is_estimate=true`, `is_live_data=false`, `last_seen_at=null`, `freshness_label="estimate"`, `confidence_level="low"`.
- Award values are documented as per-direction / one-way unless explicitly marked otherwise.
- Decision Engine input fields are documented concretely, not as TBD.
- Future seats.aero integration path is documented but not hard-coded without verified docs/credentials.
- Unrelated cash-search paths are not refactored.
- `python -m py_compile app.py` passes.
- Existing pages still return 200 where applicable.
- Only explicit task files are staged.
- `.claude/` and `AGENTS.md` remain untracked.

Personal visible success criterion:

The sprint is successful if:

- `AWARD_SOURCE` can be switched.
- `/api/awards` still works.
- The response visibly exposes:
  - `is_estimate: true`
  - `is_live_data: false`
  - `freshness_label: "estimate"`
  - `confidence_level: "low"`

This proves that the new AwardSource path is not just documented but actually powered.

## 6.4 award-source-seatsaero

Status:

```text
PLANNED - follow-up after award-data-foundation
```

Branch:

```text
codex/award-source-seatsaero
```

Mission:

```text
Connect AwardRadar's AwardSource abstraction to seats.aero or another verified real award availability provider once valid credentials, API access, and terms have been reviewed.
```

Core principle:

```text
Plug real data into the engine quickly after creating the socket.
```

Dependency:

```text
Requires codex/award-data-foundation.
```

Preconditions:

- Valid API/provider access exists.
- Provider documentation reviewed.
- Rate limits understood.
- Terms of service reviewed.
- Caching strategy defined.
- No credential is committed to the repo.
- Environment variable strategy exists.

Scope:

- Implement SeatsAeroAwardSource behind the AwardSource interface.
- Use environment variables for provider credentials.
- Respect provider rate limits.
- Add provider-level caching with TTL.
- Preserve existing static fallback source.
- Add data freshness labels.
- Clearly mark provider data as cached/observed if not live.
- Handle provider failures gracefully.
- Do not block search results if provider data is unavailable.

Potential configuration:

- `AWARD_SOURCE=static`
- `AWARD_SOURCE=seatsaero`
- `SEATSAERO_API_KEY` or equivalent provider credential
- `SEATSAERO_CACHE_TTL`
- `SEATSAERO_TIMEOUT`

Not in this sprint:

- No accounts unless already implemented.
- No OAuth user-linking unless explicitly scoped.
- No payment logic.
- No premium gating.
- No alerts.
- No background jobs.
- No provider credential storage in database unless privacy/security review is complete.
- No scraping.
- No Terms-of-Service-risky redistribution.

Acceptance criteria:

- seats.aero/provider source can be enabled via configuration.
- Static fallback remains available.
- Provider failures degrade gracefully.
- Cache/freshness behavior is visible in logs or result metadata.
- No secrets are committed.
- Existing search behavior remains stable.
- `python -m py_compile app.py` passes.

## 6.5 decision-engine-foundation

Status:

```text
PLANNED - after award-data-foundation and preferably after first real provider integration
```

Branch:

```text
codex/decision-engine-foundation
```

Mission:

```text
Turn award data into booking intelligence.
```

Core principle:

```text
Consolidate existing valuation logic before inventing new recommendation logic.
```

Existing valuation logic such as `sweet_spot_grade()` and CPM thresholds should be treated as the initial Decision Engine seed, not duplicated by a parallel new system.

First-stage Decision Engine:

- good value
- poor value
- excellent redemption
- high taxes
- better via another program
- estimate only
- verify externally
- data freshness warning

Not first-stage:

- book now
- wait
- price trend prediction
- availability trend prediction
- urgency scoring

Reason:

"Book now" and "wait" require time-series data, historical availability, repeated checks, and trend signals. Those depend on saved searches, periodic checks, and alert infrastructure.

Decision Engine maturity levels:

```text
Level 1: Static valuation verdicts.
Level 2: Provider-aware verdicts with freshness and confidence.
Level 3: Cross-program comparison.
Level 4: Historical trend-aware recommendations.
Level 5: Personalized traveler-aware recommendations.
```

Guardrails:

- No duplicated valuation engine.
- No unsupported urgency claims.
- No "book now/wait" before trend data exists.
- No hidden commercial bias.
- No provider data overclaiming.
- Always distinguish estimate, cached observation, and verified availability.
- Decision Engine must consume normalized AwardSource results.
- Decision Engine must not directly read `MM_AWARD_CHART` or provider-specific raw data structures.

## 6.6 privacy-review-accounts

Status:

```text
PLANNED
```

Branch:

```text
codex/privacy-review-accounts
```

Mission:

```text
Prepare AwardRadar for user identity before any account or login functionality is implemented.
```

Core principles:

```text
First privacy. Then identity.
Collect only what we need.
```

Deliverables:

- `docs/privacy_accounts.md`
- `docs/security_accounts.md`
- Datenschutz section draft for accounts
- Account data minimization policy
- Cookie/session concept
- Lightweight threat model
- Password policy
- Session lifetime policy
- Account deletion concept
- Data retention policy

MVP account data allowed:

- email
- password_hash
- created_at

Not in MVP:

- name
- address
- phone number
- birthdate
- passport information
- payment information
- loyalty credentials

Security direction:

- Passwords never stored in plain text.
- Argon2id preferred, bcrypt acceptable.
- Secure session cookies.
- HttpOnly cookies.
- CSRF protection.
- HTTPS only in production.
- Minimal account data.
- Clear deletion path.

Guardrails:

- No login implementation.
- No account model implementation unless only documented.
- No email sending.
- No payment logic.
- No premium gating.

## 6.7 email-infrastructure-foundation

Status:

```text
PLANNED
```

Branch:

```text
codex/email-infrastructure-foundation
```

Mission:

```text
Prepare AwardRadar for professional domain-based email communication without operating a custom email server.
```

Principle:

```text
Never run our own mail server.
```

Recommended MVP addresses:

- `hello@awardradar.app`
- `support@awardradar.app`
- `privacy@awardradar.app`

Later technical addresses:

- `no-reply@awardradar.app`
- `security@awardradar.app`

Potential providers:

Inbound/domain email:

- Google Workspace
- Proton Mail Business
- Cloudflare Email Routing
- Microsoft 365 Business

Transactional mail later:

- Resend
- Postmark
- Mailgun
- SendGrid
- Amazon SES

Guardrails:

- No own mail server.
- No account emails before account privacy review.
- No newsletter before marketing consent strategy.
- No automated alert emails before alert architecture.
- Do not use private Gmail as production sender identity.

## 6.8 money-layer-strategy

Status:

```text
PLANNED
```

Branch:

```text
codex/money-layer-strategy
```

Mission:

```text
Prepare AwardRadar for clean revenue handling before any paid product, Founding Member offer, premium tier, support/donation-like flow, or subscription goes live.
```

Core principles:

```text
No revenue without money routing.
Separate business money from private money.
Premium payments, boring infrastructure.
Never build our own payment processor.
No private bank account for production revenue.
```

Potential business account options to evaluate:

- Qonto
- Finom
- N26 Business
- Revolut Business
- Holvi
- Fyrst
- Traditional bank account via Sparkasse, Volksbank, Commerzbank, etc.

Potential accounting tools:

- lexoffice
- sevDesk
- DATEV export
- tax advisor workflow

MVP rules:

- No payment code before payment-provider strategy.
- No paid premium tier before account foundation.
- No subscription logic before user accounts.
- No private bank account for production revenue.
- No crypto in MVP.
- No custom payment processing.
- No card data stored by AwardRadar.
- No revenue feature before payment, legal, and accounting decisions are documented.

Suggested deliverable:

```text
docs/money_layer_strategy.md
```

## 6.9 accounts-foundation

Status:

```text
PLANNED
```

Branch:

```text
codex/accounts-foundation
```

Mission:

```text
Introduce user accounts only after privacy, security, email, and money-layer strategy have been documented.
```

Product principle:

```text
Identity before personalization.
```

MVP goal:

```text
Users can create an account and log in.
```

Allowed MVP data:

- email
- password_hash
- created_at

Not in MVP:

- name
- address
- phone number
- birthdate
- passport information
- payment information
- loyalty credentials
- travel document data

Guardrails:

- Must follow privacy-review-accounts output.
- Must follow email-infrastructure-foundation output.
- No premium billing in this sprint.
- No traveler profile in this sprint.
- No alerts.
- No unnecessary personal data.

## 6.10 payment-provider-strategy

Status:

```text
PLANNED
```

Branch:

```text
codex/payment-provider-strategy
```

Mission:

```text
Prepare AwardRadar for premium subscriptions and founding memberships without introducing payment code prematurely.
```

Recommended direction:

- Stripe as primary candidate for subscriptions, checkout, payment links, cards, SEPA and wallets.
- PayPal Business as optional secondary payment method later.
- Paddle or Lemon Squeezy as Merchant-of-Record candidates for international SaaS/VAT simplification.
- Crypto explicitly out of MVP.

Guardrails:

- No payment code yet.
- No premium gating yet.
- No crypto in MVP.
- No storing card data.
- No custom payment processing.
- No subscription logic before accounts exist.
- No marketing claims before pricing is finalized.

## 6.11 premium/freemium-foundation

Status:

```text
PLANNED
```

Branch:

```text
codex/premium-freemium-foundation
```

Mission:

```text
Define and later implement AwardRadar's commercial product tiers.
```

Principle:

```text
Monetization must follow trust.
```

Potential tiers:

- Free
- Pro
- Founding Member
- Enterprise / Partner later

Guardrails:

- No dark patterns.
- No hiding essential privacy information.
- No fake scarcity.
- No payment before account/payment/money-layer readiness.
- No premium claims before features exist.

## 6.12 traveler-profile-foundation

Status:

```text
PLANNED
```

Branch:

```text
codex/traveler-profile-foundation
```

Mission:

```text
Create the foundation for personalized travel intelligence.
```

Product principle:

```text
Identity before personalization.
```

Possible fields:

- home_airport
- airports_of_interest
- preferred_cabin
- preferred_airlines
- loyalty_programs
- elite_status
- family_size
- accessibility_requirements
- preferred_departure_times
- preferred_regions
- travel_style

Guardrails:

- Must follow privacy/account review.
- No sensitive travel document data in MVP.
- No passport data.
- No payment data.
- No health data unless explicitly reviewed later.
- Clear user control over profile data.
- Data minimization required.

## 6.13 flight-result-cards-v2

Status:

```text
PLANNED
```

Branch:

```text
codex/flight-result-cards-v2
```

Mission:

```text
Make flight search results feel like premium travel intelligence, not raw search output.
```

Every result should answer:

- Can I take this flight?
- Is it a good option?
- Is there anything I should know right now?

Core card fields:

- departure airport
- arrival airport
- departure time
- arrival time
- duration
- stops
- operating carrier
- flight number
- cabin
- program
- miles required
- taxes and fees
- booking or verification link

Context fields:

- local time at origin
- local time at destination
- current or forecast weather at origin
- current or forecast weather at destination
- operational notes
- airport or route alerts, where available
- data freshness timestamp

MVP rule:

```text
Start with simple weather + local time.
Do not block flight search if context APIs fail.
Context should enhance results, not become a hard dependency.
```

## 6.14 award-alerts-foundation

Status:

```text
PLANNED
```

Branch:

```text
codex/award-alerts-foundation
```

Mission:

```text
Prepare AwardRadar to notify users when saved search conditions change.
```

Product principle:

```text
Automation before notifications.
```

Dependencies:

- saved-searches-foundation
- likely accounts-foundation
- likely email-infrastructure-foundation
- may require premium/freemium-foundation

Guardrails:

- No background jobs before architecture.
- No email alerts before email infrastructure.
- No paid alerts before premium model.
- No excessive notification behavior.
- No alert promises without reliable checking.

## 6.15 status-intelligence-foundation

Status:

```text
PLANNED
```

Branch:

```text
codex/status-intelligence-foundation
```

Mission:

```text
Help users understand, maintain, and optimize elite status.
```

Core questions:

- How many miles, points, segments, or qualifying flights are missing?
- Will I requalify?
- What should I fly next?
- Which status goal is realistic?
- What is the cost per status point?
- Which routing gives the best status value?

Guardrails:

- Program rules must be sourced and freshness-dated.
- Avoid unsupported claims.
- No financial advice language.
- No guarantee of status qualification.
- Must distinguish estimate from confirmed program rule.

## 7. Future Strategic Epics

## 7.1 AwardRadar AI / Concierge AI

Mission:

```text
Explain and orchestrate travel intelligence decisions.
```

Principle:

```text
AI does not replace AwardRadar's Decision Engine.
AI makes decisions easier to understand and act on.
```

Rules:

- AI may only reason over AwardRadar API/data results.
- AI should explain, summarize, compare, and recommend.
- AI should not invent availability.
- AI should not override source-of-truth data.
- AI should show uncertainty when data is incomplete.

## 7.2 European Journey Intelligence

Mission:

```text
Let users search journeys, not just airports.
```

Principle:

```text
Users think in journeys. AwardRadar searches the system behind them.
```

Future examples:

- QYG Germany rail origin
- XER Strasbourg Lufthansa bus
- ZWS Stuttgart rail
- ZLP Zurich rail
- ZDH Basel rail
- Rail/bus feeder logic
- Multi-origin journey search

Goal:

```text
AwardRadar should understand that European premium travel often begins before the airport.
```

## 7.3 Travel Readiness Intelligence

Mission:

```text
Help travelers understand practical requirements before travel.
```

Possible future areas:

- visa
- ETA / ESTA / eTA
- passport validity
- transit rules
- accessibility assistance
- airport disruption
- weather and operational risks

Guardrails:

- Must cite authoritative sources.
- No legal guarantee.
- No immigration advice phrased as certainty.
- Always show source and freshness.

## 7.4 Partnership / Affiliate Ecosystem

Mission:

```text
Monetize around useful travel decisions without compromising trust.
```

Potential partner categories:

- eSIMs
- travel insurance
- hotels
- airport transfers
- lounges
- premium airport services
- luggage services
- concierge travel services

Principle:

```text
Trust first. Revenue second.
```

Rules:

- Never optimize recommendations for advertisers over travelers.
- Clearly mark commercial relationships.
- Do not hide better options.
- Affiliate monetization must not corrupt result ranking.

## 7.5 Founding Member Program

Mission:

```text
Turn early supporters into a product community, not just donors.
```

Principle:

```text
Donation = help us please.
Founding Membership = be part of something big.
```

Possible benefits:

- early access
- Founding Member badge
- priority support
- roadmap previews
- lifetime pricing opportunity
- community recognition
- exclusive updates
- possible merchandise later

Example identity:

```text
AwardRadar Founding Member - Since 2026
```

Guardrails:

- No fake scarcity.
- No unfulfilled premium promises.
- No payment before money-layer/payment-provider strategy.
- No community promises before operating model exists.

## 8. Engineering Rules

Codex Constitution:

- Always start with `git status`.
- Always check current branch.
- Never work directly on `main`.
- Always create a dedicated branch.
- Never use `git add .`.
- Never stage `.claude/` unless explicitly requested.
- Never stage `AGENTS.md` unless explicitly requested.
- Do not merge unless explicitly authorized.
- Keep branches focused.
- Keep scopes small.
- Preserve existing product behavior unless task explicitly changes it.
- Run compile/syntax checks before committing.
- Production verification required for infrastructure changes.

## 9. Immediate Next Action

No current implementation branch is declared by this roadmap.

Repository-backed open decisions and validation work:

1. Decide Gate C: whether one-way-only `/app` is sufficient for controlled beta.
2. If required by that decision, scope React round-trip integration explicitly.
3. Obtain and retain attributable provider approval evidence before external or
   commercial seats.aero use.
4. Verify staging/production deployment and smoke status outside Git.
5. Decide whether and how the isolated `intelligence/` foundation should be
   integrated; repository presence alone does not authorize runtime wiring.

## 10. One-Line Summary

AwardRadar's corrected near-term roadmap is:

```text
Consent -> Memory -> AwardSource -> Real Data -> Decision Engine -> Privacy -> Email -> Money -> Identity -> Payments -> Premium -> Personalization -> Context -> Alerts -> Status
```

Strategic principle:

```text
Trust architecture first. Product memory second. Motor before monetization.
```
