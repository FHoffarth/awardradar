// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import App, { buildAppSearchUrl, readInitialSearchFromUrl } from './App'

const landingCss = readFileSync('src/index.css', 'utf8')

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

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

describe('Landing round-trip search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('footer_has_no_x_twitter_link_and_exposes_info_links', () => {
    render(<App />)
    // Beta rescue: the X/Twitter link and its logo image were removed.
    expect(screen.queryByText('@awardradar')).toBeNull()
    expect(screen.queryByRole('link', { name: 'AwardRadar on X' })).toBeNull()
    expect(document.querySelector('img[src*="x-logo.png"]')).toBeNull()
    // About and Methodology now live in the footer (also reachable on mobile,
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
})

describe('Landing URL hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
