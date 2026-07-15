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
    Object.defineProperty(window, 'print', { writable: true, value: vi.fn() });
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
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/awards')).toHaveLength(1);
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/cheap')).toHaveLength(1);
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

  it('keeps Award visible and renders the neutral quota-degraded Cash state', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{
        origin: 'FRA', dest: 'JFK', date: '2030-10-10', cash_eur: null,
        programs: [{ program: 'Miles & More', miles: 30000, surcharge: 100, grade: { tier: 'great' } }],
        decision: { signal: 'insufficient_data', confidence: 'low' }, has_live_data: false,
      }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [], cash_provenance: {
        status: 'unavailable', provider: 'serpapi', observed_at: null,
        cache_age_seconds: null, fallback_reason: 'quota_exhausted',
      } }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(screen.getByText('Current cash comparison unavailable')).toBeTruthy();
      expect(screen.getByText('Award results can still be reviewed, but relative value cannot be fully assessed without a current cash fare.')).toBeTruthy();
      expect(screen.getByText('Promising award signal')).toBeTruthy();
      expect(screen.getByText('A current cash comparison is unavailable, so the relative value cannot be fully assessed.')).toBeTruthy();
      expect(container.querySelector('[data-testid="award-candidate-card"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="error-state"]')).toBeNull();
      expect(container.textContent).not.toContain('quota_exhausted');
      expect(mockFetch.mock.calls.filter(([url]) => url === '/api/awards')).toHaveLength(1);
      expect(mockFetch.mock.calls.filter(([url]) => url === '/api/cheap')).toHaveLength(1);
    });
  });

  it('keeps normal strong wording and the populated Cash card when Cash succeeds', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{
        origin: 'FRA', dest: 'JFK', date: '2030-10-10', cash_eur: 500,
        programs: [{ program: 'Miles & More', miles: 30000, surcharge: 100 }],
        decision: { signal: 'strong_miles_value', confidence: 'high' },
        verified_identical_routing: true, has_live_data: true,
      }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [{ price: 500, currency: 'EUR', airline: 'Lufthansa' }] }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(screen.getByText('Strong Award Value')).toBeTruthy();
      expect(container.querySelector('[data-testid="cash-candidate-card"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="cash-unavailable-state"]')).toBeNull();
    });
  });

  it('keeps partial success visible when the other pane errors', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') throw new Error('Award provider unavailable');
      return { ok: true, json: async () => ({ ok: true, offers: [{ price: 477, airline: 'Cash Only Air' }] }) };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="cash-candidate-card"]')?.textContent).toContain('Cash Only Air');
      expect(container.querySelector('[data-testid="award-pane-error"]')).not.toBeNull();
    });
  });

  it('keeps Cash and Award response fields isolated', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => ({
        ok: true,
        results: [{ origin: 'FRA', dest: 'JFK', date: '2030-10-10', programs: [{ program: 'Award Program X', miles: 42424, surcharge: 81 }], decision: { signal: 'unknown', confidence: 'low' } }]
      }) };
      return { ok: true, json: async () => ({ ok: true, offers: [{ price: 612, airline: 'Cash Carrier Y' }] }) };
    });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      const cash = container.querySelector('[data-testid="cash-candidate-card"]')?.textContent || '';
      const award = container.querySelector('[data-testid="award-candidate-card"]')?.textContent || '';
      expect(cash).toContain('Cash Carrier Y');
      expect(cash).not.toContain('Award Program X');
      expect(cash).not.toContain('42,424');
      expect(award).toContain('Award Program X');
      expect(award).not.toContain('Cash Carrier Y');
      expect(award).not.toContain('612');
    });
  });

  it('hides export before any successful result', () => {
    render(<App />);
    expect(screen.queryByTestId('print-button')).toBeNull();
  });

  it('shows export after Cash-only success and handles the missing Award pane', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [{ price: 500, airline: 'Lufthansa' }] }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(screen.getByTestId('print-button')).toBeTruthy();
      expect(container.querySelector('[data-testid="award-pane-empty"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="award-candidate-card"]')).toBeNull();
    });
  });

  it('shows export after Award-only success and handles the missing Cash pane', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{ origin: 'FRA', dest: 'JFK', date: '2030-10-10', decision: { signal: 'unknown', confidence: 'low' } }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [] }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));

    await waitFor(() => {
      expect(screen.getByTestId('print-button')).toBeTruthy();
      expect(container.querySelector('[data-testid="cash-pane-empty"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="cash-candidate-card"]')).toBeNull();
    });
  });

  it('freezes an export timestamp, prints once, includes route/date, and makes no new request', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{ origin: 'FRA', dest: 'JFK', date: '2030-10-10', decision: { signal: 'unknown', confidence: 'low' } }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [] }) });

    render(<App />);
    fireEvent.click(screen.getByTestId('analyze-button'));
    await waitFor(() => expect(screen.getByTestId('print-button')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('print-button'));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('export-timestamp').textContent).not.toBe('');
    expect(screen.getByTestId('print-report-header').textContent).toContain('FRA — JFK');
    expect(screen.getByTestId('print-report-header').textContent).toContain('2030-10-10');
  });

  it('does not invent program or provider fields when the APIs omit them', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown', confidence: 'low' }, programs: [] }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [{ price: 500 }] }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('print-button')).toBeTruthy());

    const cash = container.querySelector('[data-testid="cash-candidate-card"]')?.textContent || '';
    const award = container.querySelector('[data-testid="award-candidate-card"]')?.textContent || '';
    expect(cash).not.toContain('Airline');
    expect(award).not.toContain('Miles & More');
    expect(award).toContain('No program-level award detail');
  });

  it('retains the required mobile reading order in the DOM', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown', confidence: 'low' }, verified_identical_routing: false }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [{ price: 500 }] }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('result-flow')).toBeTruthy());

    const flow = screen.getByTestId('result-flow');
    const summary = screen.getByTestId('decision-summary');
    const options = screen.getByTestId('options-grid');
    const evidence = container.querySelector('.evidence-section') as HTMLElement;
    const print = screen.getByTestId('print-button');
    expect(summary.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(options.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(evidence.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flow.querySelector('.options-grid')).toBeTruthy();
  });
});
