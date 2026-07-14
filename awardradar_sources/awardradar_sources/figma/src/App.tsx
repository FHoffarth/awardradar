import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'

// ─── THEME ────────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'

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

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme]   = useState<Theme>('dark')
  const [from, setFrom]     = useState('')
  const [to, setTo]         = useState('')
  const [date, setDate]     = useState('')
  const [isEditingDate, setIsEditingDate] = useState(false)

  // Hero second block reveal — runs once on mount
  const [secondBlockVisible, setSecondBlockVisible] = useState(false)

  // Act II visibility
  const [searchVisible, setSearchVisible] = useState(false)

  useEffect(() => {
    // 1st text reveal CSS takes 900ms + 300ms delay = 1200ms
    // Pause 600ms = 1800ms
    const timer = setTimeout(() => setSecondBlockVisible(true), 1800)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
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

  const t  = T[theme]
  const PX = 'clamp(64px, 7.5vw, 120px)'
  const isValid = from.trim().length > 0 && to.trim().length > 0 && date.trim().length > 0

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!isValid) return
    const params = new URLSearchParams()
    if (from.trim()) params.set('from', from.trim())
    if (to.trim()) params.set('to', to.trim())
    if (date.trim()) params.set('date', date.trim())
    const qs = params.toString()
    window.location.href = `/app${qs ? '?' + qs : ''}`
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
          {/* Eyebrow — always visible */}
          <p style={{
            margin: '0 0 56px 0',
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.24em',
            color: t.eyebrow,
            textTransform: 'uppercase',
            lineHeight: 1,
            transition: 'color 0.4s ease',
          }}>
            Travel Decision Intelligence
          </p>

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
            <div className="ar-instrument" style={{
              width: 'calc(100% + 96px)',
              display: 'flex',
              alignItems: 'stretch',
              background: t.instrBg,
              border: `0.5px solid ${t.instrBorder}`,
              borderTop: `0.5px solid ${t.instrBorderTop}`,
              boxShadow: t.instrShadow,
              overflow: 'hidden',
              transition: 'none',
            }}>
              <Field label="From" value={from} onChange={setFrom} placeholder="From"  t={t} />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <Field label="To" value={to} onChange={setTo} placeholder="To"  t={t} />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <Field
                label="Date"
                value={date}
                displayValue={isEditingDate ? date : naturalDateLabel(date)}
                onChange={setDate}
                onFocus={() => setIsEditingDate(true)}
                onBlur={() => setIsEditingDate(false)}
                placeholder="Date"
                flex="0 0 158px"
                t={t}
              />

              <button
                className="ar-search-button"
                type="submit"
                disabled={!isValid}
                style={{
                  flex: '0 0 96px',
                  padding: 0,
                  border: 'none',
                  borderLeft: `0.5px solid ${t.btnBorder}`,
                  cursor: (!isValid) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: 'translateY(-0.5px)',
                  gap: '0',
                  background: t.btnBg,
                  color: (!isValid) ? t.btnBorder : t.btnColor,
                  opacity: (!isValid) ? 0.5 : 1,
                  fontSize: '0',
                  fontWeight: 500,
                  letterSpacing: '0',
                  textTransform: 'none',
                  fontFamily: 'inherit',
                  transition: 'color 0.3s, opacity 0.3s',
                }}
              aria-label="Search route"
              >
                <svg width="14" height="9" viewBox="0 0 16 10" fill="none" aria-hidden="true">
                  <path d="M10 1L14 5M14 5L10 9M13.5 5H1.5"
                    stroke="currentColor" strokeWidth="0.72"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
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
