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
    const r1 = render(<App />);
    fireEvent.click(getButton(r1.container));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(r1.container.querySelector('[data-testid="validation-error"]')?.textContent).toContain('Origin is required');
    r1.unmount();

    setupUrlParams('FRA', 'JFK', 'invalid');
    const r2 = render(<App />);
    fireEvent.click(getButton(r2.container));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(r2.container.querySelector('[data-testid="validation-error"]')?.textContent).toContain('valid future date');
    r2.unmount();
  });

  it('fetches both endpoints with exact request payload and shows loading state', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');

    mockFetch.mockImplementation(async (url) => {
      return { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown' } }], offers: [] }) };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    expect(container.querySelector('[data-testid="loading-state"]')).not.toBeNull();

    const expectedPayload = JSON.stringify({
      lang: 'en', origin: 'FRA', dest: 'JFK', date: '2030-10-10',
      oneWay: true, returnDate: '', direct: false, mmOnly: false,
      currency: 'eur', cabin: 'Economy', cabins: ['Economy'], flexDays: 0
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/awards', expect.objectContaining({
      method: 'POST', body: expectedPayload
    }));
    expect(mockFetch).toHaveBeenCalledWith('/api/cheap', expect.objectContaining({
      method: 'POST', body: expectedPayload
    }));
  });

  it('shows API error state when BOTH endpoints fail', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="error-state"]')).not.toBeNull();
    });
  });

  it('shows empty state when BOTH endpoints have no results', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      return { ok: true, json: async () => ({ ok: true, results: [], offers: [] }) };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    });
  });

  it('renders both cash and awards when both succeed', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return {
        ok: true,
        json: async () => ({
          ok: true,
          results: [{
            origin: 'FRA', dest: 'JFK', date: '2030-10-10',
            cash_eur: 500, verified_identical_routing: true,
            programs: [{ program: 'Miles & More', miles: 30000, surcharge: 100 }],
            decision: { signal: 'strong_miles_value', confidence: 'high', trip_basis_compatible: true }
          }]
        })
      };
      if (url === '/api/cheap') return {
        ok: true,
        json: async () => ({
          ok: true,
          offers: [{
            price: 499, currency: 'EUR', airline: 'Lufthansa',
            dep_time: '10:00', arr_time: '14:00', stops: 0, durationMin: 240, time_data_status: 'complete'
          }]
        })
      };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="decision-summary"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="cash-candidate-card"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="limited-comparison-disclaimer"]')).toBeNull();
    });
  });

  it('shows missing routing disclosure and limited comparison when verified_identical_routing is false', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return {
        ok: true,
        json: async () => ({
          ok: true,
          results: [{
            origin: 'FRA', dest: 'JFK', date: '2030-10-10',
            cash_eur: 500, verified_identical_routing: false,
            programs: [], decision: { signal: 'unknown', confidence: 'low' }
          }]
        })
      };
      if (url === '/api/cheap') return {
        ok: true,
        json: async () => ({
          ok: true,
          offers: [{ price: 500, airline: 'Lufthansa', time_data_status: 'complete' }]
        })
      };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="routing-disclosure"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="limited-comparison-disclaimer"]')).not.toBeNull();
    });
  });

  it('shows missing cash times disclosure when time_data_status is unavailable', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown' } }] }) };
      if (url === '/api/cheap') return {
        ok: true,
        json: async () => ({
          ok: true,
          offers: [{ price: 500, airline: 'Lufthansa', time_data_status: 'unavailable' }]
        })
      };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="missing-cash-times-disclosure"]')).not.toBeNull();
    });
  });

  it('only cash succeeds', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => ({ ok: true, results: [] }) };
      if (url === '/api/cheap') return { ok: true, json: async () => ({ ok: true, offers: [{ price: 500, airline: 'Lufthansa' }] }) };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="decision-summary"]')).toBeNull();
      expect(container.querySelector('[data-testid="cash-candidate-card"]')).not.toBeNull();
    });
  });

  it('only awards succeeds', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown' } }] }) };
      if (url === '/api/cheap') return { ok: true, json: async () => ({ ok: true, offers: [] }) };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="decision-summary"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="cash-candidate-card"]')).toBeNull();
    });
  });
});
