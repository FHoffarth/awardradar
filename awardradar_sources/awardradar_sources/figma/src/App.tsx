import { useState, useEffect, type FormEvent, type CSSProperties, type KeyboardEvent } from 'react'

// ─── THEME ────────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'
export type TripType = 'one_way' | 'round_trip'

const T = {
  dark: {
    bg:                 '#03030a',
    vignL:              'linear-gradient(to right, #03030a 22%, rgba(3,3,10,0.88) 46%, rgba(3,3,10,0.22) 68%, transparent 100%)',
    vignV:              'linear-gradient(to bottom, rgba(3,3,10,0.6) 0%, transparent 18%, transparent 78%, rgba(3,3,10,0.7) 100%)',
    wordmark:           '#E7E0D5',
    wordmarkRadar:      '#C77A32',
    navLink:            '#C9C1B5',
    navLinkHover:       '#F5F2EC',
    eyebrow:            '#6F7480',
    line1:              '#F3F4F6',
    line2:              '#B8BBC3',
    lineWhy:            '#F3F4F6',
    instrLabel:         'rgba(190,181,168,0.7)',
    instrBg:            '#111317',
    instrBorder:        'rgba(255,255,255,0.06)',
    instrBorderTop:     'rgba(255,255,255,0.08)',
    instrShadow:        'none',
    fieldLabel:         'rgba(209,200,187,0.6)',
    fieldValue:         '#F5F2EC',
    divider:            'rgba(245,242,236,0.05)',
    btnBorder:          'rgba(245,242,236,0.05)',
    btnBg:              '#111317',
    btnBgHover:         '#111317',
    btnColor:           '#C77A32',
    btnColorHover:      '#C77A32',
    footer:             '#BEB6AA',
    footerHover:        '#E6DED2',
    footerToggleActive: '#E6DED2',
    footerToggleInact:  '#AAA296',
    coord:              '#999186',
  },
  light: {
    bg:                 '#F3F4F6', /* Cool off-white/slate */
    vignL:              'linear-gradient(to right, #F3F4F6 0%, #F3F4F6 43%, rgba(243,244,246,0.985) 54%, rgba(243,244,246,0.58) 69%, transparent 82%)',
    vignV:              'linear-gradient(to bottom, rgba(243,244,246,0.08) 0%, transparent 16%, transparent 84%, rgba(243,244,246,0.14) 100%)',
    wordmark:           '#1F2937', /* Dark slate for less harsh contrast */
    wordmarkRadar:      '#C77A32',
    navLink:            '#4B5563', /* Slate gray */
    navLinkHover:       '#111827',
    eyebrow:            'rgba(75,85,99,0.8)',
    line1:              '#1F2937',
    line2:              'rgba(55,65,81,0.7)',
    lineWhy:            '#111827',
    instrLabel:         'rgba(75,85,99,0.7)',
    instrBg:            '#111317', /* keep same for now as dark mode if user wants it */
    instrBorder:        'rgba(0,0,0,0.06)',
    instrBorderTop:     'rgba(0,0,0,0.08)',
    instrShadow:        'none',
    fieldLabel:         'rgba(184,177,167,0.7)',
    fieldValue:         '#F3EEE5',
    divider:            'rgba(245,242,236,0.05)',
    btnBorder:          'rgba(245,242,236,0.05)',
    btnBg:              '#111317',
    btnBgHover:         '#111317',
    btnColor:           '#C77A32',
    btnColorHover:      '#C77A32',
    footer:             '#6B7280',
    footerHover:        '#1F2937',
    footerToggleActive: '#1F2937',
    footerToggleInact:  '#9CA3AF',
    coord:              '#9CA3AF',
  },
} as const



function Globe({ theme }: { theme: Theme }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        right: '-353px',
        top: '50%',
        transform: 'translateY(-51%)',
        width: '1060px',
        height: '1060px',
        pointerEvents: 'none',
        background: theme === 'light' ? '#050505' : 'transparent',
      }}
    >
      {/* Sunlight sweep — runs once on load, never repeats */}
      <div
        aria-hidden="true"
        className="ar-sunlight-sweep"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 2,
          // Warm center → cool outer edge gradient, swept diagonally
          background: 'radial-gradient(ellipse 48% 48% at 52% 48%, rgba(255,230,160,0.18) 0%, rgba(180,210,255,0.06) 55%, transparent 80%)',
        }}
      />

      <svg width="1060" height="1060" viewBox="0 0 880 880">
        <defs>
          <mask id="globe-fade">
            <radialGradient id="globe-grad" cx="50%" cy="50%" r="50%">
              <stop offset="90%" stopColor="white" />
              <stop offset="100%" stopColor="black" />
            </radialGradient>
            <rect x="0" y="0" width="880" height="880" fill="url(#globe-grad)" />
          </mask>
        </defs>

        {/* ── Authentic orbital plate ─────────────────────────────────────
            The NASA frame is deliberately left unmasked. Its own uneven horizon,
            cloud scatter and black field determine where Earth resolves into space.
            Screen blending makes the photographic blacks inherit the page canvas,
            so there is no composited edge, glow, or geometric boundary. */}
        <g style={{ animation: 'ar-photo-drift 420s ease-in-out infinite alternate', mask: 'url(#globe-fade)' }}>
          <image
            href={`${import.meta.env.BASE_URL}images/orbital-earth-nasa-v2.jpg`}
            x="-78"
            y="-3"
            width="1036"
            height="880"
            preserveAspectRatio="xMidYMid slice"
            style={{ mixBlendMode: theme === 'light' ? 'normal' : 'screen', opacity: theme === 'light' ? 1 : 0.88 }}
          />
        </g>
      </svg>
    </div>
  )
}

// ─── DATE PRESENTATION ─────────────────────────────────────────────────────────
// The search state remains untouched; this only makes ISO input read naturally at rest.
function naturalDateLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value

  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  const daysAway = Math.round((target.getTime() - today.getTime()) / 86_400_000)

  if (daysAway === 0) return 'Today'
  if (daysAway === 1) return 'Tomorrow'
  if (daysAway > 1 && daysAway <= 6) {
    return target.toLocaleDateString('en-GB', { weekday: 'long' })
  }

  return target.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ─── FIELD ────────────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, placeholder, technicalCode, displayValue, onFocus, onBlur, flex = '1 1 auto', t,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  technicalCode?: string
  displayValue?: string
  onFocus?: () => void
  onBlur?: () => void
  flex?: string
  t: any
}) {
  return (
    <div className={`ar-field ar-field--${label.toLowerCase()}`} style={{ flex, padding: '24px 48px 22px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      {technicalCode ? (
        <>
          <span className="ar-field-label" style={{ color: t.fieldLabel }}>
            {label}
          </span>
          <input
            className="ar-input ar-place-input"
            type="text"
            value={displayValue ?? value}
            onChange={e => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={placeholder}
            aria-label={label}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              margin: 0,
              fontFamily: 'inherit',
              fontSize: '21px',
              fontWeight: 400,
              letterSpacing: '-0.015em',
              lineHeight: 1,
              color: t.fieldValue,
              width: '100%',
            }}
          />
          <span className="ar-technical-code" style={{ color: t.fieldLabel }}>
            {technicalCode}
          </span>
        </>
      ) : (
        <>
          <span className="ar-field-label" style={{ color: t.fieldLabel }}>
            {label}
          </span>
          <input
            className="ar-input"
            type="text"
            value={displayValue ?? value}
            onChange={e => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={placeholder}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              margin: 0,
              fontFamily: 'inherit',
              fontSize: '15px',
              fontWeight: 520,
              letterSpacing: '0.002em',
              lineHeight: 1,
              color: t.fieldValue,
              width: '100%',
            }}
          />
        </>
      )}
    </div>
  )
}

// ─── NAV LINK ─────────────────────────────────────────────────────────────────
function NavLink({ children, href, t }: { children: string; href: string; t: any }) {
  const [hover, setHover] = useState(false)
  return (
    <a
      href={href}
      style={{
        fontSize: '11.5px',
        fontWeight: 400,
        letterSpacing: '0.09em',
        color: hover ? t.navLinkHover : t.navLink,
        textDecoration: 'none',
        lineHeight: 1,
        transition: 'color 0.2s',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
    </a>
  )
}

// ─── FOOTER LINK ──────────────────────────────────────────────────────────────
function FooterLink({
  children,
  href,
  t,
  onClick,
  external,
}: {
  children: string
  href?: string
  t: any
  onClick?: () => void
  external?: boolean
}) {
  const [hover, setHover] = useState(false)
  const style: CSSProperties = {
    fontSize: '9px',
    fontWeight: 400,
    letterSpacing: '0.09em',
    color: hover ? t.footerHover : t.footer,
    textDecoration: 'none',
    lineHeight: 1,
    transition: 'color 0.2s',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  if (onClick) {
    return (
      <button
        style={style}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {children}
      </button>
    )
  }

  return (
    <a
      href={href ?? '#'}
      style={style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  )
}

// ─── AUTOCOMPLETE ───────────────────────────────────────────────────────────
type Suggestion = { code: string; name: string; city: string; country: string; label: string }

function isValidDate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const d = new Date(`${s}T00:00:00`)
  return !Number.isNaN(d.getTime()) &&
    d.getFullYear() === Number(m[1]) &&
    d.getMonth() + 1 === Number(m[2]) &&
    d.getDate() === Number(m[3])
}

export function buildAppSearchUrl(
  from: string,
  to: string,
  date: string,
  tripType: TripType,
  returnDate: string,
): string {
  const params = new URLSearchParams()
  params.set('from', from)
  params.set('to', to)
  params.set('date', date.trim())
  if (tripType === 'round_trip') {
    params.set('trip', 'round_trip')
    params.set('returnDate', returnDate.trim())
  }
  return `/app?${params.toString()}`
}

// Airport/city autocomplete over /api/airports. Debounced, keyboard + pointer
// navigable, with loading/empty/error states. `code` is the committed IATA
// selection; typing clears it so the CTA can't validate on free text.
function AutocompleteField({
  label, text, code, onText, onSelect, placeholder, t,
}: {
  label: string
  text: string
  code: string
  onText: (v: string) => void
  onSelect: (s: Suggestion) => void
  placeholder: string
  t: any
}) {
  const [items, setItems]     = useState<Suggestion[]>([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(false)
  const [active, setActive]   = useState(-1)
  const listId = `ar-ac-${label.toLowerCase()}`

  useEffect(() => {
    const q = text.trim()
    // No lookup once a value is committed, or below the trigger threshold.
    if (code || q.length < 2) {
      setItems([]); setLoading(false); setError(false); setActive(-1); setOpen(false)
      return
    }
    setLoading(true); setError(false); setOpen(true)
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/airports?q=${encodeURIComponent(q)}&lang=en`, { signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('bad'); return r.json() })
        .then((data: Suggestion[]) => { setItems(Array.isArray(data) ? data : []); setActive(-1); setLoading(false) })
        .catch((e: any) => { if (e && e.name !== 'AbortError') { setError(true); setItems([]); setLoading(false) } })
    }, 250)
    return () => { window.clearTimeout(timer); ctrl.abort() }
  }, [text, code])

  function choose(s: Suggestion) {
    onSelect(s)
    setOpen(false); setItems([]); setActive(-1)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open && items.length) { setOpen(true); setActive(0); return }
      setActive(a => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]) }
    } else if (e.key === 'Escape') {
      setOpen(false); setActive(-1)
    }
  }

  const showList = open && text.trim().length >= 2 && !code
  const stateStyle: CSSProperties = { padding: '11px 18px', fontSize: '13px', color: t.instrLabel, listStyle: 'none' }

  return (
    <div className={`ar-field ar-field--${label.toLowerCase()}`} style={{ flex: '1 1 auto', padding: '24px 48px 22px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, position: 'relative' }}>
      <span className="ar-field-label" style={{ color: t.fieldLabel }}>{label}</span>
      <input
        className="ar-input ar-place-input"
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        value={text}
        onChange={e => onText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (!code && items.length) setOpen(true) }}
        onBlur={() => window.setTimeout(() => setOpen(false), 130)}
        placeholder={placeholder}
        aria-label={label}
        style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, fontFamily: 'inherit', fontSize: '21px', fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1, color: t.fieldValue, width: '100%' }}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="ar-ac-list"
          style={{
            position: 'absolute', top: 'calc(100% - 6px)', left: 0, right: 0, zIndex: 100,
            margin: 0, padding: '4px 0', listStyle: 'none',
            maxHeight: '248px', overflowY: 'auto',
            background: t.instrBg,
            border: `0.5px solid ${t.instrBorderTop}`,
            boxShadow: '0 18px 40px -12px rgba(0,0,0,0.55)',
          }}
        >
          {loading && <li className="ar-ac-state" style={stateStyle}>Searching&#8230;</li>}
          {error && !loading && <li className="ar-ac-state" style={stateStyle}>Couldn&apos;t load suggestions</li>}
          {!loading && !error && items.length === 0 && <li className="ar-ac-state" style={stateStyle}>No matching airports</li>}
          {!loading && !error && items.map((s, i) => (
            <li
              key={`${s.code}-${i}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="ar-ac-item"
              onMouseDown={e => { e.preventDefault(); choose(s) }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '14px',
                padding: '9px 18px', cursor: 'pointer',
                background: i === active ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}
            >
              <span style={{ fontSize: '14px', color: t.fieldValue, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.city || s.name}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: t.instrLabel, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {s.code}{s.country ? ` · ${s.country}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme]   = useState<Theme>('dark')
  const [from, setFrom]     = useState('')
  const [to, setTo]         = useState('')
  const [fromCode, setFromCode] = useState('')
  const [toCode, setToCode]     = useState('')
  const [date, setDate]     = useState('')
  const [tripType, setTripType] = useState<TripType>('one_way')
  const [returnDate, setReturnDate] = useState('')

  // Hero second block reveal — runs once on mount
  const [secondBlockVisible, setSecondBlockVisible] = useState(false)

  // Act II visibility. Under reduced motion it starts revealed so there is no
  // scroll-gated fade/slide — the search copy is present from first paint.
  const [searchVisible, setSearchVisible] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    // 1st text reveal CSS takes 900ms + 300ms delay = 1200ms
    // Pause 600ms = 1800ms
    const timer = setTimeout(() => setSecondBlockVisible(true), 1800)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    // Reduced motion: Act II is already revealed (see state init) — skip the
    // scroll-gated observer entirely so there is no motion trigger.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Set up observer for Act II
    const observer = new IntersectionObserver((entries) => {
      const [entry] = entries
      if (entry.isIntersecting) {
        setSearchVisible(true)
        observer.disconnect()
      }
    }, { threshold: 0.25 })

    const act2 = document.getElementById('act-2')
    if (act2) observer.observe(act2)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Cinematic sequence: once the manifesto reveal has completed, scroll once
    // to Act II. Runs a single time per load. Any user interaction (touch,
    // wheel, pointer, key) cancels it immediately — no scroll trapping. Reduced
    // motion opts out entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let cancelled = false
    const events = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown', 'mousedown']
    const stop = () => { events.forEach(e => window.removeEventListener(e, cancel)) }
    const cancel = () => { cancelled = true; window.clearTimeout(timer); stop() }
    events.forEach(e => window.addEventListener(e, cancel, { passive: true }))

    // 1800ms reveal delay + ~800ms reveal animation + short beat.
    const timer = window.setTimeout(() => {
      stop()
      // Only auto-advance if the reader is still idle at the top.
      if (cancelled || window.scrollY > 8) return
      document.getElementById('act-2')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 2900)

    return () => { window.clearTimeout(timer); stop() }
  }, [])

  const t  = T[theme]
  const PX = 'clamp(64px, 7.5vw, 120px)'
  const sameRoute = fromCode.length > 0 && fromCode === toCode
  const returnError = tripType === 'round_trip'
    ? !isValidDate(returnDate)
      ? 'Select a return date.'
      : isValidDate(date) && returnDate < date
        ? 'Return date must not be before the departure date.'
        : ''
    : ''
  const isValid = fromCode.length > 0 && toCode.length > 0 && !sameRoute && isValidDate(date) && !returnError

  function selectFrom(s: Suggestion) { setFrom(`${s.city || s.name} (${s.code})`); setFromCode(s.code) }
  function selectTo(s: Suggestion)   { setTo(`${s.city || s.name} (${s.code})`); setToCode(s.code) }
  function selectTripType(next: TripType) {
    setTripType(next)
    if (next === 'one_way') setReturnDate('')
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!isValid) return
    window.location.href = buildAppSearchUrl(fromCode, toCode, date, tripType, returnDate)
  }
  function toggleTheme() { setTheme(th => th === 'dark' ? 'light' : 'dark') }
  function scrollToAct2() {
    const el = document.getElementById('act-2')
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div
      className="ar-root"
      data-theme={theme}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100dvh',
        overflowX: 'hidden',
        background: t.bg,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        transition: 'background 0.4s ease',
      }}
    >
      {/* Canvas vignette */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: `${t.vignL}, ${t.vignV}`,
        transition: 'background 0.4s ease',
      }} />

      {/* ── Navigation ── */}
      <nav className="ar-nav" style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '5.5vh',
        paddingLeft: PX,
        paddingRight: PX,
      }}>
        <a
          href="/"
          className="logo"
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            gap: '2px',
            color: t.wordmark,
            textDecoration: 'none',
            fontSize: '15px',
            fontWeight: 650,
            lineHeight: 1,
            letterSpacing: '0.01em',
            transition: 'color 0.4s ease'
          }}
        >
          <div>
            <div className="logo-name" style={{ fontSize: '15px', lineHeight: 1 }}>
              <span className="logo-award" style={{ color: 'inherit' }}>Award</span>
              <span className="logo-radar" style={{ color: t.wordmarkRadar, transition: 'color 0.4s ease' }}>Radar</span>
            </div>
          </div>
        </a>

        <div className="ar-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <NavLink href="/about" t={t}>About</NavLink>
          <NavLink href="/methodology" t={t}>Methodology</NavLink>
        </div>
      </nav>

      {/* ── ACT I: Manifesto + Globe ── */}
      <section id="act-1" style={{ position: 'relative', width: '100%', minHeight: '100dvh' }}>
        {/* Globe — the only moving element */}
        <Globe theme={theme} />

        {/* ── Editorial content — left column, perfectly still ── */}
        <div className="ar-editorial" style={{
          position: 'absolute',
          top: 0, bottom: 0, left: 0,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingLeft: PX,
          paddingRight: PX,
          maxWidth: '560px',
        }}>
          {/* ── Manifesto ── */}
          <div style={{ marginBottom: '0' }}>
            {/* Couplet one — immediately visible */}
            <p className="ar-hero-first" style={{
              margin: '0 0 0.15em 0',
              fontSize: 'clamp(28px, 3vw, 42px)',
              fontWeight: 500,
              lineHeight: 1.22,
              letterSpacing: '-0.018em',
              color: t.line1,
              transition: 'color 0.4s ease',
            }}>
              We don&apos;t tell you
            </p>
            <p className="ar-hero-first" style={{
              margin: '0 0 0.6em 0',
              fontSize: 'clamp(28px, 3vw, 42px)',
              fontWeight: 500,
              lineHeight: 1.22,
              letterSpacing: '-0.018em',
              color: t.line1,
              transition: 'color 0.4s ease',
            }}>
              what to book.
            </p>

            {/* Couplet two — delayed reveal with blur + slide + opacity */}
            <p
              className="ar-reveal-block"
              style={{
                margin: '0 0 0.15em 0',
                fontSize: 'clamp(28px, 3vw, 42px)',
                fontWeight: 340,
                lineHeight: 1.22,
                letterSpacing: '-0.012em',
                color: t.line2,
                transition: 'color 0.4s ease',
              }}
              data-visible={secondBlockVisible ? 'true' : 'false'}
            >
              We help you understand
            </p>
            <p
              className="ar-reveal-block"
              style={{
                margin: '0.15em 0 0 0',
                fontSize: 'clamp(28px, 3vw, 42px)',
                fontWeight: 380,
                lineHeight: 1.22,
                letterSpacing: '-0.014em',
                color: t.lineWhy,
                transition: 'color 0.4s ease',
              }}
              data-visible={secondBlockVisible ? 'true' : 'false'}
            >
              why.
            </p>
          </div>
        </div>

        {/* Scroll cue — subtle downward indicator; click scrolls to Act II */}
        <button
          type="button"
          className="ar-scroll-cue"
          onClick={scrollToAct2}
          aria-label="Scroll to route search"
          style={{
            position: 'absolute',
            bottom: '4.5vh',
            left: PX,
            zIndex: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: t.eyebrow,
            fontFamily: 'inherit',
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            lineHeight: 1,
            transition: 'color 0.4s ease',
          }}
        >
          Scroll
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
            <path d="M6 1V12M6 12L1.5 7.5M6 12L10.5 7.5"
              stroke="currentColor" strokeWidth="1"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </section>

      {/* ── ACT II: Search Instrument ── */}
      <section id="act-2" style={{
        position: 'relative',
        width: '100%',
        minHeight: '85dvh',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingLeft: PX,
        paddingRight: PX,
      }}>
        <div style={{
          maxWidth: '560px',
          opacity: searchVisible ? 1 : 0,
          transform: searchVisible ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.8s ease, transform 0.8s ease',
          willChange: 'opacity, transform',
        }}>
          <p style={{
            margin: '0 0 40px 0',
            fontSize: '18px',
            fontWeight: 400,
            lineHeight: 1.4,
            color: t.line2,
            transition: 'color 0.4s ease',
          }}>
            <strong style={{ fontWeight: 500, color: t.line1 }}>AwardRadar.</strong> Your Travel Decision Companion.
          </p>

          <p style={{
            margin: '0 0 14px 0',
            fontSize: '8px',
            fontWeight: 500,
            letterSpacing: '0.24em',
            color: t.instrLabel,
            textTransform: 'uppercase',
            transition: 'color 0.4s ease',
          }}>
            Route search
          </p>

          <form className="ar-instrument-form" onSubmit={handleSearch}>
            <fieldset className="ar-trip-type" aria-describedby={returnError ? 'ar-return-error' : undefined}>
              <legend>Trip type</legend>
              <label>
                <input
                  type="radio"
                  name="tripType"
                  value="one_way"
                  checked={tripType === 'one_way'}
                  onChange={() => selectTripType('one_way')}
                />
                <span>One-way</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="tripType"
                  value="round_trip"
                  checked={tripType === 'round_trip'}
                  onChange={() => selectTripType('round_trip')}
                />
                <span>Round-trip</span>
              </label>
            </fieldset>
            <div className={`ar-instrument${tripType === 'round_trip' ? ' ar-instrument--round-trip' : ''}`} style={{
              width: '100%',
              display: 'flex',
              alignItems: 'stretch',
              background: t.instrBg,
              border: `0.5px solid ${t.instrBorder}`,
              borderTop: `0.5px solid ${t.instrBorderTop}`,
              boxShadow: t.instrShadow,
              overflow: 'visible',
              transition: 'none',
            }}>
              <AutocompleteField
                label="From"
                text={from}
                code={fromCode}
                onText={v => { setFrom(v); setFromCode('') }}
                onSelect={selectFrom}
                placeholder="City or airport"
                t={t}
              />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <AutocompleteField
                label="To"
                text={to}
                code={toCode}
                onText={v => { setTo(v); setToCode('') }}
                onSelect={selectTo}
                placeholder="City or airport"
                t={t}
              />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <div className="ar-field ar-field--date" style={{ flex: '0 0 auto', padding: '24px 40px 22px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <span className="ar-field-label" style={{ color: t.fieldLabel }}>Departure</span>
                <input
                  className="ar-input ar-date-input"
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => setDate(e.target.value)}
                  onClick={e => { try { (e.currentTarget as HTMLInputElement).showPicker?.() } catch {} }}
                  aria-label="Departure date"
                  style={{
                    background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0,
                    fontFamily: 'inherit', fontSize: '15px', fontWeight: 520, letterSpacing: '0.002em',
                    lineHeight: 1.15, color: t.fieldValue, width: '158px', maxWidth: '100%',
                    colorScheme: theme === 'dark' ? 'dark' : 'light',
                  }}
                />
              </div>
              {tripType === 'round_trip' && (
                <>
                  <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
                  <div className="ar-field ar-field--return" style={{ flex: '0 0 auto', padding: '24px 40px 22px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                    <span className="ar-field-label" style={{ color: t.fieldLabel }}>Return</span>
                    <input
                      className="ar-input ar-date-input"
                      type="date"
                      value={returnDate}
                      min={date || new Date().toISOString().slice(0, 10)}
                      onChange={e => setReturnDate(e.target.value)}
                      onClick={e => { try { (e.currentTarget as HTMLInputElement).showPicker?.() } catch {} }}
                      aria-label="Return date"
                      aria-invalid={Boolean(returnError)}
                      aria-describedby={returnError ? 'ar-return-error' : undefined}
                      style={{
                        background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0,
                        fontFamily: 'inherit', fontSize: '15px', fontWeight: 520, letterSpacing: '0.002em',
                        lineHeight: 1.15, color: t.fieldValue, width: '158px', maxWidth: '100%',
                        colorScheme: theme === 'dark' ? 'dark' : 'light',
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            {tripType === 'round_trip' && returnError && (
              <p className="ar-form-error" id="ar-return-error" role="status">{returnError}</p>
            )}

            {/* Primary CTA — visible, disabled until From/To/Date are valid */}
            <button
              className="ar-analyze-button"
              type="submit"
              disabled={!isValid}
              title={isValid ? 'Analyze this route' : returnError || 'Enter origin, destination and departure date to analyze'}
              style={{
                marginTop: '24px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                padding: '13px 24px',
                background: 'transparent',
                border: `0.5px solid ${isValid ? 'rgba(199,122,50,0.5)' : t.instrBorder}`,
                borderRadius: '1px',
                cursor: isValid ? 'pointer' : 'not-allowed',
                color: isValid ? t.btnColor : t.instrLabel,
                opacity: isValid ? 1 : 0.6,
                fontFamily: 'inherit',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
              aria-label="Analyze route"
            >
              Analyze route
              <svg width="14" height="9" viewBox="0 0 16 10" fill="none" aria-hidden="true">
                <path d="M10 1L14 5M14 5L10 9M13.5 5H1.5"
                  stroke="currentColor" strokeWidth="1"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {sameRoute && (
              <p role="alert" style={{ margin: '12px 0 0', fontSize: '11px', letterSpacing: '0.03em', color: '#C77A32' }}>
                Origin and destination must be different.
              </p>
            )}
          </form>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="public-footer" style={{
        position: 'relative',
        zIndex: 10,
        paddingBottom: '48px',
        paddingTop: '24px',
      }}>
        <div className="footer-layout" style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: '40px',
          paddingLeft: PX,
          paddingRight: PX,
        }}>
          <div className="trust-note" style={{ maxWidth: '640px', margin: 0, lineHeight: 1.5, color: t.footer, fontSize: '13.5px' }}>
            <strong style={{ fontWeight: 600, color: t.wordmark }}>Verify before booking</strong> &mdash; AwardRadar provides decision support only. Always confirm availability, pricing and rules with official airline, booking-site and loyalty-program sources.
          </div>
          <div className="footer-nav-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
            <div className="footer-links" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', justifyContent: 'flex-end' }}>
              <FooterLink href="/privacy" t={t}>Privacy</FooterLink>
              <FooterLink href="/impressum" t={t}>Imprint</FooterLink>
              <FooterLink onClick={toggleTheme} t={t}>Theme</FooterLink>
              <FooterLink href="https://x.com/awardradar" external t={t}>@AwardRadar</FooterLink>
            </div>
            <div className="copyright" style={{ fontSize: '12px', color: t.coord }}>&copy; 2026 AwardRadar</div>
          </div>
        </div>
      </footer>
    </div>
  )
}
