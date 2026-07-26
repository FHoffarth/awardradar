// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FORBIDDEN_PHRASES,
  isRecommendationAllowed,
  resolveAwardTrust,
  type AwardTrustInput,
} from './awardTrustContract';
import { awardTrustFixtures, REFERENCE_NOW_MS } from './awardTrustFixtures';
import { AwardTrustNotice } from './AwardTrustNotice';

afterEach(cleanup);

const NOW = REFERENCE_NOW_MS;

function present(name: keyof typeof awardTrustFixtures) {
  return resolveAwardTrust(awardTrustFixtures[name], NOW);
}

function renderFixture(name: keyof typeof awardTrustFixtures) {
  const presentation = resolveAwardTrust(awardTrustFixtures[name], NOW);
  render(<AwardTrustNotice presentation={presentation} />);
  return presentation;
}

function wholeText(): string {
  return screen.getByTestId('award-trust').textContent ?? '';
}

describe('award trust contract — fixture coverage', () => {
  it('every fixture resolves and renders', () => {
    for (const name of Object.keys(awardTrustFixtures) as (keyof typeof awardTrustFixtures)[]) {
      cleanup();
      const p = renderFixture(name);
      expect(p.state).toBe(awardTrustFixtures[name].state);
      expect(screen.getByTestId('award-trust')).toBeTruthy();
    }
  });

  it('never emits any forbidden phrase in any fixture', () => {
    for (const name of Object.keys(awardTrustFixtures) as (keyof typeof awardTrustFixtures)[]) {
      cleanup();
      renderFixture(name);
      const text = wholeText().toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(text.includes(phrase.toLowerCase()), `${name} must not contain "${phrase}"`).toBe(false);
      }
    }
  });
});

describe('live_provider_reported', () => {
  it('says provider-reported, not confirmed, with a verification requirement', () => {
    renderFixture('award_live_provider_reported');
    const text = wholeText();
    expect(text).toContain('Provider-reported');
    // May state it is *not* airline-confirmed, but must never claim confirmation.
    expect(text.toLowerCase()).not.toContain('provider confirms');
    expect(text.toLowerCase()).not.toContain('confirmed seats');
    expect(screen.getByTestId('award-trust-verify').textContent)
      .toContain('Verify availability directly with the airline or loyalty program.');
  });

  it('shows a seat count only with provider basis and timestamp', () => {
    renderFixture('award_live_provider_reported');
    expect(screen.getByTestId('award-trust-seats').textContent).toContain('2 seats provider-reported');
  });

  it('permits a recommendation only when routing and ownership are complete', () => {
    expect(isRecommendationAllowed(awardTrustFixtures.award_live_provider_reported)).toBe(true);
    const broken: AwardTrustInput = { ...awardTrustFixtures.award_live_provider_reported, itineraryOwnershipVerified: false };
    expect(isRecommendationAllowed(broken)).toBe(false);
  });
});

describe('cached_recent', () => {
  it('shows age and an availability warning', () => {
    renderFixture('award_cached_recent');
    expect(screen.getByTestId('award-trust-freshness').textContent).toContain('Last checked 45 minutes ago');
    expect(wholeText()).toContain('Availability may have changed.');
  });
});

describe('cached_stale', () => {
  it('does not invent a generic verdict or recommendation', () => {
    const p = renderFixture('award_cached_stale');
    expect(screen.queryByTestId('award-trust-verdict')).toBeNull();
    expect(wholeText()).not.toContain('Best option');
    expect(wholeText()).not.toContain('Worth checking');
    expect(p.recommendationAllowed).toBe(false);
    expect(screen.getByTestId('award-trust-freshness').textContent).toContain('Last checked 7 hours ago');
  });

  it('drops the seat count at stale age', () => {
    renderFixture('award_cached_stale');
    expect(screen.queryByTestId('award-trust-seats')).toBeNull();
  });
});

describe('estimated', () => {
  it('never claims availability and shows no concrete seat count', () => {
    const p = renderFixture('award_estimated');
    expect(screen.getByTestId('award-trust-freshness').textContent).toContain('Estimated, not confirmed availability');
    expect(screen.queryByTestId('award-trust-seats')).toBeNull();
    expect(p.recommendationAllowed).toBe(false);
    expect(p.isEstimated).toBe(true);
  });
});

describe('partial', () => {
  it('names the missing component and creates no return leg', () => {
    renderFixture('award_partial_outbound_only');
    const text = wholeText();
    expect(text).toContain('Outbound award data is available.');
    expect(text).toContain('Return award data is currently unavailable.');
    // Never renders a verdict or an invented seat/segment for a partial result.
    expect(screen.queryByTestId('award-trust-verdict')).toBeNull();
    expect(screen.queryByTestId('award-trust-seats')).toBeNull();
  });

  it('blocks any overall journey verdict for both partial variants', () => {
    for (const name of ['award_partial_outbound_only', 'award_partial_return_missing'] as const) {
      expect(present(name).verdictAllowed).toBe(false);
      expect(present(name).recommendationAllowed).toBe(false);
    }
  });
});

describe('no_results vs provider failures are never conflated', () => {
  it('no_results explicitly says the provider reported no matching results', () => {
    renderFixture('award_zero_results');
    const text = wholeText();
    expect(text).toContain('Provider reported no matching results.');
    expect(text.toLowerCase()).not.toContain('no seats');
    expect(text.toLowerCase()).not.toContain('unavailable');
  });

  it('rate_limited never uses no-results language', () => {
    renderFixture('award_rate_limited');
    const text = wholeText().toLowerCase();
    expect(text).toContain('provider limits');
    expect(text).not.toContain('no matching results');
    expect(text).not.toContain('no seats');
  });

  it('provider_error never uses no-results language', () => {
    renderFixture('award_provider_error');
    const text = wholeText().toLowerCase();
    expect(text).toContain('temporarily unavailable');
    expect(text).not.toContain('no matching results');
    expect(text).not.toContain('no seats');
  });
});

describe('malformed_payload and unavailable', () => {
  it('malformed payload renders no recommendation and no guessed fields', () => {
    const p = renderFixture('award_malformed_payload');
    expect(p.recommendationAllowed).toBe(false);
    expect(p.verdictAllowed).toBe(false);
    expect(screen.queryByTestId('award-trust-verdict')).toBeNull();
    expect(screen.queryByTestId('award-trust-seats')).toBeNull();
    expect(wholeText()).toContain('could not verify this result');
  });

  it('unavailable renders no availability conclusion', () => {
    const p = renderFixture('award_unavailable');
    expect(p.recommendationAllowed).toBe(false);
    expect(screen.queryByTestId('award-trust-seats')).toBeNull();
    const text = wholeText().toLowerCase();
    expect(text).toContain('availability data is currently unavailable');
    expect(text).not.toContain('no matching results');
  });
});

describe('seat-count guardrail', () => {
  it('no concrete seat count appears without provider basis and timestamp', () => {
    // Provider basis but no timestamp -> dropped.
    const noStamp = resolveAwardTrust(
      { state: 'live_provider_reported', seatCount: 3, seatCountBasis: 'provider_reported', checkedAt: null,
        routingConfidence: 'complete', itineraryOwnershipVerified: true },
      NOW,
    );
    expect(noStamp.seatDisplay).toBeNull();
    // Timestamp but no provider basis -> dropped.
    const noBasis = resolveAwardTrust(
      { state: 'live_provider_reported', seatCount: 3, seatCountBasis: null, checkedAt: '2026-07-18T21:00:00Z',
        routingConfidence: 'complete', itineraryOwnershipVerified: true },
      NOW,
    );
    expect(noBasis.seatDisplay).toBeNull();
  });
});
