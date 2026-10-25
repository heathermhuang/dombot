import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let createHttpApi: typeof import('./http').createHttpApi;

vi.mock('../lib/platform', () => ({ hostPath: (path: string) => path }));

const portfolio = {
  domains: [],
  errors: [],
  registrars: [],
  registrarLabels: {},
  fetchedAt: 1,
  renewalPricing: { remaining: 2, failed: 0 },
};
let finishFirst!: (response: Response) => void;
let steps = 0;
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const path = String(input);
  if (path.endsWith('/stepRenewalPricing')) {
    steps++;
    if (steps === 1)
      return new Promise((resolve) => {
        finishFirst = resolve;
      });
    return Response.json({ result: { remaining: 0, failed: 0 } });
  }
  return Response.json({
    result: path.endsWith('/hydrateFromCache')
      ? { portfolio, detail: {}, pricing: {} }
      : portfolio,
  });
});

beforeEach(async () => {
  vi.resetModules();
  ({ createHttpApi } = await import('./http'));
  steps = 0;
  fetchMock.mockClear();
  vi.stubGlobal('document', {
    visibilityState: 'hidden',
    addEventListener: vi.fn(),
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe('background price updates in an open tab', () => {
  it.each([null, 'invalid', 'Sun, 25 Oct 2026 01:10:00 GMT'])(
    'pauses with Retry-After %s and resumes a hidden tab without losing status',
    async (retryAfter) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-25T01:00:00Z'));
      const { getPricingRetryAt, subscribePricingRetry } =
        await import('./http');
      const statusChanged = vi.fn();
      const unsubscribe = subscribePricingRetry(statusChanged);
      let requests = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).endsWith('/stepRenewalPricing')) {
            requests++;
            return requests === 1
              ? Response.json(
                  { error: 'Provider refresh limit reached.' },
                  {
                    status: 429,
                    headers:
                      retryAfter === null ? {} : { 'Retry-After': retryAfter },
                  },
                )
              : Response.json({ result: { remaining: 0, failed: 0 } });
          }
          return Response.json({ result: portfolio });
        }),
      );
      try {
        await createHttpApi().listPortfolio(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(getPricingRetryAt()).toBe(Date.now() + 600_000);
        expect(statusChanged).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(599_999);
        expect(requests).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(requests).toBe(2);
        expect(getPricingRetryAt()).toBe(0);
        expect(statusChanged).toHaveBeenCalledTimes(2);
      } finally {
        unsubscribe();
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it('honors Retry-After across revision polls and inventory reloads, then resumes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'));
    let requests = 0;
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const method = String(input).split('/').pop();
        if (method === 'stepRenewalPricing') {
          requests++;
          return requests === 1
            ? Response.json(
                { error: 'Provider refresh limit reached.' },
                {
                  status: 429,
                  headers: { 'Retry-After': '600' },
                },
              )
            : Response.json({ result: { remaining: 0, failed: 0 } });
        }
        return Response.json({
          result:
            method === 'getRevisions'
              ? {
                  portfolio: 1,
                  bulk: 1,
                  approvals: 1,
                  renewalPricingPending: requests < 2,
                }
              : method === 'hydrateFromCache'
                ? { portfolio, detail: {}, pricing: {} }
                : portfolio,
        });
      }),
    );
    const api = createHttpApi();
    const unsubscribe = api.onPortfolioChanged(() => {});
    try {
      await api.listPortfolio(false);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(300_000);
      await api.hydrateFromCache();
      await api.listPortfolio(false);
      expect(requests).toBe(1);
      await vi.advanceTimersByTimeAsync(299_999);
      expect(requests).toBe(1);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(requests).toBe(2);
    } finally {
      unsubscribe();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('returns inventory and keeps stepping when another tab is selected', async () => {
    const api = createHttpApi();
    const result = await api.listPortfolio(true);
    expect(result.renewalPricing?.remaining).toBe(2);
    expect(steps).toBe(1);
    finishFirst(Response.json({ result: { remaining: 1, failed: 0 } }));
    await vi.waitFor(() => expect(steps).toBe(2));
  });

  it('resumes persisted pending prices immediately after cache hydration', async () => {
    const api = createHttpApi();
    const snapshot = await api.hydrateFromCache();
    expect(snapshot.portfolio?.renewalPricing?.remaining).toBe(2);
    expect(steps).toBe(1);
    finishFirst(Response.json({ result: { remaining: 1, failed: 0 } }));
    await vi.waitFor(() => expect(steps).toBe(2));
  });
});
