import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import {
  claimAddress,
  addressState,
  publicAddressRequest,
  publicHandleSchema,
} from './portfolio-addresses';
import { publicSite } from './public-site';
import { emptyOwnerSite, selectedSite } from '../shared/owner-site';
import {
  PROOF_HEADER,
  signGatewayRequest,
  verifyGatewayRequest,
} from '../shared/gateway-proof';
import { build } from 'esbuild';
let tenant: Fetcher;

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const key = 'test-only-addresses-gateway-key-'.repeat(3);
let mf: Miniflare;
let control: D1Database;
let db: D1Database;
let env: HostedEnv;
const forwarded = vi.fn();
const snapshot = () => {
  const draft = emptyOwnerSite();
  draft.handle = 'old-tenant-handle';
  draft.profile.name = 'Explicitly public identity';
  draft.collections = [];
  return { ...selectedSite(draft), publishedAt: Date.now() };
};
async function publish() {
  await db
    .prepare(
      "INSERT OR REPLACE INTO published_portfolios(id,handle,revision,payload) VALUES('main',?,?,?)",
    )
    .bind('old-tenant-handle', crypto.randomUUID(), JSON.stringify(snapshot()))
    .run();
}
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
          name: 'storage',
          modules: true,
          script: 'export default { fetch() { return new Response("ok") } }',
          d1Databases: { CONTROL_DB: 'control' },
        },
        {
          name: 'tenant',
          modules: true,
          script,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'tenant' },
          bindings: {
            DOMBOT_AUTH: 'gateway',
            DOMBOT_WORKSPACE_ID: ids[0],
            DOMBOT_GATEWAY_SECRET: key,
          },
        },
      ],
    }),
  );
  tenant = await mf.getWorker('tenant');
  control = (await mf.getD1Database(
    'CONTROL_DB',
    'storage',
  )) as unknown as D1Database;
  db = (await mf.getD1Database('DB', 'tenant')) as unknown as D1Database;
  for (const file of [
    'hosted/migrations/0001_control.sql',
    'hosted/migrations/0003_lifecycle.sql',
    'hosted/migrations/0015_portfolio_addresses.sql',
  ])
    await control.exec(
      readFileSync(file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  await db.exec(
    readFileSync('migrations/0002_publication.sql', 'utf8')
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' '),
  );
  for (const id of ids)
    await control
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(id, 'Test account')
      .run();
});
afterAll(async () => {
  await mf.dispose();
});
beforeEach(async () => {
  await control.exec(
    'DELETE FROM portfolio_addresses; DELETE FROM closure_requests; UPDATE workspaces SET enabled=1;',
  );
  await db.exec('DELETE FROM published_portfolios;');
  forwarded.mockReset().mockImplementation(async (request: Request) => {
    const proof = await verifyGatewayRequest(key, ids[0], request);
    expect(proof?.owner).toBeNull();
    expect(request.headers.get('cookie')).toBeNull();
    expect(request.headers.get('authorization')).toBeNull();
    return publicSite(request, db);
  });
  env = {
    PUBLIC_SITE_ADDRESSES_ENABLED: 'true',
    PUBLIC_SITE_SUBDOMAINS_ENABLED: 'true',
    CANONICAL_ORIGIN: 'https://domains.domains',
    CONTROL_DB: control,
    WORKSPACES: JSON.stringify(
      ids.map((id, i) => ({ id, binding: `WORKSPACE_${i}`, label: 'Test' })),
    ),
    GATEWAY_KEYS: JSON.stringify(
      Object.fromEntries(ids.map((id) => [id, key])),
    ),
    AUTH_PEPPER: 'test-only-pepper'.repeat(3),
    WORKSPACE_0: { fetch: forwarded },
    WORKSPACE_1: { fetch: forwarded },
  } as unknown as HostedEnv;
});
const request = (path: string, options?: RequestInit) =>
  new Request(`https://domains.domains${path}`, options);

describe('public portfolio addresses', () => {
  it('reserves every literal top-level gateway route that can be a handle', () => {
    const source = readFileSync('src/hosted/gateway.ts', 'utf8');
    const roots = [
      ...source.matchAll(/app\.(?:get|post|put|delete|all)\('\/([a-z0-9-]+)'/g),
    ].map((match) => match[1]);
    expect(roots).toContain('domains');
    for (const root of roots)
      expect(publicHandleSchema.safeParse(root).success, root).toBe(false);
  });

  it('reserves a friendly handle without publishing any content', async () => {
    const result = await claimAddress(env, ids[0], { handle: 'my-brand' });
    expect(result.address?.url).toBe('https://domains.domains/my-brand');
    expect(
      (await publicAddressRequest(request('/my-brand'), env))?.status,
    ).toBe(404);
    expect(
      await db.prepare('SELECT 1 FROM published_portfolios').first(),
    ).toBeNull();
  });
  it('arbitrates concurrent claims and prevents handle reassignment', async () => {
    const results = await Promise.allSettled(
      ids.map((id) => claimAddress(env, id, { handle: 'alice' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const owner = (await control
      .prepare('SELECT workspace_id FROM portfolio_addresses WHERE handle=?')
      .bind('alice')
      .first<{ workspace_id: string }>())!.workspace_id;
    await expect(
      claimAddress(env, owner, { handle: 'new-name' }),
    ).rejects.toThrow('already saved');
    await expect(
      claimAddress(env, owner, { handle: 'alice' }),
    ).resolves.toMatchObject({ address: { handle: 'alice' } });
  });
  it.each([
    'about',
    'about-us',
    'support',
    'pricing',
    'security',
    'official',
    'site-address',
    'admin',
    'app',
    'login',
    'domains',
    'w',
    'source',
    'mail',
    'a--b',
    '-name',
    'Name',
    'with.dot',
    '../admin',
  ])('rejects a reserved or invalid address %s', (handle) => {
    expect(publicHandleSchema.safeParse(handle).success).toBe(false);
  });
  it('serves only the published row using the short canonical URL, without owner credentials', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    await publish();
    const result = (await publicAddressRequest(
      request('/alice', {
        headers: {
          Cookie: 'private-cookie',
          Authorization: 'Bearer private',
          'x-dombot-gateway-proof': 'forged',
        },
      }),
      env,
    ))!;
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('text/html');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    const html = await result.text();
    expect(html).toContain('Explicitly public identity');
    expect(html).toContain('https://domains.domains/alice');
    expect(html).not.toContain(ids[0]);
    expect(html).not.toContain('__public_path');
    expect(forwarded).toHaveBeenCalledOnce();
  });
  it('keeps one account separate from another public identity', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    await claimAddress(env, ids[1], { handle: 'bob' });
    const other = vi.fn(async (req: Request) => {
      expect((await verifyGatewayRequest(key, ids[1], req))?.owner).toBeNull();
      return new Response('Other published identity');
    });
    const isolated = { ...env, WORKSPACE_1: { fetch: other } } as HostedEnv;
    expect(
      await (await publicAddressRequest(request('/bob'), isolated))!.text(),
    ).toBe('Other published identity');
    expect(forwarded).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledOnce();
  });
  it('does not forward POSTs, private paths or hidden collections', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    await publish();
    expect(
      (await publicAddressRequest(
        request('/alice', { method: 'POST', body: 'private' }),
        env,
      ))!.status,
    ).toBe(405);
    expect(
      await publicAddressRequest(request('/alice/api/exportData'), env),
    ).toBeNull();
    expect(
      (await publicAddressRequest(request('/alice/c/hidden'), env))!.status,
    ).toBe(404);
    expect(forwarded).toHaveBeenCalledOnce();
  });
  it('keeps closed accounts unavailable even while their runtime is enabled', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    await publish();
    await control
      .prepare(
        'INSERT OR IGNORE INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
      )
      .bind('owner', 'owner@example.test', ids[0], 'not-a-login', Date.now())
      .run();
    await control
      .prepare(
        'INSERT INTO closure_requests(workspace_id,user_id,requested_at,purge_after) VALUES(?,?,?,?)',
      )
      .bind(ids[0], 'owner', Date.now(), Date.now() + 1000)
      .run();
    expect((await publicAddressRequest(request('/alice'), env))!.status).toBe(
      404,
    );
    expect(forwarded).not.toHaveBeenCalled();
  });
  it('returns HEAD without a body and never exposes a draft after unpublish', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    await publish();
    expect(
      await (await publicAddressRequest(
        request('/alice', { method: 'HEAD' }),
        env,
      ))!.text(),
    ).toBe('');
    await db.exec('DELETE FROM published_portfolios;');
    expect((await publicAddressRequest(request('/alice'), env))!.status).toBe(
      404,
    );
  });
  it('denies disabled and closed accounts while retaining their public identity', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    await publish();
    await control
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(ids[0])
      .run();
    expect((await publicAddressRequest(request('/alice'), env))!.status).toBe(
      404,
    );
    await expect(
      claimAddress(env, ids[1], { handle: 'alice' }),
    ).rejects.toThrow('taken');
    expect(forwarded).not.toHaveBeenCalled();
  });
  it('uses the same handle as a subdomain alias without exposing account routes', async () => {
    await claimAddress(env, ids[0], { handle: 'alice' });
    const result = (await publicAddressRequest(
      new Request('https://alice.domains.domains/c/selected?q=x'),
      env,
    ))!;
    expect(result.status).toBe(308);
    expect(result.headers.get('location')).toBe(
      'https://domains.domains/alice/c/selected?q=x',
    );
    expect(
      (await publicAddressRequest(
        new Request('https://alice.domains.domains/account'),
        env,
      ))!.status,
    ).toBe(404);
    expect(forwarded).not.toHaveBeenCalled();
  });
  it('leaves existing application and long public routes alone', async () => {
    for (const path of [
      '/app',
      '/login',
      '/source',
      `/w/${ids[0]}/p/old-tenant-handle`,
    ])
      expect(await publicAddressRequest(request(path), env)).toBeNull();
    expect(
      await addressState(
        { ...env, PUBLIC_SITE_ADDRESSES_ENABLED: 'false' },
        ids[0],
      ),
    ).toEqual({ enabled: false, address: null });
  });
  it('rejects direct and owner attempts to use the internal public reader', async () => {
    await publish();
    const target = new Request(
      'https://domains.domains/platform-internal/public-site?__public_path=/alice',
    );

    expect((await tenant.fetch(target)).status).toBe(403);
    for (const owner of ['someone', null]) {
      const signed = new Request(target);
      signed.headers.set(
        PROOF_HEADER,
        await signGatewayRequest(key, ids[0], owner, signed),
      );
      expect((await tenant.fetch(signed)).status).toBe(
        owner === null ? 200 : 403,
      );
    }
  });
});
