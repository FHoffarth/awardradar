const $ = id => document.getElementById(id);

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
        <div class="skiplag-empty-header">Hidden City Analysis</div>
        <div class="skiplag-empty-title">Analysis could not be completed.</div>
        <p class="skiplag-empty-reason">No viable hidden-city candidates found for this route and date.</p>
        <button class="cross-btn" onclick="switchTabAndRun('cheap')">Compare Cash Fares</button>
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

function scoreInfo(s) {
  if (s >= 90) return { tier: 's-gold', grade: 'A+', label: 'Exceptional', desc: 'Top-tier price, often nonstop or Star Alliance' };
  if (s >= 75) return { tier: 's-green', grade: 'A', label: 'Great Value', desc: 'Well below average, good routing' };
  if (s >= 60) return { tier: 's-cyan', grade: 'B', label: 'Good Value', desc: 'Solid value for this route' };
  if (s >= 40) return { tier: 's-muted', grade: 'C', label: 'Fair', desc: 'Average price for this route' };
  return { tier: 's-muted', grade: 'D', label: 'Weak', desc: 'Above-average price' };
}
function scoreHtml(s, reason) {
  if (s == null) return '';
  const { tier, grade, label, desc } = scoreInfo(s);
  const tooltip = reason ? esc(reason) : esc(desc);
  return `<div class="score-block ${tier}" title="${tooltip}" aria-label="Deal score ${s} out of 100: ${label}">
    <span class="score-num">${s}</span><span class="score-denom">/100</span>
    <div class="score-lbl"><span class="score-grade">${grade}</span> ${label}</div>
  </div>`;
}
function bestBadgeHtml(s) {
  if (s >= 90) return '<div class="best-badge">A+ · Exceptional</div>';
  if (s >= 75) return '<div class="best-badge">A · Great Value</div>';
  return '<div class="best-badge">Best Match</div>';
}

function scoreLegendHtml() {
  return `<details class="score-legend">
    <summary>What is the Deal Score? <span class="legend-hint">tap to expand</span></summary>
    <div class="legend-grid">
      <span class="s-gold score-num" style="font-size:15px">A+</span><span><strong>Exceptional</strong> — top-tier price, often nonstop or Star Alliance (90+)</span>
      <span class="s-green score-num" style="font-size:15px">A</span><span><strong>Great Value</strong> — well below average, good routing (75+)</span>
      <span class="s-cyan score-num" style="font-size:15px">B</span><span><strong>Good Value</strong> — solid value for this route (60+)</span>
      <span class="s-muted score-num" style="font-size:15px">C</span><span><strong>Fair</strong> — average price (40+)</span>
      <span class="s-muted score-num" style="font-size:15px">D</span><span><strong>Weak</strong> — above-average price</span>
    </div>
    <p class="legend-note">Score factors: price vs. typical range (up to 30 pts), stops (up to 30 pts), Star Alliance airline (15 pts), price insight signals (25 pts).</p>
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
      ${isTop ? bestBadgeHtml(o.dealScore) : ''}
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
          ${scoreHtml(o.dealScore, o.scoreReason)}
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
    cheap:   [{ tab: 'awards', label: 'Evaluate Award Redemptions' }, { tab: 'skiplag', label: 'Check Hidden-City Candidates' }],
    awards:  [{ tab: 'cheap',  label: 'Compare Cash Fares' },         { tab: 'skiplag', label: 'Check Hidden-City Candidates' }],
    skiplag: [{ tab: 'cheap',  label: 'Compare Standard Fares' },     { tab: 'awards',  label: 'Evaluate Award Redemptions' }],
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
      html += `<div class="card"><h3>No fares found — try the live links below</h3><p class="tiny" style="margin-top:6px">No cached prices for this route right now. Use the links to check live.</p></div>`;
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
          ? `<div class="verified-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Segment-verified</div>`
          : `<div class="unverified-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Candidate — verify routing</div>`;
        const segChain = r.segmentChain ? `<div class="seg-chain">${esc(r.segmentChain)}</div>` : '';
        const layover = r.layoverDuration ? `<span class="badge">Layover ${r.layoverDuration} min at ${esc(r.hiddenCity)}</span>` : `<span class="badge">Exit at ${esc(r.hiddenCity)}</span>`;
        const savingsLine = r.savings && r.savings > 0
          ? `<div class="savings-line">Save ~${Math.round(r.savings)} EUR vs direct</div>`
          : '';
        const priceDisplay = r.candidatePrice
          ? `<div class="price">${Math.round(r.candidatePrice)} <span class="price-currency">${esc(r.currency || 'EUR')}</span></div><div class="price-sub">ticket to ${esc(r.ticketDestination)}</div>`
          : `<div class="price tiny">check live</div>`;
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
          <p class="tiny muted-note" style="margin-top:8px">One-way only · no checked baggage · verify airline T&amp;Cs before booking</p>
          ${linksHtml(r.links)}
        </div>`;
      }).join('');
      html += relatedAnalysesHtml('skiplag');
    } else {
      const origin = ($('origin').value || '').trim().toUpperCase().slice(0,3);
      const dest   = ($('dest').value   || '').trim().toUpperCase().slice(0,3);
      const routeLabel = (origin && dest) ? `${origin} → ${dest}` : 'this route';
      const providerNote = data.provider_available === false
        ? `<p class="tiny muted-note">Hidden-city verification was unavailable for this search.</p>`
        : `<p class="tiny muted-note">Hidden-city candidates are only shown when route structure and fare difference meet validation criteria.</p>`;
      html += `<div class="card skiplag-empty">
        <div class="skiplag-empty-header">Hidden City Analysis</div>
        <div class="skiplag-empty-route">${esc(routeLabel)}</div>
        <div class="skiplag-empty-title">No viable hidden-city candidates found.</div>
        <p class="skiplag-empty-reason">No cheaper through-ticket was identified for the selected route and date.</p>
        <p class="skiplag-empty-rec">Recommendation: compare standard cash fares instead.</p>
        <button class="cross-btn" onclick="switchTabAndRun('cheap')">Show Cash Fares</button>
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
          ? `<div class="award-data-note"><span class="aw-source-live">Live</span> seats.aero · <span class="aw-source-est">Est.</span> award charts</div>`
          : `<div class="award-data-note"><span class="aw-source-est">Est.</span> Estimated — verify on program websites</div>`;

        // Sort programs: by grade tier, then by cpm ascending
        const sorted = [...(r.programs || [])].sort((a, b) => {
          const ai = GRADE_ORDER.indexOf(a.grade?.tier ?? '');
          const bi = GRADE_ORDER.indexOf(b.grade?.tier ?? '');
          const ao = ai === -1 ? 99 : ai;
          const bo = bi === -1 ? 99 : bi;
          if (ao !== bo) return ao - bo;
          return (a.cpm || 99) - (b.cpm || 99);
        });

        const cards = sorted.map((p, idx) => {
          const g = p.grade || {};
          const gm = GRADE_MAP[g.tier] || null;
          const isLive = p.data_source === 'live';
          const isBest = idx === 0 && (g.tier === 'exceptional' || g.tier === 'great');
          const cpmStr = p.cpm ? `${p.cpm.toFixed(1)} ct/mi` : null;

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
            <div class="aw-card-footer">
              <a href="${esc(p.url)}" target="_blank" rel="noopener" class="aw-book-link">Book <span aria-hidden="true">→</span></a>
            </div>
          </div>`;
        }).join('');

        // Flight strip (Sprint 1: schedule from cheapest cash flight)
        let flightStrip = '';
        if (r.flight) {
          const f = r.flight;
          const parts = [];
          if (f.flight_number) parts.push(`<span class="aw-fs-fn">${esc(f.flight_number)}</span>`);
          if (f.dep_time && f.arr_time) parts.push(`<span class="aw-fs-times">${esc(f.dep_time)} → ${esc(f.arr_time)}</span>`);
          if (f.duration) parts.push(`<span class="aw-fs-dur">${esc(f.duration)}</span>`);
          if (f.stops === 0) parts.push('<span class="aw-fs-nonstop">Nonstop</span>');
          else if (f.stops === 1) parts.push(`<span class="aw-fs-stops">${f.via && f.via[0] ? `1 stop · ${esc(f.via[0])}` : '1 stop'}</span>`);
          else if (f.stops > 1) parts.push(`<span class="aw-fs-stops">${f.stops} stops</span>`);
          if (parts.length) flightStrip = `<div class="aw-flight-strip">${parts.join('<span class="aw-fs-sep">·</span>')}</div>`;
        }

        return `<div class="card${r.best_program ? ' top-card' : ''}">
          <div class="aw-result-header">
            <div>
              <h3>${esc(r.route)} <span class="route-arrow">·</span> ${esc(r.cabin)}</h3>
              <div class="meta" style="margin-top:4px">
                <span>${esc(r.date)}</span>
                ${cashStr ? `<span class="badge">Cash: ${cashStr}</span>` : ''}
              </div>
              ${flightStrip}
            </div>
          </div>
          ${liveNote}
          <div class="aw-cards-grid">${cards}</div>
          <p class="legend-note">Taxes &amp; fees estimated · verify before booking</p>
          ${linksHtml(r.links)}
        </div>`;
      }).join('');
      html += relatedAnalysesHtml('awards');
    } else {
      html += `<div class="card cross-nudge">
        <div class="cross-nudge-msg">No strong award opportunities were identified for this route.</div>
        <div class="cross-nudge-sub">View available cash fares instead.</div>
        <button class="cross-btn" onclick="switchTabAndRun('cheap')">Show Cash Fares</button>
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

document.querySelectorAll('[data-fill-origin]').forEach(b => b.onclick = () => $('origin').value = b.dataset.fillOrigin);
document.querySelectorAll('[data-fill-dest]').forEach(b => b.onclick = () => $('dest').value = b.dataset.fillDest);
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

document.querySelectorAll('.pa-target').forEach(b => {
  b.onclick = () => setPaTarget(b.dataset.target);
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
    $(paTarget).value = b.dataset.code;
    // Auto-advance: after filling origin, target dest next
    if (paTarget === 'origin') setPaTarget('dest');
    updatePaCodes();
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
      $(inputId).value = el.dataset.value;
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
      inputEl.value = active.dataset.value;
      drop.innerHTML = '';
    } else if (e.key === 'Escape') {
      drop.innerHTML = '';
    }
  });
}

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
  const MOBILE_GLOBE_H = 250; // matches CSS height

  const airports = [
    [50.0, 8.6, 'FRA', 'Frankfurt'], [48.4, 11.8, 'MUC', 'Munich'], [51.5, -0.5, 'LHR', 'London'],
    [49.0, 2.6, 'CDG', 'Paris'], [40.6, -73.8, 'JFK', 'New York'], [33.9, -118.4, 'LAX', 'Los Angeles'],
    [1.4, 103.9, 'SIN', 'Singapore'], [35.5, 139.8, 'HND', 'Tokyo'], [25.3, 55.4, 'DXB', 'Dubai'],
    [-33.9, 151.2, 'SYD', 'Sydney'], [22.3, 113.9, 'HKG', 'Hong Kong'], [13.7, 100.7, 'BKK', 'Bangkok'],
    [52.3, 4.8, 'AMS', 'Amsterdam'], [37.5, 126.5, 'ICN', 'Seoul'], [55.6, 12.6, 'CPH', 'Copenhagen'],
    [41.9, -87.6, 'ORD', 'Chicago'], [25.8, -80.3, 'MIA', 'Miami'], [-23.4, -46.5, 'GRU', 'São Paulo'],
    [47.5, 19.0, 'BUD', 'Budapest'], [48.2, 16.4, 'VIE', 'Vienna'], [59.6, 17.9, 'ARN', 'Stockholm'],
    [35.7, 139.8, 'NRT', 'Tokyo'], [-26.1, 28.2, 'JNB', 'Johannesburg'], [19.4, -99.1, 'MEX', 'Mexico City'],
  ];

  const routePairs = [
    [0, 4], [2, 6], [4, 7], [8, 2], [3, 9],
    [5, 11], [1, 8], [12, 4], [6, 9], [4, 21],
  ];

  const flights = routePairs.map((r, i) => ({
    route: r,
    t: i / routePairs.length,
    speed: 0.0011 + (i % 4) * 0.00035,
  }));

  function size() {
    w = c.width = innerWidth * devicePixelRatio;
    h = c.height = (isMobile() ? MOBILE_GLOBE_H : innerHeight) * devicePixelRatio;
  }
  addEventListener('resize', size);
  size();

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
    onDragStart(e.clientX, e.clientY);
    if (!dragging) return; // outside globe — let event fall through
  });
  c.addEventListener('mousemove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
    onDragMove(e.clientX);
    // Update cursor based on position
    const dx = e.clientX * devicePixelRatio - cx_screen();
    const dy = e.clientY * devicePixelRatio - cy_screen();
    const inside = Math.sqrt(dx*dx + dy*dy) < R_screen() * 1.2;
    if (!dragging) c.style.cursor = inside ? 'grab' : 'default';
  });
  addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; onDragMove(e.clientX); });
  addEventListener('mouseup', onDragEnd);
  let touchStartX = 0, touchStartY = 0, touchMoved = false;
  c.addEventListener('touchstart', e => {
    e.preventDefault();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
    onDragStart(e.touches[0].clientX, e.touches[0].clientY);
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
      mouseX = t.clientX; mouseY = t.clientY;
      clearTimeout(c._tapTimer);
      c._tapTimer = setTimeout(() => { mouseX = -999; mouseY = -999; }, 1500);
    }
    onDragEnd();
  });

  // Route pulse state
  let pulseRoute = null; // { from, to, startTime, duration }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // Sphere fill
    if (isLight) {
      const sphereFill = ctx.createRadialGradient(cx - R*0.2, cy - R*0.2, R*0.05, cx, cy, R);
      sphereFill.addColorStop(0, 'rgba(220,234,248,0.22)');
      sphereFill.addColorStop(0.6, 'rgba(180,210,235,0.08)');
      sphereFill.addColorStop(1, 'rgba(120,170,210,0.14)');
      ctx.fillStyle = sphereFill;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    } else {
      // Dark: inner glow for depth
      const sphereFill = ctx.createRadialGradient(cx - R*0.15, cy - R*0.15, R*0.02, cx, cy, R);
      sphereFill.addColorStop(0, 'rgba(106,215,255,0.06)');
      sphereFill.addColorStop(0.5, 'rgba(56,140,200,0.03)');
      sphereFill.addColorStop(1, 'rgba(0,30,80,0.12)');
      ctx.fillStyle = sphereFill;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }

    // Globe ambient glow
    const glowOuter = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.8);
    glowOuter.addColorStop(0, `rgba(${glowColor},${glowAlpha})`);
    glowOuter.addColorStop(0.5, `rgba(${glowColor},${glowAlpha * 0.4})`);
    glowOuter.addColorStop(1, 'transparent');
    ctx.fillStyle = glowOuter;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.8, 0, Math.PI * 2); ctx.fill();

    // Globe ring
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${ringAlpha})`;
    ctx.lineWidth = (isLight ? 1.4 : 1.2) * devicePixelRatio;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

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

      // Arc
      ctx.beginPath();
      ctx.setLineDash([5 * devicePixelRatio, 5 * devicePixelRatio]);
      ctx.lineWidth = 1.1 * devicePixelRatio;
      ctx.strokeStyle = `rgba(245,199,107,${arcAlpha})`;
      let first = true;
      for (let i = 0; i <= 80; i++) {
        const pt = slerp(from, to, i / 80);
        const p = project(pt[0], pt[1]);
        if (p.z > 0) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
        else first = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Plane position
      f.t = (f.t + f.speed) % 1;
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

    // Airport dots + IATA labels
    ctx.font = `600 ${Math.round(9.5 * devicePixelRatio)}px Inter,ui-sans-serif,sans-serif`;
    const hitR = 14 * devicePixelRatio;
    hoveredAirport = null;
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

      // Label
      ctx.fillStyle = `rgba(${lblColor},${0.7 * a})`;
      ctx.fillText(iata, p.x + 5 * devicePixelRatio, p.y - 4 * devicePixelRatio);
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

    requestAnimationFrame(frame);
  }
  frame();
}

initDates();
syncPills();
setStatus('ready');
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) globeAnimation();
