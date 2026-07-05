const $ = id => document.getElementById(id);

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
function buildItinerary(f) {
  if (!f) return '';
  // Summary line
  const sumParts = [];
  if (f.flight_number) sumParts.push(`<span class="aw-fs-fn">${esc(f.flight_number)}</span>`);
  if (f.dep_time && f.arr_time) sumParts.push(`<span class="aw-fs-times">${esc(f.dep_time)} → ${esc(f.arr_time)}</span>`);
  if (f.duration) sumParts.push(`<span class="aw-fs-dur">${esc(f.duration)}</span>`);
  if (f.stops === 0) sumParts.push('<span class="aw-fs-nonstop">Nonstop</span>');
  else if (f.stops > 0) {
    const viaStr = (f.via || []).join(' · ');
    sumParts.push(`<span class="aw-fs-stops">${f.stops} stop${f.stops > 1 ? 's' : ''}${viaStr ? ' · ' + esc(viaStr) : ''}</span>`);
  }

  // Badges (P3)
  const badges = [];
  if (f.stops === 0) badges.push('<span class="aw-badge aw-badge-nonstop">Nonstop</span>');
  if ((f.layovers || []).some(l => l.duration_min > 0 && l.duration_min < 60)) badges.push('<span class="aw-badge aw-badge-warn">Short connection</span>');
  if ((f.segments || []).some(s => s.overnight)) badges.push('<span class="aw-badge aw-badge-warn">Overnight</span>');
  if ((f.layovers || []).some(l => l.duration_min >= 240)) badges.push('<span class="aw-badge aw-badge-muted">Long layover</span>');

  // Segment detail (P2) — only for connecting flights
  let detail = '';
  if (f.stops > 0 && (f.segments || []).length > 1) {
    const segsHtml = f.segments.map((seg, i) => {
      const stub = aircraftStub(seg.aircraft);
      const lay = f.layovers && f.layovers[i];
      return `<div class="aw-seg">
        <div class="aw-seg-header">
          ${seg.flight_number ? `<span class="aw-seg-fn">${esc(seg.flight_number)}</span>` : ''}
          ${seg.aircraft ? `<span class="aw-seg-aircraft">${esc(seg.aircraft)}${stub ? ` <span class="aw-seg-stub">${esc(stub)}</span>` : ''}</span>` : ''}
        </div>
        <div class="aw-seg-route">
          <span class="aw-seg-ap">${esc(seg.dep_iata || '')}</span>
          <span class="aw-seg-t">${esc(seg.dep_time || '')}</span>
          <span class="aw-seg-arr">→</span>
          <span class="aw-seg-ap">${esc(seg.arr_iata || '')}</span>
          <span class="aw-seg-t">${esc(seg.arr_time || '')}</span>
          ${seg.duration_min ? `<span class="aw-seg-dur">${fmtDur(seg.duration_min)}</span>` : ''}
        </div>
        ${lay ? `<div class="aw-layover-row">${esc(lay.iata || '')} · ${fmtDur(lay.duration_min || 0)} layover${lay.overnight ? ' · overnight' : ''}</div>` : ''}
      </div>`;
    }).join('');
    detail = `<div class="aw-itin-detail" hidden>${segsHtml}</div>`;
  }

  const toggle = detail
    ? `<button class="aw-itin-toggle" onclick="(function(b){var d=b.closest('.aw-itin').querySelector('.aw-itin-detail');d.hidden=!d.hidden;b.textContent=d.hidden?'Show itinerary ▼':'Hide itinerary ▲';})(this)">Show itinerary ▼</button>`
    : '';

  return `<div class="aw-itin">
    <div class="aw-itin-sum">${sumParts.join('<span class="aw-fs-sep">·</span>')}</div>
    ${badges.length ? `<div class="aw-itin-badges">${badges.join('')}</div>` : ''}
    ${toggle}${detail}
  </div>`;
}

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
const consent = {
  necessary: true,   // always true — theme, lang, ar_key session cookie
  analytics: false,  // set true only after explicit user consent
  marketing: false,  // set true only after explicit user consent
};

let mode = 'cheap';
let currentOffers = [];
let currentSortKey = 'score';
let calendarPrices = {};
let fpDep, fpRet;

// Theme
let theme = localStorage.getItem('awardradar_theme')
  || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

function applyTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem('awardradar_theme', t);
  const moon = $('themeIconMoon'), sun = $('themeIconSun');
  if (moon) moon.style.display = t === 'light' ? 'none' : '';
  if (sun)  sun.style.display  = t === 'light' ? '' : 'none';
}
applyTheme(theme);


function iso(d) { return d.toISOString().slice(0, 10); }

function initDates() {
  toggleReturn();
}

function appKey() { return new URLSearchParams(location.search).get('key') || ''; }

function activeCabin() {
  const seg = document.querySelector('.seg.active');
  return seg ? seg.dataset.cabin : 'Economy';
}

function activeFlexDays() {
  const p = document.querySelector('.flex-opt.on');
  return p ? parseInt(p.dataset.flex) : 0;
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
  return {
    lang: 'en',
    origin: allOrigins.join(','),
    dest: $('dest').value,
    date: $('date').value,
    returnDate: $('returnDate').value,
    oneWay: $('oneWay').checked,
    direct: $('direct').checked,
    mmOnly: $('mmOnly').checked,
    currency: 'eur',
    cabin: activeCabin(),
    cabins: [activeCabin()],
    flexDays: activeFlexDays(),
  };
}

function setStatus(t) { $('status').textContent = t; }

const RADAR_STAGES = [
  'Resolving airports',
  'Checking live fares',
  'Scanning flexible dates',
  'Calculating value',
  'Ranking results',
];

let _progressTimer = null;
let _elapsedTimer = null;
let _radarStage = 0;
let _searchStart = 0;

function radarHtml(origin, dest) {
  const route = (origin && dest) ? `${origin} → ${dest}` : '';
  const dots = [
    [48, 2], [95, 48], [48, 95], [2, 48],
    [82, 14], [82, 82], [14, 82], [14, 14],
  ].map(([x, y]) => `<div class="radar-ring-dot" style="left:${x}%;top:${y}%"></div>`).join('');
  const stages = RADAR_STAGES.map((s, i) =>
    `<div class="radar-stage" id="rs${i}"><span class="radar-stage-dot"></span>${s}</div>`
  ).join('');
  return `<div class="radar-state" role="status" aria-live="polite" aria-label="Searching for flights">
    ${route ? `<div class="radar-route"><strong>${esc(route)}</strong></div>` : ''}
    <div class="radar-ring-wrap" aria-hidden="true">
      <div class="radar-ring radar-ring-outer"></div>
      <div class="radar-ring radar-ring-mid"></div>
      <div class="radar-ring radar-ring-inner"></div>
      ${dots}
      <div class="radar-ring-sweep"></div>
      <div class="radar-center"></div>
    </div>
    <div class="radar-stages">${stages}</div>
    <div class="radar-elapsed" id="radarElapsed">Scanning…</div>
  </div>`;
}

function startProgress(origin, dest) {
  const bar = $('progress-bar'), fill = $('progress-fill'), go = $('go');
  bar.classList.add('active');
  fill.style.width = '0%';
  go.classList.add('loading');
  go.disabled = true;
  _radarStage = 0;
  _searchStart = Date.now();

  $('results').innerHTML = radarHtml(origin, dest);

  const stageTiming = [0, 1200, 2800, 4800, 7000];
  const barSteps = [[300, 18], [1200, 38], [2800, 58], [4800, 74], [7000, 85]];

  stageTiming.forEach((delay, i) => {
    setTimeout(() => {
      const el = $('rs' + i);
      if (!el) return;
      if (i > 0) { const prev = $('rs' + (i - 1)); if (prev) { prev.classList.remove('active'); prev.classList.add('done'); } }
      el.classList.add('active');
    }, delay);
  });

  barSteps.forEach(([delay, pct]) => {
    setTimeout(() => { fill.style.width = pct + '%'; }, delay);
  });

  _elapsedTimer = setInterval(() => {
    const el = $('radarElapsed');
    if (el) el.textContent = ((Date.now() - _searchStart) / 1000).toFixed(1) + ' s';
  }, 100);
}

function stopProgress(ok) {
  clearInterval(_elapsedTimer);
  const bar = $('progress-bar'), fill = $('progress-fill'), go = $('go');
  fill.style.width = ok ? '100%' : '0%';
  go.classList.remove('loading');
  go.disabled = false;
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
  setStatus('searching…');
  $('results').innerHTML = '';
  document.querySelector('.shell').classList.add('has-results');
  const _origin = ($('origin').value || '').trim().toUpperCase().slice(0, 3);
  const _dest = ($('dest').value || '').trim().toUpperCase().slice(0, 3);
  startProgress(_origin, _dest);
  const endpoint = mode === 'cheap' ? '/api/cheap' : mode === 'skiplag' ? '/api/skiplag' : '/api/awards';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (appKey()) headers['X-App-Token'] = appKey();
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload()) });
    let data;
    try { data = await res.json(); } catch (_) { throw new Error(res.status + ' ' + res.statusText); }
    if (!res.ok || !data.ok) {
      if (data && data.error === 'quota_exhausted') throw Object.assign(new Error('quota_exhausted'), { isQuota: true });
      throw new Error((data && data.error) || res.statusText || 'Error');
    }
    stopProgress(true);
    if (typeof globePulseRoute === 'function') globePulseRoute(_origin, _dest);
    render(data);
    setStatus('ready');
    $('results').focus({ preventScroll: false });
  } catch (e) {
    stopProgress(false);
    console.error('[AwardRadar]', e.message);
    let userMsg;
    if (e.isQuota) {
      userMsg = `<div class="card skiplag-empty">
        <div class="skiplag-empty-header">Capacity Limit</div>
        <div class="skiplag-empty-title">Search capacity temporarily reached.</div>
        <p class="skiplag-empty-reason">Live data refreshes periodically. Please try again in a few minutes.</p>
      </div>`;
    } else if (mode === 'skiplag') {
      userMsg = `<div class="card skiplag-empty">
        <div class="skiplag-empty-header">Hidden Opportunities Analysis</div>
        <div class="skiplag-empty-title">Analysis could not be completed.</div>
        <p class="skiplag-empty-reason">No viable overlooked routing opportunities found for this route and date.</p>
        <button class="cross-btn" onclick="switchTabAndRun('cheap')">Compare Fare Context</button>
      </div>`;
    } else {
      userMsg = `<div class="card skiplag-empty">
        <div class="skiplag-empty-title">Search temporarily unavailable.</div>
        <p class="skiplag-empty-reason">Please try again in a moment.</p>
      </div>`;
    }
    $('results').innerHTML = userMsg;
    setStatus('error');
  }
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
  const grade = o.grade || info.grade;
  const label = o.label || info.label;
  const tooltip = o.scoreReason ? esc(o.scoreReason) : esc(label);
  const note = CASH_CONTEXT_NOTE[o.scoreContext] || '';
  const conf = o.scoreConfidence && o.scoreConfidence !== 'high'
    ? `<div class="score-conf">${o.scoreConfidence === 'low' ? 'Limited confidence' : 'Moderate confidence'}</div>` : '';
  return `<div class="score-block ${info.css}" title="${tooltip}" aria-label="Value Signal ${s} out of 100: ${esc(label)}">
    <span class="score-num">${s}</span><span class="score-denom">/100</span>
    <div class="score-lbl"><span class="score-grade">${grade}</span> ${esc(label)}</div>
    ${note ? `<div class="score-context">${esc(note)}</div>` : ''}
    ${conf}
  </div>`;
}
function bestBadgeHtml(o) {
  const tier = o.tier || scoreInfo(o.dealScore).tier;
  if (o.scoreContext === 'best_available_not_cheap') return '<div class="best-badge">Best Available</div>';
  if (o.scoreContext === 'limited_comparison') return '<div class="best-badge">Only Option</div>';
  if (tier === 'exceptional') return '<div class="best-badge">A+ · Exceptional Value</div>';
  if (tier === 'great') return '<div class="best-badge">A · Strong Value</div>';
  return '<div class="best-badge">Best Match</div>';
}

function scoreLegendHtml() {
  return `<details class="score-legend">
    <summary>What is the Value Signal? <span class="legend-hint">tap to expand</span></summary>
    <div class="legend-grid">
      <span class="s-gold score-num" style="font-size:15px">A+</span><span><strong>Exceptional Value</strong> — cheapest, nonstop and genuinely below typical (rare)</span>
      <span class="s-green score-num" style="font-size:15px">A</span><span><strong>Strong Value</strong> — near the best option in this search</span>
      <span class="s-cyan score-num" style="font-size:15px">B</span><span><strong>Fair Value</strong> — reasonable relative to the cheapest</span>
      <span class="s-muted score-num" style="font-size:15px">C</span><span><strong>Pricey for This Search</strong> — materially costlier or worse routing</span>
      <span class="s-muted score-num" style="font-size:15px">D</span><span><strong>Weak Relative Value</strong> — far from the best in this search</span>
    </div>
    <p class="legend-note">Value Signal is relative to the cheapest comparable result in this search, adjusted for routing quality and a price reality check. Best available is not always cheap.</p>
  </details>`;
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
    const priceStr = c.price ? Math.round(c.price) + ' ' + (c.currency || 'EUR') : '—';
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
  run();
}

function cheapCardsHtml(offers, sortKey) {
  let sorted = [...offers];
  if (sortKey === 'price') sorted.sort((a, b) => (a.price || 99999) - (b.price || 99999));
  else if (sortKey === 'nonstop') sorted.sort((a, b) => (a.stops || 0) - (b.stops || 0) || (-(a.dealScore || 0)) + (b.dealScore || 0));
  else sorted.sort((a, b) => (-(a.dealScore || 0)) + (b.dealScore || 0));

  return sorted.map((o, i) => {
    const isTop = i === 0;
    const stops = parseInt(o.stops) || 0;
    const viaText = o.via && o.via.length ? ` via ${o.via.join(', ')}` : '';
    const stopsLabel = stops === 0 ? 'Nonstop' : stops === 1 ? `1 Stop${viaText}` : `${stops} Stops${viaText}`;
    const airlineLabel = o.airline || 'Airline';
    const logoUrl = o.airlineCode ? `https://content.airhex.com/content/logos/airlines_${esc(o.airlineCode)}_200_200_s.png` : '';
    const logoImg = logoUrl ? `<img src="${logoUrl}" class="airline-logo" alt="" onerror="this.style.display='none'">` : '';
    return `<div class="card${isTop ? ' top-card' : ''}">
      ${isTop ? bestBadgeHtml(o) : ''}
      <div class="card-row">
        <div class="card-main">
          <h3>${esc(o.origin)}<span class="route-arrow">→</span>${esc(o.dest)}</h3>
          <div class="card-airline">${logoImg}<span class="airline-name">${esc(airlineLabel)}</span></div>
          <div class="card-detail">${stopsLabel} · ${esc(o.date)}${o.returnDate ? ' → ' + esc(o.returnDate) : ''}</div>
          <div class="card-source">${esc(o.source || '')}</div>
        </div>
        <div class="card-price">
          <div class="price">${Math.round(o.price)} <span class="price-currency">${esc(o.currency)}</span></div>
          <div class="price-sub">per person</div>
          ${scoreHtml(o)}
          ${o.scoreReason ? `<div class="score-reason-pills">${o.scoreReason.split(' · ').map(p => `<span class="srp">${esc(p)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      ${linksHtml(o.links)}
    </div>`;
  }).join('');
}

function applySort(key) {
  currentSortKey = key;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === key));
  const wrap = document.getElementById('cards-wrap');
  if (wrap) wrap.innerHTML = cheapCardsHtml(currentOffers, key);
}

function switchTabAndRun(targetMode) {
  const tabEl = document.querySelector(`.tab[data-tab="${targetMode}"]`);
  if (tabEl) activateTab(tabEl);
  run();
}

function relatedAnalysesHtml(currentMode) {
  const others = {
    cheap:   [{ tab: 'awards', label: 'Evaluate Award Redemptions' }, { tab: 'skiplag', label: 'Check Hidden Opportunities' }],
    awards:  [{ tab: 'cheap',  label: 'Compare Fare Context' },         { tab: 'skiplag', label: 'Check Hidden Opportunities' }],
    skiplag: [{ tab: 'cheap',  label: 'Compare Standard Fare Context' },     { tab: 'awards',  label: 'Evaluate Award Redemptions' }],
  }[currentMode] || [];
  const links = others.map(o =>
    `<button class="cross-link" onclick="switchTabAndRun('${o.tab}')">${esc(o.label)}</button>`
  ).join('');
  return `<div class="related-analyses"><span class="related-label">Related analyses</span>${links}</div>`;
}

function render(data) {
  let html = '';
  if (data.note) html += `<div class="card note">${esc(data.note)}</div>`;
  if (data.debug) html += `<div class="card tiny">Resolved: ${(data.debug.origins || []).join(', ')} → ${(data.debug.dests || []).join(', ')}${data.debug.seconds ? ' · ' + data.debug.seconds + 's' : ''}${data.debug.source ? ' · ' + esc(data.debug.source) : ''}</div>`;
  // Warnings: log internally only — never expose raw provider errors to users
  if (data.warnings?.length) console.debug('[AwardRadar warnings]', data.warnings);

  if (mode === 'cheap') {
    currentOffers = data.offers || [];
    currentSortKey = 'score';
    updateCalendarPrices(data.calendar);

    if (data.calendar && data.calendar.length > 1) {
      html += calendarStripHtml(data.calendar);
    }

    if (currentOffers.length) {
      html += `<div class="sort-bar">
        <span class="sort-label">Sort:</span>
        <button class="sort-btn active" data-sort="score" onclick="applySort('score')">Best Value</button>
        <button class="sort-btn" data-sort="price" onclick="applySort('price')">Lowest Price</button>
        <button class="sort-btn" data-sort="nonstop" onclick="applySort('nonstop')">Fewest Stops</button>
      </div>
      ${scoreLegendHtml()}`;
      html += `<div id="cards-wrap">${cheapCardsHtml(currentOffers, 'score')}</div>`;
      html += relatedAnalysesHtml('cheap');
    } else {
      html += `<div class="card"><h3>No fare context found — try the verification links below</h3><p class="tiny" style="margin-top:6px">No cached fare context for this route right now. Use the links to verify current pricing.</p></div>`;
    }
    html += (data.fallback || []).map(f => `<div class="card"><h3>${esc(f.route)}</h3>${linksHtml(f.links)}</div>`).join('');
  }

  if (mode === 'skiplag') {
    const skipResults = (data.results || []);
    if (skipResults.length) {
      html += skipResults.map(r => {
        const isVerified = r.verified === true;
        const logoUrl = r.airlineCode ? `https://content.airhex.com/content/logos/airlines_${esc(r.airlineCode)}_200_200_s.png` : '';
        const logoImg = logoUrl ? `<img src="${logoUrl}" class="airline-logo" alt="" onerror="this.style.display='none'">` : '';
        const verifiedBadge = isVerified
          ? `<div class="verified-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Segment context available</div>`
          : `<div class="unverified-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Risk context — verify routing</div>`;
        const segChain = r.segmentChain ? `<div class="seg-chain">${esc(r.segmentChain)}</div>` : '';
        const layover = r.layoverDuration ? `<span class="badge">Layover ${r.layoverDuration} min at ${esc(r.hiddenCity)}</span>` : `<span class="badge">Exit at ${esc(r.hiddenCity)}</span>`;
        const savingsLine = r.savings && r.savings > 0
          ? `<div class="savings-line">Potential difference ~${Math.round(r.savings)} EUR vs direct</div>`
          : '';
        const priceDisplay = r.candidatePrice
          ? `<div class="price">${Math.round(r.candidatePrice)} <span class="price-currency">${esc(r.currency || 'EUR')}</span></div><div class="price-sub">fare to ${esc(r.ticketDestination)}</div>`
          : `<div class="price tiny">verify current</div>`;
        return `<div class="card${isVerified ? ' top-card' : ''}">
          ${verifiedBadge}
          <div class="card-row">
            <div class="card-main">
              <h3>${esc(r.origin)}<span class="route-arrow">→</span><span style="color:var(--gold)">${esc(r.hiddenCity)}</span><span class="route-arrow">→</span>${esc(r.ticketDestination)}</h3>
              ${segChain}
              ${r.airline ? `<div class="card-airline">${logoImg}<span class="airline-name">${esc(r.airline)}</span></div>` : ''}
              <div class="meta">${layover}<span>${esc(r.date)}</span></div>
              ${savingsLine}
            </div>
            <div class="card-price">
              ${priceDisplay}
            </div>
          </div>
          <p class="tiny muted-note" style="margin-top:8px">One-way only · no checked baggage · verify airline T&amp;Cs before purchase</p>
          ${linksHtml(r.links)}
        </div>`;
      }).join('');
      html += relatedAnalysesHtml('skiplag');
    } else {
      const origin = ($('origin').value || '').trim().toUpperCase().slice(0,3);
      const dest   = ($('dest').value   || '').trim().toUpperCase().slice(0,3);
      const routeLabel = (origin && dest) ? `${origin} → ${dest}` : 'this route';
      const providerNote = data.provider_available === false
        ? `<p class="tiny muted-note">Verification context was unavailable for this search.</p>`
        : `<p class="tiny muted-note">Overlooked routing opportunities are shown only when routing structure and fare context meet validation criteria.</p>`;
      html += `<div class="card skiplag-empty">
        <div class="skiplag-empty-header">Hidden Opportunities Analysis</div>
        <div class="skiplag-empty-route">${esc(routeLabel)}</div>
        <div class="skiplag-empty-title">No viable overlooked routing opportunities found.</div>
        <p class="skiplag-empty-reason">No stronger overlooked routing pattern was identified for the selected route and date.</p>
        <p class="skiplag-empty-rec">Recommendation: compare standard cash fare context instead.</p>
        <button class="cross-btn" onclick="switchTabAndRun('cheap')">Show Fare Context</button>
        ${providerNote}
      </div>`;
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
      html += awardResults.map(r => {
        const cashStr = r.cash_eur ? `${Math.round(r.cash_eur)} EUR` : null;
        const hasLive = r.has_live_data;
        const liveNote = hasLive
          ? `<div class="aw-trust-bar"><span class="aw-trust-dot"></span>Award data signal - verify availability, price and rules with the official program</div>`
          : `<div class="aw-trust-bar aw-trust-est">Estimate - verify timing, availability and mileage price with the official program</div>`;
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

        // --- Booking Decision Card (Decision Engine Level 1) ---
        const best = sorted[0];
        let decisionCard = '';
        if (best) {
          const d        = r.decision || {};
          const verdict  = d.verdict || 'insufficient_data';
          const seatsStr = best.seats > 0 ? `, ${best.seats} seat${best.seats !== 1 ? 's' : ''} available` : '';
          const compatible = d.trip_basis_compatible === true;
          const hasValue = compatible && verdict !== 'insufficient_data'
                                      && verdict !== 'availability_only'
                                      && best.cpm != null && r.cash_eur;

          // Verdict → cautious action headline
          const ACTION = {
            book_miles:        'May make sense: Verify miles option',
            lean_miles:        'Miles may make sense',
            consider:          'Compare your options',
            pay_cash:          'Cash fare may make sense',
            availability_only: 'Best award redemption signal',
            insufficient_data: 'Not enough comparable data',
          };
          const headline = ACTION[verdict] || 'Award redemption value signal';

          // Subline: program + miles + fees + seats
          const isLive = best.data_source === 'live';
          const subline = `${esc(best.program)} — ${best.miles.toLocaleString()} miles + €${best.surcharge}${seatsStr}` +
            (verdict === 'availability_only' ? ` (${isLive ? 'live' : 'estimated'} availability).` : '.');

          // Supporting metric row — only on a safely comparable basis
          const metricRow = hasValue ? `
            <div class="bdc-metric-row">
              <span class="bdc-cpp">${best.cpm.toFixed(1)} <small>ct/mi</small></span>
              <span class="bdc-cash-vs">vs. <strong>€${Math.round(r.cash_eur)}</strong> cash · save <strong>€${Math.round(r.cash_eur - best.surcharge)}</strong></span>
            </div>` : '';

          // Trip-basis transparency line (visible, English, from structured fields)
          let basisLine = '';
          if (!compatible && (verdict === 'insufficient_data')) {
            basisLine = `<div class="bdc-basis">Cash and miles could not be normalized to the same trip direction — no mileage value shown.</div>`;
          } else if (compatible && d.normalized_trip_type) {
            const perDir = r.returnDate && d.normalized_trip_type === 'one_way';
            basisLine = `<div class="bdc-basis">Compared on a ${d.normalized_trip_type.replace('_', ' ')} basis${perDir ? ' (per direction; search was round-trip)' : ''}.</div>`;
          }

          // Confidence footer — driven by the decision block, drops on assumptions
          const CONF = {
            high:   ['bdc-conf-live', 'Higher confidence · verify before booking'],
            medium: ['bdc-conf-est',  'Moderate confidence · verify before booking'],
            low:    ['bdc-conf-nodata','Lower confidence · treat as a starting point'],
          };
          const [confCls, confTxt] = CONF[d.confidence] || CONF.low;
          const footerNote = `<span class="bdc-conf ${confCls}">${confTxt}</span>`;

          const bdcTier = hasValue ? (d.tier || 'fair')
                        : (verdict === 'availability_only' ? 'availability' : 'insufficient');
          decisionCard = `
          <div class="bdc bdc-${bdcTier}">
            <div class="bdc-headline">${headline}</div>
            <div class="bdc-subline">${subline}</div>
            ${metricRow}
            ${basisLine}
            <div class="bdc-footer">${footerNote}</div>
          </div>`;
        }

        const cards = sorted.map((p, idx) => {
          const g = p.grade || {};
          const gm = GRADE_MAP[g.tier] || null;
          const isLive = p.data_source === 'live';
          const isBest = idx === 0 && (g.tier === 'exceptional' || g.tier === 'great');
          const cpmStr = p.cpm ? `${p.cpm.toFixed(1)} ct/mi` : null;
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
          const verifyLink = p.url
            ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="aw-book-link">Verify with official program <span aria-hidden="true">-&gt;</span></a>`
            : `<span class="aw-link-unavailable">Manual official-program verification required</span>`;

          // Compact meta row: nonstop · seats · cpm
          const metaParts = [];
          if (p.direct) metaParts.push('<span class="aw-meta-nonstop">✓ Nonstop</span>');
          if (p.seats > 0 && p.seats <= 2) metaParts.push(`<span class="aw-meta-seats aw-meta-seats-low">${p.seats} seat${p.seats > 1 ? 's' : ''} left</span>`);
          else if (p.seats >= 3) metaParts.push(`<span class="aw-meta-seats">${p.seats} seats</span>`);
          if (cpmStr) metaParts.push(`<span class="aw-meta-cpm">${cpmStr}</span>`);

          // Surcharge class
          const surchargeClass = p.surcharge > 500 ? 'aw-surcharge-high' : p.surcharge > 250 ? 'aw-surcharge-med' : '';

          const cardClasses = ['aw-card'];
          if (isLive) cardClasses.push('aw-card-live');
          if (isBest) cardClasses.push('aw-card-best');

          return `<div class="${cardClasses.join(' ')}">
            <div class="aw-card-header">
              <div class="aw-card-prog">
                <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.program)}</a>
                ${isLive ? '<span class="aw-source-live">Live</span>' : '<span class="aw-source-est">Est.</span>'}
              </div>
              ${gm ? `<span class="aw-grade-pill ${gm.cls}">${gm.label}</span>` : ''}
            </div>
            <div class="aw-card-cost">
              <span class="aw-card-miles">${p.miles.toLocaleString()}</span>
              <span class="aw-card-miles-unit">miles</span>
            </div>
            <div class="aw-card-surcharge${surchargeClass ? ' ' + surchargeClass : ''}">+ €${p.surcharge} taxes &amp; fees</div>
            ${metaParts.length ? `<div class="aw-card-meta">${metaParts.join('<span class="aw-meta-sep">·</span>')}</div>` : ''}
            ${p.airlines ? `<div class="aw-card-airline">${esc(p.airlines)}</div>` : ''}
            ${awardTrustMetaHtml(p)}
            <div class="aw-verify-context">Search to verify: ${verifyContext}</div>
            ${verificationNote}
            ${cabinAvailabilityNote}
            <div class="aw-card-footer">
              ${verifyLink}
            </div>
          </div>`;
        }).join('');

        return `<div class="card${r.best_program ? ' top-card' : ''}">
          <div class="aw-result-header">
            <div>
              <h3>${esc(r.route)} <span class="route-arrow">·</span> ${esc(r.cabin)}</h3>
              <div class="meta" style="margin-top:4px">
                <span>${esc(r.date)}</span>
                ${cashStr ? `<span class="badge">Cash: ${cashStr}</span>` : ''}
              </div>
              ${itineraryHtml}
              ${scheduleFallback}
            </div>
          </div>
          ${liveNote}
          ${decisionCard}
          <div class="aw-cards-grid">${cards}</div>
          <p class="legend-note">Final availability, mileage prices, taxes, fees and rules must be confirmed with the airline or loyalty program before any transfer or purchase.</p>
          ${actionLinksHtml(r.links)}
        </div>`;
      }).join('');
      html += relatedAnalysesHtml('awards');
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

function toggleReturn() {
  const on = $('oneWay').checked;
  const fields = document.querySelector('.fields');
  const wrap = $('returnFieldWrap');
  if (fields) fields.classList.toggle('no-return', on);
  if (wrap) wrap.style.display = on ? 'none' : '';
  $('returnDate').disabled = on;
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
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDay();
  let d;
  if (preset === 'today') {
    d = new Date(now);
  } else if (preset === 'weekend') {
    const toSat = day === 6 ? 7 : (6 - day || 7);
    d = new Date(now); d.setDate(now.getDate() + toSat);
  } else if (preset === 'nextweek') {
    const toMon = (8 - day) % 7 || 7;
    d = new Date(now); d.setDate(now.getDate() + toMon);
  } else if (preset === 'christmas') {
    const xmasYear = (m === 11 && now.getDate() > 23) ? y + 1 : y;
    d = new Date(xmasYear, 11, 24);
  } else if (preset === 'newyear') {
    d = new Date(y + 1, 0, 1);
  } else if (preset === 'summer') {
    d = new Date(m >= 8 ? y + 1 : y, 6, 15);
  }
  if (d && fpDep) fpDep.setDate(d, true);
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
      span.textContent = Math.round(cal.price) + '€';
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

  fpDep = flatpickr('#date', { ...baseConfig, onDayCreate: dayCreateHook });
  fpDep.altInput.placeholder = 'Select date';
  fpDep.altInput.setAttribute('aria-label', 'Departure date');

  fpRet = flatpickr('#returnDate', { ...baseConfig });
  fpRet.altInput.placeholder = 'Select date';
  fpRet.altInput.setAttribute('aria-label', 'Return date');
}

// Segmented cabin control
document.querySelectorAll('.seg').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    if ($('results').children.length && $('origin').value && $('dest').value) run();
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
$('oneWay').onchange = toggleReturn;
$('themeBtn').onclick = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

// Swap origin ⇄ destination
$('swapBtn').onclick = () => {
  const o = $('origin').value, d = $('dest').value;
  $('origin').value = d; $('dest').value = o;
  updatePaCodes();
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
  updatePaCodes();
}

function bindAirportTarget(inputId, target) {
  const input = $(inputId);
  if (!input) return;
  input.addEventListener('focus', () => setPaTarget(target));
  input.addEventListener('click', () => setPaTarget(target));
  input.addEventListener('input', updatePaCodes);
  input.addEventListener('blur', () => {
    input.value = normalizeAirportValue(input.value);
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
    if ($('results').children.length && $('origin').value && $('dest').value) run();
  };
});

// Date preset chips
document.querySelectorAll('.date-chip').forEach(btn => {
  btn.onclick = () => applyDatePreset(btn.dataset.preset);
});

// Init Flatpickr
initDatepickers();
// Init return field visibility
toggleReturn();

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
  const airports = [
    [33.64, -84.43, 'ATL', 'Atlanta'], [25.25, 55.36, 'DXB', 'Dubai'], [35.55, 139.78, 'HND', 'Tokyo'],
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
    [43.68, -79.63, 'YYZ', 'Toronto'], [19.44, -99.07, 'MEX', 'Mexico City'], [-23.43, -46.47, 'GRU', 'São Paulo'],
    [4.70, -74.15, 'BOG', 'Bogotá'], [-26.14, 28.25, 'JNB', 'Johannesburg'], [30.12, 31.41, 'CAI', 'Cairo'],
    [-33.95, 151.18, 'SYD', 'Sydney'], [24.96, 46.70, 'RUH', 'Riyadh'],
    [-31.94, 115.97, 'PER', 'Perth'],
  ];
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
  let dragging = false, dragX = 0, velX = 0, autoSpin = true;
  let hoveredAirport = null, mouseX = 0, mouseY = 0;
  const R_screen = () => isMobile() ? Math.min(w, h) * 0.40 : Math.min(w, h) * 0.32;
  const cx_screen = () => isMobile() ? w * 0.50 : w * 0.78;
  const cy_screen = () => isMobile() ? h * 0.50 : h * 0.36;

  function onDragStart(x, y) {
    const dx = x * devicePixelRatio - cx_screen();
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
    // Resume auto-spin after 2s of no drag
    clearTimeout(c._resumeTimer);
    c._resumeTimer = setTimeout(() => { autoSpin = true; }, 2000);
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
    const dx = mouseX * devicePixelRatio - cx_screen();
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
    const R = Math.min(w, h) * (mob ? 0.40 : 0.32);
    const cx = mob ? w * 0.50 : w * 0.78;
    const cy = mob ? h * 0.50 : h * 0.36;
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
    // Europe
    [51.5,-0.1],[48.9,2.3],[52.5,13.4],[41.9,12.5],[40.4,-3.7],[50.1,8.7],
    [48.2,16.4],[47.5,19.0],[55.8,37.6],[59.9,30.3],[52.2,21.0],[50.1,14.4],
    [59.3,18.1],[55.7,12.6],[60.4,5.3],[63.4,10.4],[37.0,-8.0],[38.7,-9.1],
    // North America
    [40.7,-74.0],[34.0,-118.2],[41.8,-87.6],[29.8,-95.4],[33.7,-84.4],[42.4,-71.1],
    [45.5,-73.6],[43.7,-79.4],[49.3,-123.1],[32.7,-117.2],[37.8,-122.4],
    [47.6,-122.3],[25.8,-80.3],[36.2,-86.8],[39.1,-94.6],[44.9,-93.2],[35.5,-97.5],
    // East Asia
    [35.7,139.7],[34.7,135.5],[35.2,136.9],[33.6,130.4],[37.6,127.0],
    [39.9,116.4],[31.2,121.5],[23.1,113.3],[22.3,114.2],[22.6,120.3],[25.0,121.6],
    [1.3,103.9],[3.1,101.7],[6.9,79.8],
    // South/SE Asia
    [28.6,77.2],[19.1,72.9],[12.9,77.6],[22.5,88.4],[13.8,100.5],[14.1,121.0],
    // Middle East
    [25.3,55.4],[24.7,46.7],[33.5,36.3],[31.8,35.2],[30.1,31.4],
    // Africa
    [-33.9,18.4],[-26.2,28.0],[6.5,3.4],[-4.3,15.3],[9.1,7.4],[36.8,3.1],
    // South America
    [-23.5,-46.6],[-34.6,-58.4],[4.7,-74.1],[-12.0,-77.0],[10.5,-66.9],[-22.9,-43.2],
    // Australia
    [-33.9,151.2],[-37.8,145.0],[-27.5,153.0],[-31.9,115.9],
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
      rot += isMobile() ? 0.0014 : 0.0022;
    }
    ctx.clearRect(0, 0, w, h);

    const isLight = document.documentElement.dataset.theme === 'light';
    const lineColor  = isLight ? [8, 72, 120]    : [106,215,255];
    const ringAlpha  = isLight ? 0.55 : 0.38;
    const latEqAlpha = isLight ? 0.42 : 0.26;
    const latAlpha   = isLight ? 0.22 : 0.13;
    const lonAlpha   = isLight ? 0.14 : 0.10;
    const glowColor  = isLight ? '8,72,120'     : '106,215,255';
    const glowAlpha  = isLight ? 0.06 : 0.14;
    const arcAlpha   = isLight ? 0.55 : 0.42;
    const dotColor   = isLight ? '8,72,120'     : '106,215,255';
    const dotAlpha   = isLight ? 0.70 : 0.95;
    const lblColor   = isLight ? '100,55,8'     : '245,199,107';
    const [lr,lg,lb] = lineColor;

    const mob = isMobile();
    const R = Math.min(w, h) * (mob ? 0.40 : 0.32);
    const cx = mob ? w * 0.50 : w * 0.78;
    const cy = mob ? h * 0.50 : h * 0.36;

    // Deep ocean base fill
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    if (isLight) {
      ctx.fillStyle = 'rgba(185,215,240,0.55)';
    } else {
      ctx.fillStyle = 'rgba(4,18,48,0.88)';
    }
    ctx.fill();

    // Sphere sheen — highlight from upper-left
    const sphereFill = ctx.createRadialGradient(cx - R*0.28, cy - R*0.28, R*0.04, cx, cy, R);
    if (isLight) {
      sphereFill.addColorStop(0, 'rgba(255,255,255,0.28)');
      sphereFill.addColorStop(0.5, 'rgba(180,215,240,0.08)');
      sphereFill.addColorStop(1, 'rgba(100,155,210,0.18)');
    } else {
      sphereFill.addColorStop(0, 'rgba(120,200,255,0.10)');
      sphereFill.addColorStop(0.5, 'rgba(40,100,180,0.04)');
      sphereFill.addColorStop(1, 'rgba(0,10,60,0.20)');
    }
    ctx.fillStyle = sphereFill;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // Atmosphere glow — multi-stop, wider halo
    const atmoInner = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.0);
    atmoInner.addColorStop(0, 'transparent');
    atmoInner.addColorStop(1, isLight ? `rgba(80,140,220,0.18)` : `rgba(${glowColor},0.28)`);
    ctx.fillStyle = atmoInner;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, 0, Math.PI * 2); ctx.fill();

    // Cap the halo so it fades out inside the canvas — on mobile the canvas is
    // only ~260px tall and an uncapped 2.2R glow gets cut into a hard rectangle.
    const atmoOuterR = mob ? Math.max(R * 1.05, Math.min(R * 2.2, cy, h - cy, cx, w - cx)) : R * 2.2;
    const atmoOuter = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, atmoOuterR);
    atmoOuter.addColorStop(0, isLight ? `rgba(80,140,220,0.16)` : `rgba(${glowColor},${glowAlpha * 1.4})`);
    atmoOuter.addColorStop(0.3, isLight ? `rgba(80,140,220,0.07)` : `rgba(${glowColor},${glowAlpha * 0.6})`);
    atmoOuter.addColorStop(0.7, isLight ? `rgba(80,140,220,0.02)` : `rgba(${glowColor},${glowAlpha * 0.2})`);
    atmoOuter.addColorStop(1, 'transparent');
    ctx.fillStyle = atmoOuter;
    ctx.beginPath(); ctx.arc(cx, cy, atmoOuterR, 0, Math.PI * 2); ctx.fill();

    // Globe ring
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${ringAlpha})`;
    ctx.lineWidth = (isLight ? 1.6 : 1.4) * devicePixelRatio;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // Continent fills with true horizon clipping: hidden stretches of a ring
    // are replaced by arcs along the limb circle, connected in rim order.
    // This is the only fill approach that produces neither straight chords
    // nor rim blobs while the globe rotates.
    const landFill    = isLight ? 'rgba(148,188,128,0.46)' : 'rgba(6,16,34,0.90)';
    const coastStroke = isLight ? 'rgba(70,120,70,0.45)'  : 'rgba(50,110,170,0.50)';
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
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${lat === 0 ? latEqAlpha : latAlpha})`;
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
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${lonAlpha})`;
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
      ctx.strokeStyle = `rgba(245,199,107,${arcAlpha * 0.22})`;
      ctx.setLineDash([]);
      ctx.stroke();
      // Main arc — solid, thin
      drawArcPath();
      ctx.lineWidth = 1.2 * devicePixelRatio;
      ctx.strokeStyle = `rgba(245,199,107,${arcAlpha})`;
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
      NIGHT_CITIES.forEach(([lat, lon]) => {
        const p = project(lat, lon);
        if (p.z <= 0.05) return;
        const a = Math.min(1, (p.z - 0.05) * 3.5) * 0.88;
        const r = 3.2 * devicePixelRatio;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.0);
        grd.addColorStop(0, `rgba(255,220,120,${a})`);
        grd.addColorStop(0.35, `rgba(255,170,60,${a * 0.60})`);
        grd.addColorStop(0.7, `rgba(220,110,20,${a * 0.18})`);
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,240,200,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
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
    if (wrap) wrap.innerHTML = '<img src="/static/icon.svg" alt="" style="width:200px;height:200px;display:block;margin:30px auto;opacity:.7">';
  }, 800);
}

// ===== Discovery Widget =====
(function initDiscovery() {
  const container = $('discovery-cards');
  if (!container) return;

  const STARS_MAP = { exceptional: '★★★★★', great: '★★★★☆' };
  const REC_LABEL  = {
    book_miles: 'Verify miles option', lean_miles: 'Lean towards Miles',
    consider:   'Compare options', pay_cash:   'Pay Cash',
  };

  function discReason(o) {
    const isPremium = /business|first/i.test(o.cabin || '');
    const highFees  = (o.surcharge || 0) > 300;
    if (!o.cpm) return null;
    if (o.cpm >= 4.0) return isPremium ? 'Exceptionally low mileage for a premium cabin.' : 'Far below typical cost for this route.';
    if (o.cpm >= 2.5) return highFees ? 'Strong value despite elevated fees.' : 'Well above average redemption value.';
    if (o.cpm >= 1.8) return isPremium ? 'Solid value for a premium cabin.' : 'Good miles efficiency on this route.';
    return null;
  }

  function renderCards(opps) {
    if (!opps.length) {
      container.innerHTML = `<div class="disc-empty">
        <div class="disc-empty-title">No exceptional opportunities detected today.</div>
        New opportunities are continuously scanned.
      </div>`;
      return;
    }
    container.innerHTML = opps.map(o => {
      const tier    = o.grade_tier || 'great';
      const stars   = STARS_MAP[tier] || '';
      const recLbl  = REC_LABEL[o.recommendation] || 'Verify miles option';
      const reason  = discReason(o);
      const seatsLbl = o.seats > 0 ? `${o.seats} seat${o.seats !== 1 ? 's' : ''} available` : '';
      const metaLine = [o.direct ? 'Nonstop' : '', seatsLbl].filter(Boolean).join(' · ');

      // CTA: prefill search form fields then switch to awards tab
      const ctaClick = `(function(){` +
        `var f=$('from-0');var t=$('to-0');` +
        `if(f)f.value='${esc(o.origin)}';if(t)t.value='${esc(o.dest)}';` +
        `switchTabAndRun('awards');` +
        `})();return false;`;

      return `<div class="disc-card disc-card-${tier}" role="article">
        <div class="disc-route-row">
          <span class="disc-route">${esc(o.origin)} → ${esc(o.dest)}</span>
          <span class="disc-cabin-pill">${esc(o.cabin)}</span>
        </div>
        <div class="disc-verdict-row">
          ${stars ? `<span class="disc-stars" aria-hidden="true">${stars}</span>` : ''}
          <span class="disc-tier-label">${esc(o.grade_label || tier)}</span>
        </div>
        <div class="disc-rec-label">↗ ${recLbl}</div>
        <div class="disc-offer-row">
          <span class="disc-program">${esc(o.program)}</span><span class="disc-sep"> · </span><span class="disc-miles-val">${o.miles.toLocaleString()} miles + €${o.surcharge}</span>
        </div>
        ${metaLine ? `<div class="disc-meta">${esc(metaLine)}</div>` : ''}
        ${reason   ? `<div class="disc-reason">${reason}</div>` : ''}
        <div class="disc-footer-row">
          <span class="disc-conf disc-conf-live">● Current availability signal</span>
          ${o.cpm ? `<span class="disc-cpm">${o.cpm.toFixed(1)} ct/mi</span>` : ''}
        </div>
        <a href="#" class="disc-cta-btn" onclick="${ctaClick}">Review this route →</a>
      </div>`;
    }).join('');
  }

  function renderError() {
    container.innerHTML = `<div class="disc-error">
      <div class="disc-error-title">Live opportunity scanning is temporarily unavailable.</div>
      Check back soon.
    </div>`;
  }

  // Only fetch when widget scrolls into view — prevents auto-fire on every page load
  let _fetched = false;
  function loadOpportunities() {
    if (_fetched) return;
    _fetched = true;
    fetch('/api/top-opportunities')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => {
        if (d.ok) renderCards(d.opportunities || []);
        else renderError();
      })
      .catch(() => renderError());
  }

  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { obs.disconnect(); loadOpportunities(); }
    }, { rootMargin: '200px' });
    obs.observe(container);
  } else {
    // Fallback for old browsers: load after 3s delay
    setTimeout(loadOpportunities, 3000);
  }
})();
