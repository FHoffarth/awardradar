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
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: undefined });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const setupUrlParams = (from = 'FRA', to = 'JFK', date = '2030-01-01') => {
    window.history.pushState({}, 'Test Title', `/app?from=${from}&to=${to}&date=${date}`);
  };

  const getButton = (container: HTMLElement) => container.querySelector('[data-testid="analyze-button"]') as HTMLElement;

  const renderAwardOnly = async (resultOverrides: Record<string, unknown> = {}, cashResponse: Record<string, unknown> = { ok: true, offers: [] }) => {
    setupUrlParams('FRA', 'MUC', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{
        origin: 'FRA', dest: 'MUC', date: '2030-10-10',
        programs: [{ program: 'Miles & More', miles: 1662, surcharge: 35 }],
        decision: { signal: 'strong_miles_value', confidence: 'low' },
        verified_identical_routing: false, has_live_data: false,
        ...resultOverrides,
      }] }) }
      : { ok: true, json: async () => cashResponse });
    const view = render(<App />);
    fireEvent.click(getButton(view.container));
    await waitFor(() => expect(screen.getByTestId('share-hub')).toBeTruthy());
    return view;
  };

  const renderWithCashOffers = async (offers: Record<string, unknown>[]) => {
    setupUrlParams('FRA', 'MUC', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{
        origin: 'FRA', dest: 'MUC', date: '2030-10-10',
        programs: [{ program: 'Miles & More', miles: 1662, surcharge: 35 }],
        decision: { signal: 'strong_miles_value', confidence: 'medium' },
        verified_identical_routing: false, has_live_data: false,
      }] }) }
      : { ok: true, json: async () => ({ ok: true, offers }) });
    const view = render(<App />);
    fireEvent.click(getButton(view.container));
    await waitFor(() => expect(screen.getByTestId('cash-candidate-card')).toBeTruthy());
    return view;
  };

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

  it('defines a compact editorial A4 print contract', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toContain('@page { size: A4; margin: 10mm 12mm; }');
    expect(css).toMatch(/\.print-omit\s*\{[^}]*display:\s*none\s*!important/s);
    expect(css).toMatch(/\.result-section\s*\{[^}]*break-inside:\s*auto/s);
    expect(css).toMatch(/\.option-card\s*\{[^}]*break-inside:\s*avoid-page/s);
    expect(css).toMatch(/\.confidence-section\s*\{[^}]*break-inside:\s*avoid-page/s);
    expect(css).toMatch(/\.report-disclaimer\s*\{[^}]*break-inside:\s*auto[^}]*page-break-inside:\s*auto/s);
    expect(css).not.toMatch(/\.report-disclaimer\s*\{[^}]*(?:position:\s*fixed|break-(?:before|after):|page-break-(?:before|after):)/s);
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

  it('hydrates_existing_one_way_url', () => {
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

  it('preserves_exact_one_way_payload', async () => {
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

  it('keeps offers[0] primary and renders offers[1..3] in exact backend order', async () => {
    const offers = [
      { price: 410, currency: 'EUR', airline: 'Primary Air', time_data_status: 'complete', dep_time: '08:00', arr_time: '09:00', durationMin: 60, stops: 0, dealScore: 50 },
      { price: 900, currency: 'EUR', airline: 'Backend First', time_data_status: 'complete', dep_time: '10:00', arr_time: '11:30', durationMin: 90, stops: 1, dealScore: 1 },
      { price: 100, currency: 'EUR', airline: 'Backend Second', time_data_status: 'complete', dep_time: '12:00', arr_time: '13:00', durationMin: 60, stops: 0, dealScore: 99 },
      { price: 500, currency: 'EUR', airline: 'Backend Third', time_data_status: 'unavailable', dealScore: 40 },
      { price: 300, currency: 'EUR', airline: 'Fourth Hidden', time_data_status: 'complete', dealScore: 80 },
    ];
    const { container } = await renderWithCashOffers(offers);

    const primary = screen.getByTestId('cash-candidate-card').textContent || '';
    expect(primary).toContain('Primary Air');
    expect(primary).toContain('€410');
    expect(primary).not.toContain('Backend First');

    const rows = screen.getAllByTestId('cash-alternative-row');
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Backend First'),
      expect.stringContaining('Backend Second'),
      expect.stringContaining('Backend Third'),
    ]);
    expect(container.textContent).not.toContain('Fourth Hidden');
    expect(rows.map(row => row.textContent?.match(/€\d+/)?.[0])).toEqual(['€900', '€100', '€500']);
  });

  it('does not render alternatives for a single Cash offer', async () => {
    await renderWithCashOffers([{ price: 410, currency: 'EUR', airline: 'Only Air', time_data_status: 'complete' }]);
    expect(screen.queryByTestId('cash-alternatives')).toBeNull();
    expect(screen.queryAllByTestId('cash-alternative-row')).toHaveLength(0);
  });

  it('handles incomplete alternative fields without inventing values', async () => {
    await renderWithCashOffers([
      { price: 410, currency: 'EUR', airline: 'Primary Air', time_data_status: 'complete' },
      { price: 275, currency: 'EUR', time_data_status: 'unavailable', source: 'secret-provider', debugSecret: 'do-not-render' },
    ]);
    const row = screen.getByTestId('cash-alternative-row');
    expect(row.textContent).toContain('€275');
    expect(row.textContent).toContain('Schedule details unavailable. Verify with the provider.');
    expect(row.textContent).not.toContain('undefined');
    expect(row.textContent).not.toContain('secret-provider');
    expect(row.textContent).not.toContain('do-not-render');
  });

  it('uses a slice only and never sorts or scores Cash alternatives in the frontend', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source).toContain("cashOffers.slice(1, 4)");
    expect(source).not.toMatch(/cashAlternatives\s*\.\s*sort/);
    expect(source).not.toMatch(/cashAlternatives[\s\S]{0,120}dealScore/);
    expect(source).not.toMatch(/cashAlternatives[\s\S]{0,120}score/i);
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
      expect(container.querySelector('[data-testid="cash-alternatives"]')).toBeNull();
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
    expect(screen.queryByTestId('share-export-button')).toBeNull();
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
      expect(screen.getByTestId('share-export-button')).toBeTruthy();
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
      expect(screen.getByTestId('share-export-button')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByTestId('share-export-button')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('print-button'));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('export-timestamp').textContent).not.toBe('');
    expect(screen.getByTestId('print-report-header').textContent).toContain('AwardRadar Decision Report');
    expect(screen.getByTestId('print-report-header').textContent).toContain('FRA → JFK');
    expect(screen.getByTestId('print-report-header').textContent).toContain('10 Oct 2030');
  });

  it('hides the Share Hub before results and shows it after partial success', async () => {
    render(<App />);
    expect(screen.queryByTestId('share-hub')).toBeNull();
    cleanup();

    const { container } = await renderAwardOnly();
    expect(screen.getByTestId('share-export-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-export-button'));
    expect(await screen.findByTestId('print-button')).toBeTruthy();
    expect(container.querySelector('[data-testid="cash-pane-empty"]')?.classList.contains('print-omit')).toBe(true);
  });

  it('uses native share once with trusted summary text and no new API requests', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    await renderAwardOnly();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('share-export-button'));
    const menu = await screen.findByTestId('result-action-menu');
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent?.trim())).toEqual([
      'Share analysis', 'Copy summary', 'Copy forum post', 'Email analysis', 'Print / Save PDF',
    ]);
    fireEvent.click(await screen.findByTestId('share-button'));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));

    const payload = share.mock.calls[0][0];
    expect(payload.title).toBe('AwardRadar analysis: FRA to MUC on 10 Oct 2030');
    expect(payload.text).toContain('Strong Award Value signal');
    expect(payload.text).toContain('1,662 miles · €35 · Miles & More');
    expect(payload.text).toContain('not verified as identical itineraries');
    expect(payload.url).toBe('https://awardradar.app/');
    expect(JSON.stringify(payload)).not.toContain('quota_exhausted');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles native share cancellation without a generic error', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(cancelled);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    await renderAwardOnly();

    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('share-button'));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('share-feedback').textContent).toBe('');
    expect(screen.queryByText(/application failure/i)).toBeNull();
  });

  it('opens the fallback actions when native sharing is unavailable', async () => {
    await renderAwardOnly();
    fireEvent.click(screen.getByTestId('share-export-button'));
    const menu = await screen.findByTestId('result-action-menu');
    expect(menu).toBeTruthy();
    expect(screen.queryByTestId('share-button')).toBeNull();
    expect(screen.getByTestId('copy-summary-button')).toBeTruthy();
    expect(screen.getByTestId('copy-forum-button')).toBeTruthy();
    expect(screen.getByTestId('email-analysis-link')).toBeTruthy();
  });

  it('copies the trusted compact summary and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderAwardOnly();

    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('copy-summary-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('AwardRadar analysis\nFRA → MUC · 10 Oct 2030');
    expect(copied).toContain('Cash:\nNo reliable cash result was returned');
    expect(copied).toContain('Award:\n1,662 miles · €35 · Miles & More');
    expect(copied).not.toContain('cash_provenance');
    expect(screen.getByTestId('share-feedback').textContent).toBe('Summary copied');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps Summary concise while Forum, Email, and Print include compact alternatives', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = await renderWithCashOffers([
      { price: 410, currency: 'EUR', airline: 'Primary Air', time_data_status: 'complete', dep_time: '08:00', arr_time: '09:00', durationMin: 60, stops: 0 },
      { price: 450, currency: 'EUR', airline: 'Alternative One', time_data_status: 'complete', dep_time: '10:00', arr_time: '11:30', durationMin: 90, stops: 1 },
      { price: 470, currency: 'EUR', airline: 'Alternative Two', time_data_status: 'unavailable', source: 'private-source' },
      { price: 490, currency: 'EUR', airline: 'Alternative Three', time_data_status: 'complete', stops: 0 },
      { price: 510, currency: 'EUR', airline: 'Alternative Four', time_data_status: 'complete' },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('copy-summary-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const summary = writeText.mock.calls[0][0];
    expect(summary).toContain('3 additional cash options available');
    expect(summary).not.toContain('Alternative One');
    expect(summary).not.toContain('Alternative Two');

    fireEvent.click(screen.getByTestId('copy-forum-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const forum = writeText.mock.calls[1][0];
    expect(forum).toContain('[b]Other options:[/b]');
    expect(forum.indexOf('Alternative One')).toBeLessThan(forum.indexOf('Alternative Two'));
    expect(forum.indexOf('Alternative Two')).toBeLessThan(forum.indexOf('Alternative Three'));
    expect(forum).not.toContain('Alternative Four');
    expect(forum).not.toContain('private-source');

    const mailto = (screen.getByTestId('email-analysis-link').getAttribute('href') || '');
    const decodedMailto = decodeURIComponent(mailto);
    expect(decodedMailto).toContain('Other cash options:');
    expect(decodedMailto).toContain('Alternative One');
    expect(decodedMailto).toContain('Alternative Three');
    expect(decodedMailto).not.toContain('Alternative Four');
    expect(decodedMailto).not.toContain('private-source');

    const alternatives = container.querySelector('[data-testid="cash-alternatives"]') as HTMLElement;
    expect(alternatives).toBeTruthy();
    expect(alternatives.closest('.interactive-only')).toBeNull();
    fireEvent.click(screen.getByTestId('print-button'));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('copies conservative valid BBCode without complex tags', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderAwardOnly();

    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('copy-forum-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('[b]AwardRadar analysis: FRA → MUC · 10.10.2030[/b]');
    expect(copied).toContain('[b]Award:[/b]\n1.662 miles · 35 EUR · Miles & More');
    expect(copied).toMatch(/\[i\].+\[\/i\]/s);
    expect(copied).not.toMatch(/\[(?:table|color|font|url)[=\]]/i);
    expect(screen.getByTestId('share-feedback').textContent).toBe('Forum post copied');
  });

  it('creates a properly encoded plain-text mailto action', async () => {
    await renderAwardOnly();
    fireEvent.click(screen.getByTestId('share-export-button'));
    const href = (await screen.findByTestId('email-analysis-link')).getAttribute('href') || '';

    expect(href).toContain('mailto:?subject=AwardRadar%20analysis%3A%20FRA%20to%20MUC');
    expect(href).toContain('&body=AwardRadar%20analysis');
    expect(decodeURIComponent(href)).toContain('Cash:\nNo reliable cash result was returned');
    expect(decodeURIComponent(href)).not.toContain('<html');
  });

  it('preserves quota-degraded and routing caveats without raw provider details', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderAwardOnly({}, { ok: true, offers: [], cash_provenance: {
      status: 'unavailable', provider: 'serpapi', fallback_reason: 'quota_exhausted',
    } });

    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('copy-summary-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('Current cash comparison unavailable');
    expect(copied).toContain('not verified as identical itineraries');
    expect(copied).toContain('Award figures are estimates');
    expect(copied).not.toContain('quota_exhausted');
    expect(copied).not.toContain('serpapi');
  });

  it('offers manual selectable text when automatic clipboard copy is unavailable', async () => {
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    await renderAwardOnly();
    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('copy-summary-button'));

    await waitFor(() => expect(screen.getByTestId('manual-copy-text')).toBeTruthy());
    expect(screen.getByTestId('share-feedback').textContent).toContain('Select the text');
    expect((screen.getByTestId('manual-copy-text') as HTMLTextAreaElement).value).toContain('AwardRadar analysis');
  });

  it('closes the action menu with Escape and restores focus to Share & Export', async () => {
    await renderAwardOnly();
    fireEvent.click(screen.getByTestId('share-export-button'));
    const firstAction = await screen.findByTestId('copy-summary-button');
    await waitFor(() => expect(document.activeElement).toBe(firstAction));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('result-action-menu')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('share-export-button'));
  });

  it('does not invent program or provider fields when the APIs omit them', async () => {
    setupUrlParams('FRA', 'JFK', '2030-10-10');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [{ decision: { signal: 'unknown', confidence: 'low' }, programs: [] }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [{ price: 500 }] }) });

    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('share-export-button')).toBeTruthy());

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
    const actions = screen.getByTestId('share-export-button');
    expect(summary.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(options.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(evidence.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flow.querySelector('.options-grid')).toBeTruthy();
  });

  it('keeps_mobile_cash_then_award_dom_order', async () => {
    const { container } = await renderWithCashOffers([
      { price: 410, currency: 'EUR', airline: 'Primary Air', time_data_status: 'complete' },
      { price: 450, currency: 'EUR', airline: 'Alternative One', time_data_status: 'unavailable' },
      { price: 470, currency: 'EUR', airline: 'Alternative Two', time_data_status: 'unavailable' },
    ]);
    const primary = screen.getByTestId('cash-candidate-card');
    const alternatives = screen.getByTestId('cash-alternatives');
    const award = screen.getByTestId('award-candidate-card');
    expect(primary.compareDocumentPosition(alternatives) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alternatives.compareDocumentPosition(award) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('.cash-option-stack')).toHaveLength(1);
  });

  it('hydrates_round_trip_url', () => {
    window.history.pushState({}, 'Test Title', '/app?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20');
    const { container } = render(<App />);
    expect(container.textContent).toContain('Round-trip');
    expect(container.textContent).toContain('2030-10-20');
    expect((getButton(container) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends_identical_round_trip_payload_to_both_endpoints', async () => {
    window.history.pushState({}, 'Test Title', '/app?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20');
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => ({ ok: true, results: [] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const payloads = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[0]).toEqual({
      lang: 'en', origin: 'FRA', dest: 'JFK', date: '2030-10-10', oneWay: false,
      returnDate: '2030-10-20', direct: false, mmOnly: false, currency: 'eur',
      cabin: 'Economy', cabins: ['Economy'], flexDays: 0,
    });
  });

  it('rejects_round_trip_url_without_return_date', () => {
    window.history.pushState({}, 'Test Title', '/app?from=FRA&to=JFK&date=2030-10-10&trip=round_trip');
    const { container } = render(<App />);
    expect(screen.getByTestId('validation-error').textContent).toContain('return date is required');
    expect((getButton(container) as HTMLButtonElement).disabled).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects_round_trip_url_with_earlier_return', () => {
    window.history.pushState({}, 'Test Title', '/app?from=FRA&to=JFK&date=2030-10-20&trip=round_trip&returnDate=2030-10-19');
    const { container } = render(<App />);
    expect(screen.getByTestId('validation-error').textContent).toContain('must not be before');
    expect((getButton(container) as HTMLButtonElement).disabled).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  const roundTripSegments = {
    outbound: [{ dep_iata: 'FRA', arr_iata: 'JFK', dep_time: '10:00', arr_time: '13:00', airline: 'Test Air' }],
    inbound: [{ dep_iata: 'JFK', arr_iata: 'FRA', dep_time: '18:00', arr_time: '08:00', airline: 'Return Air' }],
  };

  function setupRoundTrip() {
    window.history.pushState({}, 'Test Title', '/app?from=FRA&to=JFK&date=2030-10-10&trip=round_trip&returnDate=2030-10-20');
  }

  function awardRoundTripResponse(overrides: Record<string, unknown> = {}) {
    return { ok: true, results: [{
      origin: 'FRA', dest: 'JFK', date: '2030-10-10', returnDate: '2030-10-20',
      programs: [{ program: 'Miles & More', miles: 50000, surcharge: 120, trip_type: 'one_way', requested_trip_type: 'round_trip' }],
      decision: { signal: 'strong_miles_value', confidence: 'low', trip_basis_compatible: false },
      verified_identical_routing: false, has_live_data: false, ...overrides,
    }] };
  }

  it('renders_complete_round_trip_legs', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, offers: [{ offer_id: 'complete', price: 700, currency: 'EUR', returnDate: '2030-10-20', itinerary_state: 'complete', outbound_segments: roundTripSegments.outbound, return_segments: roundTripSegments.inbound }] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('cash-round-trip-complete')).toBeTruthy());
    expect(container.textContent).toContain('FRA');
    expect(container.textContent).toContain('JFK');
    expect(container.textContent).toContain('Return Air');
  });

  it('renders_partial_round_trip_without_inventing_return', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, offers: [{ offer_id: 'partial', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('cash-round-trip-partial')).toBeTruthy());
    expect(container.textContent).toContain('Return itinerary details are not available');
    expect(container.textContent).not.toContain('Return Air');
  });

  it('renders_price_only_round_trip_without_route_claims', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, offers: [
        { offer_id: 'price', price: 600, currency: 'EUR', origin: 'FRA', dest: 'JFK', date: '2030-10-10', returnDate: '2030-10-20', itinerary_state: 'price_only', airline: 'Should Not Render', dep_time: '10:00', stops: 0 },
        { offer_id: 'alternative', price: 650, currency: 'EUR', returnDate: '2030-10-20', itinerary_state: 'price_only', airline: 'Alternative Must Not Render', dep_time: '11:00', durationMin: 500, stops: 1 },
      ] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('cash-round-trip-price-only')).toBeTruthy());
    const card = screen.getByTestId('cash-candidate-card');
    expect(card.textContent).toContain('Round-trip price signal');
    expect(card.textContent).not.toContain('Should Not Render');
    expect(card.textContent).not.toContain('Nonstop');
    expect(container.textContent).not.toContain('Alternative Must Not Render');
    expect(container.textContent).not.toContain('1 stop');
  });

  it('calls_return_leg_once_for_recommended_partial_offer', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => awardRoundTripResponse() };
      if (url === '/api/cheap') return { ok: true, json: async () => ({ ok: true, cash_guidance: { recommended_offer_id: 'rec' }, offers: [{ offer_id: 'rec', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) };
      return { ok: true, json: async () => ({ ok: true, offer_id: 'rec', itinerary_state: 'complete', return_segments: roundTripSegments.inbound }) };
    });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('cash-round-trip-complete')).toBeTruthy());
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/return-leg')).toHaveLength(1);
  });

  it('does_not_continue_non_recommended_partial_offer', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, cash_guidance: { recommended_offer_id: 'complete' }, offers: [{ offer_id: 'partial', price: 600, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }, { offer_id: 'complete', price: 700, returnDate: '2030-10-20', itinerary_state: 'complete', outbound_segments: roundTripSegments.outbound, return_segments: roundTripSegments.inbound }] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('cash-round-trip-complete')).toBeTruthy());
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/return-leg')).toHaveLength(0);
  });

  it('upgrades_only_matching_offer', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => awardRoundTripResponse() };
      if (url === '/api/cheap') return { ok: true, json: async () => ({ ok: true, cash_guidance: { recommended_offer_id: 'target' }, offers: [{ offer_id: 'other', price: 620, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }, { offer_id: 'target', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) };
      return { ok: true, json: async () => ({ ok: true, offer_id: 'target', itinerary_state: 'complete', return_segments: roundTripSegments.inbound }) };
    });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('cash-round-trip-complete')).toBeTruthy());
    expect(screen.getByTestId('cash-candidate-card').getAttribute('data-offer-id')).toBe('target');
    expect(container.textContent).toContain('Outbound details only');
  });

  it('continuation_failure_preserves_partial_state', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => awardRoundTripResponse() };
      if (url === '/api/cheap') return { ok: true, json: async () => ({ ok: true, cash_guidance: { recommended_offer_id: 'rec' }, offers: [{ offer_id: 'rec', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) };
      return { ok: true, json: async () => ({ ok: false, itinerary_state: 'partial' }) };
    });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByText('Return details unavailable')).toBeTruthy());
    expect(screen.getByTestId('cash-round-trip-partial')).toBeTruthy();
  });

  it('ignores_stale_continuation_after_new_search', async () => {
    setupRoundTrip();
    let resolveContinuation!: (value: unknown) => void;
    const continuation = new Promise(resolve => { resolveContinuation = resolve; });
    let cheapCalls = 0;
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => awardRoundTripResponse() };
      if (url === '/api/cheap') {
        cheapCalls += 1;
        return cheapCalls === 1
          ? { ok: true, json: async () => ({ ok: true, cash_guidance: { recommended_offer_id: 'old' }, offers: [{ offer_id: 'old', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) }
          : { ok: true, json: async () => ({ ok: true, offers: [{ offer_id: 'new', price: 999, returnDate: '2030-10-20', itinerary_state: 'complete', outbound_segments: roundTripSegments.outbound, return_segments: [{ dep_iata: 'JFK', arr_iata: 'FRA', airline: 'New Return' }] }] }) };
      }
      return continuation;
    });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(mockFetch.mock.calls.some(([url]) => url === '/api/return-leg')).toBe(true));
    fireEvent.click(getButton(container));
    await waitFor(() => expect(container.textContent).toContain('New Return'));
    resolveContinuation({ ok: true, json: async () => ({ ok: true, offer_id: 'old', itinerary_state: 'complete', return_segments: [{ dep_iata: 'JFK', arr_iata: 'FRA', airline: 'Old Return' }] }) });
    await Promise.resolve();
    expect(container.textContent).not.toContain('Old Return');
  });

  it('does_not_expose_continuation_token', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => {
      if (url === '/api/awards') return { ok: true, json: async () => awardRoundTripResponse() };
      if (url === '/api/cheap') return { ok: true, json: async () => ({ ok: true, cash_guidance: { recommended_offer_id: 'rec' }, offers: [{ offer_id: 'rec', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) };
      return { ok: true, json: async () => ({ ok: false, itinerary_state: 'partial' }) };
    });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(mockFetch.mock.calls.filter(([url]) => url === '/api/return-leg')).toHaveLength(1));
    const call = mockFetch.mock.calls.find(([url]) => url === '/api/return-leg');
    expect(call?.[1].body).not.toContain('token');
    expect(container.textContent).not.toContain('token');
  });

  it('shows_outbound_only_award_disclosure', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, offers: [] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('award-outbound-only-disclosure')).toBeTruthy());
  });

  it('suppresses_incompatible_round_trip_verdict', async () => {
    setupRoundTrip();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, offers: [{ offer_id: 'price', price: 600, returnDate: '2030-10-20', itinerary_state: 'price_only' }] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(screen.getByTestId('decision-verdict').textContent).toBe('Cash and award are not directly comparable'));
    expect(container.textContent).not.toContain('Excellent Award Value');
    fireEvent.click(screen.getByTestId('share-export-button'));
    fireEvent.click(await screen.findByTestId('copy-summary-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Cash and award are not directly comparable');
    expect(writeText.mock.calls[0][0]).not.toContain('Excellent Award Value');
  });

  it('renders_unknown_taxes_as_unknown', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse({ programs: [{ program: 'Miles & More', miles: 50000 }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(container.textContent).toContain('Taxes and fees unknown'));
    expect(container.textContent).not.toContain('€0');
  });

  it('renders_only_sanitized_provider_links', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse({ programs: [{ program: 'Unsafe', miles: 50000, url: 'javascript:alert(1)' }] }) }
      : { ok: true, json: async () => ({ ok: true, offers: [{ offer_id: 'price', price: 600, returnDate: '2030-10-20', itinerary_state: 'price_only', links: { Unsafe: 'data:text/html,bad', Safe: 'https://example.com/check' } }] }) });
    const { container } = render(<App />);
    fireEvent.click(getButton(container));
    await waitFor(() => expect(container.querySelector('a[href="https://example.com/check"]')).toBeTruthy());
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="data:"]')).toBeNull();
    const external = container.querySelector('a.verification-link') as HTMLAnchorElement;
    expect(external.target).toBe('_blank');
    expect(external.rel).toBe('noopener noreferrer');
  });

  it('keeps_round_trip_controls_and_results_accessible', async () => {
    setupRoundTrip();
    mockFetch.mockImplementation(async (url) => url === '/api/awards'
      ? { ok: true, json: async () => awardRoundTripResponse() }
      : { ok: true, json: async () => ({ ok: true, offers: [{ offer_id: 'partial', price: 650, returnDate: '2030-10-20', itinerary_state: 'partial', outbound_segments: roundTripSegments.outbound }] }) });
    const { container } = render(<App />);
    expect(container.textContent).toContain('Trip type');
    expect(container.querySelector('time[datetime="2030-10-20"]')).toBeTruthy();
    fireEvent.click(getButton(container));
    await waitFor(() => expect(container.querySelector('[aria-label="Return details unavailable"]')).toBeTruthy());
  });
});
