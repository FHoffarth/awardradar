import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'motion/react';
import { Activity, AlertTriangle, ArrowRight, Copy, Info, Mail, MoreHorizontal, Printer, Share2, ShieldCheck } from 'lucide-react';
import AwardTrustNotice from './trust/AwardTrustNotice';
import { FRESHNESS, resolveAwardTrust, type AwardDataState, type AwardTrustInput, type AwardTrustPresentation } from './trust/awardTrustContract';

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
  cash_offer_id?: string;
  itinerary_ref?: string;
  trip_basis?: 'one_way' | 'round_trip';
  completeness?: 'complete' | 'partial' | 'price_only';
  observed_at?: string | null;
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
  selected_cash_offer_id?: string | null;
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
  verification_level?: string;
  data_source?: string;
  source?: string;
  source_type?: string;
  is_estimate?: boolean;
  is_live_data?: boolean;
  fetched_at?: string | null;
  last_seen_at?: string | null;
  freshness_label?: string;
  seats?: number | null;
};

type DecisionResult = {
  signal?: string;
  verdict?: string;
  confidence?: string;
  trip_basis_compatible?: boolean;
  cash_trip_type?: string;
  award_trip_type?: string;
  verification_guidance?: string;
  evaluated_cash_offer_id?: string | null;
  evaluated_award_option_id?: string | null;
  itinerary_ref?: string | null;
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

type AwardResponse = {
  ok: boolean;
  results?: AwardResult[];
  selected_cash_offer_id?: string | null;
  error?: string;
  status?: number | string;
  status_code?: number | string;
  http_status?: number | string;
  code?: string;
  error_code?: string;
  message?: string;
  error_category?: string;
  error_details?: { category?: string } | null;
  error_meta?: { category?: string } | null;
  award_source?: {
    configured_source?: string;
    active_static_source?: string;
    provider_mode?: string;
    live_source_enabled?: boolean;
  };
};

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
  | { ok: true; offer_id: string; cash_offer_id?: string; itinerary_ref?: string; completeness?: 'complete'; itinerary_state: 'complete'; outbound_segments?: FlightSegment[]; return_segments: FlightSegment[] }
  | { ok: false; itinerary_state?: 'partial'; error?: string; message?: string; retryable?: boolean };

type ContinuationState = { offerId: string | null; status: ContinuationStatus };

function isValidDateString(dateStr: string): boolean {
  if (!DATE_PARAM_PATTERN.test(dateStr)) return false;
  const date = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr) && date >= now;
}

function hasValidPositivePrice(value: unknown): boolean {
  if (typeof value === 'boolean' || value === null || value === undefined) return false;
  const price = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(price) && price > 0;
}

function resolveSelectedCashOfferId(response: CashResponse | null | undefined): string | null {
  const selectedId = response?.selected_cash_offer_id?.trim();
  if (!selectedId || !Array.isArray(response?.offers)) return null;
  return response.offers.some(offer => (
    offer?.cash_offer_id === selectedId && hasValidPositivePrice(offer.price)
  )) ? selectedId : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function awardProviderName(awardData: AwardResponse | null, result: AwardResult | undefined): string | undefined {
  const bestProgram = result?.programs?.[0];
  if (isNonEmptyString(bestProgram?.source)) return bestProgram.source;
  if (isNonEmptyString(awardData?.award_source?.configured_source)) return awardData.award_source.configured_source;
  if (isNonEmptyString(awardData?.award_source?.provider_mode)) return awardData.award_source.provider_mode;
  return undefined;
}

function resolveAwardCheckedAt(program: AwardProgram | undefined): string | null {
  if (!program) return null;
  if (isNonEmptyString(program.fetched_at)) return program.fetched_at;
  if (isNonEmptyString(program.last_seen_at)) return program.last_seen_at;
  return null;
}

function inferAwardStateFromProgram(program: AwardProgram | undefined, result: AwardResult | undefined): AwardDataState {
  if (!program) return 'partial';
  const freshnessLabel = isNonEmptyString(program.freshness_label) ? program.freshness_label.trim().toLowerCase() : '';
  const checkedAt = resolveAwardCheckedAt(program);
  const ageMs = checkedAt ? Date.now() - Date.parse(checkedAt) : Number.NaN;
  const liveProgram = program.is_live_data === true || program.data_source === 'live';
  const estimatedProgram = program.is_estimate === true || program.data_source === 'estimated' || freshnessLabel === 'estimate';

  if (freshnessLabel === 'stale' || freshnessLabel === 'cached_stale') return 'cached_stale';
  if (freshnessLabel === 'recent' || freshnessLabel === 'cached_recent') return 'cached_recent';
  if (liveProgram && checkedAt && Number.isFinite(ageMs)) {
    return ageMs <= FRESHNESS.RECENT_MAX_SECONDS * 1000 ? 'cached_recent' : 'cached_stale';
  }
  if (estimatedProgram || result?.has_live_data !== true) return 'estimated';
  return 'partial';
}

function hasExplicitCurrentRequestProvenance(program: AwardProgram | undefined): boolean {
  if (!program) return false;
  // Canonical trust contract still supports `live_provider_reported`, but the
  // current Award API payload does not expose an explicit "fetched during this
  // exact user request" provenance field. We therefore intentionally DO NOT map
  // any app payload to `live_provider_reported` yet.
  return false;
}

function isRateLimitedAwardError(awardData: AwardResponse | null): boolean {
  if (!awardData) return false;
  const numericCandidates = [awardData.status, awardData.status_code, awardData.http_status];
  if (numericCandidates.some(value => value === 429 || value === '429')) return true;

  const stringCandidates = [
    awardData.code,
    awardData.error_code,
    awardData.error,
    awardData.error_category,
    awardData.error_details?.category,
    awardData.error_meta?.category,
  ]
    .filter(isNonEmptyString)
    .map(value => value.trim().toLowerCase());

  if (stringCandidates.some(value => ['rate_limited', 'rate_limit', 'quota_exceeded', 'too_many_requests'].includes(value))) {
    return true;
  }

  const fallbackText = [awardData.message, awardData.error]
    .filter(isNonEmptyString)
    .join(' ')
    .toLowerCase();

  return fallbackText.includes('too many requests') || fallbackText.includes('rate limit') || fallbackText.includes('rate-limit');
}

function getAwardOptionHeading(awardTrust: AwardTrustPresentation): string {
  if (awardTrust.recommendationAllowed) return 'Best Award Option';
  if (awardTrust.state === 'cached_stale' || awardTrust.state === 'estimated') return 'Award Option Worth Checking';
  return 'Award Evidence';
}

function buildAwardTrustInput(
  awardStatus: PaneStatus,
  awardData: AwardResponse | null,
  result: AwardResult | undefined,
  tripType: TripType,
): AwardTrustInput {
  const provider = awardProviderName(awardData, result);

  if (awardStatus === 'error') {
    return {
      state: isRateLimitedAwardError(awardData) ? 'rate_limited' : 'provider_error',
      provider,
      checkedAt: null,
    };
  }

  if (awardStatus === 'empty') {
    return {
      state: 'no_results',
      provider,
      checkedAt: new Date().toISOString(),
    };
  }

  if (awardStatus !== 'success') {
    return {
      state: 'unavailable',
      provider,
      checkedAt: null,
    };
  }

  if (!awardData || !Array.isArray(awardData.results) || !result || typeof result !== 'object') {
    return {
      state: 'malformed_payload',
      provider,
      checkedAt: null,
    };
  }

  if (result.programs !== undefined && !Array.isArray(result.programs)) {
    return {
      state: 'malformed_payload',
      provider,
      checkedAt: null,
    };
  }

  const programs = Array.isArray(result.programs) ? result.programs.filter(Boolean) : [];
  const bestProgram = programs[0];
  const checkedAt = resolveAwardCheckedAt(bestProgram);
  const itineraryOwnershipVerified = result.verified_identical_routing === true;
  const roundTripReturnMissing = tripType === 'round_trip';

  if (!bestProgram) {
    if (result.decision) {
      return {
        state: 'partial',
        provider,
        checkedAt,
        availableComponents: ['Directional award signal'],
        missingComponents: ['Program-level award detail'],
        routingConfidence: 'insufficient',
        itineraryOwnershipVerified,
        roundTripReturnMissing,
      };
    }
    return {
      state: 'malformed_payload',
      provider,
      checkedAt: null,
    };
  }

  const hasMiles = hasValidPositivePrice(bestProgram.miles ?? bestProgram.miles_required);
  const hasProgramName = isNonEmptyString(bestProgram.program);
  const hasVerificationSupport = isNonEmptyString(bestProgram.verification_note) || isNonEmptyString(bestProgram.url);

  if (!hasMiles && !hasProgramName && !hasVerificationSupport) {
    return {
      state: 'malformed_payload',
      provider,
      checkedAt,
    };
  }

  if (!hasMiles || !hasProgramName) {
    return {
      state: 'partial',
      provider,
      checkedAt,
      availableComponents: [
        hasMiles ? 'Award price signal' : '',
        hasProgramName ? 'Program label' : '',
      ].filter(Boolean),
      missingComponents: [
        hasMiles ? '' : 'Valid miles requirement',
        hasProgramName ? '' : 'Program label',
      ].filter(Boolean),
      routingConfidence: itineraryOwnershipVerified && !roundTripReturnMissing ? 'complete' : 'insufficient',
      itineraryOwnershipVerified,
      roundTripReturnMissing,
    };
  }

  const inferredState = inferAwardStateFromProgram(bestProgram, result);
  if (inferredState === 'partial') {
    return {
      state: 'partial',
      provider,
      checkedAt,
      availableComponents: ['Directional award signal', 'Program-level award detail'],
      missingComponents: ['Verified freshness timestamp'],
      routingConfidence: itineraryOwnershipVerified && !roundTripReturnMissing ? 'complete' : 'insufficient',
      itineraryOwnershipVerified,
      roundTripReturnMissing,
    };
  }

  return {
    state: hasExplicitCurrentRequestProvenance(bestProgram) ? 'live_provider_reported' : inferredState,
    provider,
    checkedAt,
    seatCount: typeof bestProgram.seats === 'number' ? bestProgram.seats : null,
    seatCountBasis: typeof bestProgram.seats === 'number' ? 'provider_reported' : null,
    routingConfidence: itineraryOwnershipVerified && !roundTripReturnMissing ? 'complete' : 'insufficient',
    itineraryOwnershipVerified,
    roundTripReturnMissing,
  };
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
  awardTrust,
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
  awardTrust: AwardTrustPresentation;
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
    ? (awardTrust.verificationNotice || (result.has_live_data
      ? 'Verify availability directly on the official program site.'
      : 'Check availability manually on the official program site.'))
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
  if (result && awardTrust.supportingCopy) notes.push(awardTrust.supportingCopy);
  if (result && awardTrust.verificationNotice) notes.push(awardTrust.verificationNotice);
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
  promising_miles_value: {
    verdict: 'Promising Award Value Signal',
    why: 'The estimated mileage requirement compares reasonably with the evaluated cash offer.',
  },
  mixed_value: {
    verdict: 'Mixed Cash and Miles Value',
    why: 'The evaluated cash and mileage options are close on the available value evidence.',
  },
  cash_may_be_stronger: {
    verdict: 'Cash May Be Stronger',
    why: 'The mileage requirement is high relative to the evaluated cash offer.',
  },
  insufficient_data: {
    verdict: 'More Evidence Required',
    why: 'The available evidence does not support a cash-versus-miles recommendation.',
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

const RECOMMENDATION_ELIGIBLE_VERDICTS = new Set([
  'book_miles',
  'lean_miles',
  'pay_cash',
]);

function isBackendRecommendationEligible(decision: DecisionResult | undefined): boolean {
  return Boolean(
    decision?.evaluated_cash_offer_id
    && decision.trip_basis_compatible === true
    && decision.verdict
    && RECOMMENDATION_ELIGIBLE_VERDICTS.has(decision.verdict),
  );
}

function getDecisionCopy(result: AwardResult | undefined, cashAvailable: boolean, cashUnavailable: boolean, tripType: TripType = 'one_way') {
  if (tripType === 'round_trip' && result?.decision?.trip_basis_compatible !== true) {
    return {
      verdict: 'Cash and award are not directly comparable',
      why: 'The cash result covers a round trip, while the award signal covers the outbound journey only.',
    };
  }
  const copy = SIGNAL_COPY[result?.decision?.signal || 'insufficient_data'] || SIGNAL_COPY.insufficient_data;
  const strongAwardSignal = ['exceptional_miles_value', 'strong_miles_value'].includes(result?.decision?.signal);
  if (cashUnavailable && strongAwardSignal) {
    return {
      verdict: 'Promising award signal',
      why: 'A current cash comparison is unavailable, so the relative value cannot be fully assessed.',
    };
  }
  const confidence = result?.decision?.confidence;
  const comparisonIsLimited = confidence === 'low' || confidence === 'medium' ||
    result?.verified_identical_routing !== true || result?.has_live_data !== true || !cashAvailable;

  if (!comparisonIsLimited || ['unknown', 'insufficient_data'].includes(result?.decision?.signal || '')) return copy;

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
  const dateLabel = dateIsValid ? formatTravelDate(dateParam) : 'Date not selected';
  const canAnalyze = Boolean(originCode && destinationCode && originCode !== destinationCode && dateIsValid && tripType && !tripValidationError);

  // This row is a READ-ONLY summary of the search composed on the Landing form
  // (`/`). Editing happens there, so the Edit link carries the current route
  // back to `/` as query params. The Landing form does not yet hydrate from
  // these params (separate slice); today it opens a blank form.
  const editParams = new URLSearchParams();
  if (origin) editParams.set('from', originCode || origin);
  if (destination) editParams.set('to', destinationCode || destination);
  if (dateParam) editParams.set('date', dateParam);
  if (tripType === 'round_trip') {
    editParams.set('trip', 'round_trip');
    if (returnDateParam) editParams.set('returnDate', returnDateParam);
  }
  const editSearchUrl = editParams.toString() ? `/?${editParams.toString()}` : '/';

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
      <div className="search-context__head">
        <div className="section-kicker" id="search-context-title">Search context</div>
        <span className="readonly-tag" data-testid="search-readonly-tag">Read-only</span>
      </div>

      {(validationError || tripValidationError) && (
        <div className="validation-error" role="alert" data-testid="validation-error">
          <AlertTriangle aria-hidden="true" /> {validationError || tripValidationError}
        </div>
      )}

      <div className={`search-instrument ${tripType === 'round_trip' ? 'search-instrument--round-trip' : ''}`} role="group" aria-label="Current search summary">
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
            <time dateTime={returnDateParam || undefined}>{returnDateIsValid ? formatTravelDate(returnDateParam) : 'Return date not selected'}</time>
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

      <div className="search-context__footer interactive-only">
        <a className="edit-search" href={editSearchUrl} data-testid="edit-search-link">Edit search</a>
      </div>
    </motion.section>
  );
};

const DecisionSummary = ({
  result,
  cashAvailable,
  cashUnavailable,
  tripType,
  awardTrust,
}: {
  result: AwardResult;
  cashAvailable: boolean;
  cashUnavailable: boolean;
  tripType: TripType;
  awardTrust: AwardTrustPresentation;
}) => {
  const copy = getDecisionCopy(result, cashAvailable, cashUnavailable, tripType);
  const tripBasisBlocked = tripType === 'round_trip' && result?.decision?.trip_basis_compatible !== true;
  const recommendationAllowed = awardTrust.recommendationAllowed
    && isBackendRecommendationEligible(result?.decision);
  const trustOverridesVerdict = !tripBasisBlocked && (Boolean(awardTrust.allowedVerdict) || !awardTrust.verdictAllowed);
  const verdict = tripBasisBlocked
    ? copy.verdict
    : awardTrust.allowedVerdict
      ? awardTrust.allowedVerdict
      : awardTrust.verdictAllowed
        ? copy.verdict
        : 'More Evidence Required';
  const why = trustOverridesVerdict ? awardTrust.supportingCopy : copy.why;
  return (
    <>
      <motion.section className="result-section decision-summary" aria-labelledby="decision-title" data-testid="decision-summary"
        data-evaluated-cash-offer-id={result?.decision?.evaluated_cash_offer_id || ''}
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="section-heading-row">
          <span aria-hidden="true" />
          <h2 id="decision-title">Decision Summary</h2>
        </div>
        <p className="recommendation-label">{recommendationAllowed ? 'Recommendation' : 'Decision signal'}</p>
        <h3 data-testid="decision-verdict">{verdict}</h3>
        {trustOverridesVerdict && (
          <p className="card-caveat" data-testid="decision-trust-blocker">
            {awardTrust.freshnessLabel}
          </p>
        )}
      </motion.section>

      <section className="result-section why-section" aria-labelledby="why-title">
        <h2 id="why-title">Why this signal</h2>
        <p data-testid="decision-why">{why}</p>
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
  <article className="option-card" data-testid="cash-candidate-card" data-offer-id={cashOffer.cash_offer_id || cashOffer.offer_id} aria-labelledby="cash-option-title">
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

const AwardCandidate = ({
  result,
  tripType,
  awardTrust,
}: {
  result: AwardResult;
  tripType: TripType;
  awardTrust: AwardTrustPresentation;
}) => {
  const bestProgram = result?.programs?.[0];
  const verificationUrl = safeExternalUrl(bestProgram?.url);
  return (
    <article className="option-card" data-testid="award-candidate-card" aria-labelledby="award-option-title">
      <div className="option-card__header">
        <div>
          <p className="option-type">Award option</p>
          <h3 id="award-option-title">{getAwardOptionHeading(awardTrust)}</h3>
        </div>
        <span className="data-source">{awardTrust.freshnessLabel}</span>
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
      <AwardTrustNotice presentation={awardTrust} />
      {verificationUrl
        ? <a className="verification-link" href={verificationUrl} target="_blank" rel="noopener noreferrer">Verify with program</a>
        : <p className="verification-guidance">Check award availability manually with the loyalty program.</p>}
    </article>
  );
};

const PaneUnavailable = ({
  kind,
  status,
  awardTrust,
}: {
  kind: 'Cash' | 'Award';
  status: PaneStatus;
  awardTrust?: AwardTrustPresentation;
}) => (
  <article className="option-card option-card--unavailable print-omit" data-testid={`${kind.toLowerCase()}-pane-${status}`}>
    <p className="option-type">{kind} option</p>
    <h3>{kind === 'Award' && awardTrust ? awardTrust.freshnessLabel : `${kind} analysis unavailable`}</h3>
    <p>{kind === 'Award' && awardTrust
      ? awardTrust.supportingCopy
      : status === 'error'
        ? `The ${kind.toLowerCase()} portion of this analysis could not be completed, so no conclusion was drawn.`
        : `No reliable ${kind.toLowerCase()} result was returned, so no conclusion was drawn.`}</p>
    {kind === 'Award' && awardTrust?.verificationNotice && (
      <p className="verification-guidance" data-testid="award-pane-verification">
        {awardTrust.verificationNotice}
      </p>
    )}
  </article>
);

const CashUnavailable = () => (
  <article className="option-card option-card--unavailable" data-testid="cash-unavailable-state">
    <p className="option-type">Cash option</p>
    <h3>Current cash comparison unavailable</h3>
    <p>Award results can still be reviewed, but relative value cannot be fully assessed without a current cash fare.</p>
  </article>
);

const ConfidenceAndVerification = ({
  decision,
  awardTrust,
}: {
  decision: any;
  awardTrust: AwardTrustPresentation;
}) => (
  <section className="result-section confidence-section" aria-labelledby="confidence-title">
    <div>
      <h2 id="confidence-title">Confidence</h2>
      <p className="confidence-value" data-testid="decision-confidence">{decision?.confidence || 'Not available'}</p>
      <p className="confidence-note">Confidence is shown as provided by the current analysis, without a percentage.</p>
    </div>
    <div>
      <h2>Next Action</h2>
      <p className="next-action"><ArrowRight aria-hidden="true" />
        {awardTrust.verificationNotice || 'Check availability manually on the official program site.'}
      </p>
    </div>
  </section>
);

const EvidenceAndCaveats = ({
  result,
  awardStatus,
  cashStatus,
  awardTrust,
}: {
  result: any;
  awardStatus: PaneStatus;
  cashStatus: PaneStatus;
  awardTrust: AwardTrustPresentation;
}) => {
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
        {result && <li data-testid="award-trust-evidence">{awardTrust.supportingCopy}</li>}
        {result && awardTrust.verificationNotice && <li>{awardTrust.verificationNotice}</li>}
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
    const selectedId = resolveSelectedCashOfferId(cashResponse);
    if (!selectedId) return;
    const offer = (cashResponse.offers || []).find(candidate => candidate.cash_offer_id === selectedId);
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
      if (!json.ok || json.offer_id !== offer.offer_id || json.cash_offer_id !== selectedId || json.itinerary_state !== 'complete' || !Array.isArray(json.return_segments) || !json.return_segments.length) {
        setContinuationState({ offerId: offer.offer_id, status: 'failed' });
        return;
      }
      setCashData(previous => previous ? {
        ...previous,
        offers: (previous.offers || []).map(candidate => candidate.offer_id === offer.offer_id ? {
          ...candidate,
          itinerary_state: 'complete',
          cash_offer_id: json.cash_offer_id,
          itinerary_ref: json.itinerary_ref || candidate.itinerary_ref,
          completeness: json.completeness || 'complete',
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

    let cashJson: CashResponse | null = null;
    try {
      const cashResponse = await fetch('/api/cheap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
      const json = await cashResponse.json() as CashResponse;
      cashJson = json;
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
    } catch {
      setCashStatus('error');
    }

    if (searchEpochRef.current !== epoch) return;
    const selectedCashOfferId = resolveSelectedCashOfferId(cashJson);
    try {
      const awardResponse = await fetch('/api/awards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedCashOfferId
          ? { ...requestPayload, cashOfferId: selectedCashOfferId }
          : requestPayload),
      });
      const json = await awardResponse.json() as AwardResponse;
      if (searchEpochRef.current !== epoch) return;
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
    } catch {
      if (searchEpochRef.current === epoch) setAwardStatus('error');
    }
  };

  const status = (awardStatus === 'loading' || cashStatus === 'loading') ? 'loading' :
    (awardStatus === 'success' || cashStatus === 'success') ? 'success' :
    (awardStatus === 'error' && cashStatus === 'error') ? 'error' : 'empty';

  const returnedCashOffers = Array.isArray(cashData?.offers) ? cashData.offers.filter(offer => hasValidPositivePrice(offer?.price)) : [];
  const selectedCashOfferId = resolveSelectedCashOfferId(cashData);
  const awardIdentityMatches = selectedCashOfferId
    ? awardData?.selected_cash_offer_id === selectedCashOfferId
    : awardData?.selected_cash_offer_id == null;
  const result = awardIdentityMatches
    ? awardData?.results?.find(candidate => (
      selectedCashOfferId
        ? candidate?.decision?.evaluated_cash_offer_id === selectedCashOfferId
        : candidate?.decision?.evaluated_cash_offer_id == null
    ))
    : undefined;
  const cashOffer = selectedCashOfferId
    ? returnedCashOffers.find(offer => offer.cash_offer_id === selectedCashOfferId)
    : undefined;
  const cashOffers = cashOffer
    ? [cashOffer, ...returnedCashOffers.filter(offer => offer.cash_offer_id !== selectedCashOfferId)]
    : [];
  const cashAlternatives = cashStatus === 'success' ? cashOffers.slice(1, 4) : [];
  const cashUnavailable = cashData?.cash_provenance?.status === 'unavailable';
  const hydratedTripType = parseTripType(getTripParam('trip')) || 'one_way';
  const tripType: TripType = activeRequest ? (activeRequest.oneWay ? 'one_way' : 'round_trip') : hydratedTripType;
  const awardTrust = useMemo(
    () => resolveAwardTrust(buildAwardTrustInput(awardStatus, awardData, result, tripType), Date.now()),
    [awardStatus, awardData, result, tripType],
  );
  const isRoundTrip = tripType === 'round_trip';
  const isLimited = result?.verified_identical_routing !== true;
  const hasSuccessfulPane = awardStatus === 'success' || cashStatus === 'success';
  const routeOrigin = result?.origin || getTripParam('from') || 'Origin';
  const routeDestination = result?.dest || getTripParam('to') || 'Destination';
  const travelDate = result?.date || getTripParam('date') || 'Date not selected';
  const shareContent = useMemo(() => buildShareContent({
    result,
    awardTrust,
    cashOffer,
    cashAlternatives,
    cashUnavailable,
    awardStatus,
    cashStatus,
    origin: routeOrigin,
    destination: routeDestination,
    travelDate,
    tripType,
  }), [result, awardTrust, cashOffer, cashAlternatives, cashUnavailable, awardStatus, cashStatus, routeOrigin, routeDestination, travelDate, tripType]);

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
            <PaneUnavailable kind="Award" status={awardStatus} awardTrust={awardTrust} />
          </div>
        )}

        {hasSuccessfulPane && (
          <div className="result-flow" data-testid="result-flow">
            {awardStatus === 'success' && result && <DecisionSummary result={result} cashAvailable={cashStatus === 'success'} cashUnavailable={cashUnavailable} tripType={tripType} awardTrust={awardTrust} />}

            <section className="result-section options-section" aria-labelledby="options-title">
              <h2 id="options-title">Best Options</h2>
              <div className="options-grid" data-testid="options-grid">
                <div className="cash-option-stack" data-testid="cash-option-stack">
                  {cashStatus === 'success' && cashOffer ? <CashCandidate cashOffer={cashOffer} isLimited={isLimited} isRoundTrip={isRoundTrip} continuationStatus={continuationState.offerId === cashOffer.offer_id ? continuationState.status : 'idle'} /> : cashUnavailable ? <CashUnavailable /> : <PaneUnavailable kind="Cash" status={cashStatus} />}
                  {cashStatus === 'success' && cashOffer && <CashAlternatives offers={cashAlternatives} isRoundTrip={isRoundTrip} />}
                </div>
                {awardStatus === 'success' && result ? <AwardCandidate result={result} tripType={tripType} awardTrust={awardTrust} /> : <PaneUnavailable kind="Award" status={awardStatus} awardTrust={awardTrust} />}
              </div>
            </section>

            {awardStatus === 'success' && result && <ConfidenceAndVerification decision={result.decision} awardTrust={awardTrust} />}
            <EvidenceAndCaveats result={result} awardStatus={awardStatus} cashStatus={cashStatus} awardTrust={awardTrust} />

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
