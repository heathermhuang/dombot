import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createDynadotFetch,
  clearDynadotPricingCapabilities,
} from './dynadot-transport';
import {
  configureStore,
  hydrateStores,
  exportNamespaces,
  clearCacheNamespaces,
  flushWrites,
} from '../storage/namespace';
import { MemoryDocStore } from '../storage/doc-store';
const context = {
  accountId: 'a',
  apiKey: 'fixture-secret-key',
  routeKey: 'fixture-private-route',
};
const classic =
  'https://api.dynadot.com/api3.json?key=fixture-secret-key&command=renew&domain=owned.io&price_check=1';
let store: MemoryDocStore;
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});
it('persists an observed classic rejection across cold fetch wrappers without storing secrets', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ Response: { Error: 'invalid key' } }));
  await (await createDynadotFetch(send, context)(classic)).text();
  configureStore(store);
  await hydrateStores();
  const cold = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const cached = await createDynadotFetch(cold, context)(classic);
  expect(cached.status).toBe(401);
  expect(cached.headers.get('X-DomBot-Pricing-Capability')).toBe(
    'cached-rejection',
  );
  expect(cold).not.toHaveBeenCalled();
  const raw = JSON.stringify(await store.list('dynadot-pricing-capabilities'));
  expect(raw).not.toContain(context.apiKey);
  expect(raw).not.toContain(context.routeKey);
  expect(exportNamespaces()).not.toHaveProperty('dynadot-pricing-capabilities');
});
it('scopes rejection evidence to account, key and route and permits explicit revalidation', async () => {
  const rejected = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ Response: { Error: 'invalid key' } }));
  await (await createDynadotFetch(rejected, context)(classic)).text();
  for (const c of [
    { ...context, accountId: 'b' },
    { ...context, routeKey: 'other-route' },
    { ...context, apiKey: 'other-key' },
  ]) {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    await (await createDynadotFetch(send, c)(classic)).text();
    expect(send).toHaveBeenCalledTimes(1);
  }
  await clearDynadotPricingCapabilities('a');
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  await createDynadotFetch(send, context)(classic);
  expect(send).toHaveBeenCalledTimes(1);
});
it('persists only explicit unsupported-TLD pricing failures across cold wrappers', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(
      {
        code: 400,
        error: { description: "This TLD isn't supported via the API." },
      },
      { status: 400 },
    ),
  );
  const init = { headers: { Authorization: 'Bearer ' + context.apiKey } };
  await (
    await createDynadotFetch(send, context)(
      'https://api.dynadot.com/restful/v2/domains/one.app/search?show_price=true',
      init,
    )
  ).text();
  configureStore(store);
  await hydrateStores();
  const cold = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const response = await createDynadotFetch(cold, context)(
    'https://api.dynadot.com/restful/v2/domains/two.app/search?show_price=true',
    init,
  );
  expect(response.status).toBe(400);
  expect(cold).not.toHaveBeenCalled();
});
it('never intercepts a paid renewal even if a price-only lookup was rejected', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ Response: { Error: 'invalid key' } }));
  await (await createDynadotFetch(send, context)(classic)).text();
  const paid = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ unchanged: true }));
  await createDynadotFetch(
    paid,
    context,
  )(classic.replace('&price_check=1', ''));
  expect(paid).toHaveBeenCalledTimes(1);
});

it('retains proven rejection evidence beyond generic TTL across restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const rejected = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ Response: { Error: 'invalid key' } }));
  await (await createDynadotFetch(rejected, context)(classic)).text();
  vi.setSystemTime(Date.now() + 24 * 60 * 60_000 + 1);
  clearCacheNamespaces();
  await flushWrites();
  configureStore(store);
  await hydrateStores();
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  await createDynadotFetch(send, context)(classic);
  expect(send).not.toHaveBeenCalled();
});

it('preserves REST inventory and supported pricing after classic rejection on the real SDK', async () => {
  const { createRegistrar } = await import('@aoxborrow/registrar-client');
  const calls: string[] = [];
  const send = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.pathname);
    if (url.pathname === '/api3.json')
      return Response.json({ Response: { Error: 'invalid key' } });
    if (url.pathname === '/restful/v2/domains')
      return Response.json({ code: 200, data: { domain_info_list: [] } });
    return Response.json({
      code: 200,
      data: {
        domain_name: 'owned.io',
        available: 'No',
        premium: 'yes',
        price_list: [
          { currency: 'USD', unit: '(price/1 year)', renewal_price: '90' },
        ],
      },
    });
  });
  const make = () =>
    createRegistrar(
      'dynadot',
      { apiKey: context.apiKey, apiSecret: 'fixture' },
      { fetch: createDynadotFetch(send, context), retries: 0 },
    );
  expect((await make().getPricing('owned.io')).renewal).toBe(90);
  configureStore(store);
  await hydrateStores();
  expect(await make().listDomains()).toEqual([]);
  expect((await make().getPricing('owned.io')).renewal).toBe(90);
  expect(calls.filter((p) => p === '/api3.json')).toHaveLength(1);
  expect(calls.filter((p) => p.endsWith('/search'))).toHaveLength(2);
});
