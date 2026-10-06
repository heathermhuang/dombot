import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpApi } from './http';

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

beforeEach(() => {
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
