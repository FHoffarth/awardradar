import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
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
    expect(container.querySelector('[data-typography="landing-parity"]')).not.toBeNull();
  });

  it('uses the Landing typography stack without adding an external font request', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toContain('--font-product: "Inter", system-ui, -apple-system, sans-serif;');
    expect(css).toMatch(/\.app-shell\s*\{[^}]*font-family:\s*var\(--font-product\)/s);
    expect(css).toMatch(/\.decision-summary h3\s*\{[^}]*font-family:\s*var\(--font-product\)/s);
    expect(css).toMatch(/\.why-section p\s*\{[^}]*font-family:\s*var\(--font-product\)/s);
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
  });

  it('keeps unresolved or invalid URL state disabled without fetching', () => {
    const r1 = render(<App />);
    expect((getButton(r1.container) as HTMLButtonElement).disabled).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    r1.unmount();

    setupUrlParams('FRA', 'JFK', 'invalid');
    const r2 = render(<App />);
    expect((getButton(r2.container) as HTMLButtonElement).disabled).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    r2.unmount();
  });

  it('hydrates canonical FRA and MUC codes from URL and enables Analyze', () => {
    setupUrlParams('FRA', 'MUC', '2026-08-06');
    const { container } = render(<App />);

    expect(container.textContent).toContain('FRA');
    expect(container.textContent).toContain('MUC');
    expect(container.textContent).toContain('2026-08-06');
    expect((getButton(container) as HTMLButtonElement).disabled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('separates a human-readable airport label from canonical URL and payload values', async () => {
    setupUrlParams('FRA', 'München (MUC)', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown' } }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [] }) });

    const { container } = render(<App />);
    expect(container.textContent).toContain('München (MUC)');
    expect((getButton(container) as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('to')).toBe('MUC'));

    fireEvent.click(getButton(container));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const payloads = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(payloads).toHaveLength(2);
    expect(payloads.every(payload => payload.origin === 'FRA' && payload.dest === 'MUC')).toBe(true);
    expect(JSON.stringify(payloads)).not.toContain('München');
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/awards')).toHaveLength(1);
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/cheap')).toHaveLength(1);
  });

  it.each([
    ['unresolved destination text', 'FRA', 'Munich', '2030-10-10'],
    ['identical airport codes', 'FRA', 'FRA', '2030-10-10'],
    ['invalid date', 'FRA', 'MUC', 'not-a-date'],
  ])('keeps %s invalid', (_label, from, to, date) => {
    setupUrlParams(from, to, date);
    const { container } = render(<App />);
    expect((getButton(container) as HTMLButtonElement).disabled).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
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
