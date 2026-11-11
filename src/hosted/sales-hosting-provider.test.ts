import { expect, it, vi } from 'vitest';
import {
  inspectSalesHosting,
  salesHostingProvider,
  salesHostingTarget,
} from './sales-hosting-provider';
const existing = {
  PORTFOLIO_CF_ZONE_ID: 'a'.repeat(32),
  PORTFOLIO_CF_API_TOKEN: 'private-service-token',
  PORTFOLIO_CNAME_TARGET: 'portfolio-origin.example',
  PORTFOLIO_EDGE_WORKER: 'domains-sales-lander',
};
it('reuses the complete existing service configuration without changing its scope', () => {
  expect(salesHostingProvider(existing)).toEqual({
    source: 'existing-portfolio',
    zoneId: 'a'.repeat(32),
    token: 'private-service-token',
    target: 'portfolio-origin.example',
  });
  expect(salesHostingTarget(existing)).toBe('portfolio-origin.example');
});
it('keeps explicit Sales credentials and does not mix incomplete configurations', () => {
  const sales = {
    ...existing,
    SALES_CF_ZONE_ID: 'b'.repeat(32),
    SALES_CF_API_TOKEN: 'sales-only',
    SALES_CNAME_TARGET: 'sales.example',
  };
  expect(salesHostingProvider(sales)).toMatchObject({
    source: 'sales',
    zoneId: 'b'.repeat(32),
    token: 'sales-only',
    target: 'sales.example',
  });
  expect(() =>
    salesHostingProvider({ ...existing, SALES_CF_API_TOKEN: 'partial' }),
  ).toThrow(/completely configured/);
  expect(() =>
    salesHostingProvider({
      ...existing,
      SALES_CNAME_TARGET: 'foreign.example',
    }),
  ).toThrow(/does not match/);
  expect(() =>
    salesHostingProvider({
      ...existing,
      PORTFOLIO_EDGE_WORKER: 'another-worker',
    }),
  ).toThrow(/does not match/);
});
it('retains manual target planning without making a provider grant', () => {
  expect(salesHostingTarget({ SALES_CNAME_TARGET: 'manual.example' })).toBe(
    'manual.example',
  );
  expect(() =>
    salesHostingProvider({ SALES_CNAME_TARGET: 'manual.example' }),
  ).toThrow();
});
it('performs only fixed reads and returns no tokens or customer hostnames', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    calls.push(u.pathname + u.search);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer private-service-token',
    );
    return Response.json({
      success: true,
      result: u.pathname.endsWith('/fallback_origin')
        ? { origin: 'portfolio-origin.example', status: 'active' }
        : [{ hostname: 'private-customer.example' }],
      result_info: { total_count: 2 },
    });
  };
  const result = await inspectSalesHosting(existing, fetcher);
  expect(result).toMatchObject({
    configured: true,
    source: 'existing-portfolio',
    hostnames: { reachable: true, count: 2 },
    fallback: { reachable: true, state: 'active' },
  });
  expect(calls).toEqual([
    `/client/v4/zones/${'a'.repeat(32)}/custom_hostnames?per_page=1`,
    `/client/v4/zones/${'a'.repeat(32)}/custom_hostnames/fallback_origin`,
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /private-service-token|private-customer/,
  );
});
it('reports access failures rather than inferring an empty quota', async () => {
  const result = await inspectSalesHosting(existing, async () =>
    Response.json(
      { success: false, errors: [{ message: 'private-provider-detail' }] },
      { status: 403 },
    ),
  );
  expect(result).toMatchObject({
    hostnames: { reachable: false, status: 403, count: null },
    fallback: { reachable: false },
  });
  expect(JSON.stringify(result)).not.toContain('private-provider-detail');
});
it('does not call a provider for mismatched or incomplete settings', async () => {
  const fetcher = vi.fn();
  expect(
    await inspectSalesHosting({ PORTFOLIO_CF_API_TOKEN: 'token' }, fetcher),
  ).toEqual({ configured: false, reason: 'incomplete-or-mismatched-provider' });
  expect(fetcher).not.toHaveBeenCalled();
});
