import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  it,
  expect,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  SalesDomainControl,
  refreshDomainControls,
} from './sales-domain-control';
import { SalesHostnames, refreshSalesHostnames } from './sales-hostnames';
import { createSalesInternalRoutes } from '../worker/sales-internal';
import { createPublicSalesRoutes } from '../worker/public-sales';
import gateway from './gateway';
import { SalesStore, readPublicSale } from '../worker/sales-store';
import { createVerifiedSaleObserver } from '../worker/sales-observation';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { emptySale } from '../shared/sales';
import { sourcePriceFingerprint } from '../core/publication/sales';
import { Hono } from 'hono';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';

let mf: Miniflare, control: D1Database, tenant: D1Database, store: SalesStore;
const workspace = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  domain = 'inquiry.fixture.example',
  key = 'domain-control-fixture-key'.repeat(3),
  root = Buffer.alloc(32, 9).toString('base64');
let tenantEnv: Env,
  env: HostedEnv,
  controller: SalesDomainControl,
  dns: Map<string, string>,
  calls: number,
  payloads: Record<string, unknown>[],
  failDns: boolean;
const fetcher: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init),
    url = new URL(request.url);
  calls++;
  expect(request.redirect).toBe('manual');
  if (failDns) throw Error('Synthetic DNS outage');
  if (url.hostname === 'cloudflare-dns.com') {
    const name = url.searchParams.get('name') ?? '',
      value = dns.get(name);
    return Response.json({
      Status: 0,
      Answer:
        url.searchParams.get('type') === 'TXT' && value
          ? [{ name, type: 16, TTL: 60, data: `"${value}"` }]
          : [],
    });
  }
  if (url.hostname === domain) {
    const published = await readPublicSale(tenant, domain);
    return new Response('public fixture', {
      headers: published
        ? { 'X-Domains-Sales-Revision': published.revision }
        : {},
    });
  }
  throw Error('Unexpected fixture request');
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'domain-control-fixture',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['CONTROL', 'TENANT'],
        },
      ],
    }),
  );
  control = await mf.getD1Database('CONTROL');
  tenant = await mf.getD1Database('TENANT');
  for (const file of readdirSync('hosted/migrations').sort())
    await control.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  for (const file of [
    '0002_publication.sql',
    '0004_sales.sql',
    '0005_sales_inquiries.sql',
    '0006_sales_control_leases.sql',
  ])
    await tenant.exec(
      readFileSync('migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
}, 30000);
afterAll(async () => mf?.dispose());
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  await control.batch(
    [
      'sales_hostnames',
      'sales_domain_controls',
      'closure_requests',
      'workspaces',
    ].map((t) => control.prepare(`DELETE FROM ${t}`)),
  );
  await control
    .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
    .bind(workspace, 'Fixture')
    .run();
  await tenant.batch(
    ['sales_reviews', 'sales_shop', 'sale_drafts'].map((t) =>
      tenant.prepare(`DELETE FROM ${t}`),
    ),
  );
  dns = new Map();
  calls = 0;
  payloads = [];
  failDns = false;
  tenantEnv = {
    DB: tenant,
    DOMBOT_SECRET: root,
    DOMBOT_AUTH: 'gateway',
    DOMBOT_WORKSPACE_ID: workspace,
    DOMBOT_GATEWAY_SECRET: key,
    SALES_DNS_CONTROL_ENABLED: 'true',
  } as Env;
  const internal = new Hono()
    .route('/sales-internal', createSalesInternalRoutes())
    .route('/', createPublicSalesRoutes());
  env = {
    CONTROL_DB: control,
    CANONICAL_ORIGIN: 'https://accounts.example',
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Fixture' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: key }),
    SALES_DOMAIN_CONTROL_ENABLED: 'true',
    SALES_DOMAIN_CONTROL_WORKSPACES: JSON.stringify([workspace]),
    SALES_CUSTOM_HOSTS_ENABLED: 'true',
    SALES_HOST_ALLOWLIST: domain,
    SALES_EDGE_KEYS: JSON.stringify({ [workspace]: key }),
    SALES_OPERATOR_HOSTS: JSON.stringify([
      {
        workspace,
        hostname: domain,
        domain,
        providerId: 'operator-resource',
        service: 'domains-sales-lander',
      },
    ]),
    WORKSPACE_0: {
      fetch: async (request: Request) => {
        if (request.method === 'POST')
          payloads.push(await request.clone().json());
        return internal.fetch(request, tenantEnv);
      },
    },
  } as HostedEnv;
  store = await SalesStore.from(tenantEnv);
  controller = new SalesDomainControl(env, fetcher);
});
async function draft() {
  const value = emptySale(domain, sourcePriceFingerprint(null));
  const revision = await store.save(value, null);
  return { value, revision };
}
async function verified() {
  const saved = await draft(),
    plan = await controller.plan(workspace, saved.value.id, domain);
  dns.set(plan.proof!.name, plan.proof!.value);
  await controller.check((await controller.read(workspace, saved.value.id))!);
  return saved;
}
async function publish(saved: Awaited<ReturnType<typeof draft>>) {
  const observe = createVerifiedSaleObserver(tenantEnv);
  const review = await store.prepare(
    [{ id: saved.value.id, revision: saved.revision }],
    observe,
  );
  await store.publish(review.id, observe);
}
it('keeps a prepared record private and grants no authority without DNS proof', async () => {
  const saved = await draft();
  await controller.plan(workspace, saved.value.id, domain);
  expect(
    (await createVerifiedSaleObserver(tenantEnv)(saved.value)).available,
  ).toBe(false);
  expect(await readPublicSale(tenant, domain)).toBeNull();
  expect(
    (
      await controller.check(
        (await controller.read(workspace, saved.value.id))!,
      )
    ).status,
  ).toBe('lost');
  expect(
    (await createVerifiedSaleObserver(tenantEnv)(saved.value)).available,
  ).toBe(false);
});
it('permits an exact publication review only after verified DNS, without automatic publication', async () => {
  const saved = await verified();
  expect(await readPublicSale(tenant, domain)).toBeNull();
  expect(
    (await createVerifiedSaleObserver(tenantEnv)(saved.value)).controlSource,
  ).toBe('dns');
  await publish(saved);
  expect((await readPublicSale(tenant, domain))?.id).toBe(saved.value.id);
});
it('accepts a signed DNS observation with a small gateway-to-tenant clock offset', async () => {
  const saved = await draft(),
    plan = await controller.plan(workspace, saved.value.id, domain),
    original = env.WORKSPACE_0.fetch;
  dns.set(plan.proof!.name, plan.proof!.value);
  env.WORKSPACE_0 = {
    fetch: async (request: Request) => {
      const realNow = Date.now;
      const clock = vi
        .spyOn(Date, 'now')
        .mockImplementation(() => realNow() - 250);
      try {
        const response = await original(request);
        if (response.ok)
          expect(
            (await createVerifiedSaleObserver(tenantEnv)(saved.value))
              .available,
          ).toBe(true);
        return response;
      } finally {
        clock.mockRestore();
      }
    },
  } as Fetcher;
  const result = await controller.check(
    (await controller.read(workspace, saved.value.id))!,
  );
  expect(result.status).toBe('verified');
});
it('rejects observations beyond the bounded gateway clock tolerance', async () => {
  const saved = await draft(),
    plan = await controller.plan(workspace, saved.value.id, domain),
    original = env.WORKSPACE_0.fetch;
  dns.set(plan.proof!.name, plan.proof!.value);
  env.WORKSPACE_0 = {
    fetch: async (request: Request) => {
      const realNow = Date.now;
      const clock = vi
        .spyOn(Date, 'now')
        .mockImplementation(() => realNow() - 10000);
      try {
        return await original(request);
      } finally {
        clock.mockRestore();
      }
    },
  } as Fetcher;
  await expect(
    controller.check((await controller.read(workspace, saved.value.id))!),
  ).rejects.toThrow('could not be saved');
  expect(
    await tenant.prepare('SELECT 1 FROM sales_control_leases').first(),
  ).toBeNull();
});
it('suppresses an existing publication when the first DNS observation is a loss', async () => {
  const saved = await draft();
  const observe = () => ({
    price: null,
    available: true,
    reason: null,
    controlSource: 'operator-dns' as const,
    controlExpiresAt: Date.now() + 86400_000,
    ownershipFingerprint: 'existing non-DNS authority',
  });
  const review = await store.prepare(
    [{ id: saved.value.id, revision: saved.revision }],
    observe,
  );
  await store.publish(review.id, observe);
  expect(await readPublicSale(tenant, domain)).not.toBeNull();
  await controller.plan(workspace, saved.value.id, domain);
  await controller.check((await controller.read(workspace, saved.value.id))!);
  const row = (await controller.read(workspace, saved.value.id))!;
  expect(row.tenant_ack_epoch).toBe(row.epoch);
  expect(row.last_loss_epoch).toBe(row.epoch);
  expect((await store.get(saved.value.id)).availability).toBe(
    'ownership-uncertain',
  );
  expect(await readPublicSale(tenant, domain)).toBeNull();
});
it('renews a due lease without changing the published terms or revision', async () => {
  const saved = await verified();
  await publish(saved);
  const before = await readPublicSale(tenant, domain);
  const old = await controller.read(workspace, saved.value.id);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 3600_000 + 1);
  await refreshDomainControls(env, fetcher);
  const after = await controller.read(workspace, saved.value.id);
  expect(after!.expires_at).toBeGreaterThan(old!.expires_at);
  expect(await readPublicSale(tenant, domain)).toEqual(before);
});
it('revokes proof and never automatically republishes after it is restored', async () => {
  const saved = await verified();
  await publish(saved);
  const oldGrant = payloads.at(-1)!;
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000);
  dns.clear();
  expect(
    (
      await controller.check(
        (await controller.read(workspace, saved.value.id))!,
      )
    ).status,
  ).toBe('lost');
  expect(await readPublicSale(tenant, domain)).toBeNull();
  expect((await store.get(saved.value.id)).availability).toBe(
    'ownership-uncertain',
  );
  const request = new Request(
    'https://accounts.example/sales-internal/domain-control',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(oldGrant),
    },
  );
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(key, workspace, null, request, {
      purpose: 'sales-hostnames',
    }),
  );
  expect(
    await (
      await new Hono()
        .route('/sales-internal', createSalesInternalRoutes())
        .fetch(request, tenantEnv)
    ).json(),
  ).toEqual({ ok: false });
  const row = (await controller.read(workspace, saved.value.id))!;
  dns.set(`_domains-inquiry.${domain}`, row.proof);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000);
  await controller.check(row);
  expect(
    (await createVerifiedSaleObserver(tenantEnv)(saved.value)).available,
  ).toBe(true);
  expect(await readPublicSale(tenant, domain)).toBeNull();
});
it('keeps only the last bounded lease during a DNS outage and stops serving after expiry', async () => {
  const saved = await verified();
  await publish(saved);
  const row = (await controller.read(workspace, saved.value.id))!;
  failDns = true;
  await control
    .prepare('UPDATE sales_domain_controls SET next_check_at=0')
    .run();
  await refreshDomainControls(env, fetcher);
  expect((await controller.read(workspace, saved.value.id))!.expires_at).toBe(
    row.expires_at,
  );
  vi.spyOn(Date, 'now').mockReturnValue(row.expires_at + 1);
  expect(
    (await createVerifiedSaleObserver(tenantEnv)(saved.value)).available,
  ).toBe(false);
  expect(await readPublicSale(tenant, domain)).toBeNull();
});
it('does not scan pending records, suspended accounts or closed accounts', async () => {
  const saved = await draft();
  await controller.plan(workspace, saved.value.id, domain);
  await refreshDomainControls(env, fetcher);
  expect(calls).toBe(0);
  await control
    .prepare(
      "UPDATE sales_domain_controls SET status='verified',next_check_at=0",
    )
    .run();
  await control.prepare('UPDATE workspaces SET enabled=0').run();
  await refreshDomainControls(env, fetcher);
  expect(calls).toBe(0);
});
it('retires a deleted listing instead of repeatedly observing it', async () => {
  const saved = await verified();
  await tenant
    .prepare('DELETE FROM sale_drafts WHERE id=?')
    .bind(saved.value.id)
    .run();
  expect(
    await tenant.prepare('SELECT 1 FROM sales_control_leases').first(),
  ).toBeNull();
  await control
    .prepare('UPDATE sales_domain_controls SET next_check_at=0')
    .run();
  await refreshDomainControls(env, fetcher);
  expect((await controller.read(workspace, saved.value.id))!.status).toBe(
    'retired',
  );
});
it('rejects a different account and the wrong internal proof purpose', async () => {
  const saved = await draft();
  await expect(
    controller.plan(other, saved.value.id, domain),
  ).rejects.toThrow();
  const request = new Request(
    'https://accounts.example/sales-internal/domain-control',
    { method: 'POST', body: '{}' },
  );
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(key, workspace, null, request, {
      purpose: 'sales-notifications',
    }),
  );
  expect(
    (
      await new Hono()
        .route('/sales-internal', createSalesInternalRoutes())
        .fetch(request, tenantEnv)
    ).status,
  ).toBe(403);
});
it('requires DNS proof for operator routes, renews active hosting and suspends missing host proof', async () => {
  const saved = await verified();
  await publish(saved);
  const hosts = new SalesHostnames(env, fetcher),
    plan = await hosts.plan(workspace, saved.value.id, domain, domain);
  expect(plan.controlMethod).toBe('operator-worker');
  await expect(
    hosts.activate(
      workspace,
      saved.value.id,
      domain,
      plan.epoch,
      plan.challenge,
      (await readPublicSale(tenant, domain))!.revision,
    ),
  ).rejects.toThrow('TXT');
  dns.set(plan.proof.name, plan.proof.value);
  await hosts.activate(
    workspace,
    saved.value.id,
    domain,
    plan.epoch,
    plan.challenge,
    (await readPublicSale(tenant, domain))!.revision,
  );
  await control.prepare('UPDATE sales_hostnames SET next_check_at=0').run();
  await refreshSalesHostnames(env, fetcher);
  expect((await hosts.list(workspace, saved.value.id))[0].status).toBe(
    'active',
  );
  dns.delete(plan.proof.name);
  await control.prepare('UPDATE sales_hostnames SET next_check_at=0').run();
  await refreshSalesHostnames(env, fetcher);
  const row = (await hosts.list(workspace, saved.value.id))[0];
  expect(row.status).toBe('control-lost');
  expect(row.epoch).toBe(plan.epoch + 1);
});
it('fences an older successful check behind a newer proof-loss observation', async () => {
  const saved = await verified();
  await publish(saved);
  const row = (await controller.read(workspace, saved.value.id))!;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  const delayed = new SalesDomainControl(env, async (input, init) => {
    const response = await fetcher(input, init);
    started();
    await gate;
    return response;
  });
  const oldCheck = delayed.check(row);
  await ready;
  dns.clear();
  await controller.check(row);
  release();
  await expect(oldCheck).rejects.toThrow('Verification changed');
  expect(
    (await createVerifiedSaleObserver(tenantEnv)(saved.value)).available,
  ).toBe(false);
  expect(await readPublicSale(tenant, domain)).toBeNull();
});
it('requires review after a loss even if revocation delivery failed, and does not pause again after review', async () => {
  const saved = await verified();
  await publish(saved);
  const shop = {
    version: 1 as const,
    handle: 'fixture',
    title: 'Selected domains',
    intro: '',
    listingIds: [saved.value.id],
  };
  await store.saveShop(shop, null);
  await tenant
    .prepare("UPDATE sales_shop SET published=? WHERE id='main'")
    .bind(JSON.stringify(shop))
    .run();
  const request = (path: string, method = 'GET') =>
    gateway.fetch(
      new Request(`https://accounts.example/w/${workspace}${path}`, {
        method,
        headers: { Origin: 'https://accounts.example' },
      }),
      env,
    );
  for (const path of [
    `/d/${domain}.`,
    '/shop/fixture',
    '/shop/fixture/export',
  ]) {
    const response = await request(path);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).toContain(domain);
  }
  const original = env.WORKSPACE_0.fetch;
  env.WORKSPACE_0 = {
    fetch: async (request: Request) => {
      if (
        request.method === 'POST' &&
        ((await request.clone().json()) as { valid?: boolean }).valid === false
      )
        return new Response('temporarily unavailable', { status: 503 });
      return original(request);
    },
  } as Fetcher;
  dns.clear();
  await expect(
    controller.check((await controller.read(workspace, saved.value.id))!),
  ).rejects.toThrow('could not be saved');
  // The tenant still has its old valid snapshot: every gateway entry point
  // must suppress that snapshot before the revocation can be delivered.
  expect(await readPublicSale(tenant, domain)).not.toBeNull();
  for (const suffix of ['', '.']) {
    for (const method of ['GET', 'HEAD']) {
      expect((await request(`/d/${domain}${suffix}`, method)).status).toBe(404);
    }
    expect(
      (await request(`/d/${domain}${suffix}/inquiries`, 'POST')).status,
    ).toBe(404);
  }
  for (const path of ['/shop/fixture', '/shop/fixture/export']) {
    const response = await request(path);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(domain);
  }
  env.WORKSPACE_0 = { fetch: original } as Fetcher;
  const row = (await controller.read(workspace, saved.value.id))!;
  dns.set(`_domains-inquiry.${domain}`, row.proof);
  await controller.check(row);
  expect(await readPublicSale(tenant, domain)).toBeNull();
  // An acknowledged loss lets the unaffected portfolio resume; tenant filters
  // have now removed the lost listing from both projections.
  for (const path of ['/shop/fixture', '/shop/fixture/export']) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(domain);
  }
  await publish(saved);
  expect(await readPublicSale(tenant, domain)).not.toBeNull();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 3600_000 + 1);
  await refreshDomainControls(env, fetcher);
  expect(await readPublicSale(tenant, domain)).not.toBeNull();
});
