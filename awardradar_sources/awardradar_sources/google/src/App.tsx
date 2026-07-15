import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'motion/react';
import { Activity, AlertTriangle, ArrowRight, Info, Printer, ShieldCheck } from 'lucide-react';

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IATA_CODE_PATTERN = /^[A-Z]{3}$/;
const LABELED_IATA_PATTERN = /\(([A-Z]{3})\)\s*$/i;

type PaneStatus = 'idle' | 'loading' | 'success' | 'error' | 'empty';

function isValidDateString(dateStr: string): boolean {
  if (!DATE_PARAM_PATTERN.test(dateStr)) return false;
  const date = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr) && date >= now;
}

function getTripParam(name: string): string {
  try {
    const value = new URLSearchParams(window.location.search).get(name);
    return value?.trim() ?? '';
  } catch {
    return '';
  }
}

function resolveAirportCode(value: string): string | null {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (IATA_CODE_PATTERN.test(upper)) return upper;
  const labeled = trimmed.match(LABELED_IATA_PATTERN);
  return labeled ? labeled[1].toUpperCase() : null;
}

function formatExportTimestamp(value: Date | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

const SIGNAL_COPY: Record<string, { verdict: string; why: string }> = {
  exceptional_miles_value: {
    verdict: 'Exceptional Award Value',
    why: 'The available comparison indicates exceptional value for the requested date based on the estimated cash fare and miles cost.',
  },
  strong_miles_value: {
    verdict: 'Strong Award Value',
    why: 'The available comparison indicates strong value for the requested date based on the estimated cash fare and miles cost.',
  },
  solid_miles_value: {
    verdict: 'Solid Award Value',
    why: 'The available comparison indicates a solid use of miles relative to paying cash.',
  },
  cash_strongly_preferred: {
    verdict: 'Cash Offers Better Value',
    why: 'The available comparison indicates that the cash fare is significantly lower than the value represented by the miles option.',
  },
  cash_preferred: {
    verdict: 'Cash Offers Better Value',
    why: 'The available comparison indicates that the cash fare is lower than the value represented by the miles option.',
  },
  low_miles_value: {
    verdict: 'Low Award Value',
    why: 'The available comparison indicates that the required miles and surcharges provide limited value relative to the cash alternative.',
  },
  unknown: {
    verdict: 'More Evidence Required',
    why: 'Insufficient data is available to make a definitive recommendation between cash and miles.',
  },
};

function getDecisionCopy(result: any, cashAvailable: boolean, cashUnavailable: boolean) {
  const copy = SIGNAL_COPY[result?.decision?.signal] || SIGNAL_COPY.unknown;
  const strongAwardSignal = ['exceptional_miles_value', 'strong_miles_value'].includes(result?.decision?.signal) ||
    ['exceptional', 'great'].includes(result?.programs?.[0]?.grade?.tier);
  if (cashUnavailable && strongAwardSignal) {
    return {
      verdict: 'Promising award signal',
      why: 'A current cash comparison is unavailable, so the relative value cannot be fully assessed.',
    };
  }
  const confidence = result?.decision?.confidence;
  const comparisonIsLimited = confidence === 'low' || confidence === 'medium' ||
    result?.verified_identical_routing !== true || result?.has_live_data !== true || !cashAvailable;

  if (!comparisonIsLimited || result?.decision?.signal === 'unknown') return copy;

  return {
    ...copy,
    verdict: `${copy.verdict} signal`,
  };
}

const SearchInstrument = ({
  onAnalyze,
  status,
  validationError,
  compact,
}: {
  onAnalyze: (origin: string, dest: string, date: string) => void;
  status: string;
  validationError: string | null;
  compact: boolean;
}) => {
  const origin = getTripParam('from');
  const destination = getTripParam('to');
  const dateParam = getTripParam('date');
  const originCode = resolveAirportCode(origin);
  const destinationCode = resolveAirportCode(destination);
  const originDisplay = origin || 'Origin';
  const destinationDisplay = destination || 'Destination';
  const dateIsValid = isValidDateString(dateParam);
  const dateLabel = dateIsValid ? dateParam : 'Date not selected';
  const canAnalyze = Boolean(originCode && destinationCode && originCode !== destinationCode && dateIsValid);

  useEffect(() => {
    if (!originCode || !destinationCode) return;
    if (origin === originCode && destination === destinationCode) return;
    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.searchParams.set('from', originCode);
    canonicalUrl.searchParams.set('to', destinationCode);
    window.history.replaceState(window.history.state, '', `${canonicalUrl.pathname}${canonicalUrl.search}${canonicalUrl.hash}`);
  }, [origin, destination, originCode, destinationCode]);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`search-context ${compact ? 'search-context--compact' : ''}`}
      aria-labelledby="search-context-title"
      data-testid="search-context"
    >
      <div className="section-kicker" id="search-context-title">Search context</div>

      {validationError && (
        <div className="validation-error" role="alert" data-testid="validation-error">
          <AlertTriangle aria-hidden="true" /> {validationError}
        </div>
      )}

      <div className="search-instrument">
        <div className="search-field search-field--accent">
          <span className="field-label">From</span>
          <strong>{originDisplay}</strong>
        </div>
        <div className="search-field">
          <span className="field-label">To</span>
          <strong>{destinationDisplay}</strong>
        </div>
        <div className="search-field">
          <span className="field-label">Date</span>
          <time dateTime={dateParam || undefined}>{dateLabel}</time>
        </div>
        <button
          onClick={() => originCode && destinationCode && onAnalyze(originCode, destinationCode, dateParam)}
          disabled={status === 'loading' || !canAnalyze}
          data-testid="analyze-button"
          className="primary-action interactive-only"
          type="button"
          aria-label={status === 'loading' ? 'Analyzing route' : 'Analyze this route'}
        >
          <span>{status === 'loading' ? 'Analyzing…' : 'Analyze this route'}</span>
          <Activity aria-hidden="true" className={status === 'loading' ? 'is-pulsing' : ''} />
        </button>
      </div>
    </motion.section>
  );
};

const DecisionSummary = ({ result, cashAvailable, cashUnavailable }: { result: any; cashAvailable: boolean; cashUnavailable: boolean }) => {
  const copy = getDecisionCopy(result, cashAvailable, cashUnavailable);
  return (
    <>
      <motion.section className="result-section decision-summary" aria-labelledby="decision-title" data-testid="decision-summary"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="section-heading-row">
          <span aria-hidden="true" />
          <h2 id="decision-title">Decision Summary</h2>
        </div>
        <p className="recommendation-label">Recommendation</p>
        <h3 data-testid="decision-verdict">{copy.verdict}</h3>
      </motion.section>

      <section className="result-section why-section" aria-labelledby="why-title">
        <h2 id="why-title">Why this signal</h2>
        <p data-testid="decision-why">{copy.why}</p>
      </section>
    </>
  );
};

const CashCandidate = ({ cashOffer, isLimited }: { cashOffer: any; isLimited: boolean }) => (
  <article className="option-card" data-testid="cash-candidate-card" aria-labelledby="cash-option-title">
    <div className="option-card__header">
      <div>
        <p className="option-type">Cash option</p>
        <h3 id="cash-option-title">Best Cash Option</h3>
      </div>
      {cashOffer.currency && <span className="data-source">{cashOffer.currency}</span>}
    </div>
    <dl className="option-facts">
      <div className="primary-fact">
        <dt>Price</dt>
        <dd>{cashOffer.currency === 'EUR' || !cashOffer.currency ? '€' : ''}{cashOffer.price}</dd>
      </div>
      {cashOffer.airline && <div><dt>Airline</dt><dd>{cashOffer.airline}</dd></div>}
      {cashOffer.time_data_status === 'complete' ? (
        <>
          {(cashOffer.dep_time || cashOffer.arr_time) && <div><dt>Times</dt><dd>{cashOffer.dep_time || '—'} — {cashOffer.arr_time || '—'}</dd></div>}
          {Number.isFinite(cashOffer.durationMin) && <div><dt>Duration</dt><dd>{Math.floor(cashOffer.durationMin / 60)}h {cashOffer.durationMin % 60}m</dd></div>}
          {cashOffer.stops !== undefined && <div><dt>Stops</dt><dd>{cashOffer.stops === 0 ? 'Nonstop' : `${cashOffer.stops} stop${cashOffer.stops === 1 ? '' : 's'}`}</dd></div>}
        </>
      ) : (
        <div className="fact-disclosure" data-testid="missing-cash-times-disclosure">
          <dt>Schedule detail</dt><dd>Time and stop details unavailable. Please verify with the provider.</dd>
        </div>
      )}
    </dl>
    {isLimited && (
      <p className="card-caveat" data-testid="limited-comparison-disclaimer">
        This cash itinerary may route differently than the award option.
      </p>
    )}
  </article>
);

const AwardCandidate = ({ result }: { result: any }) => {
  const bestProgram = result?.programs?.[0];
  return (
    <article className="option-card" data-testid="award-candidate-card" aria-labelledby="award-option-title">
      <div className="option-card__header">
        <div>
          <p className="option-type">Award option</p>
          <h3 id="award-option-title">Best Award Option</h3>
        </div>
        <span className="data-source">{result?.has_live_data ? 'Live data' : 'Estimate'}</span>
      </div>
      {bestProgram ? (
        <dl className="option-facts" data-testid="award-candidate">
          <div className="primary-fact"><dt>Miles</dt><dd>{bestProgram.miles?.toLocaleString()}</dd></div>
          {bestProgram.surcharge !== undefined && <div><dt>Surcharges</dt><dd>€{bestProgram.surcharge}</dd></div>}
          {bestProgram.program && <div><dt>Program</dt><dd>{bestProgram.program}</dd></div>}
        </dl>
      ) : (
        <p className="missing-pane" data-testid="missing-award-detail">No program-level award detail is available in this analysis.</p>
      )}
      {!result?.has_live_data && <p className="card-caveat">Award figures are estimates and do not confirm availability.</p>}
    </article>
  );
};

const PaneUnavailable = ({ kind, status }: { kind: 'Cash' | 'Award'; status: PaneStatus }) => (
  <article className="option-card option-card--unavailable" data-testid={`${kind.toLowerCase()}-pane-${status}`}>
    <p className="option-type">{kind} option</p>
    <h3>{kind} data unavailable</h3>
    <p>{status === 'error' ? 'This part of the analysis could not be completed.' : 'No reliable result was returned for this route and date.'}</p>
  </article>
);

const CashUnavailable = () => (
  <article className="option-card option-card--unavailable" data-testid="cash-unavailable-state">
    <p className="option-type">Cash option</p>
    <h3>Current cash comparison unavailable</h3>
    <p>Award results can still be reviewed, but relative value cannot be fully assessed without a current cash fare.</p>
  </article>
);

const ConfidenceAndVerification = ({ decision, hasLive }: { decision: any; hasLive: boolean }) => (
  <section className="result-section confidence-section" aria-labelledby="confidence-title">
    <div>
      <h2 id="confidence-title">Confidence</h2>
      <p className="confidence-value" data-testid="decision-confidence">{decision?.confidence || 'Not available'}</p>
      <p className="confidence-note">Confidence is shown as provided by the current analysis, without a percentage.</p>
    </div>
    <div>
      <h2>Next Action</h2>
      <p className="next-action"><ArrowRight aria-hidden="true" />
        {hasLive ? 'Verify availability directly on the official program site.' : 'Check availability manually on the official program site.'}
      </p>
    </div>
  </section>
);

const EvidenceAndCaveats = ({ result, awardStatus, cashStatus }: { result: any; awardStatus: PaneStatus; cashStatus: PaneStatus }) => {
  const limited = result?.verified_identical_routing !== true;
  return (
    <section className="result-section evidence-section" aria-labelledby="evidence-title">
      <div className="evidence-title-row">
        <Info aria-hidden="true" />
        <h2 id="evidence-title">Evidence &amp; Caveats</h2>
      </div>
      <ul>
        {limited && <li data-testid="routing-disclosure">Cash and award options are not verified as identical itineraries. Routing or carrier may differ.</li>}
        {limited && <li data-testid="limited-comparison-disclosure">The comparison is limited and should be treated as a directional decision signal.</li>}
        {result && !result.has_live_data && <li>Award data is estimated and does not confirm current availability.</li>}
        {cashStatus !== 'success' && <li>No cash option is available in the current analysis.</li>}
        {awardStatus !== 'success' && <li>No award option is available in the current analysis.</li>}
        <li>Verify prices, schedules, availability and booking rules before purchase.</li>
      </ul>
    </section>
  );
};

export default function App() {
  const [awardStatus, setAwardStatus] = useState<PaneStatus>('idle');
  const [cashStatus, setCashStatus] = useState<PaneStatus>('idle');
  const [awardData, setAwardData] = useState<any>(null);
  const [cashData, setCashData] = useState<any>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [exportTimestamp, setExportTimestamp] = useState<Date | null>(null);

  const handleAnalyze = async (origin: string, dest: string, date: string) => {
    const originCode = resolveAirportCode(origin);
    const destinationCode = resolveAirportCode(dest);
    if (!originCode) { setValidationError('A resolved three-letter origin airport code is required.'); return; }
    if (!destinationCode) { setValidationError('A resolved three-letter destination airport code is required.'); return; }
    if (originCode === destinationCode) { setValidationError('Origin and destination must be different.'); return; }
    if (!isValidDateString(date)) { setValidationError('A valid future date (YYYY-MM-DD) is required.'); return; }

    setValidationError(null);
    setAwardStatus('loading');
    setCashStatus('loading');

    const requestPayload = {
      lang: 'en',
      origin: originCode,
      dest: destinationCode,
      date: date,
      oneWay: true,
      returnDate: '',
      direct: false,
      mmOnly: false,
      currency: 'eur',
      cabin: 'Economy',
      cabins: ['Economy'],
      flexDays: 0,
    };

    const awardPromise = fetch('/api/awards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    }).then(res => res.json());

    const cashPromise = fetch('/api/cheap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    }).then(res => res.json());

    const [awardRes, cashRes] = await Promise.allSettled([awardPromise, cashPromise]);

    if (awardRes.status === 'fulfilled') {
      const json = awardRes.value;
      if (!json.ok) {
        setAwardStatus('error');
        setAwardData(json);
      } else if (!json.results || json.results.length === 0) {
        setAwardStatus('empty');
        setAwardData(json);
      } else {
        setAwardData(json);
        setAwardStatus('success');
      }
    } else {
      setAwardStatus('error');
    }

    if (cashRes.status === 'fulfilled') {
      const json = cashRes.value;
      if (!json.ok) {
        setCashStatus('error');
        setCashData(json);
      } else if (!json.offers || json.offers.length === 0) {
        setCashStatus('empty');
        setCashData(json);
      } else {
        setCashData(json);
        setCashStatus('success');
      }
    } else {
      setCashStatus('error');
    }
  };

  const status = (awardStatus === 'loading' || cashStatus === 'loading') ? 'loading' :
    (awardStatus === 'success' || cashStatus === 'success') ? 'success' :
    (awardStatus === 'error' && cashStatus === 'error') ? 'error' : 'empty';

  const result = awardData?.results?.[0];
  const cashOffer = cashData?.offers?.[0];
  const cashUnavailable = cashData?.cash_provenance?.status === 'unavailable';
  const isLimited = result?.verified_identical_routing !== true;
  const hasSuccessfulPane = awardStatus === 'success' || cashStatus === 'success';
  const routeOrigin = result?.origin || getTripParam('from') || 'Origin';
  const routeDestination = result?.dest || getTripParam('to') || 'Destination';
  const travelDate = result?.date || getTripParam('date') || 'Date not selected';

  const handlePrint = () => {
    flushSync(() => setExportTimestamp(new Date()));
    window.print();
  };

  return (
    <div className="app-shell">
      <div className="workspace-background" aria-hidden="true" />
      <header className="workspace-header interactive-only">
        <a className="wordmark" href="/" aria-label="AwardRadar home"><span>Award</span><span>Radar</span></a>
        <span className="workspace-label">Decision Workspace</span>
      </header>

      <main className="workspace-main">
        <h1 className="sr-only">AwardRadar Decision Workspace</h1>
        <SearchInstrument onAnalyze={handleAnalyze} status={status} validationError={validationError} compact={hasSuccessfulPane} />

        <div className="print-report-header" data-testid="print-report-header">
          <div className="print-wordmark">Award<span>Radar</span></div>
          <p>Decision Report</p>
          <h1>{routeOrigin} — {routeDestination}</h1>
          <dl><div><dt>Travel date</dt><dd>{travelDate}</dd></div><div><dt>Exported</dt><dd data-testid="export-timestamp">{formatExportTimestamp(exportTimestamp)}</dd></div></dl>
        </div>

        {status === 'loading' && (
          <div className="state-message" role="status" aria-live="polite" data-testid="loading-state">
            Fetching decision data…
          </div>
        )}

        {!hasSuccessfulPane && status !== 'loading' && (awardStatus !== 'idle' || cashStatus !== 'idle') && (
          <div className="state-grid" role="status" aria-live="polite" data-testid={awardStatus === 'error' && cashStatus === 'error' ? 'error-state' : 'empty-state'}>
            <PaneUnavailable kind="Cash" status={cashStatus} />
            <PaneUnavailable kind="Award" status={awardStatus} />
          </div>
        )}

        {hasSuccessfulPane && (
          <div className="result-flow" data-testid="result-flow">
            {awardStatus === 'success' && result && <DecisionSummary result={result} cashAvailable={cashStatus === 'success'} cashUnavailable={cashUnavailable} />}

            <section className="result-section options-section" aria-labelledby="options-title">
              <h2 id="options-title">Best Options</h2>
              <div className="options-grid" data-testid="options-grid">
                {cashStatus === 'success' && cashOffer ? <CashCandidate cashOffer={cashOffer} isLimited={isLimited} /> : cashUnavailable ? <CashUnavailable /> : <PaneUnavailable kind="Cash" status={cashStatus} />}
                {awardStatus === 'success' && result ? <AwardCandidate result={result} /> : <PaneUnavailable kind="Award" status={awardStatus} />}
              </div>
            </section>

            {awardStatus === 'success' && result && <ConfidenceAndVerification decision={result.decision} hasLive={Boolean(result.has_live_data)} />}
            <EvidenceAndCaveats result={result} awardStatus={awardStatus} cashStatus={cashStatus} />

            <section className="result-section export-section interactive-only" aria-labelledby="export-title">
              <div>
                <h2 id="export-title">Keep this analysis</h2>
                <p>Open your browser’s print dialog to print or save the currently displayed snapshot.</p>
              </div>
              <button type="button" className="secondary-action" onClick={handlePrint} data-testid="print-button">
                <Printer aria-hidden="true" /> Print / Save analysis
              </button>
            </section>

            <footer className="report-disclaimer">
              <ShieldCheck aria-hidden="true" />
              <p>This report is a snapshot of the information available at the time of analysis. Prices, award availability, schedules and booking rules must be verified directly with the relevant airline, loyalty program or booking provider before purchase.</p>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
