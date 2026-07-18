// Deterministic Award trust fixtures — no real provider payloads, no secrets,
// no invented itinerary segments. Timestamps are relative to a fixed reference
// clock so freshness rendering is fully deterministic in tests.

import type { AwardTrustInput } from './awardTrustContract';

// Fixed reference instant used as "now" in tests. Fixtures express provider
// timestamps as offsets from this so age labels are stable.
export const REFERENCE_NOW_ISO = '2026-07-18T21:00:00Z';
export const REFERENCE_NOW_MS = Date.parse(REFERENCE_NOW_ISO);

function minutesBefore(mins: number): string {
  return new Date(REFERENCE_NOW_MS - mins * 60 * 1000).toISOString();
}
function hoursBefore(hours: number): string {
  return new Date(REFERENCE_NOW_MS - hours * 60 * 60 * 1000).toISOString();
}

export const awardTrustFixtures: Record<string, AwardTrustInput> = {
  award_live_provider_reported: {
    state: 'live_provider_reported',
    provider: 'Seats.aero',
    checkedAt: REFERENCE_NOW_ISO,
    seatCount: 2,
    seatCountBasis: 'provider_reported',
    routingConfidence: 'complete',
    itineraryOwnershipVerified: true,
  },
  award_cached_recent: {
    state: 'cached_recent',
    provider: 'Seats.aero',
    checkedAt: minutesBefore(45),
    seatCount: 4,
    seatCountBasis: 'provider_reported',
    routingConfidence: 'complete',
    itineraryOwnershipVerified: true,
  },
  award_cached_stale: {
    state: 'cached_stale',
    provider: 'Seats.aero',
    checkedAt: hoursBefore(7),
    // Even though provider-reported, seat count is intentionally not surfaced as
    // a live claim at this age; the contract drops it for the stale state.
    routingConfidence: 'complete',
    itineraryOwnershipVerified: true,
  },
  award_estimated: {
    state: 'estimated',
    provider: 'Internal model',
    checkedAt: null,
    routingConfidence: 'insufficient',
    itineraryOwnershipVerified: false,
  },
  award_partial_outbound_only: {
    state: 'partial',
    provider: 'Seats.aero',
    checkedAt: minutesBefore(10),
    availableComponents: ['Outbound award data'],
    missingComponents: ['Return award data'],
    routingConfidence: 'insufficient',
    itineraryOwnershipVerified: false,
    roundTripReturnMissing: true,
  },
  award_partial_return_missing: {
    state: 'partial',
    provider: 'Seats.aero',
    checkedAt: minutesBefore(12),
    availableComponents: ['Price information'],
    missingComponents: ['Award routing'],
    routingConfidence: 'insufficient',
    itineraryOwnershipVerified: false,
    roundTripReturnMissing: true,
  },
  award_rate_limited: {
    state: 'rate_limited',
    provider: 'Seats.aero',
    checkedAt: null,
  },
  award_provider_error: {
    state: 'provider_error',
    provider: 'Seats.aero',
    checkedAt: null,
  },
  award_zero_results: {
    state: 'no_results',
    provider: 'Seats.aero',
    checkedAt: REFERENCE_NOW_ISO,
  },
  award_malformed_payload: {
    state: 'malformed_payload',
    provider: 'Seats.aero',
    checkedAt: null,
  },
  award_unavailable: {
    state: 'unavailable',
    checkedAt: null,
  },
};

export type AwardTrustFixtureName = keyof typeof awardTrustFixtures;
