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
import { LanderHosting, LanderPreparationPending } from './lander-hosting';
import { SalesHostnames } from './sales-hostnames';
import { drainLanderConnections } from './lander-connections';
import { PROOF_HEADER, verifyGatewayRequest } from '../shared/gateway-proof';
let mf: Miniflare,
  db: D1Database,
  providers: Map<string, Record<string, unknown>>,
  routes: { id: string; pattern: string; script: string }[],
  creates: number,
  unknownCreate: boolean,
  ordinary: boolean;
const workspace = '11111111-1111-4111-8111-111111111111',
  listing = '22222222-2222-4222-8222-222222222222',
  generation = '33333333-3333-4333-8333-333333333333',
  secret = 'fixture-secret'.repeat(4),
  edgeSecret = 'fixture-edge-secret'.repeat(4),
  domain = 'fixture.example',
  zone = 'a'.repeat(32),
  revision = '44444444-4444-4444-8444-444444444444';
const environment = () =>
  ({
    CONTROL_DB: db,
    CANONICAL_ORIGIN: 'https://accounts.example',
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Synthetic fixture' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: secret }),
    SALES_EDGE_KEYS: JSON.stringify({ [workspace]: edgeSecret }),
    SALES_CNAME_TARGET: 'fallback.example',
    SALES_CF_ZONE_ID: zone,
    SALES_CF_API_TOKEN: 'fixture-only',
    SALES_CUSTOM_HOSTS_ENABLED: 'true',
    SALES_HOST_ALLOWLIST: domain + ',www.' + domain,
    LANDER_CONNECTIONS_ENABLED: 'true',
    LANDER_CONNECTION_WORKSPACES: JSON.stringify([workspace]),
    LANDER_QUALIFIED_CNAME_TARGET: 'fallback.example',
    LANDER_APEX_FLATTENING_QUALIFIED: 'true',
    LANDER_QUALIFIED_HOST_CAP: '10',
    LANDER_CUSTOM_METADATA_QUALIFIED: 'true',
    WORKSPACE_0: { fetch: async () => Response.json({ ok: true }) },
  }) as HostedEnv;
const fetcher: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init),
    url = new URL(request.url),
    path = url.pathname;
  const result = (data: unknown, info?: unknown) =>
    Response.json({
      success: true,
      result: data,
      ...(info ? { result_info: info } : {}),
    });
  if (url.hostname === 'cloudflare-dns.com') {
    const type = url.searchParams.get('type'),
      host = url.searchParams.get('name')!;
    if (type === 'TXT' && host.startsWith('_domains-sales.')) {
      const row = await db
        .prepare('SELECT plan FROM sales_hostnames WHERE hostname=?')
        .bind(host.slice('_domains-sales.'.length))
        .first<{ plan: string }>();
      return Response.json({
        Status: 0,
        Answer: row
          ? [
              {
                name: host,
                type: 16,
                TTL: 300,
                data: JSON.parse(row.plan).proof.value,
              },
            ]
          : [],
      });
    }
    if (type === 'A')
      return Response.json({
        Status: 0,
        Answer: [{ name: host, type: 1, TTL: 300, data: '192.0.2.2' }],
      });
    if (type === 'CNAME' && host.startsWith('www.'))
      return Response.json({
        Status: 0,
        Answer: [{ name: host, type: 5, TTL: 300, data: 'fallback.example.' }],
      });
    return Response.json({ Status: 0, Answer: [] });
  }
  if (url.hostname !== 'api.cloudflare.com')
    return new Response('synthetic lander', {
      status: request.headers.has(PROOF_HEADER) || ordinary ? 200 : 503,
      headers: { 'X-Domains-Sales-Revision': revision },
    });
  expect(request.redirect).toBe('manual');
  if (path.endsWith('/custom_hostnames') && request.method === 'GET') {
    const hostname = url.searchParams.get('hostname');
    return result(
      [...providers.values()].filter(
        (p) => !hostname || p.hostname === hostname,
      ),
      { total_count: providers.size },
    );
  }
  if (path.endsWith('/custom_hostnames') && request.method === 'POST') {
    const body = (await request.json()) as Record<string, unknown>,
      id = crypto.randomUUID(),
      p = {
        ...body,
        id,
        status: 'active',
        ssl: {
          status: 'active',
          validation_records: [
            {
              txt_name: '_acme-challenge.' + body.hostname,
              txt_value: 'fixture-certificate',
            },
          ],
        },
        ownership_verification: {
          type: 'txt',
          name: '_cf-custom-hostname.' + body.hostname,
          value: 'fixture-owner',
        },
      };
    providers.set(id, p);
    creates++;
    if (unknownCreate) {
      unknownCreate = false;
      throw Error('ambiguous create');
    }
    return result(p);
  }
  if (path.includes('/custom_hostnames/')) {
    const id = path.split('/').at(-1)!;
    if (request.method === 'DELETE') {
      providers.delete(id);
      return result(null);
    }
    const p = providers.get(id);
    return p ? result(p) : new Response('missing', { status: 404 });
  }
  if (path.endsWith('/workers/routes') && request.method === 'GET')
    return result(routes);
  if (path.endsWith('/workers/routes') && request.method === 'POST') {
    const route = {
      ...((await request.json()) as { pattern: string; script: string }),
      id: crypto.randomUUID().replaceAll('-', ''),
    };
    routes.push(route);
    return result(route);
  }
  if (path.includes('/workers/routes/') && request.method === 'DELETE') {
    routes = routes.filter((r) => r.id !== path.split('/').at(-1));
    return result(null);
  }
  throw Error('Unexpected fixture request');
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'lander-hosting-test',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of readdirSync('hosted/migrations').sort())
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
}, 30000);
beforeEach(async () => {
  providers = new Map();
  routes = [];
  creates = 0;
  unknownCreate = false;
  ordinary = true;
  await db.batch(
    [
      'sales_hostnames',
      'public_hostname_claims',
      'lander_workspaces',
      'closure_requests',
      'workspaces',
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  await db
    .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
    .bind(workspace, 'Synthetic fixture')
    .run();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => mf?.dispose());
it('prepares root/www service, ownership and certificate proofs without DNS/publication writes', async () => {
  const port = new LanderHosting(environment(), fetcher),
    plans = await port.prepare(workspace, listing, domain, generation);
  expect(plans).toHaveLength(2);
  expect(plans.every((p) => p.records.length === 3)).toBe(true);
  expect(creates).toBe(2);
  expect(routes).toHaveLength(2);
  expect(
    (await port.prepare(workspace, listing, domain, generation)).map(
      (p) => p.epoch,
    ),
  ).toEqual([1, 1]);
  expect(creates).toBe(2);
});
it('reconciles its own uncertain provider creation by exact metadata instead of repeating it', async () => {
  const port = new LanderHosting(environment(), fetcher);
  unknownCreate = true;
  await expect(
    port.prepare(workspace, listing, domain, generation),
  ).rejects.toThrow();
  expect(creates).toBe(1);
  await port.prepare(workspace, listing, domain, generation);
  expect(creates).toBe(2);
});
it('does not require unqualified premium metadata and holds uncorrelated unknown creates', async () => {
  const env = environment();
  env.LANDER_CUSTOM_METADATA_QUALIFIED = 'false';
  const port = new LanderHosting(env, fetcher);
  unknownCreate = true;
  await expect(
    port.prepare(workspace, listing, domain, generation),
  ).rejects.toThrow();
  expect([...providers.values()][0]).not.toHaveProperty('custom_metadata');
  await expect(
    port.prepare(workspace, listing, domain, generation),
  ).rejects.toThrow(/another setup/);
  expect(creates).toBe(1);
});
it('never adopts another connection provider resource', async () => {
  providers.set('unrelated', {
    id: crypto.randomUUID(),
    hostname: domain,
    status: 'active',
    ssl: { status: 'active' },
    custom_metadata: { domains_connection: 'other' },
  });
  await expect(
    new LanderHosting(environment(), fetcher).prepare(
      workspace,
      listing,
      domain,
      generation,
    ),
  ).rejects.toThrow(/another setup/);
  expect(creates).toBe(0);
});
it('requires controlled apex entitlement, edge admission and finite capacity', async () => {
  const env = environment();
  env.LANDER_APEX_FLATTENING_QUALIFIED = 'false';
  await expect(
    new LanderHosting(env, fetcher).prepare(
      workspace,
      listing,
      domain,
      generation,
    ),
  ).rejects.toThrow(/Root/);
  env.LANDER_APEX_FLATTENING_QUALIFIED = 'true';
  env.LANDER_QUALIFIED_HOST_CAP = '0';
  await expect(
    new LanderHosting(env, fetcher).prepare(
      workspace,
      listing,
      domain,
      generation,
    ),
  ).rejects.toThrow(/capacity/);
  expect(creates).toBe(0);
});
it('admits only the explicit bounded endpoint-qualification fixture before the live apex flag', () => {
  const env = environment();
  env.LANDER_APEX_FLATTENING_QUALIFIED = 'false';
  env.LANDER_QUALIFIED_HOST_CAP = '2';
  const scope = {
    workspace,
    domain,
    accountId: 'dynadot',
    requestId: generation,
    expiresAt: Date.now() + 3600000,
    qualifyConnection: true,
  };
  env.DYNDNS_SETUP_FIXTURE = JSON.stringify(scope);
  expect(() =>
    new LanderHosting(env, fetcher).qualified(workspace, domain),
  ).not.toThrow();
  for (const invalid of [
    { ...scope, domain: 'other.example' },
    { ...scope, workspace: listing },
    { ...scope, expiresAt: 1 },
    { ...scope, qualifyConnection: undefined },
  ]) {
    env.DYNDNS_SETUP_FIXTURE = JSON.stringify(invalid);
    expect(() =>
      new LanderHosting(env, fetcher).qualified(workspace, domain),
    ).toThrow(/Root/);
  }
  env.DYNDNS_SETUP_FIXTURE = JSON.stringify(scope);
  env.LANDER_CONNECTION_WORKSPACES = JSON.stringify([workspace, listing]);
  expect(() =>
    new LanderHosting(env, fetcher).qualified(workspace, domain),
  ).toThrow(/Root/);
  env.LANDER_CONNECTION_WORKSPACES = JSON.stringify([workspace]);
  env.LANDER_QUALIFIED_HOST_CAP = '10';
  expect(() =>
    new LanderHosting(env, fetcher).qualified(workspace, domain),
  ).toThrow(/Root/);
  expect(creates).toBe(0);
});
it('fences stale scheduler writes before provider submission', async () => {
  const port = new LanderHosting(environment(), fetcher, async () => {
    throw Error('expired lease');
  });
  await expect(
    port.prepare(workspace, listing, domain, generation),
  ).rejects.toThrow(/expired/);
  expect(creates).toBe(0);
});
it('does not count a signed probe as ordinary public HTTPS; keeps independent host receipts', async () => {
  const port = new LanderHosting(environment(), fetcher),
    plans = await port.prepare(workspace, listing, domain, generation);
  ordinary = false;
  expect(
    await port.verify(workspace, listing, domain, generation, plans, revision),
  ).toBe('tls-ready');
  ordinary = true;
  expect(
    await port.verify(workspace, listing, domain, generation, plans, revision),
  ).toBe('live');
  const rows = await db
    .prepare('SELECT connection_receipt FROM sales_hostnames ORDER BY hostname')
    .all<{ connection_receipt: string }>();
  expect(rows.results).toHaveLength(2);
  expect(
    rows.results.every(
      (r) => JSON.parse(r.connection_receipt).ordinaryHttpsAt > 0,
    ),
  ).toBe(true);
});
it('cleans only its exact retained resources after cutback, with idempotent cleanup', async () => {
  const port = new LanderHosting(environment(), fetcher),
    plans = await port.prepare(workspace, listing, domain, generation);
  await port.finishRestore(workspace, listing, generation, plans);
  expect(routes).toEqual([]);
  expect(providers.size).toBe(0);
  await port.finishRestore(workspace, listing, generation, plans);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM sales_hostnames WHERE status='detached'",
      )
      .first(),
  ).toEqual({ n: 2 });
  const next = await port.prepare(
    workspace,
    listing,
    domain,
    crypto.randomUUID(),
  );
  expect(next.map((p) => p.epoch)).toEqual([3, 3]);
  expect(creates).toBe(4);
});
it('advances bounded scheduled slices with no browser and skips closed accounts', async () => {
  const env = environment();
  let workReads = 0,
    steps = 0;
  env.WORKSPACE_0 = {
    fetch: async (request: Request) => {
      const proof = await verifyGatewayRequest(secret, workspace, request);
      expect(proof?.sales?.purpose).toBe('sales-connections');
      if (request.url.endsWith('/work')) {
        workReads++;
        return Response.json({
          work: {
            job: crypto.randomUUID(),
            ordinal: 0,
            generation,
            domain,
            listing,
            state: 'preparing',
            hosts: null,
            publication: null,
          },
        });
      }
      steps++;
      return Response.json({ ok: true });
    },
  } as Fetcher;
  vi.spyOn(LanderHosting.prototype, 'prepare').mockResolvedValue(
    [domain, 'www.' + domain].map((hostname) => ({
      hostname,
      epoch: 1,
      challenge: 'c'.repeat(32),
      records: [],
      target: 'fallback.example',
    })),
  );
  await db
    .prepare('INSERT INTO lander_workspaces(workspace_id,due_at) VALUES(?,0)')
    .bind(workspace)
    .run();
  await drainLanderConnections(env);
  expect(workReads).toBe(4);
  expect(steps).toBe(4);
  await db
    .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
    .bind(workspace)
    .run();
  await db.prepare('UPDATE lander_workspaces SET due_at=0').run();
  await drainLanderConnections(env);
  expect(steps).toBe(4);
});
it('cleans a retained generation after the refresher advances it for lost TXT control', async () => {
  const port = new LanderHosting(environment(), fetcher),
    plans = await port.prepare(workspace, listing, domain, generation);
  await db
    .prepare(
      "UPDATE sales_hostnames SET status='control-lost',epoch=epoch+1 WHERE connection_key=?",
    )
    .bind(generation)
    .run();
  await port.finishRestore(workspace, listing, generation, plans);
  await port.finishRestore(workspace, listing, generation, plans);
  expect(providers.size).toBe(0);
  expect(routes).toHaveLength(0);
  expect(
    await db.prepare('SELECT max(epoch) AS epoch FROM sales_hostnames').first(),
  ).toEqual({ epoch: 3 });
});
it('releases known resources from a failed preparation without deleting a newer manual plan', async () => {
  const port = new LanderHosting(environment(), fetcher);
  await port.prepare(workspace, listing, domain, generation);
  await new SalesHostnames(environment(), fetcher).plan(
    workspace,
    listing,
    domain,
    domain,
  );
  await port.finishPreparation(workspace, listing, domain, generation);
  expect(
    await db
      .prepare(
        'SELECT connection_key,status FROM sales_hostnames WHERE hostname=?',
      )
      .bind(domain)
      .first(),
  ).toEqual({ connection_key: null, status: 'pending-proof' });
  expect(providers.size).toBe(1);
  expect(routes).toHaveLength(1);
});

it('retains its created hostname while delayed certificate TXT instructions are unavailable', async () => {
  let pending = true;
  const delayed: typeof fetch = async (input, init) => {
    const r = await fetcher(input, init),
      u = new URL(String(input));
    if (
      pending &&
      u.pathname.includes('/custom_hostnames') &&
      (init?.method ?? 'GET') !== 'DELETE'
    ) {
      const value = (await r.json()) as { result: unknown };
      const clear = (p: Record<string, unknown>) => ({
        ...p,
        ssl: { status: 'initializing' },
      });
      if (Array.isArray(value.result))
        value.result = value.result.map((p) => clear(p));
      else if (value.result && typeof value.result === 'object')
        value.result = clear(value.result as Record<string, unknown>);
      return Response.json(value);
    }
    return r;
  };
  const port = new LanderHosting(environment(), delayed);
  await expect(
    port.prepare(workspace, listing, domain, generation),
  ).rejects.toBeInstanceOf(LanderPreparationPending);
  expect(creates).toBe(1);
  expect(routes).toHaveLength(0);
  pending = false;
  const plans = await port.prepare(workspace, listing, domain, generation);
  expect(plans).toHaveLength(2);
  expect(
    plans.every((p) =>
      p.records.some((r) => r.name === '_acme-challenge.' + p.hostname),
    ),
  ).toBe(true);
  expect(creates).toBe(2);
});
it('leaves preparation pending instead of stepping an incomplete certificate plan', async () => {
  const env = environment();
  let reads = 0,
    steps = 0;
  env.WORKSPACE_0 = {
    fetch: async (request: Request) => {
      if (request.url.endsWith('/work')) {
        reads++;
        return Response.json({
          work: {
            job: listing,
            ordinal: 0,
            generation,
            domain,
            listing,
            state: 'preparing',
            hosts: null,
            publication: null,
          },
        });
      }
      steps++;
      return Response.json({ ok: true });
    },
  } as Fetcher;
  vi.spyOn(LanderHosting.prototype, 'prepare').mockRejectedValue(
    new LanderPreparationPending('waiting'),
  );
  await db
    .prepare('INSERT INTO lander_workspaces(workspace_id,due_at) VALUES(?,0)')
    .bind(workspace)
    .run();
  await drainLanderConnections(env);
  expect(reads).toBe(4);
  expect(steps).toBe(0);
  expect(
    await db
      .prepare('SELECT lease_until FROM lander_workspaces WHERE workspace_id=?')
      .bind(workspace)
      .first(),
  ).toEqual({ lease_until: 0 });
});
