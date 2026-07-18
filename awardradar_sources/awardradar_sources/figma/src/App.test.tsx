// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import App, { buildAppSearchUrl } from './App'

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

  it('renders_footer_x_link_with_safe_external_attributes_and_local_icon', () => {
    render(<App />)
    expect(screen.getByText('@awardradar')).toBeTruthy()
    const xLink = screen.getByRole('link', { name: 'AwardRadar on X' })
    expect(xLink.getAttribute('href')).toBe('https://x.com/awardradar')
    expect(xLink.getAttribute('target')).toBe('_blank')
    expect(xLink.getAttribute('rel')).toBe('noopener noreferrer')
    const icon = xLink.querySelector('img')
    expect(icon).toBeTruthy()
    expect(icon?.getAttribute('src')).toContain('x-logo.png')
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
