// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import App, { buildAppSearchUrl, readInitialSearchFromUrl, INITIAL_NAV_DELAY_MS } from './App'

const landingCss = readFileSync('src/index.css', 'utf8')
const landingTemplate = readFileSync('../../../templates/landing.html', 'utf8')

const mediaQueryResult = (query: string, reducedMotion = true) => ({
  matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => mediaQueryResult(query)),
})
Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  value: vi.fn().mockImplementation((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }),
})
Object.defineProperty(window, 'cancelAnimationFrame', { writable: true, value: vi.fn() })

class MockIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: MockIntersectionObserver })
Object.defineProperty(globalThis, 'IntersectionObserver', { writable: true, value: MockIntersectionObserver })
Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, value: vi.fn() })

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const installImmediateAnimationFrames = () => {
  vi.mocked(window.requestAnimationFrame).mockImplementation((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.mocked(window.cancelAnimationFrame).mockImplementation(() => undefined)
}

const elementRect = (top: number, height = 500, width = 390): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: width,
  width,
  height,
  x: 0,
  y: top,
  toJSON: () => ({}),
})

describe('Landing initial search navigation', () => {
  let nextFrameId = 0
  let frames = new Map<number, FrameRequestCallback>()

  const flushFrame = () => {
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
    if (!next) return false
    const [id, callback] = next
    frames.delete(id)
    act(() => callback(id * 16))
    return true
  }

  const flushFrames = (count: number) => {
    for (let index = 0; index < count && flushFrame(); index += 1) {
      // Drain only the requested bounded number of animation frames.
    }
  }

  // Advance past the narrative pause so the single automatic transition arms.
  const runNarrativePause = () => {
    act(() => vi.advanceTimersByTime(INITIAL_NAV_DELAY_MS))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Fake only the pause timer; the frame queue stays under manual control.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    window.history.pushState({}, '', '/')
    vi.mocked(window.matchMedia).mockImplementation((query: string) => mediaQueryResult(query, false))
    mockFetch.mockRejectedValue(new Error('Unexpected network access'))
    nextFrameId = 0
    frames = new Map()
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    })
    vi.mocked(window.cancelAnimationFrame).mockImplementation((id: number) => {
      frames.delete(id)
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    installImmediateAnimationFrames()
    window.history.pushState({}, '', '/')
  })

  it('waits for the narrative pause, then navigates once after two frames without focusing', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    // No animation frame is scheduled until the pause elapses.
    expect(frames.size).toBe(0)
    expect(scroll).not.toHaveBeenCalled()

    runNarrativePause()
    expect(frames.size).toBe(1)
    flushFrame()
    expect(scroll).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    flushFrame()

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(focus).not.toHaveBeenCalled()
  })

  it('does nothing when the search target does not exist', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const getElementById = vi.spyOn(document, 'getElementById')
    const originalGetElementById = getElementById.getMockImplementation()
    getElementById.mockImplementation((id: string) => {
      if (id === 'route-search') return null
      return originalGetElementById ? originalGetElementById(id) : document.querySelector(`#${id}`)
    })

    render(<App />)
    runNarrativePause()
    flushFrames(2)

    expect(scroll).not.toHaveBeenCalled()
  })

  it('does nothing while the search target has no real bounding box', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844, 0, 0))

    runNarrativePause()
    flushFrames(2)

    expect(scroll).not.toHaveBeenCalled()
  })

  it('still navigates under Reduced Motion and uses immediate behavior', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => mediaQueryResult(query, true))
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    runNarrativePause()
    flushFrames(2)

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('is not cancelled by early pointer, touch or theme interaction', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    fireEvent.pointerDown(window)
    fireEvent.touchStart(window)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle light/dark mode' }))
    runNarrativePause()
    flushFrames(2)

    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('stands the pending transition down after a real manual scroll', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    // A genuine page movement before the pause elapses.
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 600 })
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    fireEvent.scroll(window)
    runNarrativePause()
    flushFrames(4)

    expect(scroll).not.toHaveBeenCalled()
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 })
  })

  it('ignores a spurious 0-offset scroll and still navigates', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 })
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    fireEvent.scroll(window)
    runNarrativePause()
    flushFrames(2)

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('stands the pending transition down when the reader engages the search', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    fireEvent.focusIn(screen.getByLabelText('From'))
    runNarrativePause()
    flushFrames(4)

    expect(scroll).not.toHaveBeenCalled()
  })

  it('performs at most one immediate correction when the target remains outside the viewport', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    runNarrativePause()
    flushFrames(30)

    expect(scroll).toHaveBeenCalledTimes(2)
    expect(scroll).toHaveBeenNthCalledWith(1, { behavior: 'smooth', block: 'start' })
    expect(scroll).toHaveBeenNthCalledWith(2, { behavior: 'auto', block: 'start' })
    flushFrames(30)
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('corrects a BFCache return only when the target is no longer visible', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    const targetRect = vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(100))
    runNarrativePause()
    flushFrames(3)
    scroll.mockClear()
    targetRect.mockReturnValue(elementRect(844))

    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    flushFrame()

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('leaves an already visible BFCache target untouched', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(100))
    runNarrativePause()
    flushFrames(3)
    scroll.mockClear()

    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    flushFrame()

    expect(scroll).not.toHaveBeenCalled()
  })

  it('keeps the explicit CTA functional independently of a pending automatic navigation', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus')
    render(<App />)
    const target = document.getElementById('route-search')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(elementRect(844))

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to route search' }))
    flushFrames(30)

    const targetScrolls = scroll.mock.contexts
      .map((context, index) => ({ context, args: scroll.mock.calls[index] }))
      .filter(call => call.context === target)
    expect(targetScrolls).toHaveLength(1)
    expect(targetScrolls[0]?.args).toEqual([{ behavior: 'smooth', block: 'start' }])
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('Landing round-trip search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installImmediateAnimationFrames()
    vi.mocked(window.matchMedia).mockImplementation((query: string) => mediaQueryResult(query))
    mockFetch.mockRejectedValue(new Error('Unexpected network access'))
  })

  afterEach(() => cleanup())

  it('defaults_to_one_way_and_hides_return_date', () => {
    const { container } = render(<App />)
    expect((screen.getByRole('radio', { name: 'One-way' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('Return date')).toBeNull()
    expect(container.querySelector('.ar-instrument--round-trip')).toBeNull()
    expect((screen.getByLabelText('From') as HTMLInputElement).getAttribute('placeholder')).toBe('FRA, Frankfurt')
    expect((screen.getByLabelText('To') as HTMLInputElement).getAttribute('placeholder')).toBe('JFK, New York')
  })

  it('shows_return_date_for_round_trip', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    expect(screen.getByLabelText('Return date')).toBeTruthy()
    const instrument = container.querySelector('.ar-instrument--round-trip')
    expect(instrument).toBeTruthy()
    expect(instrument?.querySelector('.ar-field--from')).toBeTruthy()
    expect(instrument?.querySelector('.ar-field--to')).toBeTruthy()
    expect(instrument?.querySelector('.ar-field--date')).toBeTruthy()
    expect(instrument?.querySelector('.ar-field--return')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Analyze route' })).toBeTruthy()
  })

  it('keeps_round_trip_desktop_width_constraints_scoped_to_its_layout_marker', () => {
    expect(landingCss).toContain('.ar-instrument--round-trip .ar-field--from')
    expect(landingCss).toContain('.ar-instrument--round-trip .ar-field--return')
    expect(landingCss).toContain('min-width: 156px')
    expect(landingCss).toContain('flex: 0 0 140px')
  })

  it('does_not_show_round_trip_validation_before_interaction', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    expect(screen.queryByText('Select a return date.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Analyze route' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows_round_trip_validation_after_submit_attempt', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    fireEvent.submit(container.querySelector('.ar-instrument-form') as HTMLFormElement)
    expect(screen.getByText('Select a return date.')).toBeTruthy()
  })

  it('shows_round_trip_validation_after_return_field_interaction', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    fireEvent.focus(screen.getByLabelText('Return date'))
    expect(screen.getByText('Select a return date.')).toBeTruthy()
  })

  it('rejects_return_before_departure', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    fireEvent.change(screen.getByLabelText('Departure date'), { target: { value: '2030-10-20' } })
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2030-10-19' } })
    expect(screen.getByText('Return date must not be before the departure date.')).toBeTruthy()
  })

  it('generates_round_trip_url', () => {
    expect(buildAppSearchUrl('FRA', 'JFK', '2030-10-10', 'round_trip', '2030-10-20')).toBe(
      '/app?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20',
    )
  })

  it('generates_backward_compatible_one_way_url', () => {
    expect(buildAppSearchUrl('FRA', 'JFK', '2030-10-10', 'one_way', '2030-10-20')).toBe(
      '/app?from=FRA&to=JFK&date=2030-10-10',
    )
  })

  it('switching_back_to_one_way_clears_return_date', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2030-10-20' } })
    fireEvent.click(screen.getByRole('radio', { name: 'One-way' }))
    expect(screen.queryByLabelText('Return date')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    expect((screen.getByLabelText('Return date') as HTMLInputElement).value).toBe('')
  })

  it('keeps_trip_controls_keyboard_accessible', () => {
    render(<App />)
    const group = screen.getByRole('group', { name: 'Trip type' })
    const oneWay = screen.getByRole('radio', { name: 'One-way' })
    const roundTrip = screen.getByRole('radio', { name: 'Round-trip' })
    expect(group.contains(oneWay)).toBe(true)
    expect(group.contains(roundTrip)).toBe(true)
    roundTrip.focus()
    expect(document.activeElement).toBe(roundTrip)
  })

  it('footer_links_official_x_profile_and_exposes_info_links', () => {
    render(<App />)
    // The confirmed official AwardRadar X profile is linked from the footer.
    // The icon is an inline monochrome SVG — never a raster image, never the
    // legacy Twitter bird.
    const x = screen.getByRole('link', { name: 'AwardRadar on X' })
    expect(x.getAttribute('href')).toBe('https://x.com/AwardRadar')
    expect(x.getAttribute('target')).toBe('_blank')
    expect(x.getAttribute('rel')).toContain('noopener')
    expect(document.querySelector('img[src*="x-logo.png"]')).toBeNull()
    // About and Methodology live in the footer (also reachable on mobile,
    // where the header nav links are hidden).
    const footer = document.querySelector('footer')!
    expect(footer.querySelector('a[href="/about"]')).toBeTruthy()
    expect(footer.querySelector('a[href="/methodology"]')).toBeTruthy()
    expect(footer.querySelector('a[href="/privacy"]')).toBeTruthy()
    expect(footer.querySelector('a[href="/impressum"]')).toBeTruthy()
  })

  it('keeps_mobile_dom_order', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    const nodes = [
      screen.getByRole('group', { name: 'Trip type' }),
      screen.getByLabelText('From'),
      screen.getByLabelText('To'),
      screen.getByLabelText('Departure date'),
      screen.getByLabelText('Return date'),
      screen.getByRole('button', { name: 'Analyze route' }),
    ]
    nodes.slice(0, -1).forEach((node, index) => {
      expect(node.compareDocumentPosition(nodes[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  it('uses_one_stable_navigation_target_after_early_pointer_input', () => {
    render(<App />)
    const target = document.getElementById('route-search')!
    const from = screen.getByLabelText('From') as HTMLInputElement
    const targetScroll = vi.spyOn(target, 'scrollIntoView')
    const focus = vi.spyOn(from, 'focus')
    vi.spyOn(from, 'getBoundingClientRect').mockReturnValue({
      top: 120, bottom: 144, left: 20, right: 280, width: 260, height: 24, x: 20, y: 120, toJSON: () => ({}),
    })

    fireEvent.pointerDown(window)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to route search' }))

    expect(targetScroll).toHaveBeenCalledTimes(1)
    expect(targetScroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.querySelectorAll('#route-search')).toHaveLength(1)
    expect(document.getElementById('act-2')).toBeNull()
  })

  it('uses_smooth_navigation_when_reduced_motion_is_not_requested', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => mediaQueryResult(query, false))
    render(<App />)
    const target = document.getElementById('route-search')!
    const targetScroll = vi.spyOn(target, 'scrollIntoView')

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to route search' }))

    expect(targetScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('protects_iPhone_viewport_and_mobile_input_sizes', () => {
    expect(landingTemplate).toContain('viewport-fit=cover')
    expect(landingCss).toContain('--ar-page-pad: clamp(20px, 6vw, 32px)')
    expect(landingCss).toContain('scroll-margin-top: calc(env(safe-area-inset-top, 0px) + 16px)')
    expect(landingCss).toContain('.ar-date-input')
    expect(landingCss).toContain('font-size: max(16px, 1rem) !important')
  })

  it('keeps_the_mobile_search_surface_compact_and_light_mode_coherent', () => {
    expect(landingCss).toContain('min-height: clamp(420px, 58svh, 520px) !important')
    expect(landingCss).toContain('bottom: max(36px, env(safe-area-inset-bottom, 0px)) !important')
    expect(landingCss).toContain('min-height: 75svh !important')
    expect(landingCss).toContain("[data-theme='light'] .ar-analyze-button:disabled")
    expect(landingCss).toContain('background: #e9eff2 !important')

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle light/dark mode' }))
    const instrument = document.querySelector('.ar-instrument') as HTMLElement
    const from = screen.getByLabelText('From') as HTMLInputElement
    expect(instrument.style.background).toBe('rgb(255, 255, 255)')
    expect(from.style.color).toBe('rgb(23, 32, 51)')
  })
})

describe('Landing URL hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installImmediateAnimationFrames()
    vi.mocked(window.matchMedia).mockImplementation((query: string) => mediaQueryResult(query))
    mockFetch.mockRejectedValue(new Error('Unexpected network access'))
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    cleanup()
    window.history.pushState({}, '', '/')
  })

  const fromInput = () => screen.getByLabelText('From') as HTMLInputElement
  const toInput = () => screen.getByLabelText('To') as HTMLInputElement
  const departureInput = () => screen.getByLabelText('Departure date') as HTMLInputElement
  const analyzeButton = () => screen.getByRole('button', { name: 'Analyze route' }) as HTMLButtonElement

  it('parses valid params and rejects malformed ones (pure helper)', () => {
    expect(readInitialSearchFromUrl('?from=hel&to=LON&date=2030-10-10')).toEqual({
      from: 'HEL', fromCode: 'HEL', to: 'LON', toCode: 'LON',
      date: '2030-10-10', tripType: 'one_way', returnDate: '',
    })
    expect(readInitialSearchFromUrl('?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20').returnDate).toBe('2030-10-20')
    expect(readInitialSearchFromUrl('?from=HEL&to=LON&date=2030-10-10&returnDate=2030-10-20').returnDate).toBe('')
    expect(readInitialSearchFromUrl('?trip=weird').tripType).toBe('one_way')
    expect(readInitialSearchFromUrl('?from=Munich&to=L&date=not-a-date')).toEqual({
      from: '', fromCode: '', to: '', toCode: '', date: '', tripType: 'one_way', returnDate: '',
    })
  })

  it('one-way params populate the form', () => {
    window.history.pushState({}, '', '/?from=HEL&to=LON&date=2030-10-10')
    render(<App />)
    expect(fromInput().value).toBe('HEL')
    expect(toInput().value).toBe('LON')
    expect(departureInput().value).toBe('2030-10-10')
    expect((screen.getByRole('radio', { name: 'One-way' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('Return date')).toBeNull()
    expect(analyzeButton().disabled).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('round-trip params populate all fields', () => {
    window.history.pushState({}, '', '/?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20')
    render(<App />)
    expect(fromInput().value).toBe('FRA')
    expect(toInput().value).toBe('JFK')
    expect(departureInput().value).toBe('2030-10-10')
    expect((screen.getByRole('radio', { name: 'Round-trip' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Return date') as HTMLInputElement).value).toBe('2030-10-20')
    expect(analyzeButton().disabled).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('missing params preserve normal defaults', () => {
    render(<App />)
    expect(fromInput().value).toBe('')
    expect(toInput().value).toBe('')
    expect(departureInput().value).toBe('')
    expect((screen.getByRole('radio', { name: 'One-way' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('Return date')).toBeNull()
    expect(analyzeButton().disabled).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a malformed date safely while keeping valid airports', () => {
    window.history.pushState({}, '', '/?from=HEL&to=LON&date=not-a-date')
    render(<App />)
    expect(fromInput().value).toBe('HEL')
    expect(toInput().value).toBe('LON')
    expect(departureInput().value).toBe('')
    expect(analyzeButton().disabled).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects malformed airport codes safely', () => {
    window.history.pushState({}, '', '/?from=Munich&to=L&date=2030-10-10')
    render(<App />)
    expect(fromInput().value).toBe('')
    expect(toInput().value).toBe('')
    expect(departureInput().value).toBe('2030-10-10')
    expect(analyzeButton().disabled).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('ignores returnDate for a one-way link', () => {
    window.history.pushState({}, '', '/?from=HEL&to=LON&date=2030-10-10&returnDate=2030-10-20')
    render(<App />)
    expect((screen.getByRole('radio', { name: 'One-way' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('Return date')).toBeNull()
    // The stray returnDate is not carried into a later round-trip toggle.
    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    expect((screen.getByLabelText('Return date') as HTMLInputElement).value).toBe('')
  })

  it('lets the user edit fields after hydration without reverting to URL values', () => {
    window.history.pushState({}, '', '/?from=HEL&to=LON&date=2030-10-10')
    render(<App />)
    fireEvent.change(departureInput(), { target: { value: '2030-12-01' } })
    expect(departureInput().value).toBe('2030-12-01')

    fireEvent.click(screen.getByRole('radio', { name: 'Round-trip' }))
    expect(fromInput().value).toBe('HEL')
    expect(toInput().value).toBe('LON')
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2030-12-10' } })
    expect((screen.getByLabelText('Return date') as HTMLInputElement).value).toBe('2030-12-10')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('makes no automatic API calls on hydration', () => {
    window.history.pushState({}, '', '/?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20')
    render(<App />)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
