import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { createAccount } from '../core/services/accounts';
import { DynadotDnsSetup } from './dynadot-dns-setup';
import { SalesStore } from './sales-store';
import { exportLanderRecovery, landerRecoverySchema } from './lander-backup';
import { dynadotDnsSetupScope } from '../shared/dynadot-dns-setup';
let runtime: Miniflare,
  db: D1Database,
  env: Env,
  mode: string,
  ns: string[],
  records: { record_type: string; record_value1: string; sub_host?: string }[],
  writes: number,
  uncertain: boolean,
  applyAfterTimeout: boolean,
  ds: unknown[],
  forwarding: boolean;
let publicDs = false,
  publicStatus = 0,
  omitAssigned = false,
  publicNs: string[] = [];
const workspace = '11111111-1111-4111-8111-111111111111',
  requestId = '22222222-2222-4222-8222-222222222222',
  domain = 'fixture.example';
const park = ['a.dns.park.io', 'b.dns.park.io'];
const assigned = ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'];
const install = () => {
  mode = 'DNS';
  ns = [...assigned];
  records = [
    { record_type: 'aname', record_value1: 'park.io' },
    { record_type: 'cname', record_value1: 'park.io', sub_host: 'www' },
  ];
};
const fetcher: typeof fetch = async (input, init) => {
  const r = new Request(input, init),
    u = new URL(r.url);
  if (u.hostname === 'cloudflare-dns.com')
    return Response.json({
      Status: publicStatus,
      Answer:
        u.searchParams.get('type') === 'DS'
          ? publicDs
            ? [{ type: 43, data: 'existing DS' }]
            : []
          : publicNs.map((data) => ({ type: 2, data })),
    });
  expect(u.hostname).toBe('api.dynadot.com');
  expect(u.pathname.startsWith('/restful/v2/domains/' + domain)).toBe(true);
  const ok = (data: unknown) => Response.json({ code: 200, data });
  if (u.pathname.endsWith('/nameservers'))
    return ok({
      nameserver_list:
        mode === 'DNS' && omitAssigned
          ? []
          : ns.map((server_name) => ({ server_name })),
    });
  if (u.pathname.endsWith('/dnssec')) return ok({ dnssec_info_list: ds });
  if (r.method === 'GET')
    return ok({
      glue_info: {
        glue_type: mode,
        nameserver_list: ns.map((server_name) => ({ server_name })),
        ttl: '300',
        dns_main_list: records.filter((x) => !x.sub_host),
        dns_sub_list: records.filter((x) => x.sub_host),
        email_forward_type: forwarding ? 'MTYPE_FORWARD' : 'MTYPE_NONE',
        extraProviderMetadata: { retained: true },
      },
    });
  writes++;
  expect(r.method).toBe('POST');
  expect(u.pathname.endsWith('/records')).toBe(true);
  const b = (await r.json()) as Record<string, unknown>;
  expect(b).toEqual({
    dns_main_list: [{ record_type: 'aname', record_value1: 'park.io' }],
    dns_sub_list: [
      { sub_host: 'www', record_type: 'cname', record_value1: 'park.io' },
    ],
    ttl: 300,
    add_dns_to_current_setting: true,
  });
  if (!uncertain || applyAfterTimeout) install();
  if (uncertain) throw Error('submission timeout');
  return ok({});
};
beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'dns-setup',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-01',
          d1Databases: { DB: 'local-dns-setup' },
        },
      ],
    }),
  );
  db = await runtime.getD1Database('DB');
  await db.exec(
    readFileSync('migrations/0012_lander_connections.sql', 'utf8')
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' '),
  );
}, 30000);
afterAll(async () => runtime?.dispose());
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  await createAccount(
    'dynadot',
    'Saved account',
    { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
    undefined,
    'dynadot',
  );
  await db.batch([
    db.prepare('DELETE FROM lander_domain_locks'),
    db.prepare('DELETE FROM lander_recovery_archive'),
  ]);
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 2000));
  env = {
    DB: db,
    DOMBOT_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(8))),
    DOMBOT_WORKSPACE_ID: workspace,
    DYNDNS_SETUP_FIXTURE: JSON.stringify({
      workspace,
      requestId,
      domain,
      accountId: 'dynadot',
      expiresAt: now + 3600000,
    }),
  } as Env;
  mode = 'NAME_SERVERS';
  ns = [...park];
  records = [];
  writes = 0;
  uncertain = false;
  applyAfterTimeout = false;
  ds = [];
  forwarding = false;
  publicDs = false;
  publicStatus = 0;
  omitAssigned = false;
  publicNs = [...assigned];
});
afterEach(() => vi.restoreAllMocks());
it('uses the stored API connection once, retains encrypted rollback configuration and returns assigned DNS servers', async () => {
  const result = await new DynadotDnsSetup(env, fetcher).initialize(
    requestId,
    true,
  );
  expect(result).toMatchObject({
    state: 'configured',
    domain,
    nameservers: assigned,
  });
  expect(writes).toBe(1);
  const store = await SalesStore.from(env),
    recovery = await exportLanderRecovery(store);
  expect(recovery).toHaveLength(1);
  expect(recovery[0].payload.snapshot).toMatchObject({
    nameservers: park,
    settings: {
      kind: 'dynadot-dns-initialization',
      phase: 'verified',
      registrarConfiguration: {
        glue_type: 'NAME_SERVERS',
        extraProviderMetadata: { retained: true },
      },
    },
  });
  expect(JSON.stringify(recovery)).not.toMatch(/fixture-key|fixture-secret/);
  expect(
    await db.prepare('SELECT count(*) n FROM lander_domain_locks').first(),
  ).toEqual({ n: 0 });
  await new DynadotDnsSetup(env, fetcher).initialize(requestId, true);
  expect(writes).toBe(1);
});
it.each([
  'disabled',
  'other-workspace',
  'expired',
  'other-request',
  'no-unused-declaration',
  'other-delegation',
  'dnssec',
  'forwarding',
  'existing-records',
  'public-dnssec',
  'public-dns-error',
] as const)('holds %s before a registrar mutation', async (test) => {
  let id = requestId,
    unused = true;
  if (test === 'disabled') env.DYNDNS_SETUP_FIXTURE = undefined;
  if (test === 'other-workspace')
    env.DOMBOT_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
  if (test === 'expired') {
    const s = JSON.parse(env.DYNDNS_SETUP_FIXTURE!);
    s.expiresAt = 1;
    env.DYNDNS_SETUP_FIXTURE = JSON.stringify(s);
  }
  if (test === 'other-request') id = '33333333-3333-4333-8333-333333333333';
  if (test === 'no-unused-declaration') unused = false;
  if (test === 'other-delegation') ns = ['other.example'];
  if (test === 'dnssec') ds = [{ digest: 'existing' }];
  if (test === 'forwarding') forwarding = true;
  if (test === 'public-dnssec') publicDs = true;
  if (test === 'public-dns-error') publicStatus = 2;
  if (test === 'existing-records')
    records = [{ record_type: 'txt', record_value1: 'keep' }];
  await expect(
    new DynadotDnsSetup(env, fetcher).initialize(id, unused),
  ).rejects.toThrow();
  expect(writes).toBe(0);
});
it('reconciles an observable timeout without submitting another provider request', async () => {
  uncertain = true;
  applyAfterTimeout = true;
  expect(
    await new DynadotDnsSetup(env, fetcher).initialize(requestId, true),
  ).toMatchObject({ state: 'configured' });
  expect(writes).toBe(1);
  await new DynadotDnsSetup(env, fetcher).initialize(requestId, true);
  expect(writes).toBe(1);
});
it('retains an unobservable intent and its domain lock, then reconciles a late outcome without replay', async () => {
  uncertain = true;
  const service = new DynadotDnsSetup(env, fetcher);
  expect(await service.initialize(requestId, true)).toMatchObject({
    state: 'held',
  });
  expect(await service.initialize(requestId, true)).toMatchObject({
    state: 'held',
  });
  expect(writes).toBe(1);
  expect(
    await db.prepare('SELECT count(*) n FROM lander_domain_locks').first(),
  ).toEqual({ n: 1 });
  install();
  expect(await service.initialize(requestId, true)).toMatchObject({
    state: 'configured',
  });
  expect(writes).toBe(1);
});
it('does not remove a different operation lock or submit through it', async () => {
  const store = await SalesStore.from(env);
  await db
    .prepare('INSERT INTO lander_domain_locks VALUES(?,?,0,?)')
    .bind(await store.hash('domain', domain), 'other', 'other')
    .run();
  await expect(
    new DynadotDnsSetup(env, fetcher).initialize(requestId, true),
  ).rejects.toThrow(/existing/);
  expect(writes).toBe(0);
  expect(
    await db.prepare('SELECT job_id FROM lander_domain_locks').first(),
  ).toEqual({ job_id: 'other' });
});
it('an imported recovery receipt can only be reconciled and never restores submission authority', async () => {
  const store = await SalesStore.from(env);
  const snapshot = {
    provider: 'dynadot',
    accountId: 'dynadot',
    providerAccountId: '0'.repeat(64),
    zoneId: '0'.repeat(32),
    domain,
    observedAt: Date.now(),
    nameservers: park,
    records: [],
    dnssec: {},
    settings: { kind: 'dynadot-dns-initialization', phase: 'intent' },
  };
  const payload = landerRecoverySchema.shape.payload.parse({
    domain,
    snapshot,
  });
  await db
    .prepare('INSERT INTO lander_recovery_archive VALUES(?,?,?)')
    .bind('dns-setup:' + requestId, await store.seal(payload), Date.now())
    .run();
  expect(
    await new DynadotDnsSetup(env, fetcher).initialize(requestId, true),
  ).toMatchObject({ state: 'held' });
  expect(writes).toBe(0);
});
it('scope configuration is closed for malformed data and mismatched identities', () => {
  expect(dynadotDnsSetupScope('{', workspace)).toBeNull();
  expect(dynadotDnsSetupScope(undefined, workspace)).toBeNull();
  expect(dynadotDnsSetupScope(env.DYNDNS_SETUP_FIXTURE, 'other')).toBeNull();
});
it('can confirm provider-selected DNS through public delegation when defaults are omitted by the API', async () => {
  omitAssigned = true;
  publicNs = [...park];
  const service = new DynadotDnsSetup(env, fetcher);
  expect(await service.initialize(requestId, true)).toMatchObject({
    state: 'held',
  });
  expect(writes).toBe(1);
  publicNs = [...assigned];
  expect(await service.initialize(requestId, true)).toMatchObject({
    state: 'configured',
    nameservers: assigned,
  });
  expect(writes).toBe(1);
});
it('requires the gateway and portfolio to agree on the exact scoped request', async () => {
  const expected = JSON.parse(env.DYNDNS_SETUP_FIXTURE!);
  expected.accountId = 'foreign';
  await expect(
    new DynadotDnsSetup(env, fetcher).initialize(requestId, true, expected),
  ).rejects.toThrow(/scopes differ/);
  expect(writes).toBe(0);
});
