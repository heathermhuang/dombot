import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { PortfolioDomains } from './portfolio-domains';
import { portfolioDomainPublicRequest } from './portfolio-domain-public';
import { publicAddressRequest, addressState } from './portfolio-addresses';
import { publicSite } from './public-site';
import { emptyOwnerSite, selectedSite } from '../shared/owner-site';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { claimHostname, releaseSalesHostname } from './hostname-claims';
import edge from './lander-edge';
import { refreshPortfolioDomains } from './portfolio-domain-maintenance';
import { DomainServiceError } from './portfolio-domain-provider';

const workspace = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const revision = '33333333-3333-4333-8333-333333333333',
  certificateId = '44444444-4444-4444-8444-444444444444';
const key = 'fixture-only-gateway-key'.repeat(3),
  hostname = 'portfolio.example',
  origin = 'https://domains.example';
let mf: Miniflare, db: D1Database;
let proof = false,
  providerReady = false,
  tlsReady = false,
  certificateExists = false,
  certificatePosts = 0,
  routePosts = 0,
  unknownCreate = false;
let routes: { id: string; pattern: string; script: string }[] = [];
let forwarded: Request[] = [];
const provider = () => ({
  id: certificateId,
  hostname,
  status: providerReady ? 'active' : 'pending',
  ssl: {
    status: tlsReady ? 'active' : 'pending_validation',
    validation_records: [
      {
        txt_name: '_acme-challenge.' + hostname,
        txt_value: 'certificate-fixture',
      },
    ],
  },
  ownership_verification: {
    type: 'txt',
    name: '_cf-custom-hostname.' + hostname,
    value: 'ownership-fixture',
  },
});
const env = () =>
  ({
    PORTFOLIO_CUSTOM_HOSTS_ENABLED: 'true',
    PORTFOLIO_HOST_WORKSPACES: JSON.stringify([workspace, other]),
    PORTFOLIO_CF_ZONE_ID: 'a'.repeat(32),
    PORTFOLIO_CF_API_TOKEN: 'fixture-only',
    PORTFOLIO_CNAME_TARGET: 'portfolio-origin.domains.example',
    PORTFOLIO_EDGE_WORKER: 'portfolio-edge',
    PUBLIC_SITE_ADDRESSES_ENABLED: 'true',
    CANONICAL_ORIGIN: origin,
    CONTROL_DB: db,
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Fixture' },
      { id: other, binding: 'WORKSPACE_1', label: 'Other' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: key, [other]: key }),
    WORKSPACE_0: {
      fetch: async (request: Request) => {
        forwarded.push(request);
        expect(
          (await verifyGatewayRequest(key, workspace, request))?.owner,
        ).toBeNull();
        expect(request.headers.get('cookie')).toBeNull();
        expect(request.headers.get('authorization')).toBeNull();
        return publicSite(request, db);
      },
    },
  }) as HostedEnv;
const fetcher: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init),
    url = new URL(request.url);
  expect(request.redirect).toBe('manual');
  if (url.hostname === 'cloudflare-dns.com') {
    const type = url.searchParams.get('type');
    let answer: unknown[] = [];
    if (
      type === 'TXT' &&
      url.searchParams.get('name')?.startsWith('_domains-portfolio.') &&
      proof
    ) {
      const row = await db
        .prepare(
          'SELECT challenge FROM portfolio_domain_plans WHERE workspace_id=?',
        )
        .bind(workspace)
        .first<{ challenge: string }>();
      answer = [
        { type: 16, data: '"domains-portfolio=' + row!.challenge + '"' },
      ];
    }
    if (type === 'MX') answer = [{ type: 15, data: '10 mail.example.' }];
    return Response.json({ Status: 0, Answer: answer });
  }
  expect(url.hostname).toBe('api.cloudflare.com');
  const ok = (result: unknown, extra = {}) =>
    Response.json({ success: true, result, ...extra });
  if (url.pathname.endsWith('/custom_hostnames') && request.method === 'POST') {
    certificatePosts++;
    certificateExists = true;
    expect(request.headers.get('authorization')).toBe('Bearer fixture-only');
    const body = await request.json();
    expect(body).not.toHaveProperty('custom_metadata');
    expect(body.ssl.method).toBe('txt');
    if (unknownCreate) throw new Error('simulated uncertain transport failure');
    return ok(provider());
  }
  if (
    url.pathname.endsWith('/custom_hostnames') &&
    url.searchParams.has('hostname')
  )
    return ok(certificateExists ? [provider()] : []);
  if (
    url.pathname.endsWith('/custom_hostnames') &&
    url.searchParams.has('per_page')
  )
    return ok([], { result_info: { total_count: 0 } });
  if (url.pathname.endsWith('/custom_hostnames/' + certificateId)) {
    if (request.method === 'DELETE') {
      certificateExists = false;
      return ok(null);
    }
    return certificateExists
      ? ok(provider())
      : Response.json({ success: false, result: null }, { status: 404 });
  }
  if (url.pathname.endsWith('/workers/routes')) {
    if (request.method === 'POST') {
      routePosts++;
      const body = await request.json();
      const result = {
        id: 'route-fixture',
        pattern: body.pattern,
        script: body.script,
      };
      routes.push(result);
      return ok(result);
    }
    return ok(routes);
  }
  if (
    url.pathname.endsWith('/workers/routes/route-fixture') &&
    request.method === 'DELETE'
  ) {
    routes = [];
    return ok(null);
  }
  throw new Error('Unexpected network request in custom-domain fixture');
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: ['DB'],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of readdirSync('hosted/migrations').sort())
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  await db.exec(
    readFileSync('migrations/0002_publication.sql', 'utf8')
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' '),
  );
}, 30000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  await db.exec(
    'DELETE FROM public_hostname_claims; DELETE FROM portfolio_hostnames; DELETE FROM portfolio_domain_plans; DELETE FROM portfolio_addresses; DELETE FROM published_portfolios; DELETE FROM portfolio_drafts; DELETE FROM sales_hostnames; DELETE FROM closure_requests; DELETE FROM users; DELETE FROM workspaces;',
  );
  for (const id of [workspace, other])
    await db
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(id, 'Test account')
      .run();
  await db
    .prepare(
      'INSERT INTO portfolio_addresses(handle,workspace_id,created_at) VALUES(?,?,?)',
    )
    .bind('alice', workspace, Date.now())
    .run();
  const draft = emptyOwnerSite();
  draft.handle = 'private-internal-handle';
  draft.profile.name = 'Public fixture owner';
  draft.domainPresentations = [
    {
      id: 'sample',
      domain: 'fixture.example',
      ownership: 'historical',
      availability: 'not-for-sale',
      description: 'Synthetic fixture',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  draft.collections = [
    {
      id: 'selected',
      slug: 'selected',
      title: 'Selected collection',
      intro: '',
      domainIds: ['sample'],
    },
  ];
  draft.homepage.collectionIds = ['selected'];
  await db
    .prepare(
      "INSERT INTO published_portfolios(id,handle,revision,payload) VALUES('main',?,?,?)",
    )
    .bind(
      draft.handle,
      revision,
      JSON.stringify({ ...selectedSite(draft), publishedAt: Date.now() }),
    )
    .run();
  proof = false;
  providerReady = false;
  tlsReady = false;
  certificateExists = false;
  certificatePosts = 0;
  routePosts = 0;
  unknownCreate = false;
  routes = [];
  forwarded = [];
});
async function planned(controller = new PortfolioDomains(env(), fetcher)) {
  const state = await controller.plan(workspace, hostname, null);
  return { controller, plan: state.plan! };
}
async function checking() {
  const { controller, plan } = await planned();
  proof = true;
  await controller.verify(workspace, hostname, plan.revision);
  providerReady = true;
  tlsReady = true;
  const state = await controller.verify(workspace, hostname, plan.revision);
  expect(state.domain!.status).toBe('checking');
  return { controller, plan, domain: state.domain! };
}
async function active() {
  const result = await checking();
  const response = (await portfolioDomainPublicRequest(
    new Request(result.domain.verificationUrl!),
    env(),
  ))!;
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('https://' + hostname + '/');
  return result;
}

describe('portfolio custom domains', () => {
  it('fences a slow successful check behind a newer proof-loss observation', async () => {
    const { controller, plan } = await active();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      ready = new Promise<void>((r) => {
        started = r;
      });
    const delayed = new PortfolioDomains(env(), async (input, init) => {
      const result = await fetcher(input, init);
      if (String(input).includes('_domains-portfolio.')) {
        started();
        await gate;
      }
      return result;
    });
    const older = delayed.verify(workspace, hostname, plan.revision);
    await ready;
    proof = false;
    await expect(
      controller.verify(workspace, hostname, plan.revision),
    ).rejects.toThrow('dns-proof');
    release();
    await expect(older).rejects.toThrow('stale');
    expect((await controller.state(workspace)).domain!.status).toBe('blocked');
  });

  it('requires a fresh plan and proof after removal', async () => {
    const { controller, plan, domain } = await active();
    await controller.detach(workspace, hostname, domain.epoch);
    expect((await controller.state(workspace)).plan).toBeNull();
    await expect(
      controller.verify(workspace, hostname, plan.revision),
    ).rejects.toThrow('stale');
    const next = await controller.plan(workspace, hostname, null);
    expect(next.plan!.revision).not.toBe(plan.revision);
    expect(next.plan!.records[0].value).not.toBe(plan.records[0].value);
  });
  it('reuses only a previously managed certificate after fresh proof, never an unrelated one', async () => {
    const { controller, plan } = await planned();
    proof = true;
    certificateExists = true;
    await expect(
      controller.verify(workspace, hostname, plan.revision),
    ).rejects.toThrow('provider-mismatch');
    expect(certificatePosts).toBe(0);
    await db
      .prepare(
        'UPDATE public_hostname_claims SET provider_id=? WHERE hostname=?',
      )
      .bind(certificateId, hostname)
      .run();
    const state = await controller.verify(workspace, hostname, plan.revision);
    expect(state.domain!.status).toBe('pending-certificate');
    expect(certificatePosts).toBe(0);
  });
  it('does not replay a certificate create after a persistence failure', async () => {
    const { controller, plan } = await planned();
    proof = true;
    await db.exec(
      "CREATE TRIGGER fail_provider_save BEFORE UPDATE OF provider_id ON portfolio_hostnames WHEN NEW.provider_id IS NOT NULL BEGIN SELECT RAISE(FAIL,'simulated write failure'); END",
    );
    try {
      await expect(
        controller.verify(workspace, hostname, plan.revision),
      ).rejects.toThrow();
      expect(
        (await controller.state(workspace)).domain!.needsServiceReview,
      ).toBe(true);
      await controller.verify(workspace, hostname, plan.revision);
      expect(certificatePosts).toBe(1);
    } finally {
      await db.exec('DROP TRIGGER fail_provider_save');
    }
  });
  it('keeps unknown DNS observations within the last good lease and blocks a real lost proof', async () => {
    const { controller } = await active();
    await db.exec('UPDATE portfolio_hostnames SET next_check_at=0');
    const unavailable: typeof fetch = async () => {
      throw new DomainServiceError('dns-unavailable');
    };
    await refreshPortfolioDomains(env(), unavailable);
    expect((await controller.state(workspace)).domain!.status).toBe('active');
    await db.exec('UPDATE portfolio_hostnames SET next_check_at=0');
    proof = false;
    await refreshPortfolioDomains(env(), fetcher);
    expect((await controller.state(workspace)).domain!.status).toBe('blocked');
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        env(),
      ))!.status,
    ).toBe(404);
  });
  it('hides verification URLs when paused or expired and excludes paused workspaces from refresh', async () => {
    const { controller } = await checking();
    const scoped = { ...env(), PORTFOLIO_HOST_WORKSPACES: '[]' };
    expect(
      (await new PortfolioDomains(scoped, fetcher).state(workspace)).domain!
        .verificationUrl,
    ).toBeNull();
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        scoped,
      ))!.status,
    ).toBe(404);
    await db.exec('UPDATE portfolio_hostnames SET control_expires_at=0');
    const state = await controller.state(workspace);
    expect(state.domain!.status).toBe('blocked');
    expect(state.domain!.verificationUrl).toBeNull();
  });
  it('treats an already-deleted certificate as successful cleanup', async () => {
    const { controller, domain } = await active();
    certificateExists = false;
    expect(
      (await controller.detach(workspace, hostname, domain.epoch)).domain,
    ).toBeNull();
  });
  it('revokes before cleanup and refuses to delete resources after losing the global claim', async () => {
    const { controller, domain } = await active();
    await db
      .prepare(
        "UPDATE public_hostname_claims SET owner_key='another-generation' WHERE hostname=?",
      )
      .bind(hostname)
      .run();
    const state = await controller.detach(workspace, hostname, domain.epoch);
    expect(state.domain!.status).toBe('detaching');
    expect(state.domain!.needsServiceReview).toBe(true);
    expect(certificateExists).toBe(true);
    expect(routes).toHaveLength(1);
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        env(),
      ))!.status,
    ).toBe(404);
  });

  it('prepares DNS instructions without reserving a hostname or creating a provider resource', async () => {
    const { plan } = await planned();
    expect(plan.records).toHaveLength(2);
    expect(plan.dnsBefore.MX[0].data).toBe('10 mail.example.');
    expect(
      (await db
        .prepare('SELECT COUNT(*) n FROM public_hostname_claims')
        .first<{ n: number }>())!.n,
    ).toBe(0);
    expect(certificatePosts).toBe(0);
  });
  it.each([
    'domains.example',
    'support.domains.example',
    '127.0.0.1',
    'https://portfolio.example/path',
    'portfolio.example:443',
  ])(
    'rejects a platform hostname, IP or URL %s before any provisioning',
    async (name) => {
      await expect(
        new PortfolioDomains(env(), fetcher).plan(workspace, name, null),
      ).rejects.toThrow();
      expect(certificatePosts).toBe(0);
    },
  );
  it('requires both published content and the exact ownership proof before provisioning', async () => {
    const { controller, plan } = await planned();
    await expect(
      controller.verify(workspace, hostname, plan.revision),
    ).rejects.toThrow('dns-proof');
    proof = true;
    await db.exec('DELETE FROM published_portfolios');
    await expect(
      controller.verify(workspace, hostname, plan.revision),
    ).rejects.toThrow('not-published');
    expect(certificatePosts).toBe(0);
  });
  it('rejects stale plans and racing plan replacements', async () => {
    const controller = new PortfolioDomains(env(), fetcher);
    const results = await Promise.allSettled([
      controller.plan(workspace, hostname, null),
      controller.plan(workspace, 'another.example', null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(certificatePosts).toBe(0);
  });
  it('provisions one certificate, exposes its DNS records, then waits for both hostname and TLS readiness', async () => {
    const { controller, plan } = await planned();
    proof = true;
    let state = await controller.verify(workspace, hostname, plan.revision);
    expect(certificatePosts).toBe(1);
    expect(state.domain!.records.map((r) => r.name)).toEqual([
      '_cf-custom-hostname.' + hostname,
      '_acme-challenge.' + hostname,
    ]);
    providerReady = true;
    state = await controller.verify(workspace, hostname, plan.revision);
    expect(state.domain!.status).toBe('pending-certificate');
    expect(routePosts).toBe(0);
    expect(certificatePosts).toBe(1);
  });
  it('coalesces racing resource creation and never blindly replays an uncertain create', async () => {
    const { controller, plan } = await planned();
    proof = true;
    unknownCreate = true;
    await Promise.allSettled([
      controller.verify(workspace, hostname, plan.revision),
      controller.verify(workspace, hostname, plan.revision),
    ]);
    expect(certificatePosts).toBe(1);
    expect((await controller.state(workspace)).domain!.status).toBe(
      'needs-review',
    );
    await controller.verify(workspace, hostname, plan.revision);
    expect(certificatePosts).toBe(1);
  });
  it('only connects after the successful HTTPS visit, and removes the verification token from the URL', async () => {
    const { controller, domain } = await checking();
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        env(),
      ))!.status,
    ).toBe(404);
    expect(
      (await portfolioDomainPublicRequest(
        new Request(domain.verificationUrl!, { method: 'HEAD' }),
        env(),
      ))!.status,
    ).toBe(200);
    expect((await controller.state(workspace)).domain!.status).toBe('checking');
    const first = (await portfolioDomainPublicRequest(
      new Request(domain.verificationUrl!),
      env(),
    ))!;
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe('https://' + hostname + '/');
    expect(
      (await controller.state(workspace)).domain!.verificationUrl,
    ).toBeNull();
  });
  it('serves published root/collections on the customer origin without cookies or private state', async () => {
    await active();
    const result = (await portfolioDomainPublicRequest(
      new Request('https://' + hostname + '/', {
        headers: { Cookie: 'private', Authorization: 'Bearer private' },
      }),
      env(),
    ))!;
    expect(result.status).toBe(200);
    const html = await result.text();
    expect(html).toContain('https://' + hostname + '/');
    expect(html).toContain('href="/c/selected"');
    expect(html).not.toContain('href="//c/');
    expect(html).not.toContain(workspace);
    expect(html).not.toContain('private-internal-handle');
    const collection = (await portfolioDomainPublicRequest(
      new Request('https://' + hostname + '/c/selected'),
      env(),
    ))!;
    expect(collection.status).toBe(200);
    expect(await collection.text()).toContain('href="/"');
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/c/hidden'),
        env(),
      ))!.status,
    ).toBe(404);
  });
  it('uses the custom domain as the canonical share address and keeps the short link as a safe redirect', async () => {
    await active();
    expect((await addressState(env(), workspace)).address!.url).toBe(
      'https://' + hostname + '/',
    );
    const short = (await publicAddressRequest(
      new Request(origin + '/alice/c/selected'),
      env(),
    ))!;
    expect(short.status).toBe(308);
    expect(short.headers.get('location')).toBe(
      'https://' + hostname + '/c/selected',
    );
    await db.exec('DELETE FROM published_portfolios');
    expect(
      (await publicAddressRequest(new Request(origin + '/alice'), env()))!
        .status,
    ).toBe(404);
  });
  it('forbids mutation and account paths on external hostnames and drops all caller authority at the edge bridge', async () => {
    await active();
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/', {
          method: 'POST',
          body: 'private',
        }),
        env(),
      ))!.status,
    ).toBe(405);
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/account'),
        env(),
      ))!.status,
    ).toBe(404);
    const gatewayFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get('cookie')).toBeNull();
      expect(request.headers.get('authorization')).toBeNull();
      expect(request.headers.get('x-dombot-gateway-proof')).toBeNull();
      return new Response('public');
    });
    const response = await edge.fetch(
      new Request('https://' + hostname + '/', {
        headers: {
          Cookie: 'private',
          Authorization: 'Bearer private',
          'x-dombot-gateway-proof': 'forged',
        },
      }),
      { ...env(), PORTFOLIO_GATEWAY: { fetch: gatewayFetch } } as HostedEnv,
    );
    expect(response.status).toBe(200);
    expect(gatewayFetch).toHaveBeenCalledOnce();
  });
  it('keeps closed/disabled accounts unavailable and stops serving expired control leases', async () => {
    await active();
    await db
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(workspace)
      .run();
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        env(),
      ))!.status,
    ).toBe(404);
    await db
      .prepare('UPDATE workspaces SET enabled=1 WHERE id=?')
      .bind(workspace)
      .run();
    await db.exec('UPDATE portfolio_hostnames SET control_expires_at=0');
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        env(),
      ))!.status,
    ).toBe(404);
  });
  it('revokes public routing before cleanup and restores the short URL when detached', async () => {
    const { controller, domain } = await active();
    const result = await controller.detach(workspace, hostname, domain.epoch);
    expect(result.domain).toBeNull();
    expect(
      (await portfolioDomainPublicRequest(
        new Request('https://' + hostname + '/'),
        env(),
      ))!.status,
    ).toBe(404);
    expect((await addressState(env(), workspace)).address!.url).toBe(
      origin + '/alice',
    );
    expect(certificateExists).toBe(false);
    expect(routes).toHaveLength(0);
    expect(
      (await db
        .prepare('SELECT held FROM public_hostname_claims')
        .first<{ held: number }>())!.held,
    ).toBe(0);
  });
  it('will not attach a hostname already held by an individual Sales listing', async () => {
    const { controller, plan } = await planned();
    await db
      .prepare(
        "INSERT INTO sales_hostnames(hostname,workspace_id,listing_id,domain,epoch,status,challenge_hash,plan,updated_at) VALUES(?,?,?,?,1,'active','fixture','{}',?)",
      )
      .bind(hostname, other, revision, hostname, Date.now())
      .run();
    await claimHostname(
      db,
      hostname,
      'sales',
      other,
      other + ':' + revision + ':1',
    );
    proof = true;
    await expect(
      controller.verify(workspace, hostname, plan.revision),
    ).rejects.toThrow();
    expect(certificatePosts).toBe(0);
  });
  it('prevents Sales from taking over a portfolio hostname and does not release a newer Sales generation', async () => {
    await active();
    await expect(
      claimHostname(
        db,
        hostname,
        'sales',
        other,
        other + ':' + revision + ':1',
      ),
    ).rejects.toThrow();
    await db
      .prepare(
        "INSERT INTO public_hostname_claims(hostname,kind,workspace_id,owner_key,held,updated_at) VALUES('sales.example','sales',?,?,1,?)",
      )
      .bind(workspace, workspace + ':' + revision + ':3', Date.now())
      .run();
    await releaseSalesHostname(db, 'sales.example', workspace, revision, 2);
    expect(
      (await db
        .prepare(
          "SELECT held FROM public_hostname_claims WHERE hostname='sales.example'",
        )
        .first<{ held: number }>())!.held,
    ).toBe(1);
  });
});
