import { useState, type FormEvent, type CSSProperties } from 'react'

// ─── THEME ────────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'

const T = {
  dark: {
    bg:                 '#03030a',
    vignL:              'linear-gradient(to right, #03030a 22%, rgba(3,3,10,0.88) 46%, rgba(3,3,10,0.22) 68%, transparent 100%)',
    vignV:              'linear-gradient(to bottom, rgba(3,3,10,0.6) 0%, transparent 18%, transparent 78%, rgba(3,3,10,0.7) 100%)',
    wordmark:           '#E7E0D5',   // up from 0.52 — readable, still restrained
    wordmarkRadar:      '#C77A32',   // warm amber — "Radar" accent
    navLink:            '#C9C1B5',   // up from 0.28 — subtle but immediately legible
    navLinkHover:       '#F5F2EC',   // up from 0.60
    eyebrow:            '#6F7480',   // up from 0.20 — ~20% more contrast
    line1:              '#F3F4F6',
    line2:              '#B8BBC3',
    lineWhy:            '#F3F4F6',                 // same as line1 — arrival point, full luminance
    instrLabel:         'rgba(190,181,168,0.7)',   // up from 0.14 — FROM/TO/DATE must be visible
    instrBg:            '#111317',
    instrBorder:        'rgba(255,255,255,0.06)',
    instrBorderTop:     'rgba(255,255,255,0.08)',
    instrShadow:        'none',
    fieldLabel:         'rgba(209,200,187,0.6)',   // up from 0.28 — usable label contrast
    fieldValue:         '#F5F2EC',   // up from 0.88
    divider:            'rgba(245,242,236,0.05)',
    btnBorder:          'rgba(245,242,236,0.05)',
    btnBg:              '#111317',
    btnBgHover:         '#111317',
    btnColor:           '#C77A32',    // up from 0.65
    btnColorHover:      '#C77A32',
    footer:             '#BEB6AA',   // up from 0.22 — quiet but readable
    footerHover:        '#E6DED2',   // up from 0.52
    footerToggleActive: '#E6DED2',   // up from 0.45
    footerToggleInact:  '#AAA296',   // up from 0.20
    coord:              '#999186',   // up from 0.10 — metadata, not invisible
  },
  light: {
    // A quiet, warm architectural room: graphite type, mineral paper, and one dark orbital aperture.
    bg:                 '#F2EEE6',
    vignL:              'linear-gradient(to right, #F2EEE6 0%, #F2EEE6 43%, rgba(242,238,230,0.985) 54%, rgba(242,238,230,0.58) 69%, transparent 82%)',
    vignV:              'linear-gradient(to bottom, rgba(242,238,230,0.08) 0%, transparent 16%, transparent 84%, rgba(242,238,230,0.14) 100%)',
    wordmark:           '#28251F',
    wordmarkRadar:      '#C77A32',
    navLink:            '#5B554C',
    navLinkHover:       '#24211C',
    eyebrow:            'rgba(117,109,98,0.8)',
    line1:              '#28251F',
    line2:              'rgba(81,74,65,0.7)',
    lineWhy:            '#1E1B17',
    instrLabel:         'rgba(112,103,92,0.7)',
    instrBg:            '#111317',
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
    footer:             '#70685E',
    footerHover:        '#312D27',
    footerToggleActive: '#312D27',
    footerToggleInact:  '#8B8276',
    coord:              '#8A8175',
  },
} as const

// ─── CITY LIGHTS ──────────────────────────────────────────────────────────────
// [cx, cy, radius, opacity] — SVG 880×880, sphere center (440,440), radius 440
//
// Philosophy: civilizational topology, not city lists.
// The pattern of lights — the corridors, the voids, the clusters —
// should be instantly legible as Earth, not a data visualization.
//
const LIGHTS: [number, number, number, number][] = [

  // ── NORTHWESTERN EUROPE — the original industrial constellation ─────────────
  // UK
  [388, 247, 3.8, 1.0],   // London core
  [387, 244, 1.6, 0.52],  // Greater London sprawl
  [385, 252, 1.4, 0.46],  // Birmingham
  [382, 241, 1.2, 0.38],  // Manchester
  [380, 234, 1.0, 0.34],  // Edinburgh

  // Randstad → Rhine-Ruhr corridor (the most densely lit region on Earth)
  [400, 244, 2.6, 0.88],  // Amsterdam
  [399, 246, 1.8, 0.62],  // Rotterdam
  [398, 249, 1.6, 0.55],  // Brussels/Antwerp
  [402, 253, 1.7, 0.6],   // Cologne
  [404, 251, 1.5, 0.54],  // Ruhr valley
  [404, 248, 2.1, 0.72],  // Hamburg
  [401, 242, 1.2, 0.42],  // Bremen
  [414, 253, 2.9, 0.95],  // Berlin
  [411, 261, 2.4, 0.82],  // Frankfurt–Mannheim
  [407, 260, 1.5, 0.52],  // Stuttgart
  [413, 268, 2.1, 0.72],  // Munich

  // France
  [395, 261, 3.2, 1.0],   // Paris
  [390, 273, 1.2, 0.42],  // Lyon
  [393, 280, 1.4, 0.46],  // Marseille

  // Po Valley — Italy's industrial plain, one of Europe's brightest corridors
  [409, 271, 1.4, 0.52],  // Turin
  [412, 274, 2.7, 0.9],   // Milan
  [414, 275, 1.3, 0.54],  // Brescia
  [416, 274, 1.2, 0.48],  // Venice/Padova
  [414, 278, 1.5, 0.54],  // Bologna
  [417, 288, 2.0, 0.7],   // Rome
  [416, 295, 1.2, 0.4],   // Naples

  // Iberia
  [373, 279, 1.9, 0.64],  // Madrid
  [378, 284, 1.5, 0.52],  // Barcelona
  [366, 290, 1.4, 0.46],  // Lisbon

  // Scandinavia
  [408, 231, 1.5, 0.5],   // Copenhagen
  [413, 222, 1.5, 0.46],  // Stockholm
  [404, 222, 1.1, 0.38],  // Oslo

  // Eastern Europe
  [428, 250, 2.3, 0.78],  // Warsaw
  [422, 257, 1.6, 0.54],  // Prague
  [417, 266, 1.4, 0.5],   // Vienna
  [410, 266, 1.3, 0.46],  // Zurich
  [425, 267, 1.9, 0.65],  // Budapest
  [429, 277, 1.9, 0.65],  // Bucharest
  [430, 239, 1.5, 0.5],   // Vilnius/Riga
  [434, 230, 1.2, 0.38],  // Helsinki
  [420, 288, 1.4, 0.44],  // Athens

  // ── RUSSIA ─────────────────────────────────────────────────────────────────
  // Vast darkness punctuated by a few bright nodes
  [445, 237, 3.0, 0.96],  // Moscow
  [467, 228, 1.5, 0.46],  // St. Petersburg
  [440, 251, 2.1, 0.7],   // Kyiv
  [434, 245, 1.3, 0.46],  // Minsk
  [490, 231, 1.4, 0.44],  // Kazan
  [509, 227, 1.5, 0.46],  // Yekaterinburg

  // ── TURKEY / LEVANT / GULF ─────────────────────────────────────────────────
  [459, 278, 2.3, 0.8],   // Istanbul
  [465, 293, 1.6, 0.54],  // Ankara
  [472, 305, 2.2, 0.75],  // Beirut/Damascus
  [469, 310, 2.6, 0.88],  // Tel Aviv
  [474, 324, 3.0, 0.98],  // Cairo delta core
  [471, 321, 1.6, 0.56],  // Alexandria/Nile delta west
  [477, 322, 1.4, 0.5],   // Nile delta east
  [491, 317, 1.5, 0.52],  // Amman
  [499, 328, 1.9, 0.64],  // Baghdad
  [510, 343, 2.7, 0.92],  // Riyadh
  [517, 355, 3.0, 0.98],  // Dubai/Abu Dhabi
  [504, 359, 1.7, 0.58],  // Doha
  [499, 350, 1.3, 0.44],  // Kuwait

  // ── NORTH / WEST AFRICA ────────────────────────────────────────────────────
  [427, 319, 1.6, 0.54],  // Tunis
  [418, 325, 1.4, 0.5],   // Algiers
  [410, 329, 1.1, 0.38],  // Casablanca

  // ── SUB-SAHARAN AFRICA ─────────────────────────────────────────────────────
  [449, 362, 1.4, 0.44],  // Khartoum
  [448, 388, 1.5, 0.5],   // Nairobi
  [449, 445, 1.9, 0.6],   // Johannesburg
  [444, 459, 1.4, 0.44],  // Cape Town
  [431, 411, 1.3, 0.4],   // Kinshasa
  [417, 391, 1.2, 0.38],  // Lagos
  [414, 373, 1.1, 0.36],  // Abuja

  // ── SOUTH ASIA — the subcontinent arc + Ganges plain corridor ──────────────
  // The Ganges corridor from Delhi to Kolkata is one of the most recognizable
  // features of Earth at night — a river of amber light across north India.
  [539, 327, 2.8, 0.98],  // Karachi
  [547, 337, 2.6, 0.92],  // Mumbai
  [543, 322, 1.3, 0.44],  // Islamabad
  [550, 327, 2.8, 0.98],  // Delhi/NCR
  [553, 328, 1.5, 0.54],  // Delhi sprawl east
  [556, 331, 1.6, 0.58],  // Agra (Ganges corridor)
  [558, 333, 1.5, 0.56],  // Kanpur (corridor)
  [560, 335, 1.4, 0.52],  // Allahabad (corridor)
  [561, 337, 1.3, 0.5],   // Varanasi (corridor)
  [563, 340, 1.8, 0.64],  // Kolkata
  [570, 327, 1.4, 0.46],  // Dhaka
  [556, 353, 2.2, 0.76],  // Bangalore/Chennai/Hyderabad cluster
  [553, 347, 1.4, 0.52],  // Hyderabad
  [567, 352, 1.4, 0.46],  // Colombo

  // ── EAST ASIA — the most luminous region on the planet ─────────────────────

  // Japan: Tokaido megalopolis — Tokyo to Osaka, one continuous corridor
  // The gap over Hakone Mountains between Tokyo and Nagoya is real.
  [614, 294, 3.0, 1.0],   // Tokyo–Yokohama core
  [614, 295, 1.5, 0.68],  // Tokyo sprawl
  [612, 296, 1.2, 0.55],  // Shizuoka (corridor bridge)
  [611, 297, 1.8, 0.82],  // Nagoya
  [610, 298, 2.4, 0.95],  // Osaka–Kobe
  [611, 298, 1.3, 0.65],  // Kyoto (binding node)
  [617, 286, 1.4, 0.44],  // Sapporo

  // Korean Peninsula: the South brilliant, the North void —
  // one of the most striking contrasts visible from orbit.
  [607, 293, 2.8, 0.96],  // Seoul/Incheon
  [608, 295, 1.5, 0.64],  // Daejeon (corridor south)
  [609, 297, 1.8, 0.76],  // Busan/Daegu

  // China
  [601, 299, 2.3, 0.82],  // Beijing/Tianjin
  [603, 301, 1.6, 0.62],  // Tianjin sprawl
  [597, 307, 1.8, 0.65],  // Wuhan
  [599, 312, 1.6, 0.6],   // Changsha
  [609, 310, 2.7, 0.92],  // Shanghai
  [613, 315, 2.3, 0.8],   // Taipei
  [615, 321, 2.3, 0.8],   // Hong Kong/Shenzhen
  [613, 322, 1.6, 0.58],  // Guangzhou
  [596, 318, 1.8, 0.62],  // Chengdu/Chongqing

  // ── SOUTHEAST ASIA ─────────────────────────────────────────────────────────
  [588, 321, 1.6, 0.56],  // Yangon
  [604, 329, 1.9, 0.64],  // Bangkok
  [610, 343, 2.1, 0.72],  // Singapore
  [607, 337, 1.4, 0.52],  // Kuala Lumpur
  [621, 329, 1.3, 0.44],  // Manila
  [615, 350, 1.4, 0.46],  // Jakarta

  // ── EASTERN NORTH AMERICA — BosWash corridor (left sphere edge) ────────────
  // One unbroken river of light from Boston to Washington.
  [282, 277, 1.5, 0.42],  // Boston
  [288, 283, 2.7, 0.62],  // New York core
  [289, 286, 1.3, 0.48],  // New York sprawl / Philadelphia
  [292, 293, 2.0, 0.55],  // Washington DC
  [298, 307, 1.5, 0.42],  // Atlanta
  [302, 320, 1.4, 0.38],  // Miami
  [265, 287, 1.9, 0.5],   // Chicago/Great Lakes
  [269, 293, 1.5, 0.46],  // Detroit/Cleveland

  // ── AUSTRALIA ──────────────────────────────────────────────────────────────
  [637, 430, 1.5, 0.48],  // Sydney
  [631, 436, 1.2, 0.42],  // Melbourne
  [644, 418, 1.1, 0.36],  // Brisbane
]

// ─── BREATHE GROUPS ───────────────────────────────────────────────────────────
const BREATHE = [
  { kf: 'ar-breathe-a', dur: '4.3s',  delay: '0s'    },
  { kf: 'ar-breathe-b', dur: '6.7s',  delay: '-2.2s' },
  { kf: 'ar-breathe-c', dur: '5.6s',  delay: '-1.1s' },
  { kf: 'ar-breathe-d', dur: '7.4s',  delay: '-3.5s' },
  { kf: 'ar-breathe-e', dur: '4.9s',  delay: '-0.7s' },
] as const

const BREATHE_GROUPS = Array.from(
  { length: 5 },
  (_, gi) => LIGHTS.filter((_, li) => li % 5 === gi)
)

// ─── GLOBE ────────────────────────────────────────────────────────────────────
// Major clusters only for the outermost bloom — these merge into regional
// illumination zones the way real city light halos do from orbit.

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
      <svg width="1060" height="1060" viewBox="0 0 880 880" style={{ overflow: 'visible' }}>
        <defs>
          {/* The source image already contains the real atmospheric scattering. */}
        </defs>

        {/* ── Authentic orbital plate ─────────────────────────────────────
            The NASA frame is deliberately left unmasked. Its own uneven horizon,
            cloud scatter and black field determine where Earth resolves into space.
            Screen blending makes the photographic blacks inherit the page canvas,
            so there is no composited edge, glow, or geometric boundary. */}
        <g style={{ animation: 'ar-photo-drift 420s ease-in-out infinite alternate' }}>
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
  t: typeof T['dark']
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
function NavLink({ children, t }: { children: string; t: typeof T['dark'] }) {
  const [hover, setHover] = useState(false)
  return (
    <a
      href="#"
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
function FooterLink({ children, t, onClick }: { children: string; t: typeof T['dark']; onClick?: () => void }) {
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
    cursor: onClick ? 'pointer' : 'default',
    fontFamily: 'inherit',
  }
  return onClick
    ? <button style={style} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{children}</button>
    : <a href="#" style={style} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{children}</a>
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme]   = useState<Theme>('dark')
  const [from, setFrom]     = useState('')
  const [to, setTo]         = useState('')
  const [date, setDate]     = useState('')
  const [isEditingDate, setIsEditingDate] = useState(false)
  const [btnHover, setBtnHover] = useState(false)

  const t  = T[theme]
  const PX = 'clamp(64px, 7.5vw, 120px)'

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (date) params.set('date', date)
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
      {/* Globe — the only moving element */}
      <Globe theme={theme} />

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
        <span style={{
          fontSize: '13px',
          fontWeight: 400,
          letterSpacing: '0.06em',
          lineHeight: 1,
        }}>
          <span style={{ color: t.wordmark, transition: 'color 0.4s ease' }}>Award</span>
          <span style={{ color: t.wordmarkRadar, transition: 'color 0.4s ease' }}>Radar</span>
        </span>

        <div className="ar-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <NavLink t={t}>About</NavLink>
          <NavLink t={t}>Methodology</NavLink>
          <NavLink t={t}>Sign in</NavLink>
        </div>
      </nav>

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
        paddingBottom: '8vh',
        maxWidth: '560px',
      }}>

        {/* Eyebrow */}
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
        <div style={{ marginBottom: '72px' }}>
          {/* Couplet one */}
          <p style={{
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
          <p style={{
            margin: '0 0 calc(2em + 24px) 0',
            fontSize: 'clamp(28px, 3vw, 42px)',
            fontWeight: 500,
            lineHeight: 1.22,
            letterSpacing: '-0.018em',
            color: t.line1,
            transition: 'color 0.4s ease',
          }}>
            what to book.
          </p>

          {/* Couplet two — space guides the eye inevitably to "why." */}
          <p style={{
            margin: '0 0 0.15em 0',
            fontSize: 'clamp(28px, 3vw, 42px)',
            fontWeight: 340,
            lineHeight: 1.22,
            letterSpacing: '-0.012em',
            color: t.line2,
            transition: 'color 0.4s ease',
          }}>
            We help you understand
          </p>
          <p style={{
            margin: '1.4em 0 0 0',
            fontSize: 'clamp(28px, 3vw, 42px)',
            fontWeight: 380,
            lineHeight: 1.22,
            letterSpacing: '-0.014em',
            color: t.lineWhy,
            transition: 'color 0.4s ease',
          }}>
            why.
          </p>
        </div>

        {/* ── Search instrument ── */}
        <div>
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
              <Field label="From" value={from} onChange={setFrom} placeholder="Frankfurt" technicalCode="FRA" t={t} />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <Field label="To" value={to} onChange={setTo} placeholder="New York" technicalCode="JFK" t={t} />
              <div className="ar-divider" style={{ width: '0.5px', background: t.divider, margin: '17px 0', flexShrink: 0 }} />
              <Field
                label="Date"
                value={date}
                displayValue={isEditingDate ? date : naturalDateLabel(date)}
                onChange={setDate}
                onFocus={() => setIsEditingDate(true)}
                onBlur={() => setIsEditingDate(false)}
                placeholder="Tomorrow"
                flex="0 0 158px"
                t={t}
              />

              <button
                className="ar-search-button"
                type="submit"
                style={{
                  flex: '0 0 96px',
                  padding: 0,
                  border: 'none',
                  borderLeft: `0.5px solid ${t.btnBorder}`,
                  cursor: 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: 'translateY(-0.5px)',
                  gap: '0',
                  background: t.btnBg,
                  color: t.btnColor,
                  fontSize: '0',
                  fontWeight: 500,
                  letterSpacing: '0',
                  textTransform: 'none',
                  fontFamily: 'inherit',
                  transition: 'none',
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
      </div>

      {/* ── Footer ── */}
      <footer className="ar-footer" style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
        paddingBottom: '3.5vh',
        paddingLeft: PX,
        paddingRight: PX,
      }}>
        {/* Left — legal + identity */}
        <div className="ar-footer-links" style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <FooterLink t={t}>Privacy</FooterLink>
          <FooterLink t={t}>Imprint</FooterLink>
          <FooterLink t={t}>Accessibility</FooterLink>
          <FooterLink t={t} onClick={toggleTheme}>Theme</FooterLink>
          <span style={{ fontSize: '9px', fontWeight: 400, letterSpacing: '0.09em', color: t.footer, lineHeight: 1 }}>
            @AwardRadar
          </span>
        </div>

        {/* Right — orbital precision detail */}
        <div aria-hidden="true" style={{
          fontSize: '7px',
          fontWeight: 500,
          letterSpacing: '0.22em',
          color: t.coord,
          textTransform: 'uppercase',
          lineHeight: 1,
          transition: 'color 0.4s ease',
        }}>
          51°N 0°E · 35,786 km
        </div>
      </footer>
    </div>
  )
}
