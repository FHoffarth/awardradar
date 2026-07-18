// Live-Data Trust Contract V1 — Award data states.
//
// Deterministic, provider-free mapping from an Award data state to the exact
// UI language the product is allowed to use. Core principle: AwardRadar must
// never sound more certain than its data allows.
//
// This module contains NO provider calls and NO invented data. Every string a
// caller may render is produced here, so the forbidden-language guardrails can
// be enforced by a single test surface.

export type AwardDataState =
  | 'live_provider_reported'
  | 'cached_recent'
  | 'cached_stale'
  | 'estimated'
  | 'partial'
  | 'no_results'
  | 'rate_limited'
  | 'provider_error'
  | 'malformed_payload'
  | 'unavailable';

// Provisional PRODUCT thresholds for deterministic fixtures — not a claim about
// any provider guarantee. Kept as a named constant so the policy is easy to
// change in one place.
export const FRESHNESS = {
  // < 4h is "recent"; >= 4h is "stale".
  RECENT_MAX_SECONDS: 4 * 60 * 60,
} as const;

// Phrases the product must never emit for Award data. Exported so tests can
// assert no rendered contract output contains them.
export const FORBIDDEN_PHRASES: readonly string[] = [
  'Guaranteed availability',
  'guaranteed',
  'Provider confirms',
  'Confirmed seats',
  'confirmed seats',
  'Book now',
  'Reserve now',
  'Transfer points now',
  'Exact final taxes and fees',
  'No seats available',
  'No seats exist',
  'No availability anywhere',
  'Best option',
];

export type PresentationClass =
  | 'live'
  | 'cached'
  | 'stale'
  | 'estimated'
  | 'partial'
  | 'empty'
  | 'error';

// Smallest input model needed to enforce the trust rules. Fields are optional
// where a given state does not use them; nothing here is invented by the
// contract — callers/fixtures supply provider-reported facts only.
export interface AwardTrustInput {
  state: AwardDataState;
  // Provenance label only, e.g. "Seats.aero". Never rendered as confirmation.
  provider?: string;
  // ISO timestamp of the provider report, when one exists. Drives freshness.
  checkedAt?: string | null;
  // For `partial`: what IS reliable and what is NOT. Used verbatim, never
  // fabricated into itinerary segments.
  availableComponents?: string[];
  missingComponents?: string[];
  // A concrete seat count may only be shown with a provider basis AND a
  // timestamp. Any other combination is dropped.
  seatCount?: number | null;
  seatCountBasis?: 'provider_reported' | null;
  // Whether the required routing/itinerary data is complete enough for a verdict.
  routingConfidence?: 'complete' | 'insufficient';
  // Whether the cash and award itineraries are verified to be the same trip.
  itineraryOwnershipVerified?: boolean;
  // Round-trip request that is still missing its return leg.
  roundTripReturnMissing?: boolean;
}

export interface AwardTrustPresentation {
  state: AwardDataState;
  presentationClass: PresentationClass;
  freshnessLabel: string;
  supportingCopy: string;
  // Mandatory verification requirement, or '' when not applicable (system errors).
  verificationNotice: string;
  // A contract-fixed verdict string (e.g. "Worth checking"), or null when the
  // verdict — if any — must come from external value scoring.
  allowedVerdict: string | null;
  // May a value verdict be shown at all for this state?
  verdictAllowed: boolean;
  // Stricter than verdictAllowed: may a positive recommendation be made?
  recommendationAllowed: boolean;
  ctaOptions: string[];
  // Rendered seat text, or null when a concrete seat count is not permitted.
  seatDisplay: string | null;
  isProviderReported: boolean;
  isEstimated: boolean;
}

const VERIFY_AIRLINE = 'Verify availability directly with the airline or loyalty program.';

function formatAge(checkedAtMs: number, nowMs: number): string {
  const ageSeconds = Math.max(0, Math.floor((nowMs - checkedAtMs) / 1000));
  if (ageSeconds < 60) return 'just now';
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

// A concrete seat count is only ever shown when the provider reported it AND we
// have a timestamp for that report. Everything else renders no seat count.
function resolveSeatDisplay(input: AwardTrustInput): string | null {
  const providerReportedStates: AwardDataState[] = ['live_provider_reported', 'cached_recent'];
  if (!providerReportedStates.includes(input.state)) return null;
  if (input.seatCountBasis !== 'provider_reported') return null;
  if (typeof input.seatCount !== 'number' || input.seatCount < 0) return null;
  if (!input.checkedAt) return null;
  return `${input.seatCount} seat${input.seatCount === 1 ? '' : 's'} provider-reported`;
}

function partialCopy(input: AwardTrustInput): string {
  const available = (input.availableComponents ?? []).filter(Boolean);
  const missing = (input.missingComponents ?? []).filter(Boolean);
  const parts: string[] = [];
  if (available.length) parts.push(`${available.join(', ')} is available.`);
  if (missing.length) parts.push(`${missing.join(', ')} is currently unavailable.`);
  return parts.join(' ') || 'Only part of this result is reliable.';
}

// Recommendation guardrail (STEP 9): a positive recommendation is blocked unless
// the data is provider-reported-and-fresh AND the itinerary is complete and owned.
export function isRecommendationAllowed(input: AwardTrustInput): boolean {
  const freshProviderReported =
    input.state === 'live_provider_reported' || input.state === 'cached_recent';
  if (!freshProviderReported) return false;
  if (input.routingConfidence !== 'complete') return false;
  if (input.itineraryOwnershipVerified !== true) return false;
  if (input.roundTripReturnMissing === true) return false;
  return true;
}

// A value verdict (not necessarily a positive recommendation) may be shown for
// provider-reported states with complete itinerary data, and the contract also
// fixes a "Worth checking" verdict for stale/estimated orientation states.
function verdictAllowedFor(input: AwardTrustInput): boolean {
  if (input.state === 'cached_stale' || input.state === 'estimated') return true;
  return isRecommendationAllowed(input);
}

export function resolveAwardTrust(input: AwardTrustInput, nowMs: number): AwardTrustPresentation {
  const seatDisplay = resolveSeatDisplay(input);
  const recommendationAllowed = isRecommendationAllowed(input);
  const verdictAllowed = verdictAllowedFor(input);

  const base = {
    state: input.state,
    seatDisplay,
    recommendationAllowed,
    verdictAllowed,
    allowedVerdict: null as string | null,
    isProviderReported: false,
    isEstimated: false,
  };

  switch (input.state) {
    case 'live_provider_reported': {
      const checkedMs = input.checkedAt ? Date.parse(input.checkedAt) : nowMs;
      return {
        ...base,
        presentationClass: 'live',
        freshnessLabel: `Checked ${formatAge(checkedMs, nowMs)} · Provider-reported`,
        supportingCopy: 'Availability is provider-reported for this request, not airline-confirmed.',
        verificationNotice: VERIFY_AIRLINE,
        ctaOptions: ['Verify with airline', 'Check with loyalty program', 'View verification steps'],
        isProviderReported: true,
      };
    }
    case 'cached_recent': {
      const checkedMs = input.checkedAt ? Date.parse(input.checkedAt) : nowMs;
      return {
        ...base,
        presentationClass: 'cached',
        freshnessLabel: `Last checked ${formatAge(checkedMs, nowMs)}`,
        supportingCopy: 'Availability may have changed. Verify before transferring points or booking.',
        verificationNotice: VERIFY_AIRLINE,
        ctaOptions: ['Verify availability', 'Check with loyalty program', 'View verification steps'],
        isProviderReported: true,
      };
    }
    case 'cached_stale': {
      const checkedMs = input.checkedAt ? Date.parse(input.checkedAt) : nowMs;
      return {
        ...base,
        presentationClass: 'stale',
        freshnessLabel: `Last checked ${formatAge(checkedMs, nowMs)}`,
        supportingCopy: 'This result may no longer be available.',
        verificationNotice: VERIFY_AIRLINE,
        allowedVerdict: 'Worth checking',
        ctaOptions: ['Check current availability', 'Verify this opportunity'],
        isProviderReported: true,
      };
    }
    case 'estimated':
      return {
        ...base,
        presentationClass: 'estimated',
        freshnessLabel: 'Estimated, not confirmed availability',
        supportingCopy: 'Estimated from historical or modeled data; it does not report current availability.',
        verificationNotice: VERIFY_AIRLINE,
        allowedVerdict: 'Worth checking',
        seatDisplay: null,
        ctaOptions: ['Check current availability', 'Verify this opportunity'],
        isEstimated: true,
      };
    case 'partial':
      return {
        ...base,
        presentationClass: 'partial',
        freshnessLabel: 'Partial result',
        supportingCopy: partialCopy(input),
        verificationNotice: 'Verify the missing details before relying on this result.',
        ctaOptions: ['Verify availability', 'View verification steps'],
        isProviderReported: true,
      };
    case 'no_results':
      return {
        ...base,
        presentationClass: 'empty',
        freshnessLabel: 'Checked just now · Provider-reported',
        supportingCopy: 'Provider reported no matching results. Different dates or programs may show different results.',
        verificationNotice: '',
        ctaOptions: [],
        isProviderReported: true,
      };
    case 'rate_limited':
      return {
        ...base,
        presentationClass: 'error',
        freshnessLabel: 'Search temporarily unavailable due to provider limits.',
        supportingCopy: 'The provider is rate-limiting requests right now. This is not a statement about availability.',
        verificationNotice: '',
        ctaOptions: ['Try again later'],
      };
    case 'provider_error':
      return {
        ...base,
        presentationClass: 'error',
        freshnessLabel: 'Search temporarily unavailable.',
        supportingCopy: 'The provider could not be reached reliably. This is not a statement about availability.',
        verificationNotice: '',
        ctaOptions: ['Try again later'],
      };
    case 'malformed_payload':
      return {
        ...base,
        presentationClass: 'error',
        freshnessLabel: 'We could not verify this result.',
        supportingCopy: 'The provider response could not be safely interpreted, so nothing is shown for it.',
        verificationNotice: '',
        ctaOptions: ['Try again later'],
      };
    case 'unavailable':
      return {
        ...base,
        presentationClass: 'error',
        freshnessLabel: 'Availability data is currently unavailable.',
        supportingCopy: 'No trustworthy availability data is available for this result right now.',
        verificationNotice: '',
        ctaOptions: ['Try again later'],
      };
    default: {
      // Exhaustiveness guard — a new state must be handled explicitly.
      const _exhaustive: never = input.state;
      throw new Error(`Unhandled award data state: ${String(_exhaustive)}`);
    }
  }
}
