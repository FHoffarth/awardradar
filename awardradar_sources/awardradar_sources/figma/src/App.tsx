import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type FocusEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

// ─── THEME ────────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'
export type TripType = 'one_way' | 'round_trip'

const T = {
  dark: {
    bg:                 '#060a14',
    vignL:              'linear-gradient(to right, #060a14 22%, rgba(6,10,20,0.88) 46%, rgba(6,10,20,0.22) 68%, transparent 100%)',
    vignV:              'linear-gradient(to bottom, rgba(6,10,20,0.6) 0%, transparent 18%, transparent 78%, rgba(6,10,20,0.7) 100%)',
    wordmark:           '#E7E0D5',
    wordmarkRadar:      '#74d5ff',
    navLink:            '#C9C1B5',
    navLinkHover:       '#F5F2EC',
    eyebrow:            '#6F7480',
    line1:              '#F3F4F6',
    line2:              '#B8BBC3',
    lineWhy:            '#F3F4F6',
    instrLabel:         'rgba(190,181,168,0.7)',
    instrBg:            '#0e1526',
    instrBorder:        'rgba(255,255,255,0.06)',
    instrBorderTop:     'rgba(255,255,255,0.08)',
    instrShadow:        'none',
    fieldLabel:         'rgba(209,200,187,0.6)',
    fieldValue:         '#F5F2EC',
    divider:            'rgba(245,242,236,0.05)',
    btnBorder:          'rgba(245,242,236,0.05)',
    btnBg:              '#0e1526',
    btnBgHover:         '#0e1526',
    btnColor:           '#74d5ff',
    btnColorHover:      '#74d5ff',
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
    wordmarkRadar:      '#0d6e8a',
    navLink:            '#4B5563', /* Slate gray */
    navLinkHover:       '#111827',
    eyebrow:            'rgba(75,85,99,0.8)',
    line1:              '#1F2937',
    line2:              'rgba(55,65,81,0.7)',
    lineWhy:            '#111827',
    instrLabel:         '#0D6E8A',
    instrBg:            '#FFFFFF',
    instrBorder:        'rgba(15,23,42,0.12)',
    instrBorderTop:     'rgba(13,110,138,0.24)',
    instrShadow:        'none',
    fieldLabel:         'rgba(55,65,81,0.72)',
    fieldValue:         '#172033',
    divider:            'rgba(15,23,42,0.10)',
    btnBorder:          'rgba(15,23,42,0.14)',
    btnBg:              '#EDF4F6',
    btnBgHover:         '#E4F2F6',
    btnColor:           '#0D6E8A',
    btnColorHover:      '#07566D',
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
          // Layered warm-white sunlight along the upper-right horizon: a defined
          // pale-gold core over a wider warm→cool atmospheric halo. Soft, diffuse
          // falloff — no hard edge, no saturated amber, kept off the left hero.
          background: 'radial-gradient(ellipse 24% 22% at 59% 22%, rgba(255,249,231,0.32) 0%, rgba(255,241,209,0.13) 42%, transparent 68%), radial-gradient(ellipse 72% 60% at 56% 28%, rgba(255,234,194,0.11) 0%, rgba(212,226,255,0.05) 54%, transparent 92%)',
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
  ariaLabel,
}: {
  children: ReactNode
  href?: string
  t: any
  onClick?: () => void
  external?: boolean
  ariaLabel?: string
}) {
  const [hover, setHover] = useState(false)
  const style: CSSProperties = {
    fontSize: '13px',
    fontWeight: 500,
    letterSpacing: '0.01em',
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
      aria-label={ariaLabel}
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

const IATA_CODE_PATTERN = /^[A-Z]{3}$/

// Narrative-first pause before the single automatic transition to the route
// search: long enough to read the primary claim and its supporting line, short
// enough to feel intentional. This is the sole trigger for the transition — it
// is never driven by load, font or resize events.
export const INITIAL_NAV_DELAY_MS = 3400

export type InitialSearchState = {
  from: string
  fromCode: string
  to: string
  toCode: string
  date: string
  tripType: TripType
  returnDate: string
}

// Inverse of buildAppSearchUrl: read the search once from the URL so the
// "Edit search" action on /app can restore the form. Only committed, valid
// values hydrate; anything malformed falls back to the blank default. A hydrated
// airport code doubles as its committed selection (display text = the code), so
// the autocomplete never fires a lookup. This is a pure function used from a
// useState initializer — it runs a single time, never overwrites later edits,
// and triggers no submission or network access.
export function readInitialSearchFromUrl(search: string): InitialSearchState {
  const blank: InitialSearchState = {
    from: '', fromCode: '', to: '', toCode: '', date: '', tripType: 'one_way', returnDate: '',
  }
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return blank
  }
  const readCode = (value: string | null): string => {
    const code = (value ?? '').trim().toUpperCase()
    return IATA_CODE_PATTERN.test(code) ? code : ''
  }
  const fromCode = readCode(params.get('from'))
  const toCode = readCode(params.get('to'))
  const dateRaw = (params.get('date') ?? '').trim()
  const date = isValidDate(dateRaw) ? dateRaw : ''
  const tripType: TripType = (params.get('trip') ?? '').trim() === 'round_trip' ? 'round_trip' : 'one_way'
  const returnRaw = (params.get('returnDate') ?? '').trim()
  // Round-trip restores its return date; one-way ignores any stray returnDate.
  const returnDate = tripType === 'round_trip' && isValidDate(returnRaw) ? returnRaw : ''
  return {
    from: fromCode,
    fromCode,
    to: toCode,
    toCode,
    date,
    tripType,
    returnDate,
  }
}

// Airport/city autocomplete over /api/airports. Debounced, keyboard + pointer
// navigable, with loading/empty/error states. `code` is the committed IATA
// selection; typing clears it so the CTA can't validate on free text.
function AutocompleteField({
  label, text, code, onText, onSelect, onFieldFocus, onFieldBlur, inputRef, placeholder, t,
}: {
  label: string
  text: string
  code: string
  onText: (v: string) => void
  onSelect: (s: Suggestion) => void
  onFieldFocus: (event: FocusEvent<HTMLInputElement>) => void
  onFieldBlur: () => void
  inputRef?: RefObject<HTMLInputElement | null>
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
        ref={inputRef}
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
        onFocus={event => {
          if (!code && items.length) setOpen(true)
          onFieldFocus(event)
        }}
        onBlur={() => {
          onFieldBlur()
          window.setTimeout(() => setOpen(false), 130)
        }}
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
  // Hydrate the form once from the URL so "Edit search" on /app restores values.
  // Lazy initializer → runs a single time; later user edits are never overwritten.
  const [initialSearch] = useState(() => readInitialSearchFromUrl(typeof window !== 'undefined' ? window.location.search : ''))
  const [from, setFrom]     = useState(initialSearch.from)
  const [to, setTo]         = useState(initialSearch.to)
  const [fromCode, setFromCode] = useState(initialSearch.fromCode)
  const [toCode, setToCode]     = useState(initialSearch.toCode)
  const [date, setDate]     = useState(initialSearch.date)
  const [tripType, setTripType] = useState<TripType>(initialSearch.tripType)
  const [returnDate, setReturnDate] = useState(initialSearch.returnDate)
  const [returnDateTouched, setReturnDateTouched] = useState(false)
  const [roundTripSubmitAttempted, setRoundTripSubmitAttempted] = useState(false)
  const fromInputRef = useRef<HTMLInputElement>(null)
  const navigationFrameRef = useRef<number | null>(null)
  const initialNavigationFrameRef = useRef<number | null>(null)
  const initialVerificationFrameRef = useRef<number | null>(null)
  const bfcacheFrameRef = useRef<number | null>(null)
  const initialNavigationTimerRef = useRef<number | null>(null)
  const initialNavigationStartedRef = useRef(false)
  const initialNavigationCompletedRef = useRef(false)
  const viewportResizeHandlerRef = useRef<(() => void) | null>(null)

  // Hero second block reveal — runs once on mount
  const [secondBlockVisible, setSecondBlockVisible] = useState(false)

  // Act II visibility. Under reduced motion it starts revealed so there is no
  // scroll-gated fade/slide — the search copy is present from first paint.
  const [searchVisible, setSearchVisible] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  function clearViewportFocusCheck() {
    const viewport = window.visualViewport
    const handler = viewportResizeHandlerRef.current
    if (viewport && handler) viewport.removeEventListener('resize', handler)
    viewportResizeHandlerRef.current = null
  }

  function keepFocusedFieldVisible(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget
    clearViewportFocusCheck()

    const checkVisibility = () => {
      if (document.activeElement !== input) return
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
      const rect = input.getBoundingClientRect()
      const edgeInset = 16

      if (rect.top < viewportTop + edgeInset || rect.bottom > viewportBottom - edgeInset) {
        input.scrollIntoView({ behavior: 'auto', block: 'center' })
      }
    }

    window.requestAnimationFrame(checkVisibility)

    const viewport = window.visualViewport
    if (viewport) {
      const onViewportResize = () => {
        clearViewportFocusCheck()
        window.requestAnimationFrame(checkVisibility)
      }
      viewportResizeHandlerRef.current = onViewportResize
      viewport.addEventListener('resize', onViewportResize, { once: true })
    }
  }

  function focusFromWithoutScrolling(target: HTMLElement) {
    const input = fromInputRef.current
    if (!input) return

    const targetTopBeforeFocus = target.getBoundingClientRect().top
    try {
      input.focus({ preventScroll: true })
    } catch {
      input.focus()
      const targetTopAfterFocus = target.getBoundingClientRect().top
      if (Math.abs(targetTopAfterFocus - targetTopBeforeFocus) > 1) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' })
      }
    }
  }

  function cancelFrame(frameRef: { current: number | null }) {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }

  function hasRealLayout(target: HTMLElement) {
    const rect = target.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function isTargetVisible(target: HTMLElement) {
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false

    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    return rect.bottom > viewportTop && rect.top < viewportBottom
  }

  function cancelInitialNavigation() {
    if (initialNavigationTimerRef.current !== null) {
      window.clearTimeout(initialNavigationTimerRef.current)
      initialNavigationTimerRef.current = null
    }
    cancelFrame(initialNavigationFrameRef)
    cancelFrame(initialVerificationFrameRef)
  }

  function navigateToSearch({ focus = true }: { focus?: boolean } = {}) {
    const target = document.getElementById('route-search')
    if (!target) return

    // An explicit navigation supersedes a pending automatic navigation to the
    // same target. Harmless pointer, touch and theme interactions do not.
    if (focus) {
      cancelInitialNavigation()
      initialNavigationStartedRef.current = true
      initialNavigationCompletedRef.current = true
    }

    setSearchVisible(true)
    if (navigationFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationFrameRef.current)
    }

    navigationFrameRef.current = window.requestAnimationFrame(() => {
      navigationFrameRef.current = null
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
      if (focus) focusFromWithoutScrolling(target)
    })
  }

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

    const act2 = document.getElementById('route-search')
    if (act2) observer.observe(act2)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const verifyFrames = 12
    const searchSection = document.getElementById('route-search')

    const removeInteractionListeners = () => {
      window.removeEventListener('scroll', onUserScroll)
      if (searchSection) {
        searchSection.removeEventListener('focusin', onSearchInteraction)
        searchSection.removeEventListener('pointerdown', onSearchInteraction)
      }
    }

    // A meaningful interaction before the pause elapses stands the transition
    // down for good — the reader is already exploring, so we neither scroll nor
    // reschedule. Harmless pointer moves, taps and theme toggles are excluded;
    // only real scrolling or direct search engagement reaches here.
    const suppressInitialNavigation = () => {
      if (initialNavigationCompletedRef.current) return
      if (initialNavigationTimerRef.current === null && initialNavigationFrameRef.current === null) {
        removeInteractionListeners()
        return
      }
      cancelInitialNavigation()
      removeInteractionListeners()
      initialNavigationStartedRef.current = true
      initialNavigationCompletedRef.current = true
    }

    function onUserScroll() {
      // A 0→0 scroll event (e.g. a mobile toolbar settling on load) is not
      // exploration; only a real page movement counts as a manual scroll.
      if (window.scrollY > 8) suppressInitialNavigation()
    }
    function onSearchInteraction() {
      suppressInitialNavigation()
    }

    const runInitialNavigation = () => {
      // Two frames allow React's committed DOM and its responsive layout to
      // settle before Safari receives the initial navigation request.
      initialNavigationFrameRef.current = window.requestAnimationFrame(() => {
        initialNavigationFrameRef.current = window.requestAnimationFrame(() => {
          initialNavigationFrameRef.current = null
          const target = document.getElementById('route-search')
          if (!target || !hasRealLayout(target)) {
            initialNavigationStartedRef.current = false
            return
          }

          removeInteractionListeners()
          setSearchVisible(true)
          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
          initialNavigationCompletedRef.current = true

          let framesRemaining = verifyFrames
          const verificationDeadline = window.performance.now() + 240
          const verifyNavigation = () => {
            initialVerificationFrameRef.current = null
            if (isTargetVisible(target)) return
            if (framesRemaining <= 0 || window.performance.now() >= verificationDeadline) {
              // Safari may ignore or interrupt the first request while its
              // toolbar settles. Correct at most once, without animation.
              target.scrollIntoView({ behavior: 'auto', block: 'start' })
              return
            }
            framesRemaining -= 1
            initialVerificationFrameRef.current = window.requestAnimationFrame(verifyNavigation)
          }
          initialVerificationFrameRef.current = window.requestAnimationFrame(verifyNavigation)
        })
      })
    }

    const scheduleInitialNavigation = () => {
      if (initialNavigationStartedRef.current) return
      initialNavigationStartedRef.current = true

      // Hold the manifesto for a calm beat so the claim and its supporting line
      // register, then guide to the search exactly once. This single timer is
      // the only trigger. Under StrictMode the remount clears it (via the
      // cleanup below) before re-arming, so the transition still fires once.
      initialNavigationTimerRef.current = window.setTimeout(() => {
        initialNavigationTimerRef.current = null
        runInitialNavigation()
      }, INITIAL_NAV_DELAY_MS)
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      cancelFrame(bfcacheFrameRef)
      bfcacheFrameRef.current = window.requestAnimationFrame(() => {
        bfcacheFrameRef.current = null
        const target = document.getElementById('route-search')
        if (!target || !hasRealLayout(target) || isTargetVisible(target)) return
        setSearchVisible(true)
        target.scrollIntoView({ behavior: 'auto', block: 'start' })
      })
    }

    scheduleInitialNavigation()
    window.addEventListener('scroll', onUserScroll, { passive: true })
    if (searchSection) {
      searchSection.addEventListener('focusin', onSearchInteraction)
      searchSection.addEventListener('pointerdown', onSearchInteraction)
    }
    window.addEventListener('pageshow', onPageShow)

    return () => {
      window.removeEventListener('pageshow', onPageShow)
      removeInteractionListeners()
      cancelInitialNavigation()
      cancelFrame(bfcacheFrameRef)
      cancelFrame(navigationFrameRef)
      clearViewportFocusCheck()
      if (!initialNavigationCompletedRef.current) {
        initialNavigationStartedRef.current = false
      }
    }
  }, [])

  const t  = T[theme]
  const PX = 'var(--ar-page-pad)'
  const sameRoute = fromCode.length > 0 && fromCode === toCode
  const returnError = tripType === 'round_trip'
    ? !isValidDate(returnDate)
      ? 'Select a return date.'
      : isValidDate(date) && returnDate < date
        ? 'Return date must not be before the departure date.'
        : ''
    : ''
  const shouldShowReturnError = tripType === 'round_trip' && Boolean(returnError) && (returnDateTouched || roundTripSubmitAttempted)
  const isValid = fromCode.length > 0 && toCode.length > 0 && !sameRoute && isValidDate(date) && !returnError

  function selectFrom(s: Suggestion) { setFrom(`${s.city || s.name} (${s.code})`); setFromCode(s.code) }
  function selectTo(s: Suggestion)   { setTo(`${s.city || s.name} (${s.code})`); setToCode(s.code) }
  function selectTripType(next: TripType) {
    setTripType(next)
    if (next === 'one_way') {
      setReturnDate('')
      setReturnDateTouched(false)
      setRoundTripSubmitAttempted(false)
      return
    }
    setRoundTripSubmitAttempted(false)
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (tripType === 'round_trip') setRoundTripSubmitAttempted(true)
    if (!isValid) return
    window.location.href = buildAppSearchUrl(fromCode, toCode, date, tripType, returnDate)
  }
  function toggleTheme() { setTheme(th => th === 'dark' ? 'light' : 'dark') }

  return (
    <div
      className="ar-root"
      data-theme={theme}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100dvh',
        // The animated globe is intentionally clipped inside the landing root;
        // document-level overflow remains observable during responsive checks.
        overflowX: 'clip',
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
          aria-label="AwardRadar home"
          style={{
            display: 'inline-flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '10px',
            color: t.wordmark,
            textDecoration: 'none',
            transition: 'color 0.4s ease'
          }}
        >
          {/* Approved AwardRadar mark (favicon design brief). Single source:
              /static/logo-mark.svg (dark) / logo-mark-light.svg (light). */}
          <img
            className="logo-mark"
            src={theme === 'light' ? '/static/logo-mark-light.svg' : '/static/logo-mark.svg'}
            alt=""
            width={24}
            height={24}
            aria-hidden="true"
            style={{ flex: 'none', display: 'block' }}
          />
          <span className="logo-name" style={{ fontSize: '15px', fontWeight: 650, lineHeight: 1, letterSpacing: '0.01em' }}>
            <span className="logo-award" style={{ color: 'inherit' }}>Award</span>
            <span className="logo-radar" style={{ color: t.wordmarkRadar, transition: 'color 0.4s ease' }}>Radar</span>
          </span>
        </a>

        <div className="ar-nav-right" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div className="ar-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <NavLink href="/about" t={t}>About</NavLink>
            <NavLink href="/methodology" t={t}>Methodology</NavLink>
          </div>
          {/* Theme toggle lives outside .ar-nav-links (which hides < 768px) so it
              stays reachable on mobile — the only theme control on the landing. */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle light/dark mode"
            aria-pressed={theme === 'light'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px', padding: 0,
              background: 'none', border: 'none', color: t.navLink,
              cursor: 'pointer', transition: 'color 0.2s',
            }}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
            )}
          </button>
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
            {/* Primary claim — immediately visible */}
            <p className="ar-hero-first" style={{
              margin: '0 0 0.3em 0',
              fontSize: 'clamp(28px, 3vw, 42px)',
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: '-0.018em',
              color: t.line1,
              transition: 'color 0.4s ease',
            }}>
              Decide what&apos;s worth booking.
            </p>

            {/* Descriptor — delayed reveal */}
            <p
              className="ar-reveal-block"
              style={{
                margin: '0.15em 0 0 0',
                fontSize: 'clamp(17px, 1.7vw, 21px)',
                fontWeight: 400,
                lineHeight: 1.3,
                letterSpacing: '-0.008em',
                color: t.line2,
                transition: 'color 0.4s ease',
              }}
              data-visible={secondBlockVisible ? 'true' : 'false'}
            >
              Travel decision intelligence for frequent flyers.
            </p>
          </div>
        </div>

        {/* Scroll cue — subtle downward indicator; click scrolls to Act II */}
        <button
          type="button"
          className="ar-scroll-cue"
          onClick={() => navigateToSearch()}
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
      <section id="route-search" className="ar-search-section" aria-labelledby="route-search-label" style={{
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
        <div className="ar-search-content" style={{
          maxWidth: '560px',
          opacity: searchVisible ? 1 : 0,
          transform: searchVisible ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.8s ease, transform 0.8s ease',
          willChange: 'opacity, transform',
        }}>
          <p className="ar-search-intro" style={{
            margin: '0 0 40px 0',
            fontSize: '18px',
            fontWeight: 400,
            lineHeight: 1.4,
            color: t.line2,
            transition: 'color 0.4s ease',
          }}>
            <strong style={{ fontWeight: 500, color: t.line1 }}>AwardRadar</strong> brings cash fares, award options, routing quality and status context into one clear assessment.
          </p>

          <p id="route-search-label" className="ar-route-label" style={{
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
            <fieldset className="ar-trip-type" aria-describedby={shouldShowReturnError ? 'ar-return-error' : undefined}>
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
                onFieldFocus={keepFocusedFieldVisible}
                onFieldBlur={clearViewportFocusCheck}
                inputRef={fromInputRef}
                placeholder="FRA, Frankfurt"
                t={t}
              />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <AutocompleteField
                label="To"
                text={to}
                code={toCode}
                onText={v => { setTo(v); setToCode('') }}
                onSelect={selectTo}
                onFieldFocus={keepFocusedFieldVisible}
                onFieldBlur={clearViewportFocusCheck}
                placeholder="JFK, New York"
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
                  onFocus={keepFocusedFieldVisible}
                  onBlur={clearViewportFocusCheck}
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
                      onChange={e => { setReturnDate(e.target.value); setReturnDateTouched(true) }}
                      onFocus={event => {
                        setReturnDateTouched(true)
                        keepFocusedFieldVisible(event)
                      }}
                      onBlur={clearViewportFocusCheck}
                      onClick={e => { try { (e.currentTarget as HTMLInputElement).showPicker?.() } catch {} }}
                      aria-label="Return date"
                      aria-invalid={shouldShowReturnError}
                      aria-describedby={shouldShowReturnError ? 'ar-return-error' : undefined}
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

            {shouldShowReturnError && (
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
                border: `0.5px solid ${isValid ? 'rgba(116,213,255,0.5)' : t.instrBorder}`,
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
              <p role="alert" style={{ margin: '12px 0 0', fontSize: '11px', letterSpacing: '0.03em', color: '#e7a88e' }}>
                Origin and destination must be different.
              </p>
            )}
          </form>
        </div>
      </section>

      {/* ── Footer (shared public brand footer) ── */}
      <footer className="public-footer" style={{
        position: 'relative',
        zIndex: 10,
        margin: `0 ${PX}`,
        paddingTop: 'clamp(40px, 5vw, 64px)',
        paddingBottom: '44px',
        borderTop: `1px solid ${t.divider}`,
        color: t.footer,
        fontSize: '13px',
        lineHeight: 1.6,
        display: 'grid',
        gap: '22px',
        boxSizing: 'border-box',
      }}>
        <div className="footer-brand" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span className="footer-lockup" style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
            <img
              src={theme === 'light' ? '/static/logo-mark-light.svg' : '/static/logo-mark.svg'}
              alt=""
              width={20}
              height={20}
              aria-hidden="true"
              style={{ flex: 'none', display: 'block' }}
            />
            <span style={{ color: t.wordmark, fontSize: '14px', fontWeight: 600, letterSpacing: '0.01em' }}>AwardRadar</span>
          </span>
        </div>
        <nav className="footer-nav" aria-label="Footer" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 26px', margin: 0 }}>
          <FooterLink href="/about" t={t}>About</FooterLink>
          <FooterLink href="/methodology" t={t}>Methodology</FooterLink>
          <FooterLink href="/privacy" t={t}>Privacy</FooterLink>
          <FooterLink href="/impressum" t={t}>Imprint</FooterLink>
        </nav>
        <a
          className="footer-social"
          href="https://x.com/AwardRadar"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="AwardRadar on X"
          title="AwardRadar on X"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 'fit-content', color: t.footer, textDecoration: 'none', transition: 'color 0.2s' }}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" focusable="false" style={{ flex: 'none' }}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L5.8 21.75H2.49l7.73-8.835L2.066 2.25H8.9l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        </a>
        <p className="copyright" style={{ margin: 0, color: t.coord, fontSize: '12px' }}>&copy; 2026 AwardRadar</p>
      </footer>
    </div>
  )
}
