import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

// Mock matchMedia for motion
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('App', () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // clear url params
    window.history.pushState({}, 'Test Title', '/app');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const setupUrlParams = (from = 'FRA', to = 'JFK', date = '2030-01-01') => {
    window.history.pushState({}, 'Test Title', `/app?from=${from}&to=${to}&date=${date}`);
  };

  const getButton = (container: HTMLElement) => container.querySelector('[data-testid="analyze-button"]') as HTMLElement;

  it('does not fetch on mount', () => {
    const { container } = render(<App />);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks fetch on invalid input', async () => {
    // Missing URL params
    const r1 = render(<App />);
    fireEvent.click(getButton(r1.container));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(r1.container.querySelector('[data-testid="validation-error"]')?.textContent).toContain('Origin is required');
    r1.unmount();

    // Invalid date
    setupUrlParams('FRA', 'JFK', 'invalid');
    const r2 = render(<App />);
    fireEvent.click(getButton(r2.container));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(r2.container.querySelector('[data-testid="validation-error"]')?.textContent).toContain('valid future date');
    r2.unmount();
  });

  it('fetches with exact request payload and shows loading state', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, results: [{ decision: {} }] })
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    expect(container.querySelector('[data-testid="loading-state"]')).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/awards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lang: 'en',
        origin: 'FRA',
        dest: 'JFK',
        date: '2030-10-10',
        oneWay: true,
        returnDate: '',
        direct: false,
        mmOnly: false,
        currency: 'eur',
        cabin: 'Economy',
        cabins: ['Economy'],
        flexDays: 0
      })
    });
  });

  it('shows API error state', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    await waitFor(() => {
      expect(container.querySelector('[data-testid="error-state"]')).not.toBeNull();
    });
  });

  it('shows empty state when no results', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, results: [] })
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    });
  });

  it('renders both signals (cash + awards)', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{
          origin: 'FRA', dest: 'JFK', date: '2030-10-10',
          cash_eur: 500,
          verified_identical_routing: true,
          programs: [{ program: 'Miles & More', miles: 30000, surcharge: 100 }],
          decision: { signal: 'strong_miles_value', confidence: 'high' }
        }]
      })
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    await waitFor(() => {
      expect(container.querySelector('[data-testid="decision-summary"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="award-candidate"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="cash-comparison"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="routing-disclosure"]')).toBeNull();
      expect(container.querySelector('[data-testid="decision-verdict"]')?.textContent).toContain('Strong Award Value');
    });
  });

  it('renders award-only state (no cash_eur)', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{
          origin: 'FRA', dest: 'JFK', date: '2030-10-10',
          cash_eur: null,
          programs: [{ program: 'Miles & More', miles: 30000, surcharge: 100 }],
          decision: { signal: 'strong_miles_value', confidence: 'high' }
        }]
      })
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    await waitFor(() => {
      expect(container.querySelector('[data-testid="award-candidate"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="cash-comparison"]')).toBeNull();
    });
  });

  it('renders cash-comparison-only state (no programs)', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{
          origin: 'FRA', dest: 'JFK', date: '2030-10-10',
          cash_eur: 500,
          programs: [],
          decision: { signal: 'cash_preferred', confidence: 'high' }
        }]
      })
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    await waitFor(() => {
      expect(container.querySelector('[data-testid="award-candidate"]')).toBeNull();
      expect(container.querySelector('[data-testid="cash-comparison"]')).not.toBeNull();
    });
  });

  it('shows missing routing disclosure when verified_identical_routing is false', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{
          origin: 'FRA', dest: 'JFK', date: '2030-10-10',
          cash_eur: 500,
          verified_identical_routing: false, // triggers disclosure
          programs: [],
          decision: { signal: 'unknown', confidence: 'low' }
        }]
      })
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    
    await waitFor(() => {
      expect(container.querySelector('[data-testid="routing-disclosure"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="decision-verdict"]')?.textContent).toContain('More Evidence Required');
    });
  });
});
