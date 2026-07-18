// Canonical presenter for the Award trust contract.
//
// Renders ONLY the fields the contract produced. It never invents a seat count,
// a return leg, a price, or a verdict: if the resolved presentation does not
// carry a value, nothing is rendered for it. All wording comes from
// awardTrustContract so guardrails have a single enforcement surface.

import type { AwardTrustPresentation } from './awardTrustContract';

export function AwardTrustNotice({ presentation }: { presentation: AwardTrustPresentation }) {
  return (
    <section
      className={`award-trust award-trust--${presentation.presentationClass}`}
      data-testid="award-trust"
      data-state={presentation.state}
      data-recommendation-allowed={presentation.recommendationAllowed ? 'true' : 'false'}
      data-verdict-allowed={presentation.verdictAllowed ? 'true' : 'false'}
      aria-label="Award data trust status"
    >
      <p className="award-trust__freshness" data-testid="award-trust-freshness">
        {presentation.freshnessLabel}
      </p>

      {presentation.seatDisplay && (
        <p className="award-trust__seats" data-testid="award-trust-seats">
          {presentation.seatDisplay}
        </p>
      )}

      {presentation.allowedVerdict && (
        <p className="award-trust__verdict" data-testid="award-trust-verdict">
          {presentation.allowedVerdict}
        </p>
      )}

      <p className="award-trust__copy" data-testid="award-trust-copy">
        {presentation.supportingCopy}
      </p>

      {presentation.verificationNotice && (
        <p className="award-trust__verify" data-testid="award-trust-verify">
          {presentation.verificationNotice}
        </p>
      )}

      {presentation.ctaOptions.length > 0 && (
        <ul className="award-trust__cta" data-testid="award-trust-cta">
          {presentation.ctaOptions.map((cta) => (
            <li key={cta}>{cta}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default AwardTrustNotice;
