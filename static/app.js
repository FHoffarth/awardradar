const $ = id => document.getElementById(id);

// User-visible date formatter: 22 Oct 2026 format (en), 22.10.2026 (de)
// Safely handles date-only strings without timezone conversion that shifts dates
function formatUserDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // Parse as date-only (no time component) to avoid UTC/local timezone shifts
  // ISO date format: YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return trimmed; // Fallback if not ISO format

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
  const day = parseInt(match[3], 10);

  // Create date at midnight UTC to avoid timezone shift
  const d = new Date(Date.UTC(year, month, day));

  const lang = document.documentElement.getAttribute('lang') || 'en';
  if (lang === 'de') {
    const dayStr = String(d.getUTCDate()).padStart(2, '0');
    const monthStr = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dayStr}.${monthStr}.${year}`;
  }

  // English international: 22 Oct 2026
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${monthNames[d.getUTCMonth()]} ${year}`;
}

// Sprint 2B — Itinerary Intelligence helpers
function fmtDur(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
const AIRCRAFT_STUBS = {
  'A380': 'Double-deck superjumbo', 'A350': 'Modern long-haul', 'A330': 'Long-haul widebody',
  'B747': 'Widebody flagship', '747-': 'Widebody flagship',
  'B787': 'Modern widebody', '787-': 'Modern widebody',
  'B777': 'Long-haul workhorse', '777-': 'Long-haul workhorse',
  'A320': 'Narrowbody', 'A321': 'Narrowbody', 'B737': 'Narrowbody',
};
function aircraftStub(aircraft) {
  if (!aircraft) return null;
  for (const [k, v] of Object.entries(AIRCRAFT_STUBS)) {
    if (aircraft.includes(k)) return v;
  }
  return null;
}
let _itinSeq = 0;
function buildItinerary(f) {
  if (!f) return '';
  const segs = f.segments || [];

  // Badges
  const badges = [];
  if (f.stops === 0) badges.push('<span class="aw-badge aw-badge-nonstop">Nonstop</span>');
  if ((f.layovers || []).some(l => l.duration_min > 0 && l.duration_min < 60)) badges.push('<span class="aw-badge aw-badge-warn">Short connection</span>');
  if ((f.segments || []).some(s => s.overnight)) badges.push('<span class="aw-badge aw-badge-warn">Overnight</span>');
  if ((f.layovers || []).some(l => l.duration_min >= 240)) badges.push('<span class="aw-badge aw-badge-muted">Long layover</span>');

  // Structured segment cards — shown whenever segment data exists (incl. nonstop).
  let detail = '', toggle = '';
  if (segs.length) {
    const segsHtml = segs.map((seg, i) => {
      const lay = f.layovers && f.layovers[i];
      const head = [];
      if (seg.flight_number) head.push(`<span class="aw-seg-fn">${esc(seg.flight_number)}</span>`);
      if (seg.airline) head.push(`<span class="aw-seg-airline">${esc(seg.airline)}</span>`);
      const meta = [];
      if (seg.duration_min) meta.push(fmtDur(seg.duration_min));
      if (seg.cabin) meta.push(esc(seg.cabin));
      if (seg.aircraft) meta.push(esc(seg.aircraft));
      const arrSuffix = segmentArrivalSuffix(seg);
      const timeStr = (seg.dep_time || seg.arr_time)
        ? `${esc(seg.dep_time || '')}${seg.dep_time && seg.arr_time ? '–' : ''}${esc(seg.arr_time || '')}${esc(arrSuffix)}`
        : '';
      const layStr = lay
        ? `<li class="aw-layover"><span class="aw-layover-ic" aria-hidden="true">⏱</span><span>${esc(lay.iata || '')} layover${lay.duration_min ? ' · ' + fmtDur(lay.duration_min) : ''}${lay.overnight ? ' · overnight' : ''}</span></li>`
        : '';
      return `<li class="aw-seg">
        <div class="aw-seg-line">
          <span class="aw-seg-route"><span class="aw-seg-ap">${esc(seg.dep_iata || '')}</span><span class="aw-seg-arrow" aria-hidden="true">→</span><span class="aw-seg-ap">${esc(seg.arr_iata || '')}</span></span>
          ${timeStr ? `<span class="aw-seg-times">${timeStr}</span>` : ''}
        </div>
        ${head.length ? `<div class="aw-seg-head">${head.join('')}</div>` : ''}
        ${meta.length ? `<div class="aw-seg-meta">${meta.join('<span class="aw-seg-dot" aria-hidden="true">·</span>')}</div>` : ''}
      </li>${layStr}`;
    }).join('');
    const uid = 'aw-itin-' + (++_itinSeq);
    detail = `<ul class="aw-itin-detail" id="${uid}" hidden>${segsHtml}</ul>`;
    toggle = `<button type="button" class="aw-itin-toggle" aria-expanded="false" aria-controls="${uid}">
      <span class="aw-itin-toggle-label">Show flight details</span>
      <span class="aw-itin-chev" aria-hidden="true">▾</span>
    </button>`;
  }

  // Route/times/duration now live in the compact itinerary summary (node timeline);
  // this drawer carries only warning badges + the deep per-segment details.
  return `<div class="aw-itin">
    ${badges.length ? `<div class="aw-itin-badges">${badges.join('')}</div>` : ''}
    ${toggle}${detail}
  </div>`;
}

// Stable, delegated toggle for the flight-details drawer. Bound once at load, so it
// survives every render() innerHTML replacement without duplicate or stale listeners.
document.addEventListener('click', function (e) {
  const btn = e.target.closest && e.target.closest('.aw-itin-toggle');
  if (!btn) return;
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  if (!panel) return;
  panel.hidden = !panel.hidden;
  const open = !panel.hidden;
  btn.setAttribute('aria-expanded', String(open));
  const lbl = btn.querySelector('.aw-itin-toggle-label');
  if (lbl) lbl.textContent = open ? 'Hide flight details' : 'Show flight details';
});

// Delegated toggle for source disclosure (Scope E)
document.addEventListener('click', function (e) {
  const btn = e.target.closest && e.target.closest('.source-toggle');
  if (!btn) return;
  const popover = document.getElementById(btn.getAttribute('aria-controls'));
  if (!popover) return;
  popover.hidden = !popover.hidden;
  btn.setAttribute('aria-expanded', String(!popover.hidden));
});

// Close source popovers when clicking outside
document.addEventListener('click', function (e) {
  if (e.target.closest('.source-toggle') || e.target.closest('.source-popover')) return;
  document.querySelectorAll('.source-popover:not([hidden])').forEach(pop => {
    pop.hidden = true;
    const btn = document.querySelector(`[aria-controls="${pop.id}"]`);
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
});

// Close source popovers when Escape is pressed; return focus to trigger
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const openPopovers = document.querySelectorAll('.source-popover:not([hidden])');
  if (!openPopovers.length) return;
  openPopovers.forEach(pop => {
    pop.hidden = true;
    const btn = document.querySelector(`[aria-controls="${pop.id}"]`);
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });
});

function awardTrustMetaHtml(p) {
  const items = [];
  const isEstimate = p.is_estimate || p.data_source === 'estimated' || p.source_type === 'static_estimate';
  const isLive = p.is_live_data || p.data_source === 'live';
  if (isLive) items.push('<span class="aw-trust-pill aw-trust-live">Live data</span>');
  if (isEstimate) items.push('<span class="aw-trust-pill aw-trust-estimate">Estimate</span>');
  if (p.freshness_label) items.push(`<span class="aw-trust-pill">Freshness: ${esc(p.freshness_label)}</span>`);
  if (p.confidence_level) items.push(`<span class="aw-trust-pill">${esc(p.confidence_level)} confidence</span>`);
  if (Object.prototype.hasOwnProperty.call(p, 'last_seen_at')) {
    items.push(`<span class="aw-trust-pill">Last seen: ${p.last_seen_at ? esc(p.last_seen_at) : 'unavailable'}</span>`);
  }
  return items.length ? `<div class="aw-card-trust">${items.join('')}</div>` : '';
}

// Consent state — Phase 1: necessary only. Extend when analytics/affiliate added.
// Shared airport coordinates for the animated globe and Award Results journey map.
// [latitude, longitude, IATA, city]
const AWARDRADAR_AIRPORTS = [
  [33.64, -84.43, 'ATL', 'Atlanta'], [25.25, 55.36, 'DXB', 'Dubai'], [35.55, 139.78, 'HND', 'Tokyo'],
  [35.77, 140.39, 'NRT', 'Tokyo Narita'],
  [32.90, -97.04, 'DFW', 'Dallas'], [31.14, 121.81, 'PVG', 'Shanghai'], [40.08, 116.58, 'PEK', 'Beijing'],
  [51.47, -0.45, 'LHR', 'London'], [41.26, 28.74, 'IST', 'Istanbul'], [23.39, 113.30, 'CAN', 'Guangzhou'],
  [41.97, -87.90, 'ORD', 'Chicago'], [50.03, 8.56, 'FRA', 'Frankfurt'], [52.31, 4.76, 'AMS', 'Amsterdam'],
  [49.01, 2.55, 'CDG', 'Paris'], [22.31, 113.91, 'HKG', 'Hong Kong'], [25.27, 51.61, 'DOH', 'Doha'],
  [39.86, -104.67, 'DEN', 'Denver'], [33.94, -118.41, 'LAX', 'Los Angeles'], [40.64, -73.78, 'JFK', 'New York'],
  [1.36, 103.99, 'SIN', 'Singapore'], [37.46, 126.44, 'ICN', 'Seoul'], [13.69, 100.75, 'BKK', 'Bangkok'],
  [2.75, 101.71, 'KUL', 'Kuala Lumpur'], [-6.13, 106.66, 'CGK', 'Jakarta'], [28.57, 77.10, 'DEL', 'Delhi'],
  [19.09, 72.87, 'BOM', 'Mumbai'], [40.47, -3.56, 'MAD', 'Madrid'], [41.30, 2.08, 'BCN', 'Barcelona'],
  [48.35, 11.79, 'MUC', 'Munich'], [47.46, 8.55, 'ZRH', 'Zurich'], [48.11, 16.57, 'VIE', 'Vienna'],
  [50.90, 4.48, 'BRU', 'Brussels'], [55.62, 12.66, 'CPH', 'Copenhagen'], [60.19, 11.10, 'OSL', 'Oslo'],
  [59.65, 17.92, 'ARN', 'Stockholm'], [41.80, 12.24, 'FCO', 'Rome'], [45.63, 8.72, 'MXP', 'Milan'],
  [38.77, -9.13, 'LIS', 'Lisbon'], [53.43, -6.24, 'DUB', 'Dublin'], [53.35, -2.27, 'MAN', 'Manchester'],
  [25.79, -80.29, 'MIA', 'Miami'], [37.62, -122.38, 'SFO', 'San Francisco'], [47.45, -122.31, 'SEA', 'Seattle'],
  [43.68, -79.63, 'YYZ', 'Toronto'], [19.44, -99.07, 'MEX', 'Mexico City'], [-23.43, -46.47, 'GRU', 'Sao Paulo'],
  [4.70, -74.15, 'BOG', 'Bogota'], [-26.14, 28.25, 'JNB', 'Johannesburg'], [30.12, 31.41, 'CAI', 'Cairo'],
  [-33.95, 151.18, 'SYD', 'Sydney'], [24.96, 46.70, 'RUH', 'Riyadh'], [-31.94, 115.97, 'PER', 'Perth'],
];
const AWARDRADAR_AIRPORT_COORDS = AWARDRADAR_AIRPORTS.reduce((acc, [lat, lon, code, city]) => {
  acc[code] = { lat, lon, city };
  return acc;
}, {});
let _journeySeq = 0;

function awardJourneyRouteNodes(r) {
  const flight = r.flight || {};
  const segs = Array.isArray(flight.segments) ? flight.segments : [];
  const nodes = [];
  const push = code => {
    const c = String(code || '').trim().toUpperCase();
    if (/^[A-Z0-9]{3}$/.test(c) && nodes[nodes.length - 1] !== c) nodes.push(c);
  };
  if (segs.length) {
    push(segs[0].dep_iata || r.origin);
    segs.forEach(seg => push(seg.arr_iata));
  } else {
    push(r.origin);
    (flight.via || []).forEach(push);
    push(r.dest);
  }
  return nodes;
}

function segmentArrivalSuffix(seg) {
  if (!seg) return '';
  if (Number.isFinite(seg.arrival_day_offset) && seg.arrival_day_offset > 0) return ` +${seg.arrival_day_offset} day`;
  if (seg.overnight) return ' Overnight';
  return '';
}

function itineraryTimeDataStatus(flight) {
  const segs = Array.isArray(flight?.segments) ? flight.segments : [];
  if (!segs.length) return 'unavailable';
  if (segs.some(s => s.departure_date || s.arrival_date)) return 'cash_outbound_dated';
  if (segs.some(s => s.dep_time || s.arr_time)) return 'cash_outbound_partial';
  return 'unavailable';
}

function normalizeItineraryOwnership(r) {
  const d = r.decision || {};
  const source = r.journey_route_source || (r.flight?.segments?.length ? 'cash_context' : 'search_fallback');
  const verified = r.verified_identical_routing === true;
  return {
    journeyRouteSource: source,
    awardRoutingStatus: r.award_routing_status || 'not_available',
    verifiedIdenticalRouting: verified,
    displayedItinerary: r.displayed_itinerary || (source === 'cash_context' ? 'cash' : 'none'),
    canComparePriceSignals: d.trip_basis_compatible === true && r.cash_eur != null,
    canCompareRoutingQuality: verified,
    timeDataStatus: itineraryTimeDataStatus(r.flight),
  };
}

function awardJourneyMapHtml(r) {
  const ownership = normalizeItineraryOwnership(r);
  if (ownership.journeyRouteSource === 'search_fallback' || ownership.displayedItinerary === 'none') {
    const html = `<section class="aw-journey-map aw-journey-map-partial" role="group" aria-label="Confirmed itinerary routing is not available.">
      <div class="aw-journey-head">
        <div>
          <div class="aw-section-kicker">Itinerary routing unavailable</div>
          <p class="aw-journey-note">Confirmed itinerary routing is not available.</p>
        </div>
      </div>
    </section>`;
    return { html, trustNote: 'Confirmed itinerary routing is not available.' };
  }

  const nodes = awardJourneyRouteNodes(r);
  if (nodes.length < 2) return { html: '', trustNote: '' };

  const flight = r.flight || {};
  const segs = Array.isArray(flight.segments) ? flight.segments : [];
  const coordsKnown = nodes.every(code => AWARDRADAR_AIRPORT_COORDS[code]);
  const cityOf = code => (AWARDRADAR_AIRPORT_COORDS[code] || {}).city || '';
  const layoverByIata = {};
  (flight.layovers || []).forEach(l => {
    if (l && l.iata) layoverByIata[String(l.iata).toUpperCase()] = l;
  });
  const stopCount = Math.max(nodes.length - 2, 0);
  const stopText = stopCount === 0 ? 'Nonstop' : `${stopCount} stop${stopCount > 1 ? 's' : ''}`;

  const hasReturnJourney = Array.isArray(flight.return_segments) && flight.return_segments.length > 0;
  const showsOutboundOnly = !!r.returnDate && !hasReturnJourney;
  const kicker = showsOutboundOnly ? 'Outbound cash itinerary shown' : 'Cash itinerary shown';
  const ownershipNote = showsOutboundOnly
    ? 'Return routing and award routing must be verified.'
    : 'Award routing must be verified before comparing travel time, stops and convenience.';
  const fallbackNote = coordsKnown ? '' : 'Route visualization simplified because location data is incomplete.';

  const facts = [r.returnDate ? 'Round trip' : 'One-way', r.cabin, r.date, flight.duration, stopText].filter(Boolean);
  const summary = `${nodes.join(' \u2192 ')}. ${facts.join('. ')}.`;

  // Compact chronological timeline: origin \u2192 [stops] \u2192 destination, alternating
  // node/leg rows. Horizontal on desktop, vertical on mobile (CSS only). No SVG,
  // no decorative framing \u2014 nodes clustered around content.
  const rows = [];
  nodes.forEach((code, i) => {
    const role = i === 0 ? 'origin' : i === nodes.length - 1 ? 'destination' : 'stop';
    const inSeg = i > 0 ? segs[i - 1] : null;
    const outSeg = i < segs.length ? segs[i] : null;
    const times = [];
    // Chronological at each airport: arrival (inbound) before departure (outbound).
    if ((role === 'destination' || role === 'stop') && inSeg && inSeg.arr_time) times.push(`<span class="aw-route-time">Arr ${esc(inSeg.arr_time)}${esc(segmentArrivalSuffix(inSeg))}</span>`);
    if ((role === 'origin' || role === 'stop') && outSeg && outSeg.dep_time) times.push(`<span class="aw-route-time">Dep ${esc(outSeg.dep_time)}</span>`);
    const lay = role === 'stop' ? layoverByIata[code] : null;
    const layStr = lay && lay.duration_min ? `Layover ${fmtDur(lay.duration_min)}${lay.overnight ? ' \u00b7 overnight' : ''}` : '';
    rows.push(`<li class="aw-route-node aw-route-node-${role}">
      <span class="aw-route-dot" aria-hidden="true"></span>
      <span class="aw-route-code">${esc(code)}</span>
      ${cityOf(code) ? `<span class="aw-route-city">${esc(cityOf(code))}</span>` : ''}
      ${times.length ? `<span class="aw-route-times">${times.join('<span class="aw-route-tdot" aria-hidden="true"> \u00b7 </span>')}</span>` : ''}
      ${layStr ? `<span class="aw-route-layover">${esc(layStr)}</span>` : ''}
    </li>`);
    if (i < nodes.length - 1) {
      const seg = segs[i];
      const dur = seg && seg.duration_min ? fmtDur(seg.duration_min) : '';
      rows.push(`<li class="aw-route-leg" aria-hidden="true"><span class="aw-route-legline"></span>${dur ? `<span class="aw-route-legdur">${esc(dur)}</span>` : ''}</li>`);
    }
  });

  const factEls = facts.map(f => `<span>${esc(f)}</span>`).join('');
  const html = `<section class="aw-itin-summary${coordsKnown ? '' : ' aw-itin-summary-partial'}" role="group" aria-label="${esc(summary)}">
    <div class="aw-itin-sum-head">
      <div class="aw-section-kicker">${esc(kicker)}</div>
      <p class="aw-itin-own-note">${esc(ownershipNote)}</p>
    </div>
    <ol class="aw-route">${rows.join('')}</ol>
    <div class="aw-itin-facts">${factEls}</div>
    <p class="sr-only">${esc(summary)}</p>
  </section>`;
  return { html, trustNote: fallbackNote };
}

const consent = {
  necessary: true,   // always true — theme, lang, ar_key session cookie
  analytics: false,  // set true only after explicit user consent
  marketing: false,  // set true only after explicit user consent
};

let mode = 'cheap';
let currentOffers = [];
let currentSortKey = 'score';
let currentCashGuidance = null;
let currentCheapRoundTripRequested = false;
let currentCheapRequest = null;
let currentReturnLegAttempts = new Set();
let calendarPrices = {};
let fpDep, fpRet;

// Theme
let theme = localStorage.getItem('awardradar_theme') || 'dark';

function applyTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem('awardradar_theme', t);
  const moon = $('themeIconMoon'), sun = $('themeIconSun');
  if (moon) moon.style.display = t === 'light' ? 'none' : '';
  if (sun)  sun.style.display  = t === 'light' ? '' : 'none';
}
applyTheme(theme);

const TEXT_SIZE_KEY = 'awardradar_text_size';
const TEXT_SIZE_LABELS = { small: 'Small', default: 'Default', large: 'Large' };
const TEXT_SIZE_VALUES = Object.keys(TEXT_SIZE_LABELS);

function normalizeTextSize(value) {
  return TEXT_SIZE_VALUES.includes(value) ? value : 'default';
}

function storedTextSize() {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY);
  } catch (e) {
    return '';
  }
}

let textSize = normalizeTextSize(document.documentElement.dataset.textSize || storedTextSize());

function applyTextSize(value) {
  textSize = normalizeTextSize(value);
  document.documentElement.dataset.textSize = textSize;
  try {
    localStorage.setItem(TEXT_SIZE_KEY, textSize);
  } catch (e) {}
  document.querySelectorAll('[data-text-size-option]').forEach(btn => {
    const active = btn.dataset.textSizeOption === textSize;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const statusEl = $('textSizeStatus');
  if (statusEl) statusEl.textContent = `Text size ${TEXT_SIZE_LABELS[textSize]}`;
}

function initTextSizeControls() {
  applyTextSize(textSize);
  document.querySelectorAll('[data-text-size-option]').forEach(btn => {
    btn.addEventListener('click', () => applyTextSize(btn.dataset.textSizeOption));
  });
}

initTextSizeControls();


function iso(d) { return d.toISOString().slice(0, 10); }

function initDates() {
  toggleReturn(true);
}

function activeCabin() {
  const seg = document.querySelector('.seg.active');
  return seg ? seg.dataset.cabin : 'Economy';
}

function activeFlexDays() {
  const p = document.querySelector('.flex-opt.on');
  return p ? parseInt(p.dataset.flex) : 0;
}

const SEARCH_FIELD_IDS = ['origin', 'dest', 'date', 'returnDate'];
const airportResolution = { origin: null, dest: null };
const searchTouched = { origin: false, dest: false, date: false, returnDate: false };
let searchSubmitAttempted = false;

function normalizeIata(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function setResolvedAirport(inputId, value) {
  const code = normalizeIata(value);
  if (inputId === 'origin' || inputId === 'dest') airportResolution[inputId] = code || null;
}

function airportCodeFor(inputId) {
  const input = $(inputId);
  const code = normalizeIata(input && input.value);
  return code && airportResolution[inputId] === code ? code : '';
}

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function visibleInputFor(inputId) {
  const input = $(inputId);
  return (input && input._flatpickr && input._flatpickr.altInput) ? input._flatpickr.altInput : input;
}

function setFieldMessage(inputId, message, show) {
  const err = $(`${inputId}Error`);
  const input = $(inputId);
  const visible = visibleInputFor(inputId);
  const text = show ? message : '';
  if (err) err.textContent = text;
  [input, visible].forEach(el => {
    if (!el) return;
    el.classList.toggle('field-invalid', !!text);
    if (text) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });
}

function validateSearchForm(options = {}) {
  if (options.submit) searchSubmitAttempted = true;
  (options.touch || []).forEach(id => { if (id in searchTouched) searchTouched[id] = true; });

  const oneWay = !!($('oneWay') && $('oneWay').checked);
  const origin = airportCodeFor('origin');
  const dest = airportCodeFor('dest');
  const dep = parseLocalDate($('date') && $('date').value);
  const ret = parseLocalDate($('returnDate') && $('returnDate').value);
  const errors = {};

  if (!origin) errors.origin = 'Select an origin airport.';
  if (!dest) errors.dest = 'Select a destination airport.';
  if (origin && dest && origin === dest) errors.dest = 'Origin and destination must be different.';
  if (!dep) errors.date = 'Select a departure date.';
  if (!oneWay) {
    if (!ret) errors.returnDate = 'Select a return date.';
    else if (dep && ret < dep) errors.returnDate = 'Return date must not be before the departure date.';
  }

  const valid = Object.keys(errors).length === 0;
  SEARCH_FIELD_IDS.forEach(id => {
    const shouldShow = !!errors[id] && (searchSubmitAttempted || searchTouched[id] || (options.show || []).includes(id));
    setFieldMessage(id, errors[id] || '', shouldShow);
  });

  const go = $('go');
  if (go) {
    go.disabled = !valid;
    go.setAttribute('aria-disabled', valid ? 'false' : 'true');
  }
  const status = $('searchValidationStatus');
  if (status) {
    status.textContent = valid
      ? 'Ready to analyze.'
      : (searchSubmitAttempted ? (Object.values(errors)[0] || 'Complete the required journey details.') : 'Select origin, destination and departure date to analyze.');
  }
  return { valid, errors, firstInvalid: Object.keys(errors)[0] || null };
}

function markSearchFieldTouched(inputId, options = {}) {
  if (inputId in searchTouched) searchTouched[inputId] = true;
  if ((inputId === 'origin' || inputId === 'dest') && options.resolved !== true) {
    const input = $(inputId);
    if (airportResolution[inputId] !== normalizeIata(input && input.value)) airportResolution[inputId] = null;
  }
  return validateSearchForm(options);
}

function runIfSearchValid() {
  if (validateSearchForm().valid) run();
}

let extraOrigins = [];

function addOrigin() {
  if (extraOrigins.length >= 2) return;
  const idx = extraOrigins.length;
  const id = `extra-origin-${idx}`;
  extraOrigins.push('');
  const wrap = document.getElementById('extra-origins');
  const div = document.createElement('div');
  div.className = 'extra-origin-row';
  div.id = `extra-origin-row-${idx}`;
  div.innerHTML = `<div class="field-input-wrap extra-origin-wrap">
    <svg class="field-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    <input id="${id}" class="extra-origin-input" placeholder="Add airport" autocomplete="off" aria-label="Additional departure airport">
    <div class="ac-drop" id="ac-${id}" role="listbox"></div>
    <button type="button" class="remove-origin-btn" onclick="removeOrigin(${idx})" aria-label="Remove airport">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
  wrap.appendChild(div);
  const inp = document.getElementById(id);
  initAC(inp, `ac-${id}`);
  inp.addEventListener('change', () => { extraOrigins[idx] = inp.value.trim().toUpperCase().slice(0, 3); });
  inp.addEventListener('input', () => { extraOrigins[idx] = inp.value.trim().toUpperCase().slice(0, 3); });
  updateAddOriginBtn();
}

function removeOrigin(idx) {
  const row = document.getElementById(`extra-origin-row-${idx}`);
  if (row) row.remove();
  extraOrigins[idx] = '';
  const remaining = extraOrigins.filter(Boolean);
  extraOrigins = [];
  document.getElementById('extra-origins').innerHTML = '';
  remaining.forEach(() => addOrigin());
  updateAddOriginBtn();
}

function updateAddOriginBtn() {
  const btn = document.getElementById('addOriginBtn');
  if (!btn) return;
  btn.style.display = extraOrigins.length >= 2 ? 'none' : '';
}

function payload() {
  const allOrigins = [$('origin').value, ...extraOrigins].map(v => v.trim().toUpperCase().slice(0,3)).filter(Boolean);
  const isOneWay = $('oneWay').checked;
  return {
    lang: 'en',
    origin: allOrigins.join(','),
    dest: $('dest').value,
    date: $('date').value,
    returnDate: isOneWay ? '' : $('returnDate').value,
    oneWay: isOneWay,
    direct: $('direct').checked,
    mmOnly: $('mmOnly').checked,
    currency: 'eur',
    cabin: activeCabin(),
    cabins: [activeCabin()],
    flexDays: activeFlexDays(),
  };
}

function setStatus(t) {
  const status = $('status');
  if (status) status.textContent = t;
}

const RADAR_STAGES = {
  cheap: [
    'Resolving airports',
    'Comparing cash context',
    'Checking route quality',
    'Preparing value signals',
  ],
  awards: [
    'Comparing cash fare context',
    'Checking award program signals',
    'Aligning trip basis',
    'Evaluating redemption value',
    'Preparing verification guidance',
  ],
};

let _progressTimer = null;
let _progressTimers = [];
let _stageCycleTimer = null;
let _elapsedTimer = null;
let _radarStage = 0;
let _searchStart = 0;

function radarHtml(origin, dest, currentMode = mode) {
  const route = (origin && dest) ? `${origin} → ${dest}` : '';
  const stagesForMode = RADAR_STAGES[currentMode] || RADAR_STAGES.cheap;
  const stages = stagesForMode.map((s, i) =>
    `<div class="radar-stage" id="rs${i}"><span class="radar-stage-dot"></span>${s}</div>`
  ).join('');
  return `<section class="decision-document workspace-pending" role="status" aria-live="polite" aria-label="AwardRadar is analyzing this journey">
    <div class="decision-section decision-recommendation">
      <div class="decision-label">Our Recommendation</div>
      <h2>Analyzing this journey.</h2>
      ${route ? `<p class="workspace-pending-route">${esc(route)}</p>` : ''}
    </div>
    <div class="workspace-pending-stages" aria-label="Analysis progress">${stages}</div>
    <div class="radar-elapsed" id="radarElapsed">Preparing the decision workspace</div>
  </section>`;
}

function startProgress(origin, dest) {
  _progressTimers.forEach(clearTimeout);
  _progressTimers = [];
  clearInterval(_stageCycleTimer);
  clearInterval(_elapsedTimer);
  const bar = $('progress-bar'), fill = $('progress-fill'), go = $('go');
  bar.classList.add('active');
  fill.classList.add('indeterminate');
  fill.style.width = '100%';
  go.classList.add('loading');
  go.disabled = true;
  go.setAttribute('aria-disabled', 'true');
  _radarStage = 0;
  _searchStart = Date.now();

  $('results').innerHTML = radarHtml(origin, dest, mode);
  $('results').focus({ preventScroll: true });
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const stagesForMode = RADAR_STAGES[mode] || RADAR_STAGES.cheap;
  const stageTiming = stagesForMode.map((_, i) => i * 1400);
  const setRadarStage = (activeIndex) => {
    stagesForMode.forEach((_, idx) => {
      const el = $('rs' + idx);
      if (!el) return;
      el.classList.toggle('active', idx === activeIndex);
      el.classList.toggle('done', idx < activeIndex);
      el.classList.toggle('pending', idx > activeIndex);
    });
  };

  stageTiming.forEach((delay, i) => {
    const timer = setTimeout(() => {
      setRadarStage(i);
    }, delay);
    _progressTimers.push(timer);
  });

  const cycleDelay = Math.max(stagesForMode.length * 1400, 1800);
  _stageCycleTimer = setInterval(() => {
    _radarStage = (_radarStage + 1) % stagesForMode.length;
    setRadarStage(_radarStage);
  }, cycleDelay);

  _elapsedTimer = setInterval(() => {
    const el = $('radarElapsed');
    if (el) el.textContent = 'AwardRadar is analyzing';
  }, 1200);
}

function stopProgress(ok) {
  _progressTimers.forEach(clearTimeout);
  _progressTimers = [];
  clearInterval(_stageCycleTimer);
  clearInterval(_elapsedTimer);
  const bar = $('progress-bar'), fill = $('progress-fill'), go = $('go');
  fill.classList.remove('indeterminate');
  fill.style.width = ok ? '100%' : '0%';
  go.classList.remove('loading');
  validateSearchForm();
  setTimeout(() => { bar.classList.remove('active'); fill.style.width = '0%'; }, 400);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function linksHtml(obj) {
  if (Array.isArray(obj)) {
    return `<div class="links">${obj.map(l => `<a target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.name)}</a>`).join('')}</div>`;
  }
  return `<div class="links">${Object.entries(obj || {}).map(([k, v]) => `<a target="_blank" rel="noopener" href="${esc(v)}">${esc(k)}</a>`).join('')}</div>`;
}

// Cash cards expose one primary verification path. Additional sources remain in
// the demoted provenance disclosure below.
function linksHtmlWithLabels(obj) {
  if (Array.isArray(obj)) {
    return linksHtml(obj);
  }
  const entries = Object.entries(obj || {});
  if (!entries.length) return '';
  const [, url] = entries[0];
  return `<div class="links"><a class="link-primary" target="_blank" rel="noopener" href="${esc(url)}" title="Verify current fare externally"><span class="link-label">Verify current fare</span></a></div>`;
}

// Source disclosure keeps every returned provider available as provenance and
// an optional verification path without turning the card into a shopping list.
function sourceDisclosureHtml(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '';

  const uid = 'src-' + Math.random().toString(36).slice(2, 9);
  const sourcesHtml = entries.map(([k, v]) =>
    `<a target="_blank" rel="noopener" href="${esc(v)}" class="source-link">${esc(k)}</a>`
  ).join('');

  return `<div class="source-disclosure">
    <button type="button" class="source-toggle" aria-expanded="false" aria-controls="${uid}">
      Fare sources and verification options
    </button>
    <div class="source-popover" id="${uid}" hidden>
      <div class="source-links">${sourcesHtml}</div>
    </div>
  </div>`;
}

// Structured action links for Awards: Verify | Cash
function actionLinksHtml(links) {
  if (!links || Array.isArray(links)) return linksHtml(links);
  const parts = [];
  if (links.verify && links.verify.length) {
    parts.push(`<div class="aw-action-group">
      <span class="aw-action-label">Verify with official program</span>
      ${links.verify.map(l => `<a class="aw-action-link" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.name)} →</a>`).join('')}
    </div>`);
  }
  if (links.cash && links.cash.length) {
    parts.push(`<div class="aw-action-group">
      <span class="aw-action-label">Cash fare context</span>
      ${links.cash.map(l => `<a class="aw-action-link aw-action-cash" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.name)} →</a>`).join('')}
    </div>`);
  }
  return parts.length ? `<div class="aw-action-links">${parts.join('')}</div>` : '';
}

async function run() {
  const validation = validateSearchForm({ submit: true });
  if (!validation.valid) {
    const first = visibleInputFor(validation.firstInvalid);
    if (first && typeof first.focus === 'function') first.focus();
    setStatus('ready');
    return;
  }
  setStatus('searching…');
  $('results').innerHTML = '';
  const shell = document.querySelector('.shell');
  shell.classList.add('is-transitioning');
  shell.classList.add('has-results');
  const _origin = ($('origin').value || '').trim().toUpperCase().slice(0, 3);
  const _dest = ($('dest').value || '').trim().toUpperCase().slice(0, 3);
  const requestPayload = payload();
  if (mode === 'cheap') {
    currentCheapRoundTripRequested = !requestPayload.oneWay && !!String(requestPayload.returnDate || '').trim();
    currentCheapRequest = requestPayload;
    currentReturnLegAttempts = new Set();
  }
  collapseSearch();
  startProgress(_origin, _dest);
  const endpoint = mode === 'cheap' ? '/api/cheap' : '/api/awards';
  try {
    const headers = { 'Content-Type': 'application/json' };
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(requestPayload) });
    let data;
    try { data = await res.json(); } catch (_) { throw new Error(res.status + ' ' + res.statusText); }
    if (!res.ok || !data.ok) {
      if (data && data.error === 'quota_exhausted') throw Object.assign(new Error('quota_exhausted'), { isQuota: true });
      throw new Error((data && data.error) || res.statusText || 'Error');
    }
    stopProgress(true);
    if (typeof globePulseRoute === 'function') globePulseRoute(_origin, _dest);
    render(data);
    collapseSearch();               // compact editable summary — only on success
    requestAnimationFrame(() => requestAnimationFrame(() => shell.classList.remove('is-transitioning')));
    setStatus('ready');
    $('results').focus({ preventScroll: false });
  } catch (e) {
    stopProgress(false);
    if ($('panelForm') && $('panelForm').hidden) expandSearch();  // keep form usable on error
    console.debug('[AwardRadar]', e.message);
    let userMsg;
    if (e.isQuota) {
      userMsg = `<div class="card analysis-empty">
        <div class="analysis-empty-header">Capacity Limit</div>
        <div class="analysis-empty-title">Analysis capacity temporarily reached.</div>
        <p class="analysis-empty-reason">Live data refreshes periodically. Please try again in a few minutes.</p>
      </div>`;
    } else {
      userMsg = `<div class="card analysis-empty">
        <div class="analysis-empty-title">Journey analysis is temporarily unavailable.</div>
        <p class="analysis-empty-reason">Please try again in a moment.</p>
      </div>`;
    }
    $('results').innerHTML = userMsg;
    shell.classList.remove('is-transitioning');
    setStatus('error');
  }
}

// ===== Compact editable Search Summary (Change A) =====
// Collapses the full search form into a one-line summary after a successful
// search, with an accessible "Edit search" restore. Values live in the existing
// inputs/globals, so nothing is destroyed — only visibility toggled via `hidden`.
const SEARCH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseIsoDateParts(value) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
function formatSearchDate(value) {
  const p = parseIsoDateParts(value);
  return p ? `${p.d} ${SEARCH_MONTHS[p.m - 1]} ${p.y}` : '';
}
function formatSearchDateRange(depValue, retValue) {
  const dep = parseIsoDateParts(depValue);
  const ret = parseIsoDateParts(retValue);
  if (!dep && !ret) return '';
  if (!dep) return formatSearchDate(retValue);
  if (!ret) return formatSearchDate(depValue);
  if (dep.y === ret.y && dep.m === ret.m) return `${dep.d}–${ret.d} ${SEARCH_MONTHS[dep.m - 1]} ${dep.y}`;
  if (dep.y === ret.y) return `${dep.d} ${SEARCH_MONTHS[dep.m - 1]}–${ret.d} ${SEARCH_MONTHS[ret.m - 1]} ${dep.y}`;
  return `${formatSearchDate(depValue)}–${formatSearchDate(retValue)}`;
}
function formatMoney(value, currency = 'EUR') {
  if (value == null) return '—';
  const num = Number(value);
  if (!isFinite(num)) return '—';
  const hasDecimals = Math.abs(num % 1) > 0;
  const minDigits = hasDecimals ? 2 : 0;
  const maxDigits = 2;
  if (currency === 'EUR') {
    return `€${num.toLocaleString('en-US', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits })}`;
  }
  return `${num.toLocaleString('en-US', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits })} ${currency}`;
}
function formatMilesNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!isFinite(num)) return null;
  return Math.round(num).toLocaleString('en-US');
}
function formatMiles(value, unit = 'miles') {
  const numStr = formatMilesNumber(value);
  if (!numStr) return unit === 'miles' ? 'Miles unavailable' : `${unit} unavailable`;
  return `${numStr} ${unit}`;
}
function formatCpm(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!isFinite(num)) return null;
  return `${num.toFixed(1)} ct/mi`;
}
function formatTripDate(value) {
  return formatUserDate(value);
}
function formatTripDateRange(start, end) {
  if (!start && !end) return '';
  if (!start) return formatTripDate(end);
  if (!end) return formatTripDate(start);
  const dep = parseIsoDateParts(start);
  const ret = parseIsoDateParts(end);
  if (dep && ret) {
    if (dep.y === ret.y && dep.m === ret.m) return `${dep.d}–${ret.d} ${SEARCH_MONTHS[dep.m - 1]} ${dep.y}`;
    if (dep.y === ret.y) return `${dep.d} ${SEARCH_MONTHS[dep.m - 1]} – ${ret.d} ${SEARCH_MONTHS[ret.m - 1]} ${dep.y}`;
  }
  return `${formatTripDate(start)} – ${formatTripDate(end)}`;
}
function collapseSearch() {
  const pf = $('panelForm');
  if (pf) pf.hidden = false;
}
function expandSearch() {
  const pf = $('panelForm');
  if (pf) pf.hidden = false;
  const origin = $('origin');
  if (origin) origin.focus();
}

// Backend value tier → CSS class + fallback label. The backend (rescore_offer_set)
// is the single source of grade/label; this only maps to visuals.
const CASH_TIER_CSS = {
  exceptional: { css: 's-gold',  grade: 'A+', label: 'Exceptional Value' },
  great:       { css: 's-green', grade: 'A',  label: 'Strong Value' },
  good:        { css: 's-cyan',  grade: 'B',  label: 'Fair Value' },
  fair:        { css: 's-muted', grade: 'C',  label: 'Pricey for This Search' },
  poor:        { css: 's-muted', grade: 'D',  label: 'Weak Relative Value' },
};
// Numeric fallback only when backend tier is absent (e.g. legacy/TP offers).
function scoreInfo(s) {
  if (s >= 88) return { tier: 'exceptional', ...CASH_TIER_CSS.exceptional };
  if (s >= 72) return { tier: 'great', ...CASH_TIER_CSS.great };
  if (s >= 56) return { tier: 'good', ...CASH_TIER_CSS.good };
  if (s >= 38) return { tier: 'fair', ...CASH_TIER_CSS.fair };
  return { tier: 'poor', ...CASH_TIER_CSS.poor };
}
const CASH_CONTEXT_NOTE = {
  best_available_not_cheap: 'Best available in this search, but the fare remains high.',
  limited_comparison: 'Only one option found — limited comparison.',
};
function scoreHtml(o) {
  const s = o.dealScore;
  if (s == null) return '';
  const info = o.tier && CASH_TIER_CSS[o.tier] ? CASH_TIER_CSS[o.tier] : scoreInfo(s);
  const signal = relativeSignalLabel(o.tier || info.tier);
  const tooltip = o.scoreReason ? esc(cashReasonDisplay(o.scoreReason)) : esc(signal);
  const note = CASH_CONTEXT_NOTE[o.scoreContext] || '';
  const conf = o.scoreConfidence && o.scoreConfidence !== 'high'
    ? `<div class="score-conf">${o.scoreConfidence === 'low' ? 'Limited confidence' : 'Moderate confidence'}</div>` : '';
  return `<details class="score-block score-details ${info.css}" title="${tooltip}">
    <summary>Assessment details</summary>
    <div class="score-details-body" aria-label="${esc(signal)}">
      <div class="score-lbl">${esc(signal)}</div>
      ${note ? `<div class="score-context">${esc(note)}</div>` : ''}
      ${conf}
    </div>
  </details>`;
}

function relativeSignalLabel(tier) {
  if (tier === 'exceptional' || tier === 'great') return 'Stronger relative signal';
  if (tier === 'good') return 'Moderate relative signal';
  return 'Weaker relative signal';
}

function cashReasonDisplay(reason) {
  return String(reason || '')
    .replace(/cheapest in this search/gi, 'Lowest returned fare')
    .replace(/higher than cheapest/gi, 'Higher than lowest returned fare')
    .replace(/(\d+)% pricier than cheapest/gi, '$1% above lowest returned fare')
    .replace(/\bnonstop\b/gi, 'Nonstop itinerary')
    .replace(/\b1 stop\b/gi, 'One-stop itinerary')
    .replace(/\b(\d+) stops\b/gi, '$1-stop itinerary');
}
function bestBadgeHtml(o, sortContext, opts = {}) {
  const guided = !!opts.guided;
  if (guided) {
    if (o.scoreContext === 'limited_comparison') return '<div class="best-badge best-badge-secondary">Only returned option</div>';
    return '<div class="best-badge best-badge-secondary">Best returned option</div>';
  }
  // Sort context takes precedence over value judgment
  if (sortContext === 'price') {
    return '<div class="best-badge">Lowest returned fare</div>';
  }
  if (sortContext === 'nonstop') {
    const hasKnownStops =
      o.stops !== null &&
      o.stops !== undefined &&
      o.stops !== '' &&
      Number.isFinite(Number(o.stops));

    const stops = hasKnownStops ? Number(o.stops) : null;
    const label = stops === 0 ? 'Nonstop itinerary' : 'Simplest routing';
    return `<div class="best-badge">${label}</div>`;
  }
  // Default: use value-tier logic
  const tier = o.tier || scoreInfo(o.dealScore).tier;
  if (o.scoreContext === 'best_available_not_cheap') return '<div class="best-badge">Best Available</div>';
  if (o.scoreContext === 'limited_comparison') return '<div class="best-badge">Only Option</div>';
  if (tier === 'exceptional' || tier === 'great') return '<div class="best-badge">Stronger relative signal</div>';
  return '<div class="best-badge">Best Match</div>';
}

function scoreLegendHtml() {
  return `<details class="score-legend">
    <summary>What is the Value Signal?</summary>
    <div class="legend-grid">
      <span class="s-gold score-num" style="font-size:15px">+</span><span><strong>Stronger relative signal</strong> — returned fare and routing evidence align more closely</span>
      <span class="s-cyan score-num" style="font-size:15px">~</span><span><strong>Moderate relative signal</strong> — returned evidence is mixed</span>
      <span class="s-muted score-num" style="font-size:15px">−</span><span><strong>Weaker relative signal</strong> — returned fare or routing evidence is less compelling</span>
    </div>
    <p class="legend-note">Value Signal is relative to the cheapest comparable result in this search, adjusted for routing quality and a price reality check. Best available is not always cheap.</p>
  </details>`;
}

function cashVerificationExplainerHtml() {
  return `<div class="cash-result-verification" role="note">
    <strong>External verification</strong> — AwardRadar does not sell or book fares. Confirm current fares, seats and rules with the source.
  </div>`;
}

function priceTiers(calendar) {
  const prices = calendar.filter(c => c.price).map(c => c.price).sort((a, b) => a - b);
  if (!prices.length) return {};
  const p33 = prices[Math.floor(prices.length * 0.33)];
  const p66 = prices[Math.floor(prices.length * 0.66)];
  const map = {};
  calendar.forEach(c => {
    if (c.price) map[c.date] = c.price <= p33 ? 'cheap' : c.price <= p66 ? 'mid' : 'exp';
  });
  return map;
}

function calendarStripHtml(calendar) {
  const tiers = priceTiers(calendar);
  const cells = calendar.map(c => {
    const d = new Date(c.date + 'T12:00:00');
    const label = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    const tier = tiers[c.date] || '';
    const cls = (c.isSelected ? ' dc-sel' : c.isBest ? ' dc-best' : tier ? ` dc-${tier}` : '');
    const priceStr = c.price ? formatMoney(c.price, c.currency || 'EUR') : '—';
    return `<button class="date-cell${cls}" onclick="jumpToDate('${c.date}')">
      <div class="dc-date">${label}</div>
      <div class="dc-price">${priceStr}</div>
      ${c.isBest ? '<div class="dc-badge dc-badge-best">BEST</div>' : (tier === 'cheap' && !c.isSelected ? '<div class="dc-badge dc-badge-low">LOW</div>' : tier === 'exp' && !c.isSelected ? '<div class="dc-badge dc-badge-high">HIGH</div>' : '')}
    </button>`;
  }).join('');
  return `<div class="date-strip">${cells}</div>`;
}

function jumpToDate(date) {
  $('date').value = date;
  markSearchFieldTouched('date');
  runIfSearchValid();
}

// Cash itinerary timing block. Renders only reliable fields from the payload and
// discloses missing timing explicitly — no invented times, no empty separators.
function cashItineraryHtml(o) {
  const status = o.time_data_status || 'unavailable';
  const dep = o.dep_time;
  const arr = o.arr_time;
  const off = (typeof o.arrival_day_offset === 'number' && o.arrival_day_offset > 0) ? o.arrival_day_offset : null;
  const dayMark = off ? ` <span class="cash-itin-day">+${off} day${off > 1 ? 's' : ''}</span>` : '';
  if (status === 'complete' && dep && arr) {
    return `<div class="cash-itin-times"><span class="cash-itin-time">${esc(dep)}</span><span class="cash-itin-arrow" aria-hidden="true">→</span><span class="cash-itin-time">${esc(arr)}</span>${dayMark}</div>`;
  }
  if (status === 'partial' && (dep || arr)) {
    const lbl = dep ? `Dep ${esc(dep)}` : `Arr ${esc(arr)}`;
    return `<div class="cash-itin-times"><span class="cash-itin-time">${lbl}</span>${!dep ? dayMark : ''}</div><div class="cash-itin-note">Cash itinerary details incomplete</div>`;
  }
  return `<div class="cash-itin-note">Times not available from the current source</div>`;
}

// Compact Cash journey summary for recommendation card (Scope C)
// Shows origin → destination with stopover if known, times, duration, stops
function compactCashJourneySummary(o) {
  const stops = parseInt(o.stops) || 0;
  const dep = o.dep_time;
  const arr = o.arr_time;
  const off = (typeof o.arrival_day_offset === 'number' && o.arrival_day_offset > 0) ? o.arrival_day_offset : null;
  const route = `${esc(o.origin)} → ${esc(o.dest)}`;
  const viaLine = o.via && o.via.length ? `<div class="ccjs-via">via ${esc(o.via.join(', '))}</div>` : '';
  let times = '';
  if (dep && arr) {
    times = `${esc(dep)} <span class="ccjs-arrow" aria-hidden="true">→</span> ${esc(arr)}${off ? ` <span class="ccjs-daymark">+${off}d</span>` : ''}`;
  } else if (dep) {
    times = `Dep ${esc(dep)}`;
  } else if (arr) {
    times = `Arr ${esc(arr)}${off ? ` <span class="ccjs-daymark">+${off}d</span>` : ''}`;
  }
  const dur = o.durationMin ? fmtDur(o.durationMin) : '';
  const stopsLabel = stops === 0 ? 'nonstop' : stops === 1 ? '1 stop' : `${stops} stops`;
  const tripMeta = [dur, stopsLabel].filter(Boolean).join(' · ');

  return `<div class="compact-cash-journey">
    ${journeyStripHtml(o)}
    <div class="ccjs-route">${route}</div>
    ${viaLine}
    ${times ? `<div class="ccjs-times">${times}</div>` : ''}
    ${tripMeta ? `<div class="ccjs-trip-meta">${esc(tripMeta)}</div>` : ''}
  </div>`;
}

function cashSegmentTimelineHtml(segments, label) {
  if (!Array.isArray(segments) || !segments.length) return '';
  const rows = segments.map(seg => {
    if (!seg || typeof seg !== 'object') return '';
    const dep = String(seg.dep_iata || '').trim();
    const arr = String(seg.arr_iata || '').trim();
    if (!dep || !arr) return '';
    const times = [];
    if (seg.dep_time) times.push(esc(seg.dep_time));
    if (seg.arr_time) times.push(esc(seg.arr_time));
    const route = `${esc(dep)}<span class="cash-rt-arrow" aria-hidden="true">→</span>${esc(arr)}`;
    const meta = [];
    if (times.length) meta.push(times.join('<span class="cash-rt-arrow" aria-hidden="true">→</span>'));
    if (seg.duration_min != null && Number.isFinite(Number(seg.duration_min)) && Number(seg.duration_min) > 0) meta.push(esc(fmtDur(Number(seg.duration_min))));
    if (seg.airline) meta.push(esc(seg.airline));
    if (seg.flight_number) meta.push(esc(seg.flight_number));
    return `<li class="cash-rt-segment"><div class="cash-rt-route">${route}</div>${meta.length ? `<div class="cash-rt-meta">${meta.join(' · ')}</div>` : ''}</li>`;
  }).filter(Boolean).join('');
  if (!rows) return '';
  return `<section class="cash-rt-leg" aria-label="${esc(label)}"><div class="cash-rt-label">${esc(label)}</div><ol class="cash-rt-timeline">${rows}</ol></section>`;
}

function cashRoundTripIntegrityHtml(o, roundTripRequested) {
  if (!roundTripRequested) return '';
  const state = o && o.itinerary_state;
  if (!['complete', 'partial', 'price_only'].includes(state)) return '';
  if (state === 'price_only') return '<div class="cash-routing-unavailable">Routing details are not available from the current source.</div>';
  const outbound = cashSegmentTimelineHtml(o.outbound_segments, 'Outbound');
  if (state === 'complete') return `${outbound}${cashSegmentTimelineHtml(o.return_segments, 'Return')}`;
  const requestedDate = o.returnDate
    ? `<div class="cash-ghost-date"><span>Requested return date</span> ${esc(formatUserDate(o.returnDate))}</div>`
    : '';
  return `${outbound}<section class="cash-ghost-return" aria-label="Return details unavailable"><div class="cash-rt-label">Return</div><p>Return details were not provided by the current source.</p>${requestedDate}</section>`;
}

async function verifyRecommendedReturnLeg() {
  try {
    if (mode !== 'cheap' || !currentCheapRoundTripRequested || !currentCheapRequest) return;
    const recId = (currentCashGuidance && currentCashGuidance.recommended_offer_id) || '';
    if (!recId) return;
    const offer = (currentOffers || []).find(o => o && o.offer_id === recId);
    if (!offer || offer.itinerary_state !== 'partial' || !String(offer.returnDate || '').trim()) return;
    const attemptKey = `${recId}|${offer.date || ''}|${offer.returnDate || ''}`;
    if (currentReturnLegAttempts.has(attemptKey)) return;
    currentReturnLegAttempts.add(attemptKey);
    const req = currentCheapRequest;
    const body = {
      origin: offer.origin, dest: offer.dest, date: offer.date, returnDate: offer.returnDate,
      cabins: req.cabins, cabin: (req.cabins && req.cabins[0]) || 'economy',
      currency: req.currency, mmOnly: req.mmOnly, lang: req.lang, offer_id: offer.offer_id,
    };
    const res = await fetch('/api/return-leg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data; try { data = await res.json(); } catch (_) { return; }
    if (!res.ok || !data || !data.ok || data.itinerary_state !== 'complete'
        || !Array.isArray(data.return_segments) || !data.return_segments.length) return;
    if (!currentCashGuidance || currentCashGuidance.recommended_offer_id !== recId) return;
    if (!(currentOffers || []).some(o => o && o.offer_id === recId)) return;
    offer.return_segments = data.return_segments;
    if (Array.isArray(data.outbound_segments) && data.outbound_segments.length) offer.outbound_segments = data.outbound_segments;
    offer.itinerary_state = 'complete';
    const slot = document.querySelector('.cash-rt-slot[data-offer-id="' + recId + '"]');
    if (slot) slot.innerHTML = cashRoundTripIntegrityHtml(offer, true);
  } catch (_) { /* verification failure leaves the partial result unchanged */ }
}

function priceSignalContextHtml(o) {
  const route = [o && o.origin, o && o.dest].filter(Boolean).map(esc).join('<span class="cash-rt-arrow" aria-hidden="true">→</span>');
  const requestedDate = o && o.returnDate
    ? `<div class="cash-price-signal-date"><span>Requested return date</span> ${esc(formatUserDate(o.returnDate))}</div>`
    : '';
  return `<div class="cash-price-signal-context">
    ${route ? `<div class="cash-price-signal-k">Requested route</div><div class="cash-price-signal-route">${route}</div>` : ''}
    ${requestedDate}
    <div class="cash-routing-unavailable">Routing details are not available from the current source.</div>
  </div>`;
}

function journeyNodes(o) {
  const out = [];
  const push = (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (/^[A-Z0-9]{3}$/.test(c) && out[out.length - 1] !== c) out.push(c);
  };
  push(o.origin);
  const viaCodes = Array.isArray(o.via) ? o.via : [];
  viaCodes.forEach(push);
  push(o.dest);
  return out;
}

function journeyStripHtml(o, opts = {}) {
  const compact = !!opts.compact;
  const nodes = journeyNodes(o);
  if (nodes.length < 2) return '';
  const parts = [];
  nodes.forEach((code, i) => {
    const isMain = i === 0 || i === nodes.length - 1;
    const cls = `journey-node${isMain ? ' journey-node-main' : ' journey-via'}`;
    parts.push(`<span class="${cls}">${esc(code)}</span>`);
    if (i < nodes.length - 1) {
      parts.push('<span class="journey-line" aria-hidden="true"></span>');
    }
  });
  return `<div class="journey-strip${compact ? ' journey-strip-compact' : ''}">${parts.join('')}</div>`;
}

function journeyViaFact(o) {
  const viaCodes = (Array.isArray(o.via) ? o.via : [])
    .map(v => String(v || '').trim().toUpperCase())
    .filter(v => /^[A-Z0-9]{3}$/.test(v));
  if (!viaCodes.length) return '';
  if (viaCodes.length <= 2) return `via ${viaCodes.join(', ')}`;
  return `via ${viaCodes.slice(0, 2).join(', ')} +${viaCodes.length - 2}`;
}

function journeyFactsHtml(o, opts = {}) {
  const facts = [];
  const maxFacts = Number.isFinite(opts.maxFacts) ? Math.max(1, opts.maxFacts) : 4;
  const stops = parseInt(o.stops) || 0;
  const stopsLabel = stops === 0 ? 'nonstop' : stops === 1 ? '1 stop' : `${stops} stops`;
  const off = (typeof o.arrival_day_offset === 'number' && o.arrival_day_offset > 0) ? o.arrival_day_offset : null;

  if (opts.isRecommended) facts.push('Recommended option');
  if (opts.isCheapest) facts.push('Lowest returned fare');
  facts.push(stopsLabel);
  if (o.durationMin) facts.push(fmtDur(o.durationMin));
  if (opts.includeViaFact) {
    const viaFact = journeyViaFact(o);
    if (viaFact) facts.push(viaFact);
  }
  if (off) facts.push(`+${off} day arrival`);
  if (opts.includeAirlineFlight && o.airline && o.flight_number) facts.push(`${o.airline} ${o.flight_number}`);

  const uniq = facts.filter((f, i) => f && facts.indexOf(f) === i).slice(0, maxFacts);
  if (!uniq.length) return '';
  return `<div class="journey-facts">${uniq.map(f => `<span class="journey-fact">${esc(f)}</span>`).join('')}</div>`;
}

// Client-side mirror of the backend valid-price rule: reject booleans, null,
// empty/whitespace strings, non-numeric, NaN, ±Infinity, zero and negatives.
// Booleans are excluded explicitly because Number(true) === 1 would slip through.
function isValidCashPrice(v) {
  if (typeof v === 'boolean' || v == null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function decisionGuidanceHtml(guidance, offer) {
  if (!guidance || typeof guidance !== 'object') return '';
  const recommendation = guidance.headline || guidance.next_step || 'Review the strongest returned option.';
  const whyItems = [guidance.why || 'This is the strongest option supported by the returned fare evidence.'];
  const rawConfidence = String(guidance.evidence_level || '').toLowerCase();
  const confidence = rawConfidence.includes('high') ? 'High' : rawConfidence.includes('moderate') || rawConfidence.includes('medium') ? 'Moderate' : 'Limited';
  const confidenceSupport = confidence === 'High'
    ? 'Based on aligned fare and routing evidence.'
    : confidence === 'Moderate'
      ? 'Based on available fare data; some journey details still require confirmation.'
      : 'Some fare or routing evidence could not be independently verified.';
  const evidenceItems = [];
  if (offer && isValidCashPrice(offer.price)) evidenceItems.push(`Cash fare compared at ${formatMoney(offer.price, offer.currency)}`);
  if (offer && offer.time_data_status === 'complete') evidenceItems.push('Journey timing reviewed');
  if (offer && offer.stops !== null && offer.stops !== undefined && String(offer.stops).trim() !== '') evidenceItems.push('Routing complexity evaluated');
  if (guidance.evidence_level) evidenceItems.push('Evidence quality assessed');
  if (!evidenceItems.length) evidenceItems.push('Returned fare evidence reviewed');
  evidenceItems.forEach(item => {
    if (whyItems.length < 3 && !whyItems.includes(item)) whyItems.push(item);
  });
  const verificationItems = ['Verify the current fare and seat availability', guidance.watch_out || 'Verify routing and fare conditions'];
  return `<section class="decision-document cash-guidance" aria-label="Our recommendation">
    <div class="decision-section decision-recommendation"><div class="decision-label">Our Recommendation</div><h2>${esc(recommendation)}</h2></div>
    <div class="decision-section decision-why"><div class="decision-label">Why</div><ul>${whyItems.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>
    <div class="decision-section decision-confidence"><div class="decision-label">Decision Confidence</div><div class="decision-confidence-value">${confidence}</div><p class="decision-confidence-support">${esc(confidenceSupport)}</p></div>
    <div class="decision-section decision-verification"><div class="decision-label">Verification Protocol</div><ul>${verificationItems.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>
  </section>`;
}

function hasExplicitReturnLegDetails(o) {
  if (!o || typeof o !== 'object') return false;
  const textFields = ['return_dep_time', 'return_arr_time', 'return_duration', 'return_flight_number', 'return_route'];
  const valueFields = ['return_durationMin', 'return_stops', 'return_arrival_day_offset'];
  if (textFields.some(k => !!String(o[k] || '').trim())) return true;
  if (valueFields.some(k => o[k] !== null && o[k] !== undefined && String(o[k]).trim() !== '')) return true;
  if (Array.isArray(o.return_segments) && o.return_segments.length > 0) return true;
  return false;
}

function needsReturnDisclosure(o, roundTripRequested) {
  if (!roundTripRequested) return false;
  return !hasExplicitReturnLegDetails(o);
}

function returnDisclosureHtml(o, roundTripRequested) {
  if (!needsReturnDisclosure(o, roundTripRequested)) return '';
  return `<div class="rt-disclosure">
    <div class="rt-disclosure-k">Shown itinerary details are from returned fare data.</div>
    <div>Return itinerary details unavailable from current fare source. Verify return flight times before purchase.</div>
  </div>`;
}

function cheapCardsHtml(offers, sortKey, cashGuidance, opts = {}) {
  // Defense in depth: an invalid price must never sort as cheapest/best or render.
  let sorted = [...offers].filter(o => o && isValidCashPrice(o.price));
  if (sortKey === 'price') sorted.sort((a, b) => (a.price || 99999) - (b.price || 99999));
  else if (sortKey === 'nonstop') sorted.sort((a, b) => (a.stops || 0) - (b.stops || 0) || (-(a.dealScore || 0)) + (b.dealScore || 0));
  else sorted.sort((a, b) => (-(a.dealScore || 0)) + (b.dealScore || 0));
  const roundTripRequested = !!opts.roundTripRequested;

  const guidance = cashGuidance && typeof cashGuidance === 'object' ? cashGuidance : null;
  const recommendedId = ((guidance && guidance.recommended_offer_id) || '').trim();
  const decisionActionsMarkup = typeof opts.decisionActionsMarkup === 'string' ? opts.decisionActionsMarkup : '';
  if (recommendedId) {
    const recommended = sorted.find(o => o.offer_id === recommendedId);
    if (recommended) {
      sorted = [recommended, ...sorted.filter(o => o.offer_id !== recommendedId)];
    }
  }
  const cheapestPrice = sorted.reduce((min, o) => {
    const n = Number(o.price);
    return Number.isFinite(n) && n < min ? n : min;
  }, Infinity);

  return sorted.map((o, i) => {
    const isTop = i === 0;
    const isGuidanceRecommended = !!(recommendedId && o.offer_id === recommendedId);
    const offerTier = o.tier || scoreInfo(o.dealScore).tier;
    const isWeakAssessment = isGuidanceRecommended &&
      ['keep_looking', 'limited_evidence'].includes(guidance && guidance.recommendation_state) ||
      ['fair', 'poor'].includes(offerTier);
    const isCheapest = Number.isFinite(cheapestPrice) && Number(o.price) === cheapestPrice;
    const hasKnownStops = o.stops !== null && o.stops !== undefined && String(o.stops).trim() !== '' && Number.isFinite(Number(o.stops));
    const stops = hasKnownStops ? Math.max(0, parseInt(o.stops, 10)) : null;
    const airlineLabel = o.airline || 'Airline';
    const logoImg = airlineMarkHtml(airlineLabel, o.airlineCode);
    const flightNoHtml = o.flight_number ? `<span class="cash-flight-no">${esc(o.flight_number)}</span>` : '';
    const hasIntegrityState = roundTripRequested && ['complete', 'partial', 'price_only'].includes(o.itinerary_state);
    const roundTripIntegrity = cashRoundTripIntegrityHtml(o, roundTripRequested);

    if (roundTripRequested && o.itinerary_state === 'price_only') {
      return `<div class="card ${isTop ? 'recommendation-card top-card ' : 'compact-alternative '}price-signal-card">
        <div class="compact-row">
          <div class="compact-main">${priceSignalContextHtml(o)}</div>
          <div class="compact-price"><div class="price">${esc(formatMoney(o.price, o.currency))}</div></div>
        </div>
      </div>`;
    }

    // R2B-1 RECOMMENDATION CARD (Scope A, B, C, E)
    if (isTop) {
      // Verdict copy based on sort context and existing signals
      let verdict = '';
      if (sortKey === 'price') {
        verdict = 'Lowest fare in this search';
      } else if (sortKey === 'nonstop') {
        verdict = !hasKnownStops ? 'Best match for this search' : stops === 0 ? 'Best nonstop option' : 'Fewest stops option';
      } else {
        // Score sort — use existing tier logic
        const tier = o.tier || scoreInfo(o.dealScore).tier;
        if (o.scoreContext === 'best_available_not_cheap') {
          verdict = 'Best available option';
        } else if (o.scoreContext === 'limited_comparison') {
          verdict = 'Only option found';
        } else if (tier === 'exceptional') {
          verdict = 'Exceptional value for this search';
        } else if (tier === 'great') {
          verdict = 'Strong value for this search';
        } else {
          verdict = 'Best match for this search';
        }
      }

      const confirmedReturnDate = o.returnDate && o.itinerary_state !== 'partial' ? o.returnDate : '';
      const dateLine = formatTripDateRange(o.date, confirmedReturnDate);
      const displayGuidance = guidance || {
        headline: verdict,
        why: o.scoreReason || 'This is the strongest option supported by the returned fare evidence.',
        evidence_level: o.scoreConfidence || 'limited',
      };
      const guidanceHtml = decisionGuidanceHtml(displayGuidance, o);
      const verdictHtml = '';
      const recommendationTag = isGuidanceRecommended ? '<div class="cg-tag cg-tag-secondary">Recommended option</div>' : '';
      const topBadge = bestBadgeHtml(o, sortKey, { guided: isGuidanceRecommended });
      const returnDisclosure = returnDisclosureHtml(o, roundTripRequested);
      const journeyFacts = journeyFactsHtml(o, {
        maxFacts: 4,
        includeViaFact: true,
        includeAirlineFlight: true,
        isRecommended: isGuidanceRecommended,
        isCheapest,
      });

      return `<div class="card recommendation-card top-card${isGuidanceRecommended ? ' guidance-card' : ''}${isWeakAssessment ? ' assessment-caution' : ''}">
        <div class="recommendation-badges">
          ${topBadge}
          ${recommendationTag}
        </div>
        <div class="rec-context">
          <div class="rec-context-head">
            <h3>${esc(o.origin)}<span class="route-arrow">→</span>${esc(o.dest)}</h3>
            <div class="rec-meta">${esc(dateLine)}</div>
          </div>
        </div>
        <div class="rec-brief">
          <div class="rec-brief-main">
            ${guidanceHtml}
            ${returnDisclosure}
            ${verdictHtml}
            ${decisionActionsMarkup}
          </div>
          <div class="rec-brief-side">
            <div class="card-price rec-price-panel${isWeakAssessment ? ' price-evidence' : ''}">
              <div class="price">${esc(formatMoney(o.price, o.currency))}</div>
              <div class="price-sub">per person</div>
              ${o.scoreReason ? `<div class="score-reason-pills">${o.scoreReason.split(' · ').map(p => `<span class="srp">${esc(cashReasonDisplay(p))}</span>`).join('')}</div>` : ''}
              ${scoreHtml(o)}
            </div>
          </div>
        </div>
      </div>`;
    }

    // R2B-1 COMPACT ALTERNATIVES (Scope F)
    const stopsLabel = !hasKnownStops ? '' : stops === 0 ? 'nonstop' : stops === 1 ? '1 stop' : `${stops} stops`;
    const durStr = o.durationMin ? fmtDur(o.durationMin) : '';
    const confirmedReturnDate = o.returnDate && o.itinerary_state !== 'partial' ? o.returnDate : '';
    const dateLine = formatTripDateRange(o.date, confirmedReturnDate);
    const dep = o.dep_time;
    const arr = o.arr_time;
    const off = (typeof o.arrival_day_offset === 'number' && o.arrival_day_offset > 0) ? o.arrival_day_offset : null;
    let compactTimes = '';
    if (dep && arr) {
      compactTimes = `${esc(dep)} <span class="compact-time-arrow" aria-hidden="true">→</span> ${esc(arr)}${off ? ` <span class="compact-daymark">+${off}d</span>` : ''}`;
    } else if (dep) {
      compactTimes = `Dep ${esc(dep)}`;
    } else if (arr) {
      compactTimes = `Arr ${esc(arr)}${off ? ` <span class="compact-daymark">+${off}d</span>` : ''}`;
    }
    const viaLine = o.via && o.via.length ? `<div class="compact-via">via ${esc(o.via.join(', '))}</div>` : '';
    const tripMetaLine = [durStr, stopsLabel].filter(Boolean).join(' · ');
    const compactJourneyFacts = journeyFactsHtml(o, {
      maxFacts: 2,
      includeViaFact: false,
      includeAirlineFlight: false,
      isRecommended: isGuidanceRecommended,
      isCheapest,
    });

    const tier = offerTier;
    const conciseLabel = relativeSignalLabel(tier);
    const recommendationTag = isGuidanceRecommended ? '<div class="cg-tag cg-tag-compact">Recommended option</div>' : '';
    const returnDisclosure = returnDisclosureHtml(o, roundTripRequested);

    return `<div class="card compact-alternative${isGuidanceRecommended ? ' guidance-recommended' : ''}">
      <div class="compact-row">
        <div class="compact-main">
          ${recommendationTag}
          ${journeyStripHtml(o, { compact: true })}
          <div class="compact-route">${esc(o.origin)} → ${esc(o.dest)}</div>
          ${roundTripIntegrity || `${viaLine}${compactTimes ? `<div class="compact-times">${compactTimes}</div>` : ''}${tripMetaLine ? `<div class="compact-trip-meta">${esc(tripMetaLine)}</div>` : ''}${compactJourneyFacts}`}
          <div class="compact-date-meta">${esc(dateLine)}</div>
          ${returnDisclosure}
          ${hasIntegrityState && !o.airline ? '' : `<div class="compact-airline">${logoImg}<span>${esc(airlineLabel)}</span>${flightNoHtml}</div>`}
        </div>
        <div class="compact-price${['fair', 'poor'].includes(tier) ? ' price-evidence' : ''}">
          <div class="price">${esc(formatMoney(o.price, o.currency))}</div>
          <div class="compact-value">${esc(conciseLabel)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function airlineMarkHtml(airlineName, airlineCode) {
  const code = String(airlineCode || '').trim().toUpperCase();
  const name = String(airlineName || '').trim();
  const fallback = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
  const label = (code || fallback || 'AR').slice(0, 2);
  return `<span class="airline-mark" aria-hidden="true">${esc(label)}</span>`;
}

function applySort(key) {
  currentSortKey = key;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === key));
  const wrap = document.getElementById('cards-wrap');
  if (wrap) wrap.innerHTML = cheapCardsHtml(currentOffers, key, currentCashGuidance, { roundTripRequested: currentCheapRoundTripRequested });
}

function switchTabAndRun(targetMode) {
  const tabEl = document.querySelector(`.tab[data-tab="${targetMode}"]`);
  if (tabEl) activateTab(tabEl);
  run();
}

function relatedAnalysesHtml(currentMode) {
  const others = {
    cheap:  [{ tab: 'awards', label: 'Evaluate Award Redemptions' }],
    awards: [{ tab: 'cheap', label: 'Compare Fare Context' }],
  }[currentMode] || [];
  const links = others.map(o =>
    `<button class="cross-link" onclick="switchTabAndRun('${o.tab}')">${esc(o.label)}</button>`
  ).join('');
  return `<div class="related-analyses"><span class="related-label">Related analyses</span>${links}</div>`;
}

function decisionActionsHtml(offer) {
  const verificationLinks = offer && offer.links ? linksHtmlWithLabels(offer.links) : '';
  return `<section class="decision-section decision-execution" aria-label="Execution">
    <div class="decision-label">Execution</div>
    <div class="decision-actions">
    ${verificationLinks}
    <button class="cross-link decision-action" onclick="switchTabAndRun('awards')">Compare award options</button>
    </div>
  </section>`;
}

function decisionCompleteHtml(data) {
  const freshness = data && (data.freshness_label || data.fetched_at)
    ? String(data.freshness_label || data.fetched_at)
    : 'Current returned evidence';
  const assessedAt = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `<footer class="decision-complete">
    <div class="decision-label">Decision Complete</div>
    <dl>
      <div><dt>Sources</dt><dd>Verification links and returned journey evidence</dd></div>
      <div><dt>Freshness</dt><dd>${esc(freshness)}</dd></div>
      <div><dt>Assessment</dt><dd>${esc(assessedAt)}</dd></div>
    </dl>
  </footer>`;
}

function render(data) {
  const workspaceOrigin = ($('origin').value || '').trim().toUpperCase().slice(0, 3);
  const workspaceDest = ($('dest').value || '').trim().toUpperCase().slice(0, 3);
  const workspaceMode = mode === 'awards' ? 'Award decision' : 'Decision summary';
  const workspaceDate = formatSearchDate(($('date').value || '').trim()) || 'Not specified';
  let html = `<header class="result-workspace-head" aria-label="Decision summary">
    <div class="result-kicker">Decision Summary</div>
    <dl class="decision-summary-grid">
      <div><dt>Origin</dt><dd>${esc(workspaceOrigin || '—')}</dd></div>
      <div><dt>Destination</dt><dd>${esc(workspaceDest || '—')}</dd></div>
      <div><dt>Travel date</dt><dd>${esc(workspaceDate)}</dd></div>
      <div><dt>Mode</dt><dd>${esc(workspaceMode)}</dd></div>
    </dl>
  </header>`;
  if (data.note) console.debug('[AwardRadar context]', data.note);
  // Warnings: log internally only — never expose raw provider errors to users
  if (data.warnings?.length) console.debug('[AwardRadar warnings]', data.warnings);

  if (mode === 'cheap') {
    currentOffers = data.offers || [];
    currentCashGuidance = data.cash_guidance || null;
    const hasOfferReturnDate = currentOffers.some(o => o && String(o.returnDate || '').trim());
    currentCheapRoundTripRequested = currentCheapRoundTripRequested || hasOfferReturnDate;
    currentSortKey = 'score';
    updateCalendarPrices(data.calendar);

    if (currentOffers.length) {
      html += `<div id="cards-wrap">${cheapCardsHtml(currentOffers, 'score', currentCashGuidance, { roundTripRequested: currentCheapRoundTripRequested })}</div>`;
      html += `<section class="workspace-secondary-controls" aria-label="Alternative pathways">
        <div class="decision-label">Alternative pathways</div>
        ${data.calendar && data.calendar.length > 1 ? calendarStripHtml(data.calendar) : ''}
        <div class="sort-bar">
          <span class="sort-label">Review by:</span>
          <button class="sort-btn active" data-sort="score" onclick="applySort('score')">Assessment</button>
          <button class="sort-btn" data-sort="price" onclick="applySort('price')">Fare amount</button>
          <button class="sort-btn" data-sort="nonstop" onclick="applySort('nonstop')">Routing simplicity</button>
        </div>
        ${scoreLegendHtml()}
      </section>`;
      html += decisionActionsHtml(currentOffers[0]);
      html += decisionCompleteHtml(data);
      setTimeout(verifyRecommendedReturnLeg, 0);
    } else {
      currentCashGuidance = null;
      currentCheapRoundTripRequested = false;
      const fallbackActions = (data.fallback || []).map(f => linksHtml(f.links)).join('');
      html += `<div class="decision-document empty-decision">
        <section class="decision-section decision-recommendation"><div class="decision-label">Our Recommendation</div><h2>More evidence is required before making a decision.</h2></section>
        <section class="decision-section decision-why"><div class="decision-label">Why</div><ul><li>Current fare evidence is not available for this journey.</li><li>A reliable cash-versus-miles comparison cannot yet be established.</li></ul></section>
        <section class="decision-section decision-confidence"><div class="decision-label">Decision Confidence</div><div class="decision-confidence-value">Limited</div><p class="decision-confidence-support">The available evidence is not sufficient for a reliable recommendation.</p></section>
        <section class="decision-section decision-verification"><div class="decision-label">Verification Protocol</div><ul><li>Verify the current fare with an official airline source</li><li>Confirm availability and routing</li><li>Review final fare conditions before booking</li></ul></section>
        <section class="decision-section decision-execution"><div class="decision-label">Execution</div><div class="decision-actions">${fallbackActions}</div></section>
      </div>`;
      html += decisionCompleteHtml(data);
    }
  }

  if (mode === 'awards') {
    const awardResults = (data.results || []);
    if (awardResults.length) {
      const GRADE_ORDER = ['exceptional','great','good','fair','poor'];
      const GRADE_MAP = {
        exceptional: { label: 'A+', cls: 'aw-grade-aplus' },
        great:       { label: 'A',  cls: 'aw-grade-a' },
        good:        { label: 'B',  cls: 'aw-grade-b' },
        fair:        { label: 'C',  cls: 'aw-grade-c' },
        poor:        { label: 'D',  cls: 'aw-grade-d' },
      };
      html += awardResults.slice(0, 1).map(r => {
        const cashStr = r.cash_eur ? formatMoney(r.cash_eur) : null;
        const itineraryHtml = buildItinerary(r.flight);
        const scheduleFallback = itineraryHtml
          ? ''
          : `<div class="aw-schedule-note">Flight times are not available for this result. Check the schedule with the airline or loyalty program before any transfer or purchase.</div>`;

        // Sort programs: by grade tier, then by cpm ascending
        const sorted = [...(r.programs || [])].sort((a, b) => {
          const ai = GRADE_ORDER.indexOf(a.grade?.tier ?? '');
          const bi = GRADE_ORDER.indexOf(b.grade?.tier ?? '');
          const ao = ai === -1 ? 99 : ai;
          const bo = bi === -1 ? 99 : bi;
          if (ao !== bo) return ao - bo;
          return (a.cpm || 99) - (b.cpm || 99);
        });

        // ===== Intelligence Briefing (presentation layer over the Decision Engine) =====
        // Copy maps only — no scoring, thresholds or backend fields are recomputed.
        const HEADLINE = {
          cash_may_be_stronger: {
            high:   ['Cash offers the stronger price signal.', 'Pay cash and save your miles.'],
            medium: ['Cash offers the stronger price signal.', 'The current comparison favors paying cash.'],
            low:    ['Cash may offer the stronger price signal.', 'Verify both options before deciding.'],
          },
          strong_miles_value: {
            high:   ['The award shows a strong redemption value.', 'This redemption offers strong value.'],
            medium: ['The award shows a strong redemption value.', 'This redemption appears promising.'],
            low:    ['The award shows a promising value signal.', 'Verify availability and final costs before transferring points.'],
          },
          promising_miles_value: {
            high:   ['The award shows promising redemption value.', 'This redemption looks promising.'],
            medium: ['The award shows promising redemption value.', 'This redemption looks promising.'],
            low:    ['This award option may be worth checking.', 'Confirm availability, taxes and program rules first.'],
          },
          mixed_value: {
            high:   ['The price signals are closely matched.', 'Compare the final price and award availability before deciding.'],
            medium: ['The price signals are closely matched.', 'Compare the final price and award availability before deciding.'],
            low:    ['The price signals are closely matched.', 'Compare the final price and award availability before deciding.'],
          },
          insufficient_data: {
            high:   ['More information is needed before comparing.', 'Verify the current cash fare and award availability.'],
            medium: ['More information is needed before comparing.', 'Verify the current cash fare and award availability.'],
            low:    ['More information is needed before comparing.', 'Verify the current cash fare and award availability.'],
          },
        };
        const VALUE_LABEL = { exceptional: 'Excellent value', great: 'Strong value', good: 'Good value', fair: 'Fair value', poor: 'Poor value' };
        const CONF_WORD = { high: 'High', medium: 'Moderate', low: 'Limited' };
        const confBucket = c => (c === 'high' ? 'high' : c === 'medium' ? 'medium' : 'low');
        const stateOf = sig => sig === 'cash_may_be_stronger' ? 'cash'
          : (sig === 'strong_miles_value' || sig === 'promising_miles_value') ? 'miles'
          : sig === 'mixed_value' ? 'mixed' : 'insufficient';

        const best = sorted[0];
        const d = r.decision || {};
        const incompatibleBasis = d.trip_basis_compatible === false;
        const ownership = normalizeItineraryOwnership(r);
        const routingVerified = ownership.verifiedIdenticalRouting === true;

        const programCardHtml = (p, idx, isEvaluated = false) => {
          const g = p.grade || {};
          const gm = incompatibleBasis ? null : (GRADE_MAP[g.tier] || null);
          const isLive = p.data_source === 'live';
          const isBest = !incompatibleBasis && idx === 0 && (g.tier === 'exceptional' || g.tier === 'great');
          const cpmStr = (!incompatibleBasis && p.cpm) ? formatCpm(p.cpm) : null;
          const verifyContext = [r.route, r.date, r.cabin, p.program]
            .filter(Boolean)
            .map(esc)
            .join(' / ');
          const verificationNote = p.verification_note
            ? `<div class="aw-verify-note">${esc(p.verification_note)}</div>`
            : '';
          const cabinAvailabilityNote = isLive
            ? ''
            : `<div class="aw-verify-note">Cabin-specific availability is not confirmed for this estimate. Verify with the official program before transferring points.</div>`;
          // Compact meta row: provider direct signal · seats · cpm
          const metaParts = [];
          if (p.direct) metaParts.push('<span class="aw-meta-nonstop">Provider reports direct availability</span>');
          if (p.seats > 0 && p.seats <= 2) metaParts.push(`<span class="aw-meta-seats aw-meta-seats-low">${p.seats} seat${p.seats > 1 ? 's' : ''} left</span>`);
          else if (p.seats >= 3) metaParts.push(`<span class="aw-meta-seats">${p.seats} seats</span>`);
          if (cpmStr) metaParts.push(`<span class="aw-meta-cpm">${cpmStr}</span>`);

          // Surcharge class
          const surchargeClass = p.surcharge > 500 ? 'aw-surcharge-high' : p.surcharge > 250 ? 'aw-surcharge-med' : '';

          const cardClasses = ['aw-card'];
          if (isLive) cardClasses.push('aw-card-live');
          if (isBest) cardClasses.push('aw-card-best');
          if (isEvaluated) cardClasses.push('aw-card-evaluated');

          return `<div class="${cardClasses.join(' ')}">
            <div class="aw-card-header">
              <div class="aw-card-prog">
                <span>${esc(p.program)}</span>
                ${isLive ? '<span class="aw-source-live">Live</span>' : '<span class="aw-source-est">Est.</span>'}
              </div>
              ${gm ? `<span class="aw-grade-pill ${gm.cls}" title="Program-level redemption signal — see the summary card above for AwardRadar's assessment">${gm.label}</span>` : ''}
            </div>
            <div class="aw-card-cost">
              <span class="aw-card-miles">${esc(formatMilesNumber(p.miles) || '—')}</span>
              <span class="aw-card-miles-unit">miles</span>
            </div>
            <div class="aw-card-surcharge${surchargeClass ? ' ' + surchargeClass : ''}">+ ${esc(formatMoney(p.surcharge))} taxes &amp; fees</div>
            ${metaParts.length ? `<div class="aw-card-meta">${metaParts.join('<span class="aw-meta-sep">·</span>')}</div>` : ''}
            ${p.airlines ? `<div class="aw-card-airline">${esc(p.airlines)}</div>` : ''}
            ${awardTrustMetaHtml(p)}
            <div class="aw-verify-context">Search to verify: ${verifyContext}</div>
            ${verificationNote}
            ${cabinAvailabilityNote}
          </div>`;
        };

        const evalProgramName = d.evaluated_program || (best && best.program) || '';
        const evaluated = sorted.find(p => p.program === evalProgramName) || best;

        // Header (route + date + cash badge) — position 1 in the hierarchy.
        const requestedTripLabel = r.returnDate ? 'Round trip' : 'One-way';
        const dateContext = formatTripDateRange(r.date, r.returnDate);
        const cashBadgeLabel = d.cash_trip_type === 'round_trip' ? 'Round-trip cash fare' : 'Cash fare';
        const headerHtml = `
          <div class="aw-result-header">
            <h3 class="aw-result-route">${esc(r.route)} <span class="aw-dot" aria-hidden="true">·</span> ${esc(r.cabin)}</h3>
            <div class="aw-result-meta">
              <span>${esc(requestedTripLabel)}</span>
              <span>${esc(dateContext)}</span>
              ${cashStr ? `<span class="badge">${esc(cashBadgeLabel)}: ${cashStr}</span>` : ''}
            </div>
          </div>`;

        // Empty guard: a result with no programs cannot be compared.
        if (!best) {
          return `<div class="card decision-document-card"><div class="aw-result-shell">
            <div class="decision-document">
              <section class="decision-section decision-recommendation"><div class="decision-label">Our Recommendation</div><h2>More evidence is required before making a decision.</h2></section>
              <section class="decision-section decision-why"><div class="decision-label">Why</div><ul><li>No compatible award options were returned for this journey.</li></ul></section>
              <section class="decision-section decision-confidence"><div class="decision-label">Decision Confidence</div><div class="decision-confidence-value">Limited</div><p class="decision-confidence-support">The available evidence is not sufficient for a reliable comparison.</p></section>
              <section class="decision-section decision-verification"><div class="decision-label">Verification Protocol</div><ul><li>Verify current availability with the official loyalty program</li><li>Confirm mileage prices, taxes and program rules</li></ul></section>
              <section class="decision-section decision-execution"><div class="decision-label">Execution</div>${actionLinksHtml(r.links)}</section>
            </div>
            ${decisionCompleteHtml({ freshness_label: d.freshness_label })}
          </div></div>`;
        }

        // Evaluated-option identity (authoritative, from the backend decision).
        const sig  = d.signal || 'insufficient_data';
        const st   = stateOf(sig);
        const cb   = confBucket(d.confidence);
        const [baseHl] = (HEADLINE[sig] || HEADLINE.insufficient_data)[cb];
        const unverifiedHeadline = {
          cash_may_be_stronger: 'Cash offers the stronger price signal.',
          strong_miles_value: 'The award shows a strong redemption value.',
          promising_miles_value: 'The award shows promising redemption value.',
          mixed_value: 'The price signals are closely matched.',
        }[sig];
        const hl = incompatibleBasis
          ? 'A round-trip comparison is not available yet.'
          : (!routingVerified && unverifiedHeadline ? unverifiedHeadline : baseHl);
        const cash = (r.cash_eur != null) ? Math.round(r.cash_eur) : null;
        const evalMiles = (d.evaluated_miles != null ? d.evaluated_miles : (evaluated.miles || 0));
        const evalSurcharge = (d.evaluated_surcharge != null ? d.evaluated_surcharge : (evaluated.surcharge || 0));
        const cpm = (d.estimated_value != null) ? Number(d.estimated_value) : null;
        const tier = d.tier || null;
        const valueWord = tier ? VALUE_LABEL[tier] : null;
        const netSaved = (cash != null && evalSurcharge != null) ? Math.round(cash - evalSurcharge) : null;

        // Guided-decision derived values (from existing fields only — no new maths).
        const milesAvailable = evalMiles != null && evalMiles > 0;
        const valueAdj = valueWord ? valueWord.toLowerCase().replace(' value', '') : null;

        // 1 — Verdict Layer (dominant, confidence-aware heading; readable without colour)
        const recommendationSentence = incompatibleBasis
          ? 'We recommend verifying both options before deciding.'
          : ({ cash: 'We recommend paying cash.', miles: 'We recommend using miles.', mixed: 'We recommend comparing both options.', insufficient: 'We need more evidence before recommending.' }[st]);

        // 2 — What this means (plain language, safe fallbacks)
        let meaning;
        if (incompatibleBasis) {
          meaning = 'The cash fare covers the full return trip, while the available award estimate covers the outbound journey only.';
        } else if (st === 'cash') {
          meaning = (netSaved != null && netSaved > 0 && milesAvailable)
            ? `You would use ${formatMiles(evalMiles)} to save only ${formatMoney(netSaved)}. That is weak value for your miles.`
            : 'The current award option does not provide enough value compared with the cash fare.';
        } else if (st === 'miles') {
          meaning = (netSaved != null && netSaved > 0 && valueAdj)
            ? `The award option saves about ${formatMoney(netSaved)} while giving your miles ${valueAdj} value.`
            : 'The current award option appears promising based on the available value signals.';
        } else if (st === 'mixed') {
          meaning = (netSaved != null && cpm != null)
            ? `The award option saves ${formatMoney(netSaved)}, but the value per mile is only ${formatCpm(cpm)}. Neither option is clearly superior.`
            : 'The available signals do not clearly favor either cash or miles.';
        } else {
          meaning = 'AwardRadar does not yet have enough compatible data to make a reliable comparison.';
        }
        if (!incompatibleBasis && !routingVerified && ownership.journeyRouteSource === 'cash_context') {
          meaning += ' The itinerary context below is cash-based.';
        }
        const meansHtml = `<div class="aw-means"><div class="aw-block-k">What this means</div><p>${esc(meaning)}</p></div>`;

        // 3 — Your next best step (calm expert guidance; not a warning, not a promo)
        const NEXT = {
          cash:         'Pay cash for this trip and keep your miles for a stronger redemption.',
          miles:        'Verify current availability, taxes and booking rules with the official program before transferring points.',
          mixed:        'Check the final cash fare first, then compare it with the confirmed award cost.',
          insufficient: 'Review the available program signals and verify both cash and award pricing directly.',
        };
        const nextText = incompatibleBasis
          ? 'Review the outbound award signals below and verify the full return-trip cost with the official program.'
          : NEXT[st];
        const nextHtml = `<div class="aw-next"><div class="aw-block-k">Your next best step</div><p>${esc(nextText)}</p></div>`;

        // 5 — Metrics panel (evidence; omit anything without a real value)
        const metricCell = (label, val, sub, subCls) =>
          `<div class="aw-metric"><div class="aw-metric-label">${esc(label)}</div><div class="aw-metric-val">${esc(val)}</div>${sub ? `<div class="aw-metric-sub${subCls ? ' ' + subCls : ''}">${esc(sub)}</div>` : ''}</div>`;
        const metrics = [];
        if (incompatibleBasis) {
          metrics.push(metricCell('Round-trip cash fare', cash != null ? formatMoney(cash) : 'Not available'));
          metrics.push(metricCell('Outbound one-way award estimate', milesAvailable ? `${formatMiles(evalMiles)} + ${formatMoney(evalSurcharge)}` : 'Not available'));
        } else {
          metrics.push(metricCell('Cash fare', cash != null ? formatMoney(cash) : 'Not available'));
          metrics.push(metricCell('Award cost', milesAvailable ? `${formatMiles(evalMiles)} + ${formatMoney(evalSurcharge)}` : 'Not available'));
          if (netSaved != null && netSaved > 0) metrics.push(metricCell('Net cash saved', formatMoney(netSaved)));
          if (cpm != null) metrics.push(metricCell('Value per mile', formatCpm(cpm), valueWord, tier ? `aw-vw-${tier}` : ''));
        }
        const metricsHtml = `<div class="aw-metrics">${metrics.join('')}</div>`;

        // 4 - Dynamic CTA (existing URLs / tab-switch only; one dominant action)
        const hasAwardUrl = evaluated && evaluated.url && evaluated.url !== '#';
        const ctaBtn = (label, kind, primary) => {
          const cls = `aw-cta ${primary ? 'aw-cta-primary' : 'aw-cta-secondary'}`;
          if (kind === 'award') {
            return hasAwardUrl
              ? `<a class="${cls}" href="${esc(evaluated.url)}" target="_blank" rel="noopener">${esc(label)}</a>`
              : `<button type="button" class="${cls}" onclick="this.closest('.card').querySelector('.aw-programs').scrollIntoView({block:'start'})">${esc(label)}</button>`;
          }
          if (kind === 'cash') return `<button type="button" class="${cls}" onclick="switchTabAndRun('cheap')">${esc(label)}</button>`;
          return `<button type="button" class="${cls}" onclick="this.closest('.card').querySelector('.aw-programs').scrollIntoView({block:'start'})">${esc(label)}</button>`;
        };
        const CTA = {
          cash:         { p: ['Check cash fare', 'cash'],            s: ['View evaluated award', 'award'] },
          miles:        { p: ['Verify with official program', 'award'], s: ['Compare cash alternative', 'cash'] },
          mixed:        { p: ['Compare official options', 'award'], s: ['Review both alternatives', 'cash'] },
          insufficient: { p: ['Verify current availability', 'award'], s: ['Review available signals', 'scroll'] },
        }[st];
        const ctaHtml = `<div class="aw-cta-row">${ctaBtn(CTA.p[0], CTA.p[1], true)}${ctaBtn(CTA.s[0], CTA.s[1], false)}</div>`;
        const decisionConfidence = d.confidence === 'high' ? 'High' : d.confidence === 'medium' ? 'Moderate' : 'Limited';
        const whyItems = [
          st === 'cash' ? 'Cash preserves your miles for a stronger redemption' : null,
          st === 'miles' ? (valueWord || 'The award shows the stronger value signal') : null,
          st === 'mixed' ? 'Cash and award value signals are closely matched' : null,
          incompatibleBasis ? 'The available prices cover different journey scopes' : null,
          !routingVerified ? 'Routing still requires confirmation' : null,
        ].filter(Boolean).slice(0, 3);
        if (!whyItems.length) whyItems.push('The available evidence is not sufficient for a reliable comparison');
        const confidenceSupport = decisionConfidence === 'High'
          ? 'Based on aligned fare, award and routing evidence.'
          : decisionConfidence === 'Moderate'
            ? 'Based on available fare and award data; some details still require verification.'
            : 'Some partner availability or routing evidence could not be independently verified.';
        const evidenceItems = [];
        if (cash != null) evidenceItems.push(`Cash fare compared at ${formatMoney(cash)}`);
        if (milesAvailable) evidenceItems.push(`Award cost evaluated at ${formatMiles(evalMiles)}`);
        if (d.evaluated_surcharge != null || evaluated.surcharge != null) evidenceItems.push(`Taxes and fees included at ${formatMoney(evalSurcharge)}`);
        if (routingVerified) evidenceItems.push('Routing evaluated on a comparable itinerary');
        if (evaluated && evaluated.program) evidenceItems.push(`${evaluated.program} program source identified`);
        if (!evidenceItems.length) evidenceItems.push('Available fare and award evidence reviewed');
        evidenceItems.forEach(item => {
          if (whyItems.length < 3 && !whyItems.includes(item)) whyItems.push(item);
        });
        const decisionDocumentHtml = `<div class="decision-document">
          <section class="decision-section decision-recommendation"><div class="decision-label">Our Recommendation</div><h2>${esc(recommendationSentence)}</h2></section>
          <section class="decision-section decision-why"><div class="decision-label">Why</div><ul>${whyItems.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>
          <section class="decision-section decision-confidence"><div class="decision-label">Decision Confidence</div><div class="decision-confidence-value">${decisionConfidence}</div><p class="decision-confidence-support">${esc(confidenceSupport)}</p></section>
          <section class="decision-section decision-verification"><div class="decision-label">Verification Protocol</div><ul><li>Verify current award availability</li><li>Confirm taxes and fees</li><li>Review airline booking conditions</li></ul></section>
        </div>`;

        // 6 — Trust metadata (subordinate)
        const journeyMap = awardJourneyMapHtml(r);
        const trustNotes = [
          d.verification_guidance || 'Final availability, prices, taxes and program rules must be confirmed with the official provider.',
          journeyMap.trustNote,
        ].filter(Boolean);
        const trustHtml = `
          <div class="aw-trust">
            ${d.freshness_label ? `<div class="aw-trust-item"><span class="aw-trust-k">Freshness</span><span class="aw-trust-v">${esc(d.freshness_label)}</span></div>` : ''}
            <div class="aw-trust-note">${trustNotes.map(esc).join('<br>')}</div>
          </div>`;

        // 7 — Flight details drawer (deep per-segment detail). Ownership label now
        // lives once on the compact itinerary summary above (journeyMap).
        const flightHtml = itineraryHtml
          ? `<div class="aw-flight-details">${itineraryHtml}</div>`
          : scheduleFallback;

        // 8–11 — Evaluated redemption + top-3 alternatives + show-all
        const alternatives = sorted.filter(p => p !== evaluated).slice(0, 3);
        const hiddenPrograms = sorted.filter(p => p !== evaluated).slice(3);
        const evaluatedCard = programCardHtml(evaluated, sorted.indexOf(evaluated), true);
        const altCards = alternatives.map(p => programCardHtml(p, sorted.indexOf(p))).join('');
        const hiddenCards = hiddenPrograms.map(p => programCardHtml(p, sorted.indexOf(p))).join('');
        const showAll = hiddenPrograms.length ? `
          <details class="aw-more-programs">
            <summary><span class="aw-more-closed">Show all programs <span class="aw-more-count">${hiddenPrograms.length} more</span></span><span class="aw-more-open">Show fewer programs</span></summary>
            <div class="aw-cards-grid aw-cards-grid-secondary">${hiddenCards}</div>
          </details>` : '';
        const programsHtml = `
          <div class="aw-programs">
            <div class="aw-section-kicker">${incompatibleBasis ? 'One-way award signals for the outbound journey' : 'Evaluated redemption'}</div>
            <div class="aw-cards-grid aw-cards-grid-briefing">${evaluatedCard}</div>
          </div>`;
        const programOptionsHtml = (alternatives.length || hiddenPrograms.length) ? `
          <div class="aw-program-options">
            ${alternatives.length ? `
              <div class="aw-cards-caption">Other program options · raw estimates, not AwardRadar's final judgment</div>
              <div class="aw-cards-grid">${altCards}</div>` : ''}
            ${showAll}
          </div>` : '';

        return `<div class="card decision-document-card${r.best_program ? ' top-card' : ''}">
          <div class="aw-result-shell">
            <div class="aw-briefing">
              <div class="aw-briefing-main">
                <div class="aw-recommendation">
                  ${decisionDocumentHtml}
                </div>
              </div>
            </div>
            <section class="decision-section decision-alternatives" aria-label="Alternative pathways">
              <div class="decision-label">Alternative Pathways</div>
              ${programsHtml}
              ${programOptionsHtml}
            </section>
            <section class="decision-section decision-execution" aria-label="Execution">
              <div class="decision-label">Execution</div>
              ${ctaHtml}
            </section>
            ${decisionCompleteHtml({ freshness_label: d.freshness_label || r.freshness_label })}
          </div>
        </div>`;
      }).join('');
    } else {
      html += `<div class="card cross-nudge">
        <div class="cross-nudge-msg">No strong award redemption value signals were identified for this route.</div>
        <div class="cross-nudge-sub">Review cash fare context instead.</div>
        <button class="cross-btn" onclick="switchTabAndRun('cheap')">Show Fare Context</button>
      </div>`;
    }
  }

  $('results').innerHTML = html;
}

function toggleReturn(initial = false) {
  const on = $('oneWay').checked;
  const fields = document.querySelector('.fields');
  const wrap = $('returnFieldWrap');
  const returnAltInput = fpRet && fpRet.altInput ? fpRet.altInput : null;
  const tripTypeLabel = $('oneWay').closest('label')?.querySelector('span');
  if (fields) fields.classList.toggle('no-return', on);
  if (wrap) wrap.style.display = on ? 'none' : '';
  $('returnDate').disabled = on;
  if (tripTypeLabel) tripTypeLabel.textContent = on ? 'One-way' : 'Round-trip';
  if (returnAltInput) {
    returnAltInput.hidden = on;
    returnAltInput.disabled = on;
  }
  if (initial) validateSearchForm();
  else markSearchFieldTouched('returnDate', { show: on ? [] : ['returnDate'] });
}

function updateCalendarPrices(calendar) {
  calendarPrices = {};
  const entries = (calendar || []).filter(c => c.date && c.price);
  const tiers = priceTiers(entries.map(c => ({ date: c.date, price: c.price })));
  entries.forEach(c => {
    calendarPrices[c.date] = { price: c.price, isBest: !!c.isBest, isSelected: !!c.isSelected, tier: tiers[c.date] || '' };
  });
  if (fpDep) fpDep.redraw();
  // Auto-jump to best date when flex search returns a better date than selected
  const best = entries.find(c => c.isBest);
  if (best && activeFlexDays() > 0) {
    const cur = fpDep && fpDep.selectedDates[0] ? fpDep.selectedDates[0].toISOString().slice(0, 10) : null;
    if (cur !== best.date) fpDep.setDate(best.date, false);
  }
}

function applyDatePreset(preset) {
  const now = new Date();
  let d;
  if (preset === 'today') {
    d = new Date(now);
  } else if (preset === 'tomorrow') {
    d = new Date(now);
    d.setDate(now.getDate() + 1);
  }
  if (!d) return;
  const value = localDateString(d);
  if (fpDep) fpDep.setDate(value, true);
  else $('date').value = value;
  const show = ['date'];
  if (!$('oneWay').checked && $('returnDate').value && validateSearchForm().errors.returnDate) show.push('returnDate');
  markSearchFieldTouched('date', { show });
}

// Flatpickr: replace native month <select> + year input with custom "‹ June 2026 ›" label
function arMonthYear(fp) {
  return fp.l10n.months.longhand[fp.currentMonth] + ' ' + fp.currentYear;
}
function patchMonthNav(fp) {
  const monthDiv = fp.calendarContainer.querySelector('.flatpickr-current-month');
  if (!monthDiv || monthDiv.querySelector('.ar-month-year')) return;
  monthDiv.innerHTML = '<span class="ar-month-year"></span>';
  fp._arLabel = monthDiv.querySelector('.ar-month-year');
  fp._arLabel.textContent = arMonthYear(fp);
}

function initDatepickers() {
  const dayCreateHook = function(_dObj, _dStr, fp, dayElem) {
    const dateStr = dayElem.dateObj.toISOString().slice(0, 10);

    // Flex range band
    const flexDays = activeFlexDays();
    if (flexDays > 0 && fp.selectedDates[0]) {
      const diffMs = dayElem.dateObj - fp.selectedDates[0];
      const diffD = Math.round(diffMs / 86400000);
      if (diffD !== 0 && Math.abs(diffD) <= flexDays) dayElem.classList.add('fp-day-range');
    }

    const cal = calendarPrices[dateStr];
    if (cal) {
      const span = document.createElement('span');
      span.className = 'fp-price';
      span.textContent = formatMoney(cal.price);
      dayElem.appendChild(span);
      if (cal.tier) dayElem.classList.add('fp-day-' + cal.tier);
      if (cal.isBest) dayElem.classList.add('fp-day-best');
    }
  };

  const baseConfig = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'j M Y',
    minDate: 'today',
    disableMobile: true,
    locale: { firstDayOfWeek: 1 },
    onReady(_d, _s, fp)     { patchMonthNav(fp); },
    onMonthChange(_d, _s, fp) { if (fp._arLabel) fp._arLabel.textContent = arMonthYear(fp); },
    onYearChange(_d, _s, fp)  { if (fp._arLabel) fp._arLabel.textContent = arMonthYear(fp); },
  };

  fpDep = flatpickr('#date', {
    ...baseConfig,
    onDayCreate: dayCreateHook,
    onChange() {
      const show = ['date'];
      if (!$('oneWay').checked && $('returnDate').value && validateSearchForm().errors.returnDate) show.push('returnDate');
      markSearchFieldTouched('date', { show });
    }
  });
  fpDep.altInput.placeholder = 'Departure';
  fpDep.altInput.setAttribute('aria-label', 'Departure date');

  fpRet = flatpickr('#returnDate', {
    ...baseConfig,
    onChange() { markSearchFieldTouched('returnDate', { show: ['returnDate'] }); }
  });
  fpRet.altInput.placeholder = 'Select date';
  fpRet.altInput.setAttribute('aria-label', 'Return date');
  fpRet.altInput.classList.add('return-alt-input');
  fpRet.altInput.hidden = true;
}

// Segmented cabin control
document.querySelectorAll('.seg').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    if ($('results').children.length) runIfSearchValid();
  };
});

// USP cards → switch tab
document.querySelectorAll('.usp-card').forEach(card => {
  card.onclick = () => {
    const target = card.dataset.usp;
    document.querySelectorAll('.usp-card').forEach(c => c.classList.remove('usp-active'));
    card.classList.add('usp-active');
    const targetTab = document.querySelector(`.tab[data-tab="${target}"]`);
    if (targetTab) activateTab(targetTab);
  };
});

// Sync pill .on class with checkbox state
function syncPills() {
  document.querySelectorAll('.pill input[type=checkbox]').forEach(cb => {
    cb.closest('.pill').classList.toggle('on', cb.checked);
    cb.addEventListener('change', () => cb.closest('.pill').classList.toggle('on', cb.checked));
  });
}

// Tab activation — manages ARIA + keyboard
function activateTab(tabEl) {
  document.querySelectorAll('.tab').forEach(x => {
    x.classList.remove('active');
    x.setAttribute('aria-selected', 'false');
    x.setAttribute('tabindex', '-1');
  });
  tabEl.classList.add('active');
  tabEl.setAttribute('aria-selected', 'true');
  tabEl.setAttribute('tabindex', '0');
  mode = tabEl.dataset.tab;
  validateSearchForm();
}

// Event bindings
document.querySelectorAll('.tab').forEach(b => b.onclick = () => activateTab(b));

// Arrow key navigation within tablist
document.querySelector('[role="tablist"]').addEventListener('keydown', e => {
  const tabs = [...document.querySelectorAll('.tab')];
  const idx = tabs.indexOf(document.activeElement);
  if (idx === -1) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); const n = tabs[(idx + 1) % tabs.length]; n.focus(); activateTab(n); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); const n = tabs[(idx - 1 + tabs.length) % tabs.length]; n.focus(); activateTab(n); }
  if (e.key === 'Home') { e.preventDefault(); tabs[0].focus(); activateTab(tabs[0]); }
  if (e.key === 'End')  { e.preventDefault(); tabs[tabs.length-1].focus(); activateTab(tabs[tabs.length-1]); }
});

document.querySelectorAll('[data-fill-origin]').forEach(b => b.onclick = () => {
  setAirportInputValue('origin', b.dataset.fillOrigin);
  setPaTarget('dest');
});
document.querySelectorAll('[data-fill-dest]').forEach(b => b.onclick = () => {
  setAirportInputValue('dest', b.dataset.fillDest);
  setPaTarget('dest');
});
const addOriginBtn = document.getElementById('addOriginBtn');
if (addOriginBtn) addOriginBtn.addEventListener('click', addOrigin);
$('go').onclick = run;
{ const _eb = $('editSearchBtn'); if (_eb) _eb.onclick = expandSearch; }
$('oneWay').onchange = () => toggleReturn(false);
$('themeBtn').onclick = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

// Swap origin ⇄ destination
$('swapBtn').onclick = () => {
  const o = $('origin').value, d = $('dest').value;
  const ro = airportResolution.origin, rd = airportResolution.dest;
  $('origin').value = d; $('dest').value = o;
  airportResolution.origin = rd;
  airportResolution.dest = ro;
  searchTouched.origin = true;
  searchTouched.dest = true;
  updatePaCodes();
  validateSearchForm({ show: ['origin', 'dest'] });
};

// FROM / TO toggle — explicit target for airport chips
let paTarget = 'origin';

function setPaTarget(t) {
  paTarget = t;
  document.querySelectorAll('.pa-target').forEach(b => b.classList.toggle('active', b.dataset.target === t));
}

function normalizeAirportValue(value) {
  const v = String(value || '').trim();
  return /^[a-z]{3}$/i.test(v) ? v.toUpperCase() : v;
}

function setAirportInputValue(inputId, value) {
  const input = $(inputId);
  if (!input) return;
  input.value = normalizeAirportValue(value);
  setResolvedAirport(inputId, input.value);
  markSearchFieldTouched(inputId, { resolved: true, show: [inputId] });
  updatePaCodes();
}

function bindAirportTarget(inputId, target) {
  const input = $(inputId);
  if (!input) return;
  input.addEventListener('focus', () => setPaTarget(target));
  input.addEventListener('click', () => setPaTarget(target));
  input.addEventListener('input', () => {
    markSearchFieldTouched(inputId, { show: [inputId] });
    updatePaCodes();
  });
  input.addEventListener('blur', () => {
    input.value = normalizeAirportValue(input.value);
    markSearchFieldTouched(inputId, { show: [inputId] });
    updatePaCodes();
  });
}

document.querySelectorAll('.pa-target').forEach(b => {
  b.onclick = () => setPaTarget(b.dataset.target);
});

document.querySelectorAll('.pa-toggle').forEach(btn => {
  btn.onclick = () => {
    const group = btn.closest('.pa-group');
    if (!group) return;
    const expanded = group.classList.toggle('expanded');
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.textContent = expanded ? 'Show less' : 'Show more';
  };
});

// Mobile airport progressive disclosure: collapse all groups except DACH by default
(function() {
  const paCol = document.querySelector('.pa-col');
  if (!paCol) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pa-all-toggle';
  btn.textContent = 'Show all airports';
  paCol.appendChild(btn);
  function applyCompact() {
    const compact = window.innerWidth <= 640;
    paCol.classList.toggle('pa-col-compact', compact);
    if (compact) btn.textContent = 'Show all airports';
  }
  btn.addEventListener('click', function() {
    const nowCompact = paCol.classList.toggle('pa-col-compact');
    btn.textContent = nowCompact ? 'Show all airports' : 'Show fewer airports';
  });
  applyCompact();
})();

function updatePaCodes() {
  const destVal   = ($('dest').value   || '').toUpperCase().trim();
  const originVal = ($('origin').value || '').toUpperCase().trim();
  document.querySelectorAll('.pa-code').forEach(b => {
    b.classList.toggle('pa-active', b.dataset.code === destVal || b.dataset.code === originVal);
  });
}

document.querySelectorAll('.pa-code').forEach(b => {
  b.onclick = () => {
    closeAllAcDrops();
    const focusedId = document.activeElement?.id;
    const target = (focusedId === 'origin' || focusedId === 'dest') ? focusedId : paTarget;
    setAirportInputValue(target, b.dataset.code);
    // Auto-advance: after filling origin, target dest next
    if (target === 'origin') setPaTarget('dest');
  };
});

// Flex segmented control — mutually exclusive; re-runs search if results already shown
document.querySelectorAll('.flex-opt').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.flex-opt').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    if ($('results').children.length) runIfSearchValid();
  };
});

// Date preset chips
document.querySelectorAll('.date-chip').forEach(btn => {
  btn.onclick = () => applyDatePreset(btn.dataset.preset);
});

// Init Flatpickr
['origin', 'dest', 'date', 'returnDate'].forEach(id => {
  const input = $(id);
  if (input) input.value = '';
});
initDatepickers();
// Init return field visibility
toggleReturn(true);
validateSearchForm();

// Airport autocomplete
const debounce = (fn, ms = 250) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
function closeAllAcDrops(except) {
  ['ac-origin', 'ac-dest'].forEach(id => { if (id !== except) { const d = $(id); if (d) d.innerHTML = ''; } });
}

function renderAcDrop(dropId, inputId, items) {
  const drop = $(dropId);
  if (!drop) return;
  if (!items || !items.length) { drop.innerHTML = ''; return; }
  drop.innerHTML = items.map((x, i) =>
    `<div class="ac-item" role="option" tabindex="-1" data-value="${esc(x.value)}" data-idx="${i}">
      <span class="ac-code">${esc(x.value)}</span>
      <span class="ac-label">${esc(x.label)}</span>
    </div>`
  ).join('');
  drop.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('mousedown', ev => {
      ev.preventDefault();
      setAirportInputValue(inputId, el.dataset.value);
      if (inputId === 'origin') setPaTarget('dest');
      drop.innerHTML = '';
    });
  });
}


function initAC(inputEl, dropId) {
  const suggest = debounce(async () => {
    const q = inputEl.value;
    if (q.length < 2) { const d = $(dropId); if (d) d.innerHTML = ''; return; }
    const data = await fetch('/api/airports?q=' + encodeURIComponent(q) + '&lang=en').then(r => r.json()).catch(() => []);
    renderAcDrop(dropId, inputEl.id, data || []);
  }, 220);
  inputEl.addEventListener('input', suggest);
  inputEl.addEventListener('blur', () => setTimeout(() => { const d = $(dropId); if (d) d.innerHTML = ''; }, 150));
  inputEl.addEventListener('keydown', e => {
    const drop = $(dropId);
    if (!drop) return;
    const items = drop.querySelectorAll('.ac-item');
    if (!items.length) return;
    const active = drop.querySelector('.ac-item.ac-active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? (active.nextElementSibling || items[0]) : items[0];
      if (active) active.classList.remove('ac-active');
      next.classList.add('ac-active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? (active.previousElementSibling || items[items.length - 1]) : items[items.length - 1];
      if (active) active.classList.remove('ac-active');
      prev.classList.add('ac-active');
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      setAirportInputValue(inputEl.id, active.dataset.value);
      if (inputEl.id === 'origin') setPaTarget('dest');
      drop.innerHTML = '';
    } else if (e.key === 'Escape') {
      drop.innerHTML = '';
    }
  });
}

bindAirportTarget('origin', 'origin');
bindAirportTarget('dest', 'dest');
['origin', 'dest'].forEach(id => initAC($(id), 'ac-' + id));

document.addEventListener('click', e => {
  if (!e.target.closest('label[for="origin"]')) { const d = $('ac-origin'); if (d) d.innerHTML = ''; }
  if (!e.target.closest('label[for="dest"]')) { const d = $('ac-dest'); if (d) d.innerHTML = ''; }
});

// Globe animation
function globeAnimation() {
  const c = $('globe');
  const ctx = c.getContext('2d');
  let w, h, rot = 0;
  const isMobile = () => innerWidth <= 640;
  const MOBILE_GLOBE_H = 260; // fallback only — matches CSS !important height

  // Top-50 Airports nach ACI-Passagieraufkommen, in Rang-Reihenfolge —
  // die Reihenfolge ist zugleich die Label-Priorität bei Kollisionen.
  const airports = AWARDRADAR_AIRPORTS;
  const AP_IDX = {};
  airports.forEach((a, i) => { AP_IDX[a[2]] = i; });

  // Always-on showcase routes by IATA (index-independent), t staggered so the
  // planes are spread along their arcs instead of departing simultaneously.
  const flights = [
    ['FRA', 'JFK', 0.10, 0.0016],
    ['LHR', 'HND', 0.45, 0.0013],
    ['FRA', 'SIN', 0.70, 0.0014],
    ['MUC', 'DXB', 0.25, 0.0018],
    ['CDG', 'LAX', 0.85, 0.0015],
    ['DXB', 'SYD', 0.55, 0.0011],
    ['JFK', 'GRU', 0.30, 0.0015],
  ].map(([from, to, t, speed]) => ({ route: [AP_IDX[from], AP_IDX[to]], t, speed }));

  function size() {
    // Backing store must match the CSS box exactly — innerWidth includes the
    // scrollbar and the mobile CSS height (260px) differs from the old constant,
    // both of which stretched the raster and shifted every drawn element.
    const rect = c.getBoundingClientRect();
    const cssW = rect.width || innerWidth;
    const cssH = rect.height || (isMobile() ? MOBILE_GLOBE_H : innerHeight);
    w = c.width = Math.round(cssW * devicePixelRatio);
    h = c.height = Math.round(cssH * devicePixelRatio);
  }
  addEventListener('resize', size);
  size();

  // Pointer coords must be canvas-relative: on mobile the canvas sits below
  // the navbar, so raw clientX/clientY are offset against the drawn globe.
  const canvasPos = (clientX, clientY) => {
    const r = c.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  };

  // Drag-to-spin interaction
  let dragging = false, dragX = 0, velX = 0, autoSpin = false;
  let hoveredAirport = null, mouseX = 0, mouseY = 0;
  const R_screen = () => isMobile() ? Math.max(w, h) * 0.75 : Math.max(w, h) * 0.75;
  const cx_screen = () => w * 0.50;
  const cy_screen = () => isMobile() ? h * 0.50 : h * 0.50;

  function onDragStart(x, y) {
    const dx = x * devicePixelRatio - w * 0.50;
    const dy = y * devicePixelRatio - cy_screen();
    if (Math.sqrt(dx*dx + dy*dy) > R_screen() * 1.4) return;
    dragging = true; dragX = x; velX = 0; autoSpin = false;
    c.style.cursor = 'grabbing';
  }
  function onDragMove(x) {
    if (!dragging) return;
    const delta = (x - dragX) / (innerWidth * 0.5);
    rot -= delta * Math.PI;
    velX = -(delta * Math.PI);
    dragX = x;
  }
  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    c.style.cursor = 'grab';
    // Keep the map itself still; the result canvas drifts as a whole via CSS.
    clearTimeout(c._resumeTimer);
    autoSpin = false;
  }

  // Enable pointer events on canvas — only pass through clicks outside globe
  c.classList.add('interactive');
  c.addEventListener('mousedown', e => {
    const [px, py] = canvasPos(e.clientX, e.clientY);
    onDragStart(px, py);
    if (!dragging) return; // outside globe — let event fall through
  });
  c.addEventListener('mousemove', e => {
    [mouseX, mouseY] = canvasPos(e.clientX, e.clientY);
    onDragMove(e.clientX);
    // Update cursor based on position
    const dx = mouseX * devicePixelRatio - w * 0.50;
    const dy = mouseY * devicePixelRatio - cy_screen();
    const inside = Math.sqrt(dx*dx + dy*dy) < R_screen() * 1.2;
    if (!dragging) c.style.cursor = inside ? 'grab' : 'default';
  });
  addEventListener('mousemove', e => { [mouseX, mouseY] = canvasPos(e.clientX, e.clientY); onDragMove(e.clientX); });
  addEventListener('mouseup', onDragEnd);
  let touchStartX = 0, touchStartY = 0, touchMoved = false;
  c.addEventListener('touchstart', e => {
    e.preventDefault();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
    const [px, py] = canvasPos(e.touches[0].clientX, e.touches[0].clientY);
    onDragStart(px, py);
  }, { passive: false });
  addEventListener('touchmove', e => {
    if (dragging) {
      e.preventDefault();
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) touchMoved = true;
      onDragMove(e.touches[0].clientX);
    }
  }, { passive: false });
  addEventListener('touchend', e => {
    // Tap without drag: set mouseX/mouseY for tooltip for 1.5s
    if (!touchMoved && isMobile()) {
      const t = e.changedTouches[0];
      [mouseX, mouseY] = canvasPos(t.clientX, t.clientY);
      clearTimeout(c._tapTimer);
      c._tapTimer = setTimeout(() => { mouseX = -999; mouseY = -999; }, 1500);
    }
    onDragEnd();
  });

  // Route pulse state
  let pulseRoute = null; // { from, to, startTime, duration }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) autoSpin = false; // freeze rotation — loop still runs to prevent iOS canvas-clear

  // Adaptive quality for older devices
  let fpsAvg = 60, lastFrameTime = performance.now(), frameCount = 0;
  const lowPerf = () => fpsAvg < 45 && isMobile();

  window.globePulseRoute = function(originCode, destCode) {
    const from = airports.find(a => a[2] === originCode);
    const to   = airports.find(a => a[2] === destCode);
    if (!from || !to) return;
    pulseRoute = { from, to, startTime: performance.now(), duration: reducedMotion ? 0 : 3000 };
  };

  function project(lat, lon) {
    const phi = lat * Math.PI / 180;
    const lam = (lon * Math.PI / 180) + rot;
    const px = Math.cos(phi) * Math.sin(lam);
    const py = Math.sin(phi);
    const pz = Math.cos(phi) * Math.cos(lam);
    const tilt = 0.28;
    const y2 = py * Math.cos(tilt) - pz * Math.sin(tilt);
    const z2 = py * Math.sin(tilt) + pz * Math.cos(tilt);
    const mob = isMobile();
    const R = Math.min(w, h) * (mob ? 0.90 : 0.85);
    const cx = w * 0.50;
    const cy = mob ? h * 0.50 : h * 0.50;
    return { x: cx + px * R, y: cy - y2 * R, z: z2, R, cx, cy };
  }

  function slerp(a, b, t) {
    const r = x => x * Math.PI / 180;
    const p1 = [Math.cos(r(a[0])) * Math.cos(r(a[1])), Math.sin(r(a[0])), Math.cos(r(a[0])) * Math.sin(r(a[1]))];
    const p2 = [Math.cos(r(b[0])) * Math.cos(r(b[1])), Math.sin(r(b[0])), Math.cos(r(b[0])) * Math.sin(r(b[1]))];
    const dot = Math.min(1, Math.max(-1, p1[0]*p2[0] + p1[1]*p2[1] + p1[2]*p2[2]));
    const omega = Math.acos(dot);
    if (omega < 0.001) return [a[0], a[1]];
    const s = Math.sin(omega);
    const pa = Math.sin((1 - t) * omega) / s;
    const pb = Math.sin(t * omega) / s;
    const x = pa*p1[0] + pb*p2[0];
    const y = pa*p1[1] + pb*p2[1];
    const z = pa*p1[2] + pb*p2[2];
    return [Math.atan2(y, Math.sqrt(x*x + z*z)) * 180/Math.PI, Math.atan2(z, x) * 180/Math.PI];
  }

  // Simplified continent outlines [lat, lon] — drawn as stroked paths on the globe
  // Land polygons loaded from world-land.js (Natural Earth 110m, self-hosted).
  // Falls back to empty array gracefully if script not loaded.
  const LAND_POLYS = (typeof WORLD_LAND !== 'undefined') ? WORLD_LAND : [];

  // Major city clusters for night lights (dark mode)
  const NIGHT_CITIES = [
    // Europe (Populated, warm golden glow)
    [51.5,-0.1, 2.8],[48.9,2.3, 2.5],[52.5,13.4, 2.0],[41.9,12.5, 1.8],[40.4,-3.7, 1.9],[50.1,8.7, 2.1],
    [48.2,16.4, 1.5],[47.5,19.0, 1.4],[55.8,37.6, 2.8],[59.9,30.3, 1.6],[52.2,21.0, 1.3],[50.1,14.4, 1.3],
    [59.3,18.1, 1.4],[55.7,12.6, 1.2],[38.7,-9.1, 1.3],
    // North America (Dense East/West coast clusters)
    [40.7,-74.0, 3.2],[34.0,-118.2, 3.0],[41.8,-87.6, 2.4],[29.8,-95.4, 2.2],[33.7,-84.4, 2.1],[42.4,-71.1, 2.0],
    [45.5,-73.6, 1.6],[43.7,-79.4, 1.9],[37.8,-122.4, 2.2],[47.6,-122.3, 1.8],[25.8,-80.3, 2.0],
    // East Asia (Mega-metropolis density)
    [35.7,139.7, 3.8],[34.7,135.5, 2.8],[37.6,127.0, 2.6],[39.9,116.4, 3.0],[31.2,121.5, 3.2],
    [23.1,113.3, 2.7],[22.3,114.2, 2.8],[1.3,103.9, 2.4],[3.1,101.7, 1.7],
    // South/SE Asia
    [28.6,77.2, 2.8],[19.1,72.9, 2.6],[12.9,77.6, 2.1],[13.8,100.5, 2.2],[14.1,121.0, 2.1],
    // Middle East
    [25.3,55.4, 2.5],[24.7,46.7, 1.8],[30.1,31.4, 2.2],
    // South America
    [-23.5,-46.6, 2.8],[-34.6,-58.4, 2.3],[-22.9,-43.2, 2.2],
    // Australia
    [-33.9,151.2, 1.9],[-37.8,145.0, 1.7]
  ];

  function frame() {
    // FPS tracking for adaptive quality
    const now = performance.now();
    frameCount++;
    if (frameCount % 30 === 0) {
      const elapsed = now - lastFrameTime;
      fpsAvg = 30000 / elapsed;
      lastFrameTime = now;
    }

    if (dragging) {
      // velX already applied in onDragMove
    } else if (Math.abs(velX) > 0.0001) {
      rot += velX;
      velX *= 0.88; // friction
    } else if (autoSpin) {
      rot += 0.00003;
    }
    ctx.clearRect(0, 0, w, h);

    const isLight = document.documentElement.dataset.theme === 'light';
    const lineColor  = isLight ? [8, 72, 120]    : [184,196,212];
    const ringAlpha  = isLight ? 0.55 : 0.18;
    const latEqAlpha = isLight ? 0.42 : 0.01;
    const latAlpha   = isLight ? 0.22 : 0.005;
    const lonAlpha   = isLight ? 0.14 : 0.005;
    const glowColor  = isLight ? '8,72,120'     : '223,196,147';
    const glowAlpha  = isLight ? 0.06 : 0.05;
    const arcAlpha   = isLight ? 0.55 : 0.20;
    const dotColor   = isLight ? '8,72,120'     : '223,196,147';
    const dotAlpha   = isLight ? 0.70 : 0.45;
    const lblColor   = isLight ? '100,55,8'     : '223,196,147';
    const [lr,lg,lb] = lineColor;

    const mob = isMobile();
    const R = Math.min(w, h) * (mob ? 0.90 : 0.85);
    const cx = w * 0.50;
    const cy = mob ? h * 0.50 : h * 0.50;

    // Deep ocean base fill
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    if (isLight) {
      ctx.fillStyle = 'rgba(185,215,240,0.55)';
    } else {
      ctx.fillStyle = 'rgba(1, 2, 5, 0.95)';
    }
    ctx.fill();

    // Sphere sheen — highlight from upper-left
    const sphereFill = ctx.createRadialGradient(cx - R*0.28, cy - R*0.28, R*0.04, cx, cy, R);
    if (isLight) {
      sphereFill.addColorStop(0, 'rgba(255,255,255,0.28)');
      sphereFill.addColorStop(0.5, 'rgba(180,215,240,0.08)');
      sphereFill.addColorStop(1, 'rgba(100,155,210,0.18)');
    } else {
      sphereFill.addColorStop(0, 'rgba(0,0,0,0.92)');
      sphereFill.addColorStop(0.8, 'rgba(2,5,12,0.9)');
      sphereFill.addColorStop(1, 'rgba(10,25,50,0.4)');
    }
    ctx.fillStyle = sphereFill;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // Atmosphere glow — multi-stop, wider halo
    const atmoInner = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.0);
    atmoInner.addColorStop(0, 'transparent');
    atmoInner.addColorStop(1, isLight ? `rgba(80,140,220,0.18)` : `rgba(180,215,255,0.35)`);
    ctx.fillStyle = atmoInner;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, 0, Math.PI * 2); ctx.fill();

    // Cap the halo so it fades out inside the canvas — on mobile the canvas is
    // only ~260px tall and an uncapped 2.2R glow gets cut into a hard rectangle.
    const atmoOuterR = R * 1.35;
    const atmoOuter = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, atmoOuterR);
    atmoOuter.addColorStop(0, isLight ? `rgba(80,140,220,0.16)` : `rgba(140,195,255,0.28)`);
    atmoOuter.addColorStop(0.15, isLight ? `rgba(80,140,220,0.07)` : `rgba(100,145,220,0.05)`);
    // atmoOuter.addColorStop(0.7, ...)
    atmoOuter.addColorStop(1, 'transparent');
    ctx.fillStyle = atmoOuter;
    ctx.beginPath(); ctx.arc(cx, cy, atmoOuterR, 0, Math.PI * 2); ctx.fill();

    // Globe ring
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${ringAlpha * 0.05})`;
    ctx.lineWidth = (isLight ? 1.6 : 1.4) * devicePixelRatio;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // Continent fills with true horizon clipping: hidden stretches of a ring
    // are replaced by arcs along the limb circle, connected in rim order.
    // This is the only fill approach that produces neither straight chords
    // nor rim blobs while the globe rotates.
    const landFill    = isLight ? 'rgba(180,210,230,0.46)' : 'rgba(0, 0, 0, 0.4)';
    const coastStroke = isLight ? 'rgba(120,150,180,0.45)' : 'rgba(40,60,90,0.02)';
    const TAU = Math.PI * 2;

    const buildLandFillPath = (poly) => {
      const pts = [];
      let anyVis = false, anyHid = false;
      for (const [lat, lon] of poly) {
        const p = project(lat, lon);
        pts.push(p);
        if (p.z > 0) anyVis = true; else anyHid = true;
      }
      if (!anyVis) return false;
      ctx.beginPath();
      if (!anyHid) {
        for (let i = 0; i < pts.length; i++) i ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y);
        ctx.closePath();
        return true;
      }
      // Visible runs with rim crossing points at both ends
      const n = pts.length;
      const rimPoint = (pVis, pHid) => {
        const t = pVis.z / (pVis.z - pHid.z);
        let x = pVis.x + (pHid.x - pVis.x) * t, y = pVis.y + (pHid.y - pVis.y) * t;
        const dx = x - cx, dy = y - cy, len = Math.sqrt(dx * dx + dy * dy) || 1;
        x = cx + dx / len * R; y = cy + dy / len * R;
        return { x, y, ang: Math.atan2(y - cy, x - cx) };
      };
      const runs = [];
      for (let i = 0; i < n; i++) {
        if (pts[i].z > 0 && pts[(i + n - 1) % n].z <= 0) {
          const idx = [];
          let j = i;
          while (pts[j].z > 0) { idx.push(j); j = (j + 1) % n; }
          runs.push({
            idx,
            entry: rimPoint(pts[i], pts[(i + n - 1) % n]),
            exit:  rimPoint(pts[idx[idx.length - 1]], pts[j]),
            used: false,
          });
        }
      }
      if (!runs.length) return false;
      // Stitch runs: leave each exit along the rim (canvas-clockwise) to the
      // nearest entry — matches the ring winding of the Natural Earth data.
      for (const start of runs) {
        if (start.used) continue;
        let r = start;
        ctx.moveTo(r.entry.x, r.entry.y);
        for (;;) {
          r.used = true;
          for (const i of r.idx) ctx.lineTo(pts[i].x, pts[i].y);
          let best = null, bestD = Infinity;
          for (const q of runs) {
            let d = ((q.entry.ang - r.exit.ang) % TAU + TAU) % TAU;
            if (d < 1e-9) d = TAU;
            if (d < bestD) { bestD = d; best = q; }
          }
          ctx.arc(cx, cy, R, r.exit.ang, r.exit.ang + bestD, false);
          if (best === start || best.used) { ctx.closePath(); break; }
          r = best;
        }
      }
      return true;
    };

    // Coast stroke: visible segments only, never closed — no chords, no rim trace
    const strokeCoast = (poly) => {
      ctx.beginPath();
      let wasVis = false;
      for (const [lat, lon] of poly) {
        const p = project(lat, lon);
        if (p.z > 0) {
          if (!wasVis) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          wasVis = true;
        } else wasVis = false;
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 0.5 * devicePixelRatio, 0, TAU); ctx.clip();
    LAND_POLYS.forEach(poly => {
      if (buildLandFillPath(poly)) { ctx.fillStyle = landFill; ctx.fill(); }
      ctx.strokeStyle = coastStroke;
      ctx.lineWidth = 0.75 * devicePixelRatio;
      strokeCoast(poly);
    });
    ctx.restore();

    // Lat lines (reduced step on low-perf mobile)
    const gridStep = lowPerf() ? 6 : 3;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let first = true;
      for (let lon = -180; lon <= 180; lon += gridStep) {
        const p = project(lat, lon);
        if (p.z > 0) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
        else first = true;
      }
      ctx.strokeStyle = isLight ? `rgba(${lr},${lg},${lb},${lat === 0 ? latEqAlpha : latAlpha})` : 'transparent';
      ctx.lineWidth = 0.7 * devicePixelRatio;
      ctx.stroke();
    }

    // Lon lines
    for (let lon = 0; lon < 360; lon += 30) {
      ctx.beginPath();
      let first = true;
      for (let lat = -85; lat <= 85; lat += gridStep) {
        const p = project(lat, lon);
        if (p.z > 0) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
        else first = true;
      }
      ctx.strokeStyle = isLight ? `rgba(${lr},${lg},${lb},${lonAlpha})` : 'transparent';
      ctx.stroke();
    }

    // Flight arcs + planes
    flights.forEach(f => {
      const from = airports[f.route[0]];
      const to = airports[f.route[1]];

      // Arc — glow pass then crisp line
      const arcPts = [];
      for (let i = 0; i <= 80; i++) {
        const pt = slerp(from, to, i / 80);
        arcPts.push(project(pt[0], pt[1]));
      }
      const drawArcPath = () => {
        ctx.beginPath();
        let first = true;
        for (const p of arcPts) {
          if (p.z > 0) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
          else first = true;
        }
      };
      // Glow layer
      drawArcPath();
      ctx.lineWidth = 4.5 * devicePixelRatio;
      ctx.strokeStyle = `rgba(255,180,80,${arcAlpha * 0.8})`;
      ctx.setLineDash([]);
      ctx.stroke();
      // Main arc — solid, thin
      drawArcPath();
      ctx.lineWidth = 1.2 * devicePixelRatio;
      ctx.strokeStyle = `rgba(255,200,100,${arcAlpha * 1.5})`;
      ctx.setLineDash([4 * devicePixelRatio, 5 * devicePixelRatio]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Plane position — frozen with reduced motion (loop keeps repainting)
      if (!reducedMotion) f.t = (f.t + f.speed) % 1;
      const pos = slerp(from, to, f.t);
      const p = project(pos[0], pos[1]);

      if (p.z > 0.12) {
        const next = slerp(from, to, Math.min(f.t + 0.018, 1));
        const np = project(next[0], next[1]);
        const angle = Math.atan2(np.y - p.y, np.x - p.x);
        const alpha = 0.4 + p.z * 0.55;
        const sz = 5 * devicePixelRatio;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.fillStyle = `rgba(245,199,107,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(sz * 2.2, 0);
        ctx.lineTo(-sz * 0.8, sz * 0.9);
        ctx.lineTo(-sz * 0.3, 0);
        ctx.lineTo(-sz * 0.8, -sz * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Pulse dot behind plane
        ctx.fillStyle = `rgba(245,199,107,${alpha * 0.25})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, sz * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Route pulse after search
    if (pulseRoute) {
      const elapsed = performance.now() - pulseRoute.startTime;
      const progress = Math.min(1, elapsed / pulseRoute.duration);
      if (progress >= 1) {
        pulseRoute = null;
      } else {
        // Fade in 0→0.3s, hold 0.3→2.5s, fade out 2.5→3s
        let alpha;
        if (elapsed < 300)       alpha = elapsed / 300;
        else if (elapsed < 2500) alpha = 1;
        else                     alpha = 1 - (elapsed - 2500) / 500;
        // Gentle pulse on top of the fade (0.85–1.0 range)
        const pulse = 0.85 + 0.15 * Math.sin(elapsed / 220);
        alpha *= pulse;

        const col = isLight ? '13,110,138' : '106,215,255';
        const { from, to } = pulseRoute;

        // Bright arc
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.lineWidth = 2.2 * devicePixelRatio;
        ctx.strokeStyle = `rgba(${col},${alpha * 0.9})`;
        let firstPt = true;
        for (let i = 0; i <= 100; i++) {
          const pt = slerp(from, to, i / 100);
          const p = project(pt[0], pt[1]);
          if (p.z > 0) { if (firstPt) { ctx.moveTo(p.x, p.y); firstPt = false; } else ctx.lineTo(p.x, p.y); }
          else firstPt = true;
        }
        ctx.stroke();

        // Glow layer
        ctx.lineWidth = 5 * devicePixelRatio;
        ctx.strokeStyle = `rgba(${col},${alpha * 0.18})`;
        firstPt = true;
        for (let i = 0; i <= 100; i++) {
          const pt = slerp(from, to, i / 100);
          const p = project(pt[0], pt[1]);
          if (p.z > 0) { if (firstPt) { ctx.moveTo(p.x, p.y); firstPt = false; } else ctx.lineTo(p.x, p.y); }
          else firstPt = true;
        }
        ctx.stroke();

        // Endpoint dots
        [[from[0], from[1]], [to[0], to[1]]].forEach(([lat, lon]) => {
          const p = project(lat, lon);
          if (p.z <= 0) return;
          ctx.fillStyle = `rgba(${col},${alpha})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(${col},${alpha * 0.22})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 10 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
        });
      }
    }

    // Night city lights — warm amber glow dots, dark mode only
    if (!isLight) {
      NIGHT_CITIES.forEach(([lat, lon, size]) => {
        const p = project(lat, lon);
        if (p.z <= 0.05) return;
        const weight = size || 1.0;
        const a = Math.min(1, (p.z - 0.05) * 3.5) * 0.88;
        const r = 2.4 * devicePixelRatio * weight;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 8.0);
        grd.addColorStop(0, `rgba(255,220,130,${a * 1.6})`);
        grd.addColorStop(0.15, `rgba(255,170,40,${a * 1.2})`);
        grd.addColorStop(0.4, `rgba(220,100,10,${a * 0.6})`);
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 8.0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,250,220,${a * 1.8})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 * devicePixelRatio * Math.sqrt(weight), 0, Math.PI * 2); ctx.fill();
      });
    }

    // Airport dots + IATA labels
    ctx.font = `600 ${Math.round(9.5 * devicePixelRatio)}px Inter,ui-sans-serif,sans-serif`;
    const hitR = 14 * devicePixelRatio;
    hoveredAirport = null;
    // Dots always draw; labels are placed in airport-priority order (array
    // order = ACI rank) and a lower-ranked label is suppressed when it would
    // collide with one already placed — the dot and hover tooltip remain.
    const placedLabels = [];
    const labW = 26 * devicePixelRatio, labH = 12 * devicePixelRatio;
    airports.forEach(([lat, lon, iata, city]) => {
      const p = project(lat, lon);
      if (p.z <= 0) return;
      const a = Math.min(1, p.z * 3.5);

      // Hover detection
      const mx = mouseX * devicePixelRatio, my = mouseY * devicePixelRatio;
      const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2);
      const hovered = !dragging && dist < hitR;
      if (hovered) hoveredAirport = { iata, city, px: p.x, py: p.y };

      // Glow (larger when hovered)
      const glowR = hovered ? 10 * devicePixelRatio : 6 * devicePixelRatio;
      const dg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      dg.addColorStop(0, `rgba(${dotColor},${(hovered ? 0.7 : 0.45) * a})`);
      dg.addColorStop(1, 'transparent');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fill();

      // Dot (larger when hovered)
      const dotR = hovered ? 3.4 * devicePixelRatio : 2.2 * devicePixelRatio;
      ctx.fillStyle = `rgba(${dotColor},${(hovered ? 1 : dotAlpha) * a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill();

      // Label — skip if it would overlap a higher-priority one already placed
      const lx = p.x + 5 * devicePixelRatio, ly = p.y - 4 * devicePixelRatio;
      const collides = placedLabels.some(r =>
        lx < r.x + r.w && lx + labW > r.x && ly - labH < r.y + r.h && ly > r.y);
      if (hovered || !collides) {
        placedLabels.push({ x: lx, y: ly - labH, w: labW, h: labH });
        ctx.fillStyle = `rgba(${lblColor},${0.7 * a})`;
        ctx.fillText(iata, lx, ly);
      }
    });

    // Tooltip
    if (hoveredAirport) {
      const { iata, city, px, py } = hoveredAirport;
      const dpr = devicePixelRatio;
      const pad = 10 * dpr, gap = 14 * dpr;
      ctx.font = `700 ${Math.round(11 * dpr)}px Inter,ui-sans-serif,sans-serif`;
      const iataW = ctx.measureText(iata).width;
      ctx.font = `500 ${Math.round(10 * dpr)}px Inter,ui-sans-serif,sans-serif`;
      const cityW = ctx.measureText(city).width;
      const boxW = Math.max(iataW, cityW) + pad * 2;
      const boxH = 36 * dpr;
      let bx = px + gap, by = py - boxH / 2;
      if (bx + boxW > w - 8 * dpr) bx = px - gap - boxW;
      if (by < 4 * dpr) by = 4 * dpr;
      if (by + boxH > h - 4 * dpr) by = h - boxH - 4 * dpr;

      // Box
      ctx.fillStyle = isLight ? 'rgba(10,22,40,0.88)' : 'rgba(6,16,31,0.88)';
      const r = 6 * dpr;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, r);
      ctx.fill();

      // IATA
      ctx.fillStyle = '#f5c76b';
      ctx.font = `700 ${Math.round(11 * dpr)}px Inter,ui-sans-serif,sans-serif`;
      ctx.fillText(iata, bx + pad, by + 14 * dpr);

      // City
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = `500 ${Math.round(10 * dpr)}px Inter,ui-sans-serif,sans-serif`;
      ctx.fillText(city, bx + pad, by + 28 * dpr);

      c.style.cursor = 'pointer';
    } else if (!dragging) {
      c.style.cursor = 'grab';
    }

    // Always loop — iOS clears canvas on scroll if rAF stops.
    // With reducedMotion: rot is frozen (no spin/movement), loop just repaints static globe.
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

initDates();
syncPills();
setStatus('ready');
// On mobile: always show globe (static snapshot if reduced-motion, animated otherwise)
// On desktop: skip globe when reduced-motion (it's a background decoration there)
const _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!_reducedMotion || innerWidth <= 640) globeAnimation();

// Safety net: if canvas stayed empty after 800ms, show icon fallback
if (innerWidth <= 640) {
  setTimeout(function() {
    const canvas = document.getElementById('globe');
    if (!canvas || canvas.width > 0) return;
    const wrap = document.getElementById('globe-wrap');
    if (wrap) {
      const markSrc = document.documentElement.getAttribute('data-theme') === 'light'
        ? '/static/logo-mark-light.svg'
        : '/static/logo-mark.svg';
      wrap.innerHTML = '<img src="' + markSrc + '" alt="" style="width:200px;height:200px;display:block;margin:30px auto;opacity:.7">';
    }
  }, 800);
}

// ===== Discovery Widget helpers =====
function discoveryText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function discoveryNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function discoveryBool(value) {
  return value === true || value === 'true';
}

function discoverySafeUrl(value) {
  const raw = discoveryText(value);
  if (!raw) return '';
  try {
    const base = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'https://awardradar.app';
    const url = new URL(raw, base);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
  } catch (_) {
    return '';
  }
}

function normalizeDiscoveryOpportunity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const origin = discoveryText(raw.origin).toUpperCase();
  const dest = discoveryText(raw.dest).toUpperCase();
  if (!origin || !dest) return null;
  return {
    airlines: discoveryText(raw.airlines),
    available_date: discoveryText(raw.available_date),
    cabin: discoveryText(raw.cabin, 'Economy'),
    cash_eur: discoveryNumber(raw.cash_eur),
    cpm: discoveryNumber(raw.cpm),
    dest,
    direct: discoveryBool(raw.direct),
    grade_label: discoveryText(raw.grade_label),
    grade_tier: discoveryText(raw.grade_tier, 'great').toLowerCase(),
    miles: discoveryNumber(raw.miles),
    origin,
    program: discoveryText(raw.program, 'Award program'),
    reasoning: discoveryText(raw.reasoning),
    recommendation: discoveryText(raw.recommendation),
    seats: discoveryNumber(raw.seats),
    surcharge: discoveryNumber(raw.surcharge),
    url: discoverySafeUrl(raw.url),
  };
}

function formatDiscoveryMiles(value) {
  const miles = discoveryNumber(value);
  return formatMiles(miles);
}

function formatDiscoveryFees(value) {
  const fees = discoveryNumber(value);
  return fees === null ? '' : ` + ${formatMoney(fees)}`;
}

function discoveryReason(o) {
  const isPremium = /business|first/i.test(o.cabin || '');
  const highFees = (o.surcharge || 0) > 300;
  if (!o.cpm) return o.reasoning ? esc(o.reasoning) : null;
  if (o.cpm >= 4.0) return isPremium ? 'Exceptionally low mileage for a premium cabin.' : 'Far below typical cost for this route.';
  if (o.cpm >= 2.5) return highFees ? 'Strong value despite elevated fees.' : 'Well above average redemption value.';
  if (o.cpm >= 1.8) return isPremium ? 'Solid value for a premium cabin.' : 'Good miles efficiency on this route.';
  return o.reasoning ? esc(o.reasoning) : null;
}

// ===== Discovery Widget =====
(function initDiscovery() {
  const container = $('discovery-cards');
  if (!container) return;

  const SIGNAL_LABEL = { exceptional: 'Strong award signal', great: 'Award signal' };
  // Decision Contract V1 verdict vocabulary; unknown values fall back to the
  // verification-oriented label.
  const REC_LABEL  = {
    miles_value_supported: 'Verify miles option', miles_value_leaning: 'Lean towards Miles',
    comparison_inconclusive: 'Compare options', cash_value_supported: 'Compare cash option',
  };

  function renderCards(opps) {
    const cards = [];
    (Array.isArray(opps) ? opps : []).forEach((raw, index) => {
      let o;
      try {
        o = normalizeDiscoveryOpportunity(raw);
      } catch (err) {
        console.warn('Skipping malformed top opportunity item.', err && err.message ? err.message : err);
        return;
      }
      if (!o) return;
      const tier = SIGNAL_LABEL[o.grade_tier] ? o.grade_tier : 'great';
      const tierLabel = SIGNAL_LABEL[tier] || 'Award signal';
      const recLbl = REC_LABEL[o.recommendation] || 'Verify miles option';
      const reason = discoveryReason(o);
      const roundedSeats = o.seats === null ? null : Math.round(o.seats);
      const seatsLbl = roundedSeats && roundedSeats > 0 ? `${roundedSeats} seat${roundedSeats !== 1 ? 's' : ''} available` : '';
      const airlineLbl = o.airlines ? `Airline signal: ${o.airlines}` : '';
      const metaLine = [o.direct ? 'Provider reports direct availability' : '', seatsLbl, airlineLbl, o.available_date ? `Date: ${formatTripDate(o.available_date)}` : ''].filter(Boolean).join(' - ');
      const milesLine = `${formatDiscoveryMiles(o.miles)}${formatDiscoveryFees(o.surcharge)}`;
      const originLiteral = JSON.stringify(o.origin);
      const destLiteral = JSON.stringify(o.dest);
      const ctaClick = `(function(){` +
        `var f=$('origin');var t=$('dest');` +
        `if(f)f.value=${originLiteral};if(t)t.value=${destLiteral};` +
        `switchTabAndRun('awards');` +
        `})();return false;`;

      cards.push(`<div class="disc-card disc-card-${tier}" role="article" data-disc-index="${index}">
        <div class="disc-route-row">
          <span class="disc-route">${esc(o.origin)} &rarr; ${esc(o.dest)}</span>
          <span class="disc-cabin-pill">${esc(o.cabin)}</span>
        </div>
        <div class="disc-verdict-row">
          <span class="disc-tier-label">${esc(tierLabel)}</span>
        </div>
        <div class="disc-rec-label">&nearr; ${esc(recLbl)}</div>
        <div class="disc-offer-row">
          <span class="disc-program">${esc(o.program)}</span><span class="disc-sep"> - </span><span class="disc-miles-val">${esc(milesLine)}</span>
        </div>
        ${metaLine ? `<div class="disc-meta">${esc(metaLine)}</div>` : ''}
        ${reason ? `<div class="disc-reason">${reason}</div>` : ''}
        <div class="disc-footer-row">
          <span class="disc-conf disc-conf-live">Current availability signal</span>
          ${o.cpm ? `<span class="disc-cpm">${formatCpm(o.cpm)}</span>` : ''}
        </div>
        <a href="#" class="disc-cta-btn" onclick="${esc(ctaClick)}">Review value signal &rarr;</a>
      </div>`);
    });
    if (!cards.length) {
      container.innerHTML = `<div class="disc-empty">
        <div class="disc-empty-title">No strong opportunity signals are available right now.</div>
        New opportunities are continuously scanned.
      </div>`;
      return;
    }
    container.innerHTML = cards.join('');
  }

  function renderError() {
    container.innerHTML = `<div class="disc-error">
      <div class="disc-error-title">Current award signals are temporarily unavailable.</div>
      Check back soon.
    </div>`;
  }

  // Frozen legacy surface: discovery rendering is retained, but no provider-backed
  // opportunities are loaded automatically on page load, viewport entry, or a timer.
})();
