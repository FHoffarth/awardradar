const $ = id => document.getElementById(id);
let mode = 'cheap';
let lang = localStorage.getItem('awardradar_lang') || 'en';
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
  const btn = $('themeBtn');
  if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
}
applyTheme(theme);

const I18N = {
  en: {
    ready:'ready', searching:'searching…', running:'Radar scanning. One moment…', error:'error',
    tab_cheap:'Cheap Flights', tab_skiplag:'Skiplag Finder', tab_awards:'Awards',
    from:'From', to:'To', departure:'Departure', return:'Return',
    oneway:'one-way', nonstop:'nonstop only', mmstar:'M&M / Star only',
    start:'Start Radar', resolved:'Resolved',
    no_cache_title:'No fares found — try the live links below',
    no_cache_text:'No cached prices for this route right now. Use the links to check live.',
    stops:'stop(s)', airline:'Airline', hidden_city:'Hidden-city candidate',
    ticket_dest:'Ticket destination', confidence:'Confidence',
    saving:'potential saving (unverified)', candidate:'Check candidate · verify routing',
    no_candidates:'No candidates found.', verify:'Verify routing before booking',
  },
  de: {
    ready:'ready', searching:'suche…', running:'Radar läuft. Einen Moment…', error:'Fehler',
    tab_cheap:'Cheap Flights', tab_skiplag:'Skiplag Finder', tab_awards:'Awards',
    from:'Von', to:'Nach', departure:'Hinflug', return:'Rückflug',
    oneway:'nur Hinflug', nonstop:'nur Nonstop', mmstar:'M&M/Star bevorzugt',
    start:'Radar starten', resolved:'Aufgelöst',
    no_cache_title:'Keine Cachepreise – Live-Links bereit',
    no_cache_text:'Travelpayouts hat für diese Route gerade nichts. Nutze die Links.',
    stops:'Stop(s)', airline:'Airline', hidden_city:'Hidden-City-Kandidat',
    ticket_dest:'Ticketziel', confidence:'Confidence',
    saving:'mögliche Ersparnis (nicht segmentbestätigt)', candidate:'Kandidat prüfen · Routing verifizieren',
    no_candidates:'Keine Kandidaten gefunden.', verify:'Routing vor Buchung prüfen',
  },
};

function tr(k) { return (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k; }

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = tr(el.dataset.i18n));
  document.querySelectorAll('.lang').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('[data-ph-de]').forEach(el => {
    el.placeholder = (lang === 'de' ? el.dataset.phDe : el.dataset.phEn) || el.placeholder;
  });
  setStatus(tr('ready'));
}

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

function payload() {
  return {
    lang,
    origin: $('origin').value,
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

let _progressTimer = null;
function startProgress() {
  const bar = $('progress-bar'), fill = $('progress-fill'), go = $('go');
  bar.classList.add('active');
  fill.style.width = '0%';
  go.classList.add('loading');
  go.disabled = true;
  // Ramp to 85% over ~8s, then hold until stopProgress
  let pct = 0;
  const steps = [
    [300, 35], [600, 55], [1200, 70], [2000, 80], [3500, 85]
  ];
  let i = 0;
  _progressTimer = setInterval(() => {
    if (i < steps.length) { pct = steps[i][1]; i++; }
    fill.style.width = pct + '%';
  }, steps[i]?.[0] || 1000);
}
function stopProgress(ok) {
  clearInterval(_progressTimer);
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
  setStatus(tr('searching'));
  $('results').innerHTML = '';
  startProgress();
  const endpoint = mode === 'cheap' ? '/api/cheap' : mode === 'skiplag' ? '/api/skiplag' : '/api/awards';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (appKey()) headers['X-App-Token'] = appKey();
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload()) });
    let data;
    try { data = await res.json(); } catch (_) { throw new Error(res.status + ' ' + res.statusText); }
    if (!res.ok || !data.ok) throw new Error((data && data.error) || res.statusText || 'Error');
    stopProgress(true);
    render(data);
    setStatus(tr('ready'));
    $('results').focus({ preventScroll: false });
  } catch (e) {
    stopProgress(false);
    $('results').innerHTML = `<div class="card warn">${esc(e.message)}</div>`;
    setStatus(tr('error'));
  }
}

function scoreInfo(s) {
  if (s >= 90) return { tier: 's-gold', emoji: '🔥', label: 'Sweet Spot', desc: 'Exceptional price + direct or Star Alliance' };
  if (s >= 75) return { tier: 's-green', emoji: '⭐', label: 'Great Deal', desc: 'Well below average, good routing' };
  if (s >= 60) return { tier: 's-cyan', emoji: '✓', label: 'Good Deal', desc: 'Solid value for this route' };
  return { tier: 's-muted', emoji: '', label: 'Fair', desc: 'Average or above-average price' };
}
function scoreHtml(s, reason) {
  if (s == null) return '';
  const { tier, emoji, label, desc } = scoreInfo(s);
  const tooltip = reason ? esc(reason) : esc(desc);
  return `<div class="score-block ${tier}" title="${tooltip}" aria-label="Deal score ${s} out of 100: ${label}">
    <span class="score-num">${s}</span><span class="score-denom">/100</span>
    <div class="score-lbl">${emoji} ${label}</div>
  </div>`;
}
function bestBadgeHtml(s) {
  if (s >= 90) return '<div class="best-badge">🔥 Sweet Spot</div>';
  if (s >= 75) return '<div class="best-badge">⭐ Best Value</div>';
  return '<div class="best-badge">Best Match</div>';
}

function scoreLegendHtml() {
  return `<details class="score-legend">
    <summary>What is the Deal Score? <span class="legend-hint">tap to expand</span></summary>
    <div class="legend-grid">
      <span class="s-gold score-num" style="font-size:15px">90+</span><span>🔥 <strong>Sweet Spot</strong> — exceptional price, often nonstop or Star Alliance</span>
      <span class="s-green score-num" style="font-size:15px">75+</span><span>⭐ <strong>Great Deal</strong> — well below average, good routing</span>
      <span class="s-cyan score-num" style="font-size:15px">60+</span><span>✓ <strong>Good Deal</strong> — solid value for this route</span>
      <span class="s-muted score-num" style="font-size:15px">&lt;60</span><span><strong>Fair</strong> — average or above-average price</span>
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
      ${c.isBest ? '<div class="dc-badge">BEST</div>' : ''}
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
    const airlineLabel = o.airline || tr('airline');
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

function render(data) {
  let html = '';
  if (data.note) html += `<div class="card note">${esc(data.note)}</div>`;
  if (data.debug) html += `<div class="card tiny">${tr('resolved')}: ${(data.debug.origins || []).join(', ')} → ${(data.debug.dests || []).join(', ')}${data.debug.seconds ? ' · ' + data.debug.seconds + 's' : ''}${data.debug.source ? ' · ' + esc(data.debug.source) : ''}</div>`;
  if (data.warnings?.length) html += `<div class="card warn">${data.warnings.slice(0, 4).map(esc).join('<br>')}</div>`;

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
    } else {
      html += `<div class="card"><h3>${tr('no_cache_title')}</h3><p class="tiny" style="margin-top:6px">${tr('no_cache_text')}</p></div>`;
    }
    html += (data.fallback || []).map(f => `<div class="card"><h3>${esc(f.route)}</h3>${linksHtml(f.links)}</div>`).join('');
  }

  if (mode === 'skiplag') {
    html += (data.results || []).map(r => {
      const isVerified = r.verified === true;
      const logoUrl = r.airlineCode ? `https://content.airhex.com/content/logos/airlines_${esc(r.airlineCode)}_200_200_s.png` : '';
      const logoImg = logoUrl ? `<img src="${logoUrl}" class="airline-logo" alt="" onerror="this.style.display='none'">` : '';
      const verifiedBadge = isVerified
        ? `<div class="verified-badge">✓ Segment-verified</div>`
        : `<div class="unverified-badge">⚠ Candidate – verify routing</div>`;
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
        <p class="tiny warn" style="margin-top:8px">One-way only · no checked baggage · check airline T&amp;Cs</p>
        ${linksHtml(r.links)}
      </div>`;
    }).join('') || `<div class="card">${tr('no_candidates')}</div>`;
  }

  if (mode === 'awards') {
    html += (data.cards || []).map(c => `
      <div class="card">
        <div class="card-row">
          <div class="card-main">
            <h3>${esc(c.route)} · ${esc(c.cabin)}</h3>
            <div class="meta"><span>${esc(c.date)}${c.returnDate ? ' – ' + esc(c.returnDate) : ''}</span></div>
            <p style="margin-top:7px;font-size:13px;color:var(--muted)">${esc(c.score.text)}</p>
          </div>
          <div class="card-price">
            <div class="score score-ok" style="font-size:13px;padding:6px 12px">${esc(c.score.label)}</div>
          </div>
        </div>
        ${linksHtml(c.links)}
      </div>`).join('');
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
    disableMobile: false,
    locale: { firstDayOfWeek: 1 },
  };

  fpDep = flatpickr('#date', { ...baseConfig, onDayCreate: dayCreateHook });
  fpDep.altInput.placeholder = 'Departure date';
  fpDep.altInput.setAttribute('aria-label', 'Departure date');

  fpRet = flatpickr('#returnDate', { ...baseConfig });
  fpRet.altInput.placeholder = 'Return date';
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

document.querySelectorAll('.lang').forEach(b => b.onclick = () => {
  lang = b.dataset.lang;
  localStorage.setItem('awardradar_lang', lang);
  document.querySelectorAll('.lang').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.lang === lang)));
  applyLang();
});
document.querySelectorAll('[data-fill-origin]').forEach(b => b.onclick = () => $('origin').value = b.dataset.fillOrigin);
document.querySelectorAll('[data-fill-dest]').forEach(b => b.onclick = () => $('dest').value = b.dataset.fillDest);
$('go').onclick = run;
$('oneWay').onchange = toggleReturn;
$('themeBtn').onclick = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

// Swap origin ⇄ destination
$('swapBtn').onclick = () => {
  const o = $('origin').value, d = $('dest').value;
  $('origin').value = d; $('dest').value = o;
  updatePaCodes();
};

// Popular airport codes → fill dest (or origin if dest filled & origin empty)
function updatePaCodes() {
  const destVal = ($('dest').value || '').toUpperCase().trim();
  const originVal = ($('origin').value || '').toUpperCase().trim();
  document.querySelectorAll('.pa-code').forEach(b => {
    b.classList.toggle('pa-active', b.dataset.code === destVal || b.dataset.code === originVal);
  });
}
document.querySelectorAll('.pa-code').forEach(b => {
  b.onclick = () => {
    const code = b.dataset.code;
    if (!$('origin').value) {
      $('origin').value = code;
    } else if (!$('dest').value) {
      $('dest').value = code;
    } else {
      $('dest').value = code;
    }
    updatePaCodes();
  };
});

// Flex segmented control — mutually exclusive
document.querySelectorAll('.flex-opt').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.flex-opt').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
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
const airportSuggest = debounce(async e => {
  const q = e.target.value;
  if (q.length < 2) return;
  const data = await fetch('/api/airports?q=' + encodeURIComponent(q) + '&lang=' + encodeURIComponent(lang)).then(r => r.json()).catch(() => []);
  $('airport-list').innerHTML = (data || []).map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
}, 250);
['origin', 'dest'].forEach(id => $(id).addEventListener('input', airportSuggest));

// Globe animation
function globeAnimation() {
  const c = $('globe');
  const ctx = c.getContext('2d');
  let w, h, rot = 0;

  const airports = [
    [50.0, 8.6, 'FRA'], [48.4, 11.8, 'MUC'], [51.5, -0.5, 'LHR'],
    [49.0, 2.6, 'CDG'], [40.6, -73.8, 'JFK'], [33.9, -118.4, 'LAX'],
    [1.4, 103.9, 'SIN'], [35.5, 139.8, 'HND'], [25.3, 55.4, 'DXB'],
    [-33.9, 151.2, 'SYD'], [22.3, 113.9, 'HKG'], [13.7, 100.7, 'BKK'],
    [52.3, 4.8, 'AMS'], [37.5, 126.5, 'ICN'], [55.6, 12.6, 'CPH'],
    [41.9, -87.6, 'ORD'], [25.8, -80.3, 'MIA'], [-23.4, -46.5, 'GRU'],
    [47.5, 19.0, 'BUD'], [48.2, 16.4, 'VIE'], [59.6, 17.9, 'ARN'],
    [35.7, 139.8, 'NRT'], [-26.1, 28.2, 'JNB'], [19.4, -99.1, 'MEX'],
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
    h = c.height = innerHeight * devicePixelRatio;
  }
  addEventListener('resize', size);
  size();

  function project(lat, lon) {
    const phi = lat * Math.PI / 180;
    const lam = (lon * Math.PI / 180) + rot;
    const px = Math.cos(phi) * Math.sin(lam);
    const py = Math.sin(phi);
    const pz = Math.cos(phi) * Math.cos(lam);
    const tilt = 0.28;
    const y2 = py * Math.cos(tilt) - pz * Math.sin(tilt);
    const z2 = py * Math.sin(tilt) + pz * Math.cos(tilt);
    const R = Math.min(w, h) * 0.32;
    const cx = w * 0.78, cy = h * 0.36;
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
    rot += 0.0022;
    ctx.clearRect(0, 0, w, h);

    const info = project(0, 0);
    const R = Math.min(w, h) * 0.32;
    const cx = w * 0.78, cy = h * 0.36;

    // Subtle globe glow
    const glow = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 1.5);
    glow.addColorStop(0, 'rgba(106,215,255,0.05)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2); ctx.fill();

    // Globe ring
    ctx.strokeStyle = 'rgba(106,215,255,0.2)';
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // Lat lines
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let first = true;
      for (let lon = -180; lon <= 180; lon += 3) {
        const p = project(lat, lon);
        if (p.z > 0) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
        else first = true;
      }
      ctx.strokeStyle = lat === 0 ? 'rgba(106,215,255,0.13)' : 'rgba(106,215,255,0.06)';
      ctx.lineWidth = 0.7 * devicePixelRatio;
      ctx.stroke();
    }

    // Lon lines
    for (let lon = 0; lon < 360; lon += 30) {
      ctx.beginPath();
      let first = true;
      for (let lat = -85; lat <= 85; lat += 3) {
        const p = project(lat, lon);
        if (p.z > 0) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
        else first = true;
      }
      ctx.strokeStyle = 'rgba(106,215,255,0.05)';
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
      ctx.strokeStyle = 'rgba(245,199,107,0.2)';
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

    // Airport dots + IATA labels
    ctx.font = `600 ${Math.round(9.5 * devicePixelRatio)}px Inter,ui-sans-serif,sans-serif`;
    airports.forEach(([lat, lon, iata]) => {
      const p = project(lat, lon);
      if (p.z <= 0) return;
      const a = Math.min(1, p.z * 3.5);

      // Glow
      const dg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 6 * devicePixelRatio);
      dg.addColorStop(0, `rgba(106,215,255,${0.45 * a})`);
      dg.addColorStop(1, 'transparent');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();

      // Dot
      ctx.fillStyle = `rgba(106,215,255,${0.88 * a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();

      // Label
      ctx.fillStyle = `rgba(245,199,107,${0.7 * a})`;
      ctx.fillText(iata, p.x + 5 * devicePixelRatio, p.y - 4 * devicePixelRatio);
    });

    requestAnimationFrame(frame);
  }
  frame();
}

initDates();
syncPills();
applyLang();
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) globeAnimation();
