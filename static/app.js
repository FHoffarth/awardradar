const $ = id => document.getElementById(id);
let mode = 'cheap';
let lang = localStorage.getItem('awardradar_lang') || 'en';

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
  const d = new Date(); d.setDate(d.getDate() + 60);
  $('date').value = iso(d);
  const r = new Date(d); r.setDate(r.getDate() + 7);
  $('returnDate').value = iso(r);
  toggleReturn();
}

function appKey() { return new URLSearchParams(location.search).get('key') || ''; }

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
    cabins: [...document.querySelectorAll('.cabin:checked')].map(x => x.value),
  };
}

function setStatus(t) { $('status').textContent = t; }

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
  $('results').innerHTML = `<div class="card note">${tr('running')}</div>`;
  const endpoint = mode === 'cheap' ? '/api/cheap' : mode === 'skiplag' ? '/api/skiplag' : '/api/awards';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (appKey()) headers['X-App-Token'] = appKey();
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload()) });
    let data;
    try { data = await res.json(); } catch (_) { throw new Error(res.status + ' ' + res.statusText); }
    if (!res.ok || !data.ok) throw new Error((data && data.error) || res.statusText || 'Error');
    render(data);
    setStatus(tr('ready'));
  } catch (e) {
    $('results').innerHTML = `<div class="card warn">${esc(e.message)}</div>`;
    setStatus(tr('error'));
  }
}

function scoreClass(s) { return s >= 80 ? 'score-hot' : 'score-ok'; }
function scoreEmoji(s) { return s >= 80 ? '🔥' : '⭐'; }

function render(data) {
  let html = '';
  if (data.note) html += `<div class="card note">${esc(data.note)}</div>`;
  if (data.debug) html += `<div class="card tiny">${tr('resolved')}: ${(data.debug.origins || []).join(', ')} → ${(data.debug.dests || []).join(', ')}${data.debug.seconds ? ' · ' + data.debug.seconds + 's' : ''}${data.debug.source ? ' · ' + esc(data.debug.source) : ''}</div>`;
  if (data.warnings?.length) html += `<div class="card warn">${data.warnings.slice(0, 4).map(esc).join('<br>')}</div>`;

  if (mode === 'cheap') {
    if (data.offers?.length) {
      html += data.offers.map(o => `
        <div class="card">
          <div class="card-row">
            <div class="card-main">
              <h3>${esc(o.origin)}<span class="route-arrow">→</span>${esc(o.dest)}</h3>
              <div class="meta">
                <span class="badge">${esc(o.airline || tr('airline'))}</span>
                <span class="badge">${esc(o.stops)} ${tr('stops')}</span>
                <span>${esc(o.date)}${o.returnDate ? ' – ' + esc(o.returnDate) : ''}</span>
                <span>${esc(o.source || '')}</span>
              </div>
            </div>
            <div class="card-price">
              <div class="price">${Math.round(o.price)} ${esc(o.currency)}</div>
              <div class="price-sub">per person</div>
              ${o.dealScore != null ? `<div class="score ${scoreClass(o.dealScore)}">${scoreEmoji(o.dealScore)} ${o.dealScore}/100</div>` : ''}
            </div>
          </div>
          ${linksHtml(o.links)}
        </div>`).join('');
    } else {
      html += `<div class="card"><h3>${tr('no_cache_title')}</h3><p class="tiny" style="margin-top:6px">${tr('no_cache_text')}</p></div>`;
    }
    html += (data.fallback || []).map(f => `<div class="card"><h3>${esc(f.route)}</h3>${linksHtml(f.links)}</div>`).join('');
  }

  if (mode === 'skiplag') {
    html += (data.results || []).map(r => `
      <div class="card">
        <h3>${esc(r.candidateLabel || tr('hidden_city'))}: ${esc(r.origin)}<span class="route-arrow">→</span>${esc(r.hiddenCity)}<span class="route-arrow">→</span>${esc(r.ticketDestination)}</h3>
        <div class="meta">
          <span class="badge">${tr('hidden_city')}: ${esc(r.hiddenCity)}</span>
          <span class="badge">${tr('ticket_dest')}: ${esc(r.ticketDestination)}</span>
          <span>${tr('confidence')}: ${esc(r.confidence)}</span>
        </div>
        <p class="price" style="font-size:18px;margin-top:6px">${r.savings ? tr('saving') + ' ' + Math.round(r.savings) + ' €' : tr('candidate')}</p>
        <p class="tiny warn" style="margin-top:5px">${esc(r.verifyRouting || tr('verify'))}</p>
        ${linksHtml(r.links)}
      </div>`).join('') || `<div class="card">${tr('no_candidates')}</div>`;
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
  const rf = document.querySelector('.return-field');
  if (rf) rf.style.opacity = on ? .35 : 1;
  $('returnDate').disabled = on;
}

// Sync pill .on class with checkbox state
function syncPills() {
  document.querySelectorAll('.pill input[type=checkbox]').forEach(cb => {
    cb.closest('.pill').classList.toggle('on', cb.checked);
    cb.addEventListener('change', () => cb.closest('.pill').classList.toggle('on', cb.checked));
  });
}

// Event bindings
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  mode = b.dataset.tab;
});
document.querySelectorAll('.lang').forEach(b => b.onclick = () => {
  lang = b.dataset.lang;
  localStorage.setItem('awardradar_lang', lang);
  applyLang();
});
document.querySelectorAll('[data-fill-origin]').forEach(b => b.onclick = () => $('origin').value = b.dataset.fillOrigin);
document.querySelectorAll('[data-fill-dest]').forEach(b => b.onclick = () => $('dest').value = b.dataset.fillDest);
$('go').onclick = run;
$('oneWay').onchange = toggleReturn;

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
    const R = Math.min(w, h) * 0.29;
    const cx = w * 0.71, cy = h * 0.42;
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
    const { R, cx, cy } = info;

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
globeAnimation();
