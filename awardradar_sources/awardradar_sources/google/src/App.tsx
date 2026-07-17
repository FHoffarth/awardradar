import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'motion/react';
import { Activity, AlertTriangle, ArrowRight, Copy, Info, Mail, MoreHorizontal, Printer, Share2, ShieldCheck } from 'lucide-react';

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IATA_CODE_PATTERN = /^[A-Z]{3}$/;
const LABELED_IATA_PATTERN = /\(([A-Z]{3})\)\s*$/i;

type PaneStatus = 'idle' | 'loading' | 'success' | 'error' | 'empty';
type TripType = 'one_way' | 'round_trip';
type ItineraryState = 'complete' | 'partial' | 'price_only';
type ContinuationStatus = 'idle' | 'loading' | 'complete' | 'failed';

type SearchRequest = {
  lang: 'en';
  origin: string;
  dest: string;
  date: string;
  oneWay: boolean;
  returnDate: string;
  direct: false;
  mmOnly: false;
  currency: 'eur';
  cabin: 'Economy';
  cabins: ['Economy'];
  flexDays: 0;
};

type FlightSegment = {
  flight_number?: string | null;
  airline?: string | null;
  aircraft?: string | null;
  dep_iata: string;
  departure_datetime_raw?: string | null;
  departure_date?: string | null;
  dep_time?: string | null;
  arr_iata: string;
  arrival_datetime_raw?: string | null;
  arrival_date?: string | null;
  arr_time?: string | null;
  arrival_day_offset?: number | null;
  duration_min?: number | null;
  overnight?: boolean | null;
};

type CashOffer = {
  offer_id?: string;
  source?: string;
  price: number;
  currency?: string;
  origin?: string;
  dest?: string;
  date?: string;
  returnDate?: string | null;
  itinerary_state?: ItineraryState;
  outbound_segments?: FlightSegment[];
  return_segments?: FlightSegment[];
  segments?: FlightSegment[];
  time_data_status?: 'complete' | 'partial' | 'unavailable';
  dep_time?: string | null;
  arr_time?: string | null;
  durationMin?: number | null;
  stops?: number | null;
  airline?: string | null;
  airlineCode?: string | null;
  bookUrl?: string | null;
  links?: Record<string, string>;
};

type CashResponse = {
  ok: boolean;
  offers?: CashOffer[];
  cash_guidance?: { recommended_offer_id?: string | null } | null;
  cash_provenance?: { status?: string; reason?: string };
  error?: string;
};

type AwardProgram = {
  program?: string;
  miles?: number | null;
  miles_required?: number | null;
  surcharge?: number | null;
  taxes_fees?: number | null;
  currency?: string;
  url?: string | null;
  verification_note?: string;
  provider_limitations?: string[];
  trip_type?: 'one_way' | 'round_trip' | 'unknown';
  requested_trip_type?: 'one_way' | 'round_trip';
  grade?: { tier?: string } | null;
};

type DecisionResult = {
  signal?: string;
  verdict?: string;
  confidence?: string;
  trip_basis_compatible?: boolean;
  cash_trip_type?: string;
  award_trip_type?: string;
  verification_guidance?: string;
};

type AwardResult = {
  origin?: string;
  dest?: string;
  date?: string;
  returnDate?: string | null;
  cabin?: string;
  programs?: AwardProgram[];
  has_live_data?: boolean;
  verified_identical_routing?: boolean;
  decision?: DecisionResult;
  links?: Record<string, string>;
};

type AwardResponse = { ok: boolean; results?: AwardResult[]; error?: string };

type ReturnLegRequest = {
  origin: string;
  dest: string;
  date: string;
  returnDate: string;
  cabin: string;
  cabins: string[];
  currency: string;
  mmOnly: boolean;
  lang: string;
  offer_id: string;
};

type ReturnLegResponse =
  | { ok: true; offer_id: string; itinerary_state: 'complete'; outbound_segments?: FlightSegment[]; return_segments: FlightSegment[] }
  | { ok: false; itinerary_state?: 'partial'; error?: string; message?: string; retryable?: boolean };

type ContinuationState = { offerId: string | null; status: ContinuationStatus };

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

function parseTripType(value: string): TripType | null {
  if (!value || value === 'one_way') return 'one_way';
  if (value === 'round_trip') return 'round_trip';
  return null;
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function cashVerificationUrl(offer: CashOffer): string | null {
  const preferred = offer.links?.['Google Flights'];
  const candidates = [preferred, ...Object.values(offer.links || {}), offer.bookUrl];
  for (const candidate of candidates) {
    const safe = safeExternalUrl(candidate);
    if (safe) return safe;
  }
  return null;
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

function formatTravelDate(value: string, forum = false): string {
  if (!DATE_PARAM_PATTERN.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(forum ? 'de-DE' : 'en-GB', forum ? {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  } : {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function formatCashLine(cashOffer: any, tripType: TripType = 'one_way'): string {
  const hasPrice = cashOffer?.price !== undefined && cashOffer?.price !== null;
  const currency = String(cashOffer?.currency || 'EUR').toUpperCase();
  const price = hasPrice ? (currency === 'EUR' ? `€${cashOffer.price}` : `${cashOffer.price} ${currency}`) : '';
  if (tripType === 'round_trip') {
    const state = cashOffer?.itinerary_state === 'complete'
      ? 'round-trip itinerary'
      : cashOffer?.itinerary_state === 'partial'
        ? 'round-trip price; outbound details only'
        : 'round-trip price signal';
    return [price, state].filter(Boolean).join(' · ') || 'Round-trip cash result available; verify the itinerary with the provider.';
  }
  return [price, cashOffer?.airline].filter(Boolean).join(' · ') || 'Cash result available; verify the final fare with the provider.';
}

function formatCashAlternativeLine(cashOffer: any, forum = false, tripType: TripType = 'one_way'): string {
  const parts: string[] = [formatCashLine(cashOffer, tripType)];
  if (tripType === 'round_trip') {
    const line = parts.filter(Boolean).join(' · ');
    return forum ? line.replaceAll('€', '').replace(/(\d)\s*(?=·|$)/, '$1 EUR ') : line;
  }
  if (cashOffer?.time_data_status === 'complete' && cashOffer?.dep_time && cashOffer?.arr_time) {
    parts.push(`${cashOffer.dep_time}–${cashOffer.arr_time}`);
  }
  if (Number.isFinite(cashOffer?.durationMin)) {
    const hours = Math.floor(cashOffer.durationMin / 60);
    const minutes = cashOffer.durationMin % 60;
    parts.push(`${hours}h${minutes ? ` ${minutes}m` : ''}`);
  }
  if (Number.isFinite(cashOffer?.stops)) {
    parts.push(cashOffer.stops === 0 ? 'Nonstop' : `${cashOffer.stops} stop${cashOffer.stops === 1 ? '' : 's'}`);
  }
  const line = parts.filter(Boolean).join(' · ');
  return forum ? line.replaceAll('€', '').replace(/(\d)\s*(?=·|$)/, '$1 EUR ') : line;
}

function formatAwardLine(result: any, forum = false): string {
  const program = result?.programs?.[0];
  if (!program) return 'No program-level award detail is available in this analysis.';
  const parts: string[] = [];
  if (program.miles !== undefined && program.miles !== null) {
    parts.push(`${Number(program.miles).toLocaleString(forum ? 'de-DE' : 'en-GB')} miles`);
  }
  if (program.surcharge !== undefined && program.surcharge !== null) {
    parts.push(forum ? `${program.surcharge} EUR` : `€${program.surcharge}`);
  }
  if (program.program) parts.push(String(program.program));
  return parts.join(' · ') || 'Award result available; verify the program details directly.';
}

type ShareContent = {
  title: string;
  compactText: string;
  forumText: string;
  emailSubject: string;
  emailBody: string;
  mailto: string;
};

function buildShareContent({
  result,
  cashOffer,
  cashAlternatives,
  cashUnavailable,
  awardStatus,
  cashStatus,
  origin,
  destination,
  travelDate,
  tripType,
}: {
  result: any;
  cashOffer: any;
  cashAlternatives: any[];
  cashUnavailable: boolean;
  awardStatus: PaneStatus;
  cashStatus: PaneStatus;
  origin: string;
  destination: string;
  travelDate: string;
  tripType: TripType;
}): ShareContent {
  const date = formatTravelDate(travelDate);
  const forumDate = formatTravelDate(travelDate, true);
  const decision = result ? getDecisionCopy(result, cashStatus === 'success', cashUnavailable, tripType) : null;
  const confidence = result?.decision?.confidence
    ? `${String(result.decision.confidence).charAt(0).toUpperCase()}${String(result.decision.confidence).slice(1)}`
    : null;
  const nextStep = result
    ? (result.has_live_data
      ? 'Verify availability directly on the official program site.'
      : 'Check availability manually on the official program site.')
    : null;

  const cashLine = cashStatus === 'success' && cashOffer
    ? formatCashLine(cashOffer, tripType)
    : cashUnavailable
      ? 'Current cash comparison unavailable'
      : cashStatus === 'error'
        ? 'Cash data unavailable'
        : 'No reliable cash result was returned for this route and date.';
  const awardLine = awardStatus === 'success' && result
    ? formatAwardLine(result)
    : awardStatus === 'error'
      ? 'Award data unavailable'
      : 'No reliable award result was returned for this route and date.';
  const forumAwardLine = awardStatus === 'success' && result ? formatAwardLine(result, true) : awardLine;
  const additionalCashCount = cashStatus === 'success' ? Math.min(cashAlternatives.length, 3) : 0;
  const compactCashLine = additionalCashCount
    ? `${cashLine}\n${additionalCashCount} additional cash option${additionalCashCount === 1 ? '' : 's'} available`
    : cashLine;
  const emailAlternatives = cashAlternatives.slice(0, 3).map(offer => `- ${formatCashAlternativeLine(offer, false, tripType)}`);
  const forumAlternatives = cashAlternatives.slice(0, 3).map(offer => `- ${formatCashAlternativeLine(offer, true, tripType)}`);

  const notes: string[] = [];
  if (cashUnavailable) notes.push('A current cash comparison is unavailable.');
  if (result?.verified_identical_routing !== true && result) {
    notes.push('Cash and award options are not verified as identical itineraries; routing or carrier may differ.');
  }
  if (cashStatus === 'success' && cashOffer?.time_data_status !== 'complete') {
    notes.push('Cash schedule details are unavailable and must be verified with the provider.');
  }
  if (result && !result.has_live_data) notes.push('Award figures are estimates and do not confirm availability.');
  notes.push('Prices and award availability can change. Schedules and booking rules must be verified before purchase.');
  const note = notes.join(' ');

  const compactSections = [
    `AwardRadar analysis\n${origin} → ${destination} · ${date}`,
    decision ? `Signal:\n${decision.verdict}` : null,
    `Cash:\n${compactCashLine}`,
    `Award:\n${awardLine}`,
    confidence ? `Confidence:\n${confidence}` : null,
    nextStep ? `Next step:\n${nextStep}` : null,
    `Note:\n${note}`,
  ].filter(Boolean);
  const compactText = compactSections.join('\n\n');

  const forumSections = [
    `[b]AwardRadar analysis: ${origin} → ${destination} · ${forumDate}[/b]`,
    decision ? `[b]Signal:[/b]\n${decision.verdict}` : null,
    `[b]Cash:[/b]\n${cashLine.replaceAll('€', '').replace(/(\d)\s*(?=·|$)/, '$1 EUR ')}`,
    forumAlternatives.length ? `[b]Other options:[/b]\n${forumAlternatives.join('\n')}` : null,
    `[b]Award:[/b]\n${forumAwardLine}`,
    confidence ? `[b]Confidence:[/b]\n${confidence}` : null,
    nextStep ? `[b]Next step:[/b]\n${nextStep}` : null,
    `[i]${note}[/i]`,
  ].filter(Boolean);
  const forumText = forumSections.join('\n\n');

  const emailSubject = `AwardRadar analysis: ${origin} to ${destination} on ${date}`;
  const emailBody = emailAlternatives.length
    ? `${compactText}\n\nOther cash options:\n${emailAlternatives.join('\n')}`
    : compactText;
  const mailto = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
  return { title: emailSubject, compactText, forumText, emailSubject, emailBody, mailto };
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Continue to the local selection fallback below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard_unavailable');
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

function getDecisionCopy(result: AwardResult | undefined, cashAvailable: boolean, cashUnavailable: boolean, tripType: TripType = 'one_way') {
  if (tripType === 'round_trip' && result?.decision?.trip_basis_compatible !== true) {
    return {
      verdict: 'Cash and award are not directly comparable',
      why: 'The cash result covers a round trip, while the award signal covers the outbound journey only.',
    };
  }
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
  onAnalyze: (origin: string, dest: string, date: string, tripType: TripType, returnDate: string) => void;
  status: string;
  validationError: string | null;
  compact: boolean;
}) => {
  const origin = getTripParam('from');
  const destination = getTripParam('to');
  const dateParam = getTripParam('date');
  const tripParam = getTripParam('trip');
  const returnDateParam = getTripParam('returnDate');
  const tripType = parseTripType(tripParam);
  const originCode = resolveAirportCode(origin);
  const destinationCode = resolveAirportCode(destination);
  const originDisplay = origin || 'Origin';
  const destinationDisplay = destination || 'Destination';
  const dateIsValid = isValidDateString(dateParam);
  const returnDateIsValid = isValidDateString(returnDateParam);
  const tripValidationError = tripType === null
    ? 'Trip type in this link is invalid.'
    : tripType === 'round_trip' && !returnDateParam
      ? 'A return date is required for a round-trip search.'
      : tripType === 'round_trip' && !returnDateIsValid
        ? 'A valid future return date (YYYY-MM-DD) is required.'
        : tripType === 'round_trip' && dateIsValid && returnDateParam < dateParam
          ? 'Return date must not be before the departure date.'
          : null;
  const dateLabel = dateIsValid ? dateParam : 'Date not selected';
  const canAnalyze = Boolean(originCode && destinationCode && originCode !== destinationCode && dateIsValid && tripType && !tripValidationError);

  useEffect(() => {
    if (!originCode || !destinationCode) return;
    const hasCanonicalCodes = origin === originCode && destination === destinationCode;
    const hasStrayOneWayReturn = tripType === 'one_way' && Boolean(returnDateParam);
    if (hasCanonicalCodes && !hasStrayOneWayReturn) return;
    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.searchParams.set('from', originCode);
    canonicalUrl.searchParams.set('to', destinationCode);
    if (tripType === 'one_way') canonicalUrl.searchParams.delete('returnDate');
    window.history.replaceState(window.history.state, '', `${canonicalUrl.pathname}${canonicalUrl.search}${canonicalUrl.hash}`);
  }, [origin, destination, originCode, destinationCode, tripType, returnDateParam]);

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

      {(validationError || tripValidationError) && (
        <div className="validation-error" role="alert" data-testid="validation-error">
          <AlertTriangle aria-hidden="true" /> {validationError || tripValidationError}
        </div>
      )}

      <div className={`search-instrument ${tripType === 'round_trip' ? 'search-instrument--round-trip' : ''}`}>
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
        <div className="search-field">
          <span className="field-label">Trip type</span>
          <strong>{tripType === 'round_trip' ? 'Round-trip' : tripType === 'one_way' ? 'One-way' : 'Invalid'}</strong>
        </div>
        {tripType === 'round_trip' && (
          <div className="search-field">
            <span className="field-label">Return</span>
            <time dateTime={returnDateParam || undefined}>{returnDateIsValid ? returnDateParam : 'Return date not selected'}</time>
          </div>
        )}
        <button
          onClick={() => originCode && destinationCode && tripType && onAnalyze(originCode, destinationCode, dateParam, tripType, tripType === 'round_trip' ? returnDateParam : '')}
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

const DecisionSummary = ({ result, cashAvailable, cashUnavailable, tripType }: { result: AwardResult; cashAvailable: boolean; cashUnavailable: boolean; tripType: TripType }) => {
  const copy = getDecisionCopy(result, cashAvailable, cashUnavailable, tripType);
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

const SegmentList = ({ label, segments }: { label: string; segments: FlightSegment[] }) => (
  <section className="journey-leg" aria-label={label}>
    <h4>{label}</h4>
    <ol>
      {segments.map((segment, index) => (
        <li key={`${segment.dep_iata}-${segment.arr_iata}-${segment.flight_number || index}`}>
          <strong>{segment.dep_iata} <span aria-hidden="true">→</span> {segment.arr_iata}</strong>
          {(segment.dep_time || segment.arr_time) && <span>{segment.dep_time || '—'}–{segment.arr_time || '—'}</span>}
          {(segment.airline || segment.flight_number) && <span>{[segment.airline, segment.flight_number].filter(Boolean).join(' · ')}</span>}
        </li>
      ))}
    </ol>
  </section>
);

const CashVerification = ({ offer }: { offer: CashOffer }) => {
  const url = cashVerificationUrl(offer);
  return url ? (
    <a className="verification-link" href={url} target="_blank" rel="noopener noreferrer">Check current fare</a>
  ) : (
    <p className="verification-guidance">Verify the current fare with a flight provider.</p>
  );
};

const CashRoundTripDetails = ({ offer, continuationStatus }: { offer: CashOffer; continuationStatus: ContinuationStatus }) => {
  const state = offer.itinerary_state;
  const requestedReturn = offer.returnDate ? formatTravelDate(offer.returnDate) : 'Not provided';
  if (state === 'price_only') {
    return (
      <div className="round-trip-integrity price-only" data-testid="cash-round-trip-price-only">
        <p className="integrity-label">Round-trip price signal</p>
        <dl className="trip-request-facts">
          <div><dt>Route</dt><dd>{offer.origin || 'Origin'} → {offer.dest || 'Destination'}</dd></div>
          <div><dt>Departure</dt><dd>{formatTravelDate(offer.date || '')}</dd></div>
          <div><dt>Requested return</dt><dd>{requestedReturn}</dd></div>
        </dl>
        <p className="card-caveat">The current source returned a round-trip price without reliable itinerary details.</p>
      </div>
    );
  }
  if (state === 'complete') {
    return (
      <div className="round-trip-integrity complete" data-testid="cash-round-trip-complete">
        <p className="integrity-label">Round-trip details available</p>
        <SegmentList label="Outbound" segments={offer.outbound_segments || []} />
        <SegmentList label="Return" segments={offer.return_segments || []} />
        <p className="requested-return">Requested return: {requestedReturn}</p>
        <p className="card-caveat">Returned fare data includes both journey legs. Verify schedules and fare conditions before purchase.</p>
      </div>
    );
  }
  return (
    <div className="round-trip-integrity partial" data-testid="cash-round-trip-partial">
      <p className="integrity-label">{continuationStatus === 'loading' ? 'Checking return details…' : 'Return details unavailable'}</p>
      <SegmentList label="Outbound" segments={offer.outbound_segments || []} />
      <section className="return-placeholder" aria-label="Return details unavailable">
        <h4>Return</h4>
        <p>Return itinerary details are not available.</p>
        <p>Requested return: {requestedReturn}</p>
      </section>
    </div>
  );
};

const CashCandidate = ({ cashOffer, isLimited, isRoundTrip, continuationStatus }: { cashOffer: CashOffer; isLimited: boolean; isRoundTrip: boolean; continuationStatus: ContinuationStatus }) => (
  <article className="option-card" data-testid="cash-candidate-card" data-offer-id={cashOffer.offer_id} aria-labelledby="cash-option-title">
    <div className="option-card__header">
      <div>
        <p className="option-type">Cash option</p>
        <h3 id="cash-option-title">Best Cash Option</h3>
      </div>
      {cashOffer.currency && <span className="data-source">{cashOffer.currency}</span>}
    </div>
    {isRoundTrip ? (
      <>
        <dl className="option-facts option-facts--price-only">
          <div className="primary-fact"><dt>Price</dt><dd>{cashOffer.currency === 'EUR' || !cashOffer.currency ? '€' : ''}{cashOffer.price}</dd></div>
        </dl>
        <CashRoundTripDetails offer={cashOffer} continuationStatus={continuationStatus} />
      </>
    ) : <dl className="option-facts">
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
    </dl>}
    {isLimited && (
      <p className="card-caveat" data-testid="limited-comparison-disclaimer">
        This cash itinerary may route differently than the award option.
      </p>
    )}
    <CashVerification offer={cashOffer} />
  </article>
);

const CashAlternatives = ({ offers, isRoundTrip }: { offers: CashOffer[]; isRoundTrip: boolean }) => {
  if (!offers.length) return null;
  return (
    <section className="cash-alternatives" aria-labelledby="cash-alternatives-title" data-testid="cash-alternatives">
      <h3 id="cash-alternatives-title">Other viable cash options</h3>
      <div className="cash-alternatives__list">
        {offers.map((offer, index) => {
          const hasCompleteTimes = !isRoundTrip && offer?.time_data_status === 'complete' && offer?.dep_time && offer?.arr_time;
          return (
            <article className="cash-alternative-row" key={`${offer?.offer_id || 'cash-alternative'}-${index}`} data-testid="cash-alternative-row">
              <div className="cash-alternative-row__lead">
                <strong>{offer?.currency === 'EUR' || !offer?.currency ? '€' : ''}{offer?.price}</strong>
                {offer?.currency && offer.currency !== 'EUR' && <span>{offer.currency}</span>}
                {!isRoundTrip && offer?.airline && <span>{offer.airline}</span>}
              </div>
              <div className="cash-alternative-row__facts">
                {isRoundTrip && <span>{offer.itinerary_state === 'complete' ? 'Round-trip details available' : offer.itinerary_state === 'price_only' ? 'Round-trip price signal' : 'Outbound details only'}</span>}
                {hasCompleteTimes && <span>{offer.dep_time}–{offer.arr_time}</span>}
                {!isRoundTrip && Number.isFinite(offer?.durationMin) && (
                  <span>{Math.floor(offer.durationMin / 60)}h{offer.durationMin % 60 ? ` ${offer.durationMin % 60}m` : ''}</span>
                )}
                {!isRoundTrip && Number.isFinite(offer?.stops) && <span>{offer.stops === 0 ? 'Nonstop' : `${offer.stops} stop${offer.stops === 1 ? '' : 's'}`}</span>}
              </div>
              {!isRoundTrip && !hasCompleteTimes && (
                <p className="cash-alternative-row__disclosure">Schedule details unavailable. Verify with the provider.</p>
              )}
              {isRoundTrip && offer.returnDate && <p className="cash-alternative-row__disclosure">Requested return: {formatTravelDate(offer.returnDate)}. Verify return details before purchase.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
};

const AwardCandidate = ({ result, tripType }: { result: AwardResult; tripType: TripType }) => {
  const bestProgram = result?.programs?.[0];
  const verificationUrl = safeExternalUrl(bestProgram?.url);
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
          {bestProgram.taxes_fees != null || bestProgram.surcharge != null
            ? <div><dt>Estimated taxes &amp; fees</dt><dd>€{bestProgram.taxes_fees ?? bestProgram.surcharge}</dd></div>
            : <div className="fact-disclosure"><dt>Taxes &amp; fees</dt><dd>Taxes and fees unknown — verify with the program.</dd></div>}
          {bestProgram.program && <div><dt>Program</dt><dd>{bestProgram.program}</dd></div>}
        </dl>
      ) : (
        <p className="missing-pane" data-testid="missing-award-detail">No program-level award detail is available in this analysis.</p>
      )}
      {tripType === 'round_trip' && (
        <p className="card-caveat award-outbound-disclosure" data-testid="award-outbound-only-disclosure">
          Outbound award signal only. Return award availability is not included in this round-trip analysis.
        </p>
      )}
      {!result?.has_live_data && <p className="card-caveat">Award figures are estimates and do not confirm availability.</p>}
      {verificationUrl
        ? <a className="verification-link" href={verificationUrl} target="_blank" rel="noopener noreferrer">Verify with program</a>
        : <p className="verification-guidance">Check award availability manually with the loyalty program.</p>}
    </article>
  );
};

const PaneUnavailable = ({ kind, status }: { kind: 'Cash' | 'Award'; status: PaneStatus }) => (
  <article className="option-card option-card--unavailable print-omit" data-testid={`${kind.toLowerCase()}-pane-${status}`}>
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

const ResultActions = ({ content, onPrint }: { content: ShareContent; onPrint: () => void }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstMenuActionRef = useRef<HTMLButtonElement>(null);
  const nativeShareSupported = typeof navigator.share === 'function';

  useEffect(() => {
    if (!menuOpen) return;
    firstMenuActionRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: content.title,
        text: content.compactText,
        url: 'https://awardradar.app/',
      });
      setFeedback('Share sheet opened');
    } catch (error: any) {
      if (error?.name !== 'AbortError') setFeedback('Sharing is unavailable. Choose another action.');
    } finally {
      setMenuOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleCopy = async (text: string, successMessage: string) => {
    setManualCopy('');
    try {
      await copyToClipboard(text);
      setFeedback(successMessage);
    } catch {
      setManualCopy(text);
      setFeedback('Could not copy automatically. Select the text and try again.');
    }
  };

  return (
    <section className="result-section result-actions interactive-only" aria-labelledby="result-actions-title" data-testid="share-hub">
      <div className="result-actions__intro">
        <h2 id="result-actions-title">Keep or share this analysis</h2>
        <p>Share a concise snapshot or open your browser’s print dialog to save a PDF.</p>
      </div>

      <div className="result-actions__controls">
        <button
          type="button"
          className="secondary-action secondary-action--primary"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="result-action-menu"
          onClick={() => {
            if (menuOpen) {
              setMenuOpen(false);
              triggerRef.current?.focus();
            } else {
              setMenuOpen(true);
            }
          }}
          ref={triggerRef}
          data-testid="share-export-button"
        >
          <Share2 aria-hidden="true" /> Share &amp; Export <MoreHorizontal aria-hidden="true" />
        </button>

        {menuOpen && (
          <div className="result-action-menu" id="result-action-menu" role="menu" aria-label="Result actions" data-testid="result-action-menu">
            {nativeShareSupported && (
              <button type="button" role="menuitem" ref={firstMenuActionRef} onClick={handleNativeShare} data-testid="share-button">
                <Share2 aria-hidden="true" /> Share analysis
              </button>
            )}
            <button type="button" role="menuitem" ref={nativeShareSupported ? undefined : firstMenuActionRef} onClick={() => handleCopy(content.compactText, 'Summary copied')} data-testid="copy-summary-button">
              <Copy aria-hidden="true" /> Copy summary
            </button>
            <button type="button" role="menuitem" onClick={() => handleCopy(content.forumText, 'Forum post copied')} data-testid="copy-forum-button">
              <Copy aria-hidden="true" /> Copy forum post
            </button>
            <a role="menuitem" href={content.mailto} data-testid="email-analysis-link">
              <Mail aria-hidden="true" /> Email analysis
            </a>
            <button type="button" role="menuitem" onClick={onPrint} data-testid="print-button">
              <Printer aria-hidden="true" /> Print / Save PDF
            </button>
          </div>
        )}
      </div>

      <p className="share-feedback" role="status" aria-live="polite" data-testid="share-feedback">{feedback}</p>
      {manualCopy && (
        <label className="manual-copy">
          Select and copy this text
          <textarea readOnly value={manualCopy} onFocus={event => event.currentTarget.select()} data-testid="manual-copy-text" />
        </label>
      )}
    </section>
  );
};

export default function App() {
  const [awardStatus, setAwardStatus] = useState<PaneStatus>('idle');
  const [cashStatus, setCashStatus] = useState<PaneStatus>('idle');
  const [awardData, setAwardData] = useState<AwardResponse | null>(null);
  const [cashData, setCashData] = useState<CashResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [exportTimestamp, setExportTimestamp] = useState<Date | null>(null);
  const [activeRequest, setActiveRequest] = useState<SearchRequest | null>(null);
  const [continuationState, setContinuationState] = useState<ContinuationState>({ offerId: null, status: 'idle' });
  const searchEpochRef = useRef(0);
  const continuationAttemptsRef = useRef<Set<string>>(new Set());
  const continuationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => continuationAbortRef.current?.abort(), []);

  const verifyRecommendedReturnLeg = async (cashResponse: CashResponse, request: SearchRequest, epoch: number) => {
    if (request.oneWay || !request.returnDate) return;
    const recommendedId = cashResponse.cash_guidance?.recommended_offer_id?.trim();
    if (!recommendedId) return;
    const offer = (cashResponse.offers || []).find(candidate => candidate.offer_id === recommendedId);
    if (!offer || offer.itinerary_state !== 'partial' || !offer.offer_id) return;

    const guardKey = `${epoch}|${offer.offer_id}|${request.date}|${request.returnDate}`;
    if (continuationAttemptsRef.current.has(guardKey)) return;
    continuationAttemptsRef.current.add(guardKey);

    continuationAbortRef.current?.abort();
    const controller = new AbortController();
    continuationAbortRef.current = controller;
    setContinuationState({ offerId: offer.offer_id, status: 'loading' });

    const continuationRequest: ReturnLegRequest = {
      origin: request.origin,
      dest: request.dest,
      date: request.date,
      returnDate: request.returnDate,
      cabin: request.cabin,
      cabins: request.cabins,
      currency: request.currency,
      mmOnly: request.mmOnly,
      lang: request.lang,
      offer_id: offer.offer_id,
    };

    try {
      const response = await fetch('/api/return-leg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(continuationRequest),
        signal: controller.signal,
      });
      const json = await response.json() as ReturnLegResponse;
      if (searchEpochRef.current !== epoch) return;
      if (!json.ok || json.offer_id !== offer.offer_id || json.itinerary_state !== 'complete' || !Array.isArray(json.return_segments) || !json.return_segments.length) {
        setContinuationState({ offerId: offer.offer_id, status: 'failed' });
        return;
      }
      setCashData(previous => previous ? {
        ...previous,
        offers: (previous.offers || []).map(candidate => candidate.offer_id === offer.offer_id ? {
          ...candidate,
          itinerary_state: 'complete',
          outbound_segments: json.outbound_segments?.length ? json.outbound_segments : candidate.outbound_segments,
          return_segments: json.return_segments,
        } : candidate),
      } : previous);
      setContinuationState({ offerId: offer.offer_id, status: 'complete' });
    } catch {
      if (searchEpochRef.current === epoch && !controller.signal.aborted) {
        setContinuationState({ offerId: offer.offer_id, status: 'failed' });
      }
    }
  };

  const handleAnalyze = async (origin: string, dest: string, date: string, tripType: TripType, returnDate: string) => {
    const originCode = resolveAirportCode(origin);
    const destinationCode = resolveAirportCode(dest);
    if (!originCode) { setValidationError('A resolved three-letter origin airport code is required.'); return; }
    if (!destinationCode) { setValidationError('A resolved three-letter destination airport code is required.'); return; }
    if (originCode === destinationCode) { setValidationError('Origin and destination must be different.'); return; }
    if (!isValidDateString(date)) { setValidationError('A valid future date (YYYY-MM-DD) is required.'); return; }
    if (tripType === 'round_trip' && !isValidDateString(returnDate)) { setValidationError('A valid future return date (YYYY-MM-DD) is required.'); return; }
    if (tripType === 'round_trip' && returnDate < date) { setValidationError('Return date must not be before the departure date.'); return; }

    const epoch = ++searchEpochRef.current;
    continuationAbortRef.current?.abort();
    continuationAttemptsRef.current.clear();
    setContinuationState({ offerId: null, status: 'idle' });
    setValidationError(null);
    setAwardStatus('loading');
    setCashStatus('loading');

    const requestPayload: SearchRequest = {
      lang: 'en',
      origin: originCode,
      dest: destinationCode,
      date: date,
      oneWay: tripType === 'one_way',
      returnDate: tripType === 'round_trip' ? returnDate : '',
      direct: false,
      mmOnly: false,
      currency: 'eur',
      cabin: 'Economy',
      cabins: ['Economy'],
      flexDays: 0,
    };
    setActiveRequest(requestPayload);

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
      const json = awardRes.value as AwardResponse;
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
      const json = cashRes.value as CashResponse;
      if (!json.ok) {
        setCashStatus('error');
        setCashData(json);
      } else if (!json.offers || json.offers.length === 0) {
        setCashStatus('empty');
        setCashData(json);
      } else {
        setCashData(json);
        setCashStatus('success');
        void verifyRecommendedReturnLeg(json, requestPayload, epoch);
      }
    } else {
      setCashStatus('error');
    }
  };

  const status = (awardStatus === 'loading' || cashStatus === 'loading') ? 'loading' :
    (awardStatus === 'success' || cashStatus === 'success') ? 'success' :
    (awardStatus === 'error' && cashStatus === 'error') ? 'error' : 'empty';

  const result = awardData?.results?.[0];
  const returnedCashOffers = Array.isArray(cashData?.offers) ? cashData.offers : [];
  const recommendedCashId = cashData?.cash_guidance?.recommended_offer_id;
  const cashOffers = recommendedCashId && returnedCashOffers.some(offer => offer.offer_id === recommendedCashId)
    ? [returnedCashOffers.find(offer => offer.offer_id === recommendedCashId)!, ...returnedCashOffers.filter(offer => offer.offer_id !== recommendedCashId)]
    : returnedCashOffers;
  const cashOffer = cashOffers[0];
  const cashAlternatives = cashStatus === 'success' ? cashOffers.slice(1, 4) : [];
  const cashUnavailable = cashData?.cash_provenance?.status === 'unavailable';
  const hydratedTripType = parseTripType(getTripParam('trip')) || 'one_way';
  const tripType: TripType = activeRequest ? (activeRequest.oneWay ? 'one_way' : 'round_trip') : hydratedTripType;
  const isRoundTrip = tripType === 'round_trip';
  const isLimited = result?.verified_identical_routing !== true;
  const hasSuccessfulPane = awardStatus === 'success' || cashStatus === 'success';
  const routeOrigin = result?.origin || getTripParam('from') || 'Origin';
  const routeDestination = result?.dest || getTripParam('to') || 'Destination';
  const travelDate = result?.date || getTripParam('date') || 'Date not selected';
  const shareContent = useMemo(() => buildShareContent({
    result,
    cashOffer,
    cashAlternatives,
    cashUnavailable,
    awardStatus,
    cashStatus,
    origin: routeOrigin,
    destination: routeDestination,
    travelDate,
    tripType,
  }), [result, cashOffer, cashAlternatives, cashUnavailable, awardStatus, cashStatus, routeOrigin, routeDestination, travelDate, tripType]);

  const handlePrint = () => {
    flushSync(() => setExportTimestamp(new Date()));
    window.print();
  };

  return (
    <div className="app-shell typography-landing-parity" data-typography="landing-parity">
      <div className="workspace-background" aria-hidden="true" />
      <header className="workspace-header interactive-only">
        <a className="wordmark" href="/" aria-label="AwardRadar home"><span>Award</span><span>Radar</span></a>
        <span className="workspace-label">Decision Workspace</span>
      </header>

      <main className="workspace-main">
        <h1 className="sr-only">AwardRadar Decision Workspace</h1>
        <SearchInstrument onAnalyze={handleAnalyze} status={status} validationError={validationError} compact={hasSuccessfulPane} />

        <div className="print-report-header" data-testid="print-report-header">
          <h1><span>AwardRadar</span> Decision Report</h1>
          <p className="print-route">{routeOrigin} → {routeDestination}</p>
          <dl>
            <div><dt>Travel date</dt><dd>{formatTravelDate(travelDate)}</dd></div>
            <div><dt>Exported</dt><dd data-testid="export-timestamp">{formatExportTimestamp(exportTimestamp)}</dd></div>
          </dl>
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
            {awardStatus === 'success' && result && <DecisionSummary result={result} cashAvailable={cashStatus === 'success'} cashUnavailable={cashUnavailable} tripType={tripType} />}

            <section className="result-section options-section" aria-labelledby="options-title">
              <h2 id="options-title">Best Options</h2>
              <div className="options-grid" data-testid="options-grid">
                <div className="cash-option-stack" data-testid="cash-option-stack">
                  {cashStatus === 'success' && cashOffer ? <CashCandidate cashOffer={cashOffer} isLimited={isLimited} isRoundTrip={isRoundTrip} continuationStatus={continuationState.offerId === cashOffer.offer_id ? continuationState.status : 'idle'} /> : cashUnavailable ? <CashUnavailable /> : <PaneUnavailable kind="Cash" status={cashStatus} />}
                  {cashStatus === 'success' && cashOffer && <CashAlternatives offers={cashAlternatives} isRoundTrip={isRoundTrip} />}
                </div>
                {awardStatus === 'success' && result ? <AwardCandidate result={result} tripType={tripType} /> : <PaneUnavailable kind="Award" status={awardStatus} />}
              </div>
            </section>

            {awardStatus === 'success' && result && <ConfidenceAndVerification decision={result.decision} hasLive={Boolean(result.has_live_data)} />}
            <EvidenceAndCaveats result={result} awardStatus={awardStatus} cashStatus={cashStatus} />

            <ResultActions content={shareContent} onPrint={handlePrint} />

            <footer className="report-disclaimer">
              <ShieldCheck aria-hidden="true" />
              <p>This report is a snapshot of the information available at the time of analysis. Prices and award availability can change. Schedules and booking rules must be verified directly with the relevant airline, loyalty program or booking provider before purchase.</p>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
