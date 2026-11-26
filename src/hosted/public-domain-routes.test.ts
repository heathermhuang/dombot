import { tokenHash } from './crypto';
import { ownerReferralActivity, saveReferralConsent } from './agent-referrals';
import { agentListingSchema } from './agent-openapi';
import { refreshAgentCatalog } from './agent-catalog';
import { agentOwnerPage } from './agent-views';
import type { SaleDraft } from '../shared/hosted-sales';
import {
  backfillDomainRoutes,
  PublicDomainDirectory,
} from './public-domain-directory';
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { publicDomainRequest } from './public-domain-routes';
import gateway from './gateway';
import {
  verifyGatewayRequest,
  PROOF_HEADER,
  signGatewayRequest,
} from '../shared/gateway-proof';
import { SalesStore, readPublicSale } from '../worker/sales-store';
import { SalesInquiryStore } from '../worker/sales-inquiry-store';
import { emptySale } from '../shared/hosted-sales';
import { sealPlatformKey } from './platform-keys';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const keys = ids.map((id) => `synthetic-public-domain-key-${id}`);
const origin = 'https://localhost';
const partnerFixture = {
  AGENT_REFERRAL_PARTNER_ID: 'test-partner',
  AGENT_REFERRAL_PARTNER_NAME: 'Synthetic partner',
  AGENT_REFERRAL_PARTNER_TOKEN: 'fixture-bearer-credential'.repeat(2),
  AGENT_REFERRAL_SIGNING_KEY: 'fixture-independent-signing-key'.repeat(2),
};
let mf: Miniflare;
let control: D1Database;
let dbs: D1Database[];
let env: HostedEnv;
const calls = vi.fn();
let broken = -1;
let syntheticIntake: ((request: Request) => Promise<Response>) | null = null;
const observation = () => ({
  available: true,
  reason: null,
  price: null,
  ownershipFingerprint: 'synthetic-control',
  controlExpiresAt: Date.now() + 86400000,
});
async function publish(
  index = 0,
  domain = 'working.io',
  values: Partial<SaleDraft> = {},
) {
  const store = await SalesStore.from({
    DB: dbs[index],
    DOMBOT_SECRET: btoa('x'.repeat(32)),
  });
  const draft = {
    ...emptySale(domain, 'synthetic'),
    priceSource: null,
    ...values,
  };
  const revision = await store.save(draft, null);
  const review = await store.prepare([{ id: draft.id, revision }], observation);
  try {
    await new PublicDomainDirectory(control).reserve(ids[index], {
      domain,
      listing: draft.id,
      revision: review.items[0].after.revision,
    });
  } catch {
    /* Conflict manifest is exercised below. */
  }
  await store.publish(review.id, observation);
  return draft.id;
}
function request(path = '/working.io', method = 'GET', requestHeaders = {}) {
  return new Request(origin + path, {
    method,
    headers: requestHeaders,
    ...(method === 'POST' ? { body: 'synthetic inquiry' } : {}),
  });
}
const route = async (
  path?: string,
  method?: string,
  headers?: Record<string, string>,
) => (await publicDomainRequest(request(path, method, headers), env))!;

beforeAll(async () => {
  const script = (
    await build({
      entryPoints: ['src/hosted/tenant.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      external: ['cloudflare:*'],
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
  const referralGateway = (
    await build({
      entryPoints: ['src/hosted/gateway.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      external: ['cloudflare:*'],
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'control',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          d1Databases: { CONTROL_DB: 'control' },
        },
        {
          name: 'referral-browser-gateway',
          modules: true,
          script: referralGateway,
          compatibilityDate: '2026-10-08',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { CONTROL_DB: 'control' },
          serviceBindings: { WORKSPACE_2: 'tenant2' },
          bindings: {
            ...partnerFixture,
            AGENT_CATALOG_ENABLED: 'true',
            CANONICAL_ORIGIN: origin,
            AUTH_PEPPER: 'synthetic-pepper'.repeat(4),
            WORKSPACES: JSON.stringify([
              {
                id: ids[2],
                binding: 'WORKSPACE_2',
                label: 'Synthetic account',
              },
            ]),
            GATEWAY_KEYS: JSON.stringify({ [ids[2]]: keys[2] }),
          },
        },
        ...ids.map((id, i) => ({
          name: `tenant${i}`,
          modules: true,
          script,
          compatibilityDate: '2026-10-08',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: `tenant${i}` },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'WorkspaceCoordinator',
              useSQLite: true,
            },
          },
          bindings: {
            DOMBOT_AUTH: 'gateway',
            DOMBOT_WORKSPACE_ID: id,
            DOMBOT_GATEWAY_SECRET: keys[i],
            DOMBOT_PUBLIC_BASE_PATH: `/w/${id}`,
            DOMBOT_SALES_ORIGIN: `${origin}/w/${id}`,
            SALES_INQUIRIES_ENABLED: 'true',
            SALES_PRIVACY_REVIEWED: 'true',
            SALES_TURNSTILE_SITEKEY: 'synthetic-site-key',
            ...(i === 2
              ? {
                  SALES_TURNSTILE_SECRET: 'synthetic-never-send',
                  SALES_MAIL_ENABLED: 'true',
                }
              : {}),
            // The first tenant exercises public reads without a root secret.
            ...(i === 0 ? {} : { DOMBOT_SECRET: btoa('x'.repeat(32)) }),
          },
        })),
      ],
    }),
  );
  control = (await mf.getD1Database(
    'CONTROL_DB',
    'control',
  )) as unknown as D1Database;
  dbs = await Promise.all(
    ids.map(
      async (_, i) =>
        (await mf.getD1Database('DB', `tenant${i}`)) as unknown as D1Database,
    ),
  );
  for (const file of readdirSync('hosted/migrations').sort())
    await control.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  for (const db of dbs)
    for (const file of [
      '0002_publication.sql',
      '0004_sales.sql',
      '0009_sales_lifecycle.sql',
      '0005_sales_inquiries.sql',
      '0006_sales_control_leases.sql',
    ])
      await db.exec(
        readFileSync('migrations/' + file, 'utf8')
          .replace(/^--.*$/gm, '')
          .replace(/\n/g, ' '),
      );
  const services = await Promise.all(
    ids.map((_, i) => mf.getWorker(`tenant${i}`)),
  );
  env = {
    CONTROL_DB: control,
    CANONICAL_ORIGIN: origin,
    AUTH_PEPPER: 'synthetic-pepper'.repeat(4),
    WORKSPACES: JSON.stringify(
      ids.map((id, i) => ({
        id,
        binding: `WORKSPACE_${i}`,
        label: 'Synthetic account',
      })),
    ),
    GATEWAY_KEYS: JSON.stringify(
      Object.fromEntries(ids.map((id, i) => [id, keys[i]])),
    ),
    ...Object.fromEntries(
      services.map((service, i) => [
        `WORKSPACE_${i}`,
        {
          fetch: async (req: Request) => {
            calls(i, req.clone());
            if (broken === i)
              return new Response('Synthetic reader failure', { status: 503 });
            const proof = await verifyGatewayRequest(keys[i], ids[i], req);
            expect(proof?.owner).toBeNull();
            expect(req.headers.get('cookie')).toBeNull();
            expect(req.headers.get('authorization')).toBeNull();
            if (new URL(req.url).pathname.startsWith('/platform-internal/'))
              expect(proof?.sales).toBeUndefined();
            else expect(proof?.sales?.purpose).toBe('sales-public');
            if (
              syntheticIntake &&
              new URL(req.url).pathname === '/d/working.io/inquiries'
            )
              return syntheticIntake(req);
            return service.fetch(req);
          },
        },
      ]),
    ),
  } as HostedEnv;
}, 30000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  delete env.AGENT_CATALOG_ENABLED;
  delete env.AGENT_REFERRAL_PARTNER_ID;
  delete env.AGENT_REFERRAL_PARTNER_NAME;
  delete env.AGENT_REFERRAL_PARTNER_TOKEN;
  delete env.AGENT_REFERRAL_SIGNING_KEY;
  syntheticIntake = null;
  delete env.PUBLIC_DOMAIN_DIRECTORY_READY;
  broken = -1;
  delete env.PLATFORM_ENABLED;
  delete env.DISPATCHER;
  calls.mockClear();
  await control.exec(
    'DELETE FROM agent_referral_receipts; DELETE FROM agent_referral_optins; DELETE FROM agent_catalog_events; DELETE FROM agent_catalog_search; DELETE FROM agent_catalog_index; DELETE FROM public_domain_route_transfers; DELETE FROM public_domain_route_conflicts; DELETE FROM public_domain_route_backfill; DELETE FROM public_domain_routes; DELETE FROM sales_domain_controls; DELETE FROM closure_requests; DELETE FROM users; DELETE FROM platform_workspaces; DELETE FROM rate_limits; DELETE FROM workspaces;',
  );
  for (const id of ids)
    await control
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(id, 'Synthetic')
      .run();
  for (const db of dbs)
    await db.exec(
      'DELETE FROM sales_reviews; DELETE FROM sales_leads; DELETE FROM published_sales; DELETE FROM sale_drafts;',
    );
});

describe('canonical public domain routing', () => {
  it('serves the clean URL anonymously through the gateway with canonical metadata and a clean inquiry action', async () => {
    await publish();
    const response = await gateway.fetch(
      request('/working.io', 'GET', {
        Cookie: 'private=session',
        Authorization: 'Bearer private',
        [PROOF_HEADER]: 'forged',
      }),
      env,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`href="${origin}/working.io"`);
    expect(html).toContain('action="/working.io/inquiries"');
    expect(html).not.toContain('/w/');
    expect(response.headers.get('Cache-Control')).toBe(
      'no-store, no-transform',
    );
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(calls).toHaveBeenCalledTimes(2);
  });
  it('preserves only unmapped legacy paths during an explicit release bridge', async () => {
    env.PUBLIC_DOMAIN_DIRECTORY_READY = 'false';
    const legacy = `/w/${ids[0]}/d/working.io`;
    expect(await publicDomainRequest(request(legacy), env)).toBeNull();
    expect((await route('/working.io')).status).toBe(404);
    env.PUBLIC_DOMAIN_DIRECTORY_READY = 'true';
    expect((await route(legacy)).status).toBe(404);
    delete env.PUBLIC_DOMAIN_DIRECTORY_READY;
    expect((await route(legacy)).status).toBe(404);
    await publish();
    env.PUBLIC_DOMAIN_DIRECTORY_READY = 'false';
    expect((await route(legacy)).status).toBe(308);
    const directory = new PublicDomainDirectory(control),
      record = (await directory.get('working.io'))!;
    await directory.withdraw(record);
    expect((await route(legacy)).status).toBe(404);
  });
  it('permanently redirects legacy and normalized addresses while retaining query parameters', async () => {
    await publish();
    for (const path of [
      `/w/${ids[0]}/d/working.io?ref=share`,
      '/Working.IO./?ref=share',
    ]) {
      const response = await route(path);
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe('/working.io?ref=share');
    }
    expect((await route(`/w/${ids[1]}/d/working.io`)).status).toBe(404);
    const head = await route('/working.io', 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
  it('does not publish drafts or serve withdrawn, paused, expired or ownership-lost listings', async () => {
    expect((await route()).status).toBe(404);
    await publish();
    await dbs[0].exec("UPDATE sale_drafts SET availability='paused'");
    expect((await route()).status).toBe(404);
    await dbs[0].exec(
      "UPDATE sale_drafts SET availability='available',control_expires_at=1",
    );
    expect((await route()).status).toBe(404);
    await dbs[0]
      .prepare('UPDATE sale_drafts SET control_expires_at=?')
      .bind(Date.now() + 10000)
      .run();
    await control
      .prepare(
        "INSERT INTO sales_domain_controls(workspace_id,listing_id,domain,epoch,revision,proof,status,updated_at) VALUES(?,?,?,1,?,?,'lost',?)",
      )
      .bind(
        ids[0],
        crypto.randomUUID(),
        'working.io',
        crypto.randomUUID(),
        'synthetic',
        Date.now(),
      )
      .run();
    expect((await route()).status).toBe(404);
    await control.exec('DELETE FROM sales_domain_controls');
    await dbs[0].exec('DELETE FROM published_sales');
    expect((await route()).status).toBe(404);
  });
  it('holds conflicting claims until explicit ownership review', async () => {
    await publish(0);
    await publish(1);
    const conflict = await route();
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain(ids[0]);
    expect((await route(`/w/${ids[0]}/d/working.io`)).status).toBe(409);
    await dbs[1].exec('DELETE FROM published_sales');
    broken = 1;
    expect((await route()).status).toBe(409);
  });
  it('excludes disabled and closed accounts', async () => {
    await publish();
    await control
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(ids[0])
      .run();
    expect((await route()).status).toBe(404);
    expect(calls.mock.calls.every(([i]) => i !== 0)).toBe(true);
    await control
      .prepare('UPDATE workspaces SET enabled=1 WHERE id=?')
      .bind(ids[0])
      .run();
    await control
      .prepare(
        'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        'synthetic-user',
        'owner@example.test',
        ids[0],
        'unused',
        Date.now(),
      )
      .run();
    await control
      .prepare(
        'INSERT INTO closure_requests(workspace_id,user_id,requested_at,purge_after) VALUES(?,?,?,?)',
      )
      .bind(ids[0], 'synthetic-user', Date.now(), Date.now() + 86400000)
      .run();
    expect((await route()).status).toBe(404);
  });
  it('serves qualified platform accounts at 500-account scale with constant selected-tenant reads', async () => {
    await publish(1);
    const staticWorkspaces = env.WORKSPACES;
    env.WORKSPACES = JSON.stringify(JSON.parse(staticWorkspaces).slice(0, 1));
    env.PLATFORM_ENABLED = 'true';
    const get = vi.fn(() => env.WORKSPACE_1);
    env.DISPATCHER = { get } as unknown as DispatchNamespace;
    const insert = async (id: string, database: string) => {
      await control
        .prepare(
          'INSERT INTO platform_workspaces(workspace_id,database_id,gateway_key_box,engine_version,qualified_at,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          id,
          database,
          await sealPlatformKey(env.AUTH_PEPPER, id, keys[1]),
          'synthetic',
          Date.now(),
          Date.now(),
        )
        .run();
    };
    try {
      await insert(ids[1], 'synthetic-db');
      expect((await route()).status).toBe(200);
      expect(get).toHaveBeenCalledWith(`dombot-wfp-${ids[1]}`);
      const extra = await Promise.all(
        Array.from({ length: 498 }, async (_, i) => {
          const id = crypto.randomUUID();
          return {
            id,
            database: `synthetic-db-${i}`,
            key: await sealPlatformKey(env.AUTH_PEPPER, id, keys[1]),
          };
        }),
      );
      for (let offset = 0; offset < extra.length; offset += 100) {
        const encoded = JSON.stringify(extra.slice(offset, offset + 100));
        await control.batch([
          control
            .prepare(
              "INSERT INTO workspaces(id,label) SELECT json_extract(value,'$.id'),'Synthetic capacity' FROM json_each(?)",
            )
            .bind(encoded),
          control
            .prepare(
              "INSERT INTO platform_workspaces(workspace_id,database_id,gateway_key_box,engine_version,qualified_at,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.database'),json_extract(value,'$.key'),'synthetic',?1,?1 FROM json_each(?2)",
            )
            .bind(Date.now(), encoded),
        ]);
      }
      calls.mockClear();
      broken = 0;
      expect((await route()).status).toBe(200);
      expect(calls).toHaveBeenCalledTimes(2);
      expect(calls.mock.calls.every(([index]) => index === 1)).toBe(true);
    } finally {
      env.WORKSPACES = staticWorkspaces;
    }
  });
  it('reconciles interrupted reservations, fences stale writers and never serves an unrelated tenant failure', async () => {
    const listing = await publish();
    broken = 1;
    expect((await route()).status).toBe(200);
    const directory = new PublicDomainDirectory(control),
      old = (await directory.get('working.io'))!;
    const pending = await directory.reserve(ids[0], {
      domain: 'working.io',
      listing,
      revision: crypto.randomUUID(),
    });
    expect(pending.generation).toBeGreaterThan(old.generation);
    await directory.withdraw(old);
    expect((await directory.get('working.io'))?.generation).toBe(
      pending.generation,
    );
    expect((await route()).status).toBe(404);
    await directory.reserve(ids[0], {
      domain: 'working.io',
      listing,
      revision: old.revision,
    });
    expect((await route()).status).toBe(200);
    broken = 0;
    expect((await route()).status).toBe(503);
  });
  it('backfills only published eligible rows with resumable checkpoint and durable conflict holds', async () => {
    await publish(0, 'first.io');
    await publish(0, 'second.io');
    await control.exec('DELETE FROM public_domain_routes');
    const first = await backfillDomainRoutes(env, ids[0], 1);
    expect(first.done).toBe(false);
    expect(first.cursor).toBe('first.io');
    const second = await backfillDomainRoutes(env, ids[0], 1);
    expect(second.done).toBe(true);
    expect((await route('/second.io')).status).toBe(200);
    expect((await backfillDomainRoutes(env, ids[0], 1)).done).toBe(true);
  });
  it('backfills eligible neutral stale pages and advances past ineligible published snapshots', async () => {
    await publish(0, 'a.io');
    await publish(0, 'b.io');
    const row = await dbs[0]
      .prepare("SELECT payload FROM published_sales WHERE domain='a.io'")
      .first<{ payload: string }>();
    const payload = {
      ...JSON.parse(row!.payload),
      mode: 'offer',
      allowQuestions: false,
      sourceValidUntil: Date.now() - 1,
    };
    await dbs[0]
      .prepare("UPDATE published_sales SET payload=? WHERE domain='a.io'")
      .bind(JSON.stringify(payload))
      .run();
    await dbs[0].exec(
      "UPDATE sale_drafts SET availability='source-stale' WHERE id IN (SELECT id FROM published_sales WHERE domain='b.io')",
    );
    await control.exec('DELETE FROM public_domain_routes');
    const first = await backfillDomainRoutes(env, ids[0], 1);
    expect(first.done).toBe(false);
    expect(first.cursor).toBe('a.io');
    expect(await new PublicDomainDirectory(control).get('a.io')).toBeNull();
    const second = await backfillDomainRoutes(env, ids[0], 1);
    expect(second.done).toBe(true);
    expect((await route('/b.io')).status).toBe(200);
  });
  it('does not let an older backfill observation replace a newer reservation or tombstone', async () => {
    const listing = await publish(),
      directory = new PublicDomainDirectory(control),
      old = (await directory.get('working.io'))!;
    const newer = await directory.reserve(ids[0], {
      domain: 'working.io',
      listing,
      revision: crypto.randomUUID(),
    });
    await backfillDomainRoutes(env, ids[0], 1);
    expect(await directory.get('working.io')).toMatchObject({
      revision: newer.revision,
      generation: newer.generation,
      state: 'reserved',
    });
    await directory.withdraw(newer);
    const tombstone = await directory.get('working.io');
    await directory.reserve(
      ids[0],
      { domain: 'working.io', listing, revision: old.revision },
      'backfill',
    );
    expect(await directory.get('working.io')).toEqual(tombstone);
  });
  it('requires fresh control plus explicit generation-bound transfer and never reactivates the former publication', async () => {
    await publish(0);
    const next = await publish(1),
      directory = new PublicDomainDirectory(control),
      revision = crypto.randomUUID();
    await expect(
      directory.reviewTransfer(ids[1], {
        domain: 'working.io',
        listing: next,
        revision,
      }),
    ).rejects.toThrow(/control/);
    await control
      .prepare(
        "INSERT INTO sales_domain_controls(workspace_id,listing_id,domain,epoch,revision,proof,status,observed_at,expires_at,updated_at) VALUES(?,?,?,1,?,?,'verified',?,?,?)",
      )
      .bind(
        ids[1],
        next,
        'working.io',
        crypto.randomUUID(),
        'fresh-proof',
        Date.now(),
        Date.now() + 3600000,
        Date.now(),
      )
      .run();
    const review = await directory.reviewTransfer(ids[1], {
      domain: 'working.io',
      listing: next,
      revision,
    });
    expect((await route()).status).toBe(409);
    const transferred = await directory.commitTransfer(ids[1], review.id);
    expect(transferred?.workspace_id).toBe(ids[1]);
    expect(
      (await directory.commitTransfer(ids[1], review.id))?.generation,
    ).toBe(transferred?.generation);
    expect((await route()).status).toBe(404); // transfer reserves; it cannot publish terms
    expect((await route(`/w/${ids[0]}/d/working.io`)).status).toBe(404);
    await expect(
      directory.reserve(ids[0], {
        domain: 'working.io',
        listing: crypto.randomUUID(),
        revision: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/conflicting/);
  });
  it('checks origin before inquiry discovery, redirects old POSTs with their method, and never probes with a mutation', async () => {
    await publish();
    expect(
      (
        await route('/working.io/inquiries', 'POST', {
          Origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(calls).not.toHaveBeenCalled();
    const redirected = await route(
      `/w/${ids[0]}/d/working.io/inquiries`,
      'POST',
      { Origin: origin },
    );
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get('Location')).toBe('/working.io/inquiries');
    expect(calls.mock.calls.every(([, req]) => req.method === 'GET')).toBe(
      true,
    );
    calls.mockClear();
    // Missing delivery secret deliberately stops before parsing/creating a lead.
    const intake = await route('/working.io/inquiries', 'POST', {
      Origin: origin,
    });
    expect(intake.status, await intake.clone().text()).toBe(503);
    expect(
      calls.mock.calls.filter(([, req]) => req.method === 'POST'),
    ).toHaveLength(1);
  });
  it('does not capture application routes, static files or custom hosts', async () => {
    for (const path of [
      '/robots.txt',
      '/favicon.ico',
      '/app',
      '/api/working.io',
      '/working.io/extra',
    ])
      expect(await publicDomainRequest(request(path), env)).toBeNull();
    expect(
      await publicDomainRequest(
        new Request('https://custom.example/working.io'),
        env,
      ),
    ).toBeNull();
    expect((await route('/working.io', 'DELETE')).status).toBe(405);
    expect((await route('/invalid..io')).status).toBe(404);
    expect(calls).not.toHaveBeenCalled();
  });
  it('keeps discovery internal and rejects owner and public-edge admission at its narrow endpoint', async () => {
    const service = await mf.getWorker('tenant0');
    for (const owner of [null, 'synthetic-owner']) {
      const req = new Request(
        origin + '/platform-internal/public-domain?domain=working.io',
      );
      req.headers.set(
        PROOF_HEADER,
        await signGatewayRequest(
          keys[0],
          ids[0],
          owner,
          req,
          owner
            ? undefined
            : {
                purpose: 'sales-public',
                host: 'domains.domains',
                listing: null,
                epoch: 0,
              },
        ),
      );
      expect((await service.fetch(req)).status).toBe(403);
    }
    const blocked = await gateway.fetch(
      request(`/w/${ids[0]}/platform-internal/public-domain?domain=working.io`),
      env,
    );
    expect(blocked.status).toBe(404);
  });
});

it('signs original public inquiry context and strips forged internal headers before forwarding', async () => {
  await publish();
  const incoming = request('/working.io/inquiries', 'POST', {
    Origin: origin,
    'cf-connecting-ip': '203.0.113.99',
    'user-agent': 'Original browser',
    'x-dombot-inquiry-request': 'forged',
  });
  Object.defineProperty(incoming, 'cf', {
    value: { country: 'SG', city: 'Singapore', timezone: 'Asia/Singapore' },
  });
  await publicDomainRequest(incoming, env);
  const forwarded = calls.mock.calls
    .map(([, req]) => req as Request)
    .find((req) => new URL(req.url).pathname === '/d/working.io/inquiries')!;
  expect(forwarded).toBeDefined();
  expect(forwarded.headers.get('x-dombot-inquiry-request')).toBeNull();
  const proof = await verifyGatewayRequest(keys[0], ids[0], forwarded);
  expect(
    proof?.sales?.purpose === 'sales-public' && proof.sales.inquiryRequest,
  ).toMatchObject({
    ipAddress: '203.0.113.99',
    userAgent: 'Original browser',
    country: 'SG',
    city: 'Singapore',
  });
});

describe('public agent catalog', () => {
  const listingPath = '/api/agent/listings/working.io';
  const fetchGateway = (path: string, init?: RequestInit) =>
    gateway.fetch(new Request(origin + path, init), env);
  const override = { amount: '1200.99', currency: 'USD' };
  const offerDraft: Partial<SaleDraft> = {
    mode: 'offer',
    description: 'Card payments software for merchants.',
    categories: ['payments'],
    priceSource: {
      kind: 'override',
      price: override,
      reason: 'Approved public price',
    },
  };

  it('keeps the agent setup and copy script reachable when public portfolio handles are enabled', async () => {
    const productionEnv = {
      ...env,
      AGENT_CATALOG_ENABLED: 'true',
      PUBLIC_SITE_ADDRESSES_ENABLED: 'true',
    };
    const setup = await gateway.fetch(
      new Request(origin + '/connect-agent'),
      productionEnv,
    );
    expect(setup.status).toBe(200);
    expect(await setup.text()).toContain('Connect your agent');
    const script = await gateway.fetch(
      new Request(origin + '/connect-agent/copy-v1.js'),
      productionEnv,
    );
    expect(script.status).toBe(200);
    expect(script.headers.get('Content-Type')).toContain('text/javascript');
  });

  it('provides no-auth setup instructions and a read-only JSON catalog contract', async () => {
    expect((await fetchGateway('/connect-agent')).status).toBe(404);
    expect((await fetchGateway('/api/agent/openapi.json')).status).toBe(404);
    env.AGENT_CATALOG_ENABLED = 'true';
    await publish(2, 'working.io', offerDraft);

    const page = await fetchGateway('/connect-agent');
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Security-Policy')).toContain(
      "script-src 'self'",
    );
    const html = await page.text();
    expect(html).toContain(origin + '/mcp/catalog');
    expect(html).toContain('No authentication');
    expect(html).toContain('No sign in to Domains.Domains is required');
    expect(html).toContain('codex mcp add domains-domains-catalog --url');
    expect(html).toContain('claude mcp add --transport http');
    expect(html).toContain('gemini mcp add --transport http');
    const install = html.match(/href="(cursor:[^"]+)"/)![1];
    const cursor = new URL(install.replaceAll('&amp;', '&'));
    expect(JSON.parse(atob(cursor.searchParams.get('config')!))).toEqual({
      url: origin + '/mcp/catalog',
    });

    const spec = await fetchGateway('/api/agent/openapi.json');
    expect(spec.status).toBe(200);
    expect(await spec.json()).toMatchObject({
      openapi: '3.1.0',
      security: [],
      servers: [{ url: origin }],
      paths: {
        '/api/agent/listings': { get: { operationId: 'domain_search' } },
        '/api/agent/listings/{domain}': {
          get: { operationId: 'domain_price' },
        },
      },
      components: { schemas: { Listing: { type: 'object' } } },
    });
    const live = await (await fetchGateway(listingPath)).json();
    expect(agentListingSchema.parse(live)).toEqual(live);
    expect(await (await fetchGateway('/')).text()).toContain('/connect-agent');
  });

  it('shares only explicitly opted-in current terms and attributes the browser offer to the Sales receipt', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    expect((await fetchGateway('/api/agent/referrals')).status).toBe(404);
    Object.assign(env, partnerFixture);
    const owner = ids[2];
    const listing = await publish(2, 'working.io', offerDraft);
    const { revision } = await (await fetchGateway(listingPath)).json();
    const entry = { domain: 'working.io', listing, revision, enabled: true };
    const feed = (
      authorization = 'Bearer ' + env.AGENT_REFERRAL_PARTNER_TOKEN,
    ) =>
      fetchGateway('/api/agent/referrals', {
        headers: { Authorization: authorization },
      });
    expect((await feed('Bearer incorrect')).status).toBe(401);
    expect((await (await feed()).json()).listings).toEqual([]);
    expect(await saveReferralConsent(env, ids[1], entry)).toBe(false);
    expect(await saveReferralConsent(env, owner, entry)).toBe(true);

    const page = await (await feed()).json();
    expect(page.listings).toHaveLength(1);
    expect(page.listings[0]).toMatchObject({
      domain: 'working.io',
      askingPrice: override,
    });
    const handoff = new URL(page.listings[0].offerUrl);
    const ticket = handoff.searchParams.get('referral')!;
    expect(ticket).toBeTruthy();
    expect((await fetchGateway('/working.io?referral=forged')).status).toBe(
      404,
    );
    const browserGateway = await mf.getWorker('referral-browser-gateway');
    const hostedForm = await browserGateway.fetch(handoff.href);
    expect(hostedForm.status).toBe(200);
    const markedUp = await hostedForm.text();
    expect(markedUp).toContain('/working.io/inquiries?referral=');
    expect(markedUp).toContain(
      'This offer will be marked as a referral from Synthetic partner.',
    );

    const receipt = crypto.randomUUID();
    const directKey = crypto.randomUUID();
    const keys: string[] = [];
    syntheticIntake = async (req) => {
      const form = await req.formData();
      keys.push(String(form.get('idempotencyKey')));
      return new Response(
        '<p class="receipt">Inquiry reference: ' + receipt + '</p>',
        {
          status: 202,
          headers: { 'Content-Type': 'text/html' },
        },
      );
    };
    const post = (referral: string, observedRevision = revision) =>
      fetchGateway('/working.io/inquiries?referral=' + referral, {
        method: 'POST',
        headers: { Origin: origin },
        body: new URLSearchParams({
          intent: 'offer',
          amount: '900',
          currency: 'USD',
          idempotencyKey: directKey,
          observedRevision,
        }),
      });
    expect((await post(ticket, crypto.randomUUID())).status).toBe(409);
    expect((await post(ticket)).status).toBe(202);
    expect((await post(ticket)).status).toBe(202);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(directKey);
    expect((await ownerReferralActivity(env, owner))?.recent).toEqual([
      {
        domain: 'working.io',
        receipt,
        partner_name: 'Synthetic partner',
      },
    ]);
    expect((await ownerReferralActivity(env, ids[1]))?.recent).toEqual([]);

    expect(
      await saveReferralConsent(env, owner, { ...entry, enabled: false }),
    ).toBe(true);
    expect((await post(ticket)).status).toBe(404);
    expect((await (await feed()).json()).listings).toEqual([]);
    expect(await saveReferralConsent(env, owner, entry)).toBe(true);
    expect((await post(ticket)).status).toBe(404);

    await dbs[2]
      .prepare('DELETE FROM published_sales WHERE id=?')
      .bind(listing)
      .run();
    expect((await (await feed()).json()).listings).toEqual([]);
    expect((await ownerReferralActivity(env, owner))?.recent).toHaveLength(1);
  });

  it('indexes published terms, searches by concept and exact price, and excludes withdrawn and private names', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    const listingId = await publish(2, 'working.io', offerDraft);
    const privateStore = await SalesStore.from({
      DB: dbs[1],
      DOMBOT_SECRET: btoa('x'.repeat(32)),
    });
    await privateStore.save(
      emptySale('private.example.com', 'Private portfolio'),
      null,
    );
    await refreshAgentCatalog(env);

    const response = await fetchGateway(
      '/api/agent/listings?q=fintech&currency=USD&minPrice=1200.99&maxPrice=1200.99',
      {
        headers: {
          'User-Agent': 'SyntheticAgent/1.0',
          Cookie: 'secret=owner',
          Authorization: 'Bearer secret',
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      listings: [
        {
          domain: 'working.io',
          forSale: true,
          askingPrice: override,
          terms: 'make-offer',
          offerCurrency: 'USD',
          route: {
            type: 'offer',
            humanApprovalRequired: true,
            buyerVerificationRequired: true,
          },
        },
      ],
      nextCursor: null,
      partial: false,
    });
    expect(
      (await fetchGateway('/api/agent/listings/private.example.com')).status,
    ).toBe(404);
    expect(
      (await fetchGateway('/api/agent/listings?minPrice=100')).status,
    ).toBe(400);
    const activity = await agentOwnerPage(env, ids[2], '', '');
    expect(activity).toContain('API · SyntheticAgent');
    expect(activity).toContain('fintech');
    expect(await agentOwnerPage(env, ids[1], '', '')).not.toContain('fintech');
    expect((await fetchGateway('/account/agent-listings')).status).toBe(303);

    await dbs[2]
      .prepare('DELETE FROM published_sales WHERE id=?')
      .bind(listingId)
      .run();
    expect((await fetchGateway(listingPath)).status).toBe(404);
    expect((await fetchGateway('/working.io/llms.txt')).status).toBe(404);
    expect(
      await (await fetchGateway('/api/agent/listings?q=fintech')).json(),
    ).toMatchObject({ listings: [] });
  });

  it('withholds aged terms and serves the draft discovery URL for the eligible name', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    const listing = await publish(2, 'working.io', offerDraft);
    const price = await fetchGateway(listingPath);
    const approved = await price.json();
    expect(approved.askingPrice).toEqual(override);
    expect(approved.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const file = await fetchGateway('/working.io/llms.txt');
    expect(file.status).toBe(200);
    expect(await file.text()).toContain(`${origin}${listingPath}`);

    await dbs[2]
      .prepare(
        "UPDATE published_sales SET payload=json_set(payload,'$.publishedAt',?) WHERE id=?",
      )
      .bind(Date.now() - 31 * 86400_000, listing)
      .run();
    expect(await (await fetchGateway(listingPath)).json()).toMatchObject({
      askingPrice: null,
      priceStatus: 'needs-reconfirmation',
    });
    expect(
      await (await fetchGateway('/api/agent/listings?currency=USD')).json(),
    ).toMatchObject({ listings: [] });
  });

  it('exposes a real read-only stateless MCP server and denies direct private reader calls', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    await publish(2, 'working.io', offerDraft);
    const send = (method: string, params: object) =>
      fetchGateway('/mcp/catalog', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    const initialized = await send('initialize', {
      protocolVersion: '2025-11-25',
      clientInfo: { name: 'synthetic', version: '1' },
      capabilities: {},
    });
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({
      result: { serverInfo: { name: 'domains-domains-public-catalog' } },
    });
    const tools = await send('tools/list', {});
    expect(await tools.json()).toMatchObject({
      result: { tools: [{ name: 'domain_search' }, { name: 'domain_price' }] },
    });
    const result = await send('tools/call', {
      name: 'domain_price',
      arguments: { domain: 'working.io' },
    });
    const payload = await result.json();
    expect(JSON.parse(payload.result.content[0].text)).toMatchObject({
      askingPrice: override,
    });

    const tenant = await mf.getWorker('tenant2');
    expect(
      (
        await tenant.fetch(
          origin + '/platform-internal/agent-listing?domain=working.io',
        )
      ).status,
    ).toBe(403);
    delete env.AGENT_CATALOG_ENABLED;
    expect((await send('tools/list', {})).status).toBe(404);
  });

  it('keeps the verified buyer thread through the packaged tenant after withdrawal', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    const listing = await publish(2, 'working.io', offerDraft);
    await refreshAgentCatalog(env);
    const publicTerms = await (await fetchGateway(listingPath)).json();
    const snapshot = (await readPublicSale(dbs[2], 'working.io'))!;
    expect(publicTerms.revision).toBe(snapshot.revision);
    const seller = await SalesStore.from({
      DB: dbs[2],
      DOMBOT_SECRET: btoa('x'.repeat(32)),
    });
    const inbox = new SalesInquiryStore(seller, origin + '/w/' + ids[2]);
    const offer = {
      observedRevision: snapshot.revision,
      idempotencyKey: crypto.randomUUID(),
      name: 'Synthetic buyer',
      email: 'buyer@example.com',
      message: 'Offer for the catalog fixture.',
      offer: { amount: '950', currency: 'USD' },
      website: '',
      turnstileToken: 'fixture',
    };
    const receipt = await inbox.intake(offer, snapshot);
    expect(await inbox.intake(offer, snapshot)).toEqual(receipt);
    const [mail] = await inbox.lease();
    const verification = new URL(mail.mail.url);
    const confirmed = await fetchGateway(verification.pathname + '/confirm', {
      method: 'POST',
      headers: { Origin: origin },
    });
    expect(confirmed.status).toBe(303);
    const threadPath = confirmed.headers.get('Location')!;
    expect(threadPath).toMatch(new RegExp('^/w/' + ids[2] + '/t/'));
    expect(await (await fetchGateway(threadPath)).text()).toContain(
      'Awaiting seller review',
    );
    expect(
      (await fetchGateway(threadPath.replace(ids[2], ids[1]))).status,
    ).toBe(403);

    await inbox.message(receipt.id, {
      direction: 'reply',
      revision: (await inbox.lead(receipt.id)).revision,
      body: 'Thanks. Could you share your timeline?',
      idempotencyKey: crypto.randomUUID(),
    });
    await seller.unpublish(listing, (await seller.get(listing)).revision);
    expect((await fetchGateway(listingPath)).status).toBe(404);
    const search = await (
      await fetchGateway('/api/agent/listings?q=payments')
    ).json();
    expect(search.listings).toEqual([]);
    const thread = await fetchGateway(threadPath);
    expect(thread.status).toBe(200);
    const html = await thread.text();
    expect(html).toContain('Seller replied');
    expect(html).toContain('Thanks. Could you share your timeline?');
  });

  it('serves updated prices after explicit review and uses an opaque filter-bound cursor', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    const id = await publish(2, 'working.io', offerDraft);
    await publish(2, 'sorted-first.example.com', offerDraft);
    const first = await (
      await fetchGateway('/api/agent/listings?limit=1')
    ).json();
    expect(
      first.listings.map((item: { domain: string }) => item.domain),
    ).toEqual(['sorted-first.example.com']);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.nextCursor).not.toContain('sorted-first.example.com');
    expect(
      (
        await fetchGateway(
          '/api/agent/listings?limit=1&q=unrelated&cursor=' + first.nextCursor,
        )
      ).status,
    ).toBe(400);
    const second = await (
      await fetchGateway(
        '/api/agent/listings?limit=1&cursor=' + first.nextCursor,
      )
    ).json();
    expect(
      second.listings.map((item: { domain: string }) => item.domain),
    ).toEqual(['working.io']);

    const store = await SalesStore.from({
      DB: dbs[2],
      DOMBOT_SECRET: btoa('x'.repeat(32)),
    });
    const saved = await store.get(id);
    const askingPrice = { amount: '1600.55', currency: 'USD' };
    const revision = await store.save(
      {
        ...saved.draft,
        priceSource: {
          kind: 'override',
          price: askingPrice,
          reason: 'Updated asking price',
        },
      },
      saved.revision,
    );
    expect(await (await fetchGateway(listingPath)).json()).toMatchObject({
      askingPrice: override,
    });
    const review = await store.prepare([{ id, revision }], observation);
    await new PublicDomainDirectory(control).reserve(ids[2], {
      domain: 'working.io',
      listing: id,
      revision: review.items[0].after.revision,
    });
    expect((await fetchGateway(listingPath)).status).toBe(404);
    await store.publish(review.id, observation);
    expect(await (await fetchGateway(listingPath)).json()).toMatchObject({
      askingPrice,
    });
  });

  it('requires the current reviewed revision and forwards structured offers through existing Sales intake', async () => {
    env.AGENT_CATALOG_ENABLED = 'true';
    const listingId = await publish(2, 'working.io', offerDraft);
    const { revision } = await (await fetchGateway(listingPath)).json();
    const id = crypto.randomUUID();
    const data = {
      intent: 'offer',
      observedRevision: revision,
      idempotencyKey: crypto.randomUUID(),
      name: 'Fixture buyer',
      email: 'buyer@example.com',
      turnstileToken: 'fixture-token',
      offer: override,
    };
    const post = (body: object, caller = origin) =>
      fetchGateway(listingPath + '/inquiries', {
        method: 'POST',
        headers: {
          Origin: caller,
          'Content-Type': 'application/json',
          'cf-connecting-ip': '203.0.113.1',
        },
        body: JSON.stringify(body),
      });
    const dispatch = vi.fn(async (request: Request) => {
      const input = await request.json();
      expect(input).toMatchObject({
        offer: override,
        turnstileToken: 'fixture-token',
        observedRevision: revision,
      });
      return Response.json(
        { id, status: 'verification-pending' },
        { status: 202 },
      );
    });
    syntheticIntake = dispatch;
    expect((await post(data, 'https://other.example.com')).status).toBe(403);
    expect(
      (await post({ ...data, observedRevision: crypto.randomUUID() })).status,
    ).toBe(409);
    expect(dispatch).not.toHaveBeenCalled();
    expect((await post(data)).status).toBe(202);
    expect((await post(data)).status).toBe(202);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const counted = await control
      .prepare(
        "SELECT count(*) AS hits FROM agent_catalog_events WHERE event='offer' AND receipt=?",
      )
      .bind(id)
      .first<{ hits: number }>();
    expect(counted?.hits).toBe(1);
    await dbs[2]
      .prepare(
        `
      INSERT INTO sales_leads(id,listing_id,request_hash,payload_hash,email_hash,revision,verification,created_at,updated_at,sealed)
      VALUES(?,?,'request','payload','email',?,'verified',0,0,'fixture')
    `,
      )
      .bind(id, listingId, revision)
      .run();
    const evidence = crypto.randomUUID();
    await dbs[2].batch([
      dbs[2]
        .prepare(
          "INSERT INTO sales_events(id,listing_id,lead_id,kind,created_at,sealed) VALUES(?,?,?,'outcome',?,'fixture')",
        )
        .bind(evidence, listingId, id, Date.now()),
      dbs[2]
        .prepare(
          "INSERT INTO sales_journey_receipts(event,receipt) VALUES('sale-evidence-linked',?)",
        )
        .bind(evidence),
    ]);

    const user = crypto.randomUUID();
    const token = 'a'.repeat(64);
    await control.batch([
      control
        .prepare(
          "INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,'fixture',?)",
        )
        .bind(user, 'owner@example.com', ids[2], Date.now()),
      control
        .prepare(
          'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
        )
        .bind(await tokenHash(token), user, Date.now() + 3600_000),
    ]);
    const ownerPage = () =>
      fetchGateway('/account/agent-listings', {
        headers: { Cookie: '__Host-dd_session=' + token },
      });
    const dashboard = await ownerPage();
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain('1 email-verified offers');
    await dbs[2]
      .prepare("UPDATE sale_drafts SET availability='sold' WHERE id=?")
      .bind(listingId)
      .run();
    expect((await fetchGateway(listingPath)).status).toBe(404);
    expect(await (await ownerPage()).text()).toContain(
      '<strong>1</strong><span>Linked sale evidence</span>',
    );
  });
});
