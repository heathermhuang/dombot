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
import { SalesStore } from '../worker/sales-store';
import { emptySale } from '../shared/hosted-sales';
import { sealPlatformKey } from './platform-keys';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const keys = ids.map((id) => `synthetic-public-domain-key-${id}`);
const origin = 'https://localhost';
let mf: Miniflare;
let control: D1Database;
let dbs: D1Database[];
let env: HostedEnv;
const calls = vi.fn();
let broken = -1;
const observation = () => ({
  available: true,
  reason: null,
  price: null,
  ownershipFingerprint: 'synthetic-control',
  controlExpiresAt: Date.now() + 86400000,
});
async function publish(index = 0, domain = 'working.io') {
  const store = await SalesStore.from({
    DB: dbs[index],
    DOMBOT_SECRET: btoa('x'.repeat(32)),
  });
  const draft = { ...emptySale(domain, 'synthetic'), priceSource: null };
  const revision = await store.save(draft, null);
  const review = await store.prepare([{ id: draft.id, revision }], observation);
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
            // Public reads must work without a root secret or any registrar credentials.
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
            calls(i, req);
            if (broken === i)
              return new Response('Synthetic reader failure', { status: 503 });
            const proof = await verifyGatewayRequest(keys[i], ids[i], req);
            expect(proof?.owner).toBeNull();
            expect(req.headers.get('cookie')).toBeNull();
            expect(req.headers.get('authorization')).toBeNull();
            if (
              new URL(req.url).pathname === '/platform-internal/public-domain'
            )
              expect(proof?.sales).toBeUndefined();
            else expect(proof?.sales?.purpose).toBe('sales-public');
            return service.fetch(req);
          },
        },
      ]),
    ),
  } as HostedEnv;
}, 30000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  broken = -1;
  delete env.PLATFORM_ENABLED;
  delete env.DISPATCHER;
  calls.mockClear();
  await control.exec(
    'DELETE FROM sales_domain_controls; DELETE FROM closure_requests; DELETE FROM users; DELETE FROM platform_workspaces; DELETE FROM rate_limits; DELETE FROM workspaces;',
  );
  for (const id of ids)
    await control
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(id, 'Synthetic')
      .run();
  for (const db of dbs)
    await db.exec(
      'DELETE FROM sales_reviews; DELETE FROM published_sales; DELETE FROM sale_drafts;',
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
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(calls).toHaveBeenCalledTimes(3);
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
  it('fails closed on duplicate eligible publications and unavailable readers', async () => {
    await publish(0);
    await publish(1);
    const conflict = await route();
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain(ids[0]);
    expect((await route(`/w/${ids[0]}/d/working.io`)).status).toBe(409);
    await dbs[1].exec('DELETE FROM published_sales');
    broken = 1;
    expect((await route()).status).toBe(503);
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
  it('includes qualified platform accounts and rejects fleet sizes above the bounded reader limit', async () => {
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
      for (let i = 0; i < 63; i++) {
        const id = crypto.randomUUID();
        await control
          .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
          .bind(id, 'Synthetic capacity')
          .run();
        await insert(id, `synthetic-db-${i}`);
      }
      calls.mockClear();
      expect((await route()).status).toBe(503);
      expect(calls).not.toHaveBeenCalled();
    } finally {
      env.WORKSPACES = staticWorkspaces;
    }
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
