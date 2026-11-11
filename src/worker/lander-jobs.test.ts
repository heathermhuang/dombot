import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { createAccount } from '../core/services/accounts';
import { LanderCloudflare } from '../core/services/lander-cloudflare';
import { LanderDynadot } from '../core/services/lander-dynadot';
import { SalesStore } from './sales-store';
import { LanderJobs } from './lander-jobs';
import { emptySale } from '../shared/hosted-sales';
import type {
  NativeDnsRecord,
  LanderHostingPlan,
} from '../shared/lander-connection';
import { exportSales, restoreSales } from './sales-backup';
import { signGatewayRequest } from '../shared/gateway-proof';
import { Hono } from 'hono';
import { createLanderRoutes } from './lander-routes';
import { landerRequest } from '../hosted/lander-connections';

let mf: Miniflare, db: D1Database, store: SalesStore, jobs: LanderJobs;
const account = 'a'.repeat(32),
  zone = 'b'.repeat(32),
  domain = 'fixture.example';
let records: NativeDnsRecord[],
  writes: number,
  fail: 'none' | 'before' | 'after',
  nameservers: string[],
  wrongAccount: boolean,
  malformed: boolean,
  proxy: boolean;
const observation = () => ({
  price: null,
  available: true,
  reason: null,
  ownershipFingerprint: 'exact-owner',
  controlExpiresAt: Date.now() + 86400000,
});
const hosts = (name = domain): LanderHostingPlan[] =>
  [name, `www.${name}`].map((hostname) => ({
    hostname,
    epoch: 1,
    challenge: 'c'.repeat(32),
    records: [
      {
        type: 'TXT',
        name: `_domains-sales.${hostname}`,
        value: 'domains-sales=' + 'c'.repeat(32),
      },
    ],
    target: 'fallback.example',
  }));
const fetcher: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init),
    url = new URL(request.url),
    path = url.pathname;
  if (url.hostname === 'cloudflare-dns.com')
    return Response.json({
      Status: 0,
      Answer: nameservers.map((data) => ({ type: 2, data })),
    });
  const result = (value: unknown, info?: unknown) =>
    Response.json({
      success: true,
      result: value,
      ...(info ? { result_info: info } : {}),
    });
  if (path === '/client/v4/zones')
    return result(
      [
        {
          id: zone,
          name: domain,
          status: 'active',
          type: 'full',
          account: { id: wrongAccount ? 'e'.repeat(32) : account },
          name_servers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'],
        },
      ],
      { page: 1, per_page: 50, total_pages: 1, total_count: 1 },
    );
  if (path === `/client/v4/zones/${zone}`)
    return result({
      id: zone,
      name: domain,
      status: 'active',
      type: 'full',
      account: { id: wrongAccount ? 'e'.repeat(32) : account },
      name_servers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'],
    });
  if (path.endsWith('/dns_records') && request.method === 'GET') {
    expect(url.searchParams.get('order')).toBe('name');
    if (malformed) return new Response('broken');
    const page = Number(url.searchParams.get('page'));
    return result(records.slice((page - 1) * 100, page * 100), {
      page,
      per_page: 100,
      total_pages: Math.ceil(records.length / 100),
      total_count: records.length,
    });
  }
  if (path.includes('/dns_records') && request.method !== 'GET') {
    writes++;
    if (fail === 'before') {
      fail = 'none';
      throw Error('timeout');
    }
    const body =
      request.method === 'DELETE'
        ? null
        : ((await request.json()) as NativeDnsRecord);
    if (request.method === 'POST')
      records.push({ ...body!, id: crypto.randomUUID().replaceAll('-', '') });
    if (request.method === 'PATCH')
      records = records.map((r) =>
        r.id === path.split('/').at(-1) ? { ...r, ...body } : r,
      );
    if (request.method === 'DELETE')
      records = records.filter((r) => r.id !== path.split('/').at(-1));
    if (fail === 'after') {
      fail = 'none';
      throw Error('timeout after apply');
    }
    return result(body ?? {});
  }
  if (path.endsWith('/rulesets') || path.endsWith('/pagerules'))
    return result([]);
  if (path.endsWith('/dnssec')) return result({ status: 'active' });
  if (path.endsWith('/settings/cname_flattening'))
    return result({ value: proxy ? 'flatten_none' : 'flatten_at_root' });
  throw Error('Unexpected fixture call ' + path);
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'lander-jobs-test',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const f of readdirSync('migrations').sort())
    await db.exec(
      readFileSync('migrations/' + f, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  store = await SalesStore.from({
    DB: db,
    DOMBOT_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(8))),
  });
}, 30000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  vi.restoreAllMocks();
  configureStore(new MemoryDocStore());
  await hydrateStores();
  for (const table of [
    'lander_domain_locks',
    'lander_jobs',
    'lander_recovery_archive',
    'sales_events',
    'sales_reviews',
    'sales_shop',
    'sale_drafts',
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
  await createAccount(
    'cloudflare',
    'DNS only',
    { apiToken: 'fixture-secret', accountId: account },
    undefined,
    'cloudflare',
  );
  records = [
    {
      id: 'd'.repeat(32),
      type: 'A',
      name: domain,
      content: '192.0.2.1',
      ttl: 3600,
      proxied: false,
      comment: 'keep',
      tags: ['owner:test'],
      settings: { ipv4_only: false },
    },
  ];
  writes = 0;
  fail = 'none';
  nameservers = ['a.ns.cloudflare.com.', 'b.ns.cloudflare.com.'];
  wrongAccount = false;
  malformed = false;
  proxy = false;
  jobs = new LanderJobs(store, observation, fetcher);
});
async function prepared() {
  const id = crypto.randomUUID();
  await jobs.create({ kind: 'domains', domains: [domain] }, id, async () => [
    domain,
  ]);
  const work = (await jobs.work())!;
  await jobs.step(work, hosts());
  const review = await jobs.get(id);
  expect(review.state).toBe('awaiting-review');
  expect(review.counts).toEqual([{ state: 'ready', count: 1 }]);
  return { id, work, review };
}
async function tick(state = 'tls-ready') {
  await db.prepare('UPDATE lander_items SET due_at=0').run();
  const work = await jobs.work();
  if (work) await jobs.step(work, undefined, state);
  return work;
}
describe('native Cloudflare qualification', () => {
  it('enumerates multiple DNS pages with all metadata intact', async () => {
    records = Array.from({ length: 205 }, (_, i) => ({
      id: i.toString(16).padStart(32, '0'),
      type: 'TXT',
      name: `s${i}.${domain}`,
      content: 'proof ' + i,
      ttl: 3600,
      comment: 'private note',
      tags: ['owner:record'],
    }));
    const result = await new LanderCloudflare('cloudflare', fetcher).snapshot(
      domain,
    );
    expect(result.records).toEqual(records);
    expect(writes).toBe(0);
    records = [];
    expect(
      (await new LanderCloudflare('cloudflare', fetcher).snapshot(domain))
        .records,
    ).toEqual([]);
  });
  it.each(['empty', 'wrong-account', 'no-apex', 'malformed'] as const)(
    'fails closed for %s',
    async (mode) => {
      if (mode === 'empty') nameservers = [];
      if (mode === 'wrong-account') wrongAccount = true;
      if (mode === 'no-apex') proxy = true;
      if (mode === 'malformed') malformed = true;
      await expect(
        new LanderCloudflare('cloudflare', fetcher).snapshot(domain),
      ).rejects.toThrow();
      expect(writes).toBe(0);
    },
  );
});
describe('durable exact lander manifests and recovery', () => {
  it('matches Unicode search through the shared Worker-safe domain normalizer', async () => {
    await store.save(emptySale('xn--fiqs8s.example', 'none'), null);
    const view = await jobs.create(
      { kind: 'matching-listings', q: '中国', mode: '', state: 'All' },
      crypto.randomUUID(),
      async () => ['xn--fiqs8s.example'],
    );
    expect(view.total).toBe(1);
    expect(view.items[0].domain).toBe('xn--fiqs8s.example');
  });
  it('freezes 521 all-matching listings across server pages and internal inserts', async () => {
    for (let i = 0; i < 521; i++) {
      const d = emptySale(`selected-${i}.example`, 'none');
      d.priceSource = null;
      await store.save(d, null);
    }
    const id = crypto.randomUUID(),
      view = await jobs.create(
        { kind: 'matching-listings', q: '', mode: '', state: 'All' },
        id,
        async () => [],
      );
    expect(view.total).toBe(521);
    expect(view.items).toHaveLength(100);
    expect(view.cursor).toBe(99);
    await store.save(emptySale('later.example', 'none'), null);
    expect((await jobs.get(id)).total).toBe(521);
    expect((await jobs.get(id, 499)).items).toHaveLength(21);
  }, 30000);
  it('requires the exact combined digest, keeps neutral publication private before approval and survives controller recreation', async () => {
    const { id, work, review } = await prepared();
    expect((await store.get(work.listing)).published).toBeNull();
    expect(review.items[0].publication?.publicPrice).toBeNull();
    expect(writes).toBe(0);
    await expect(jobs.approve(id, '0'.repeat(64))).rejects.toThrow(/manifest/);
    await jobs.approve(id, review.digest!);
    jobs = new LanderJobs(store, observation, fetcher);
    await tick();
    expect((await store.get(work.listing)).published?.revision).toBe(
      review.items[0].publication?.revision,
    );
    expect(writes).toBe(1);
    for (let n = 0; n < 5; n++) await tick('live');
    expect((await jobs.get(id)).counts).toEqual([{ state: 'live', count: 1 }]);
    expect(records.find((r) => r.id === 'd'.repeat(32))).toMatchObject({
      type: 'CNAME',
      comment: 'keep',
      tags: ['owner:test'],
      ttl: 3600,
    });
    expect(records.filter((r) => r.type === 'CNAME')).toHaveLength(2);
  });
  it('reconciles a timeout after submission without duplicate writes', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    fail = 'after';
    await tick();
    expect(writes).toBe(1);
    await tick();
    expect(writes).toBe(1);
    expect((await jobs.get(id)).items[0].state).toBe('dns');
  });
  it('never blindly retries an unknown write that is not yet observable', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    fail = 'before';
    await tick();
    await tick();
    expect(writes).toBe(1);
    expect((await jobs.get(id)).items[0]).toMatchObject({ state: 'held' });
  });
  it('holds restore for an unobserved submission and reconciles a late write before cutback', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    fail = 'before';
    await tick();
    await tick();
    const row = await db
      .prepare('SELECT sealed FROM lander_items WHERE job_id=?')
      .bind(id)
      .first<{ sealed: string }>();
    const payload = JSON.parse(await store.cipher.open(row!.sealed));
    await jobs.restore(id);
    await tick('detached');
    expect((await jobs.get(id)).items[0]).toMatchObject({ state: 'held' });
    expect((await jobs.get(id)).items[0].reason).toContain('may arrive later');
    expect(writes).toBe(1);
    records.push({
      ...payload.plan.changes[payload.write.index].after,
      id: 'f'.repeat(32),
    });
    await jobs.restore(id);
    for (let i = 0; i < 6; i++) await tick('detached');
    expect((await jobs.get(id)).items[0].state).toBe('restored');
    expect(records.some((r) => r.id === 'f'.repeat(32))).toBe(false);
    expect(writes).toBe(2);
  });
  it('prepares HTTPS before changing root/www routing', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    await tick('waiting');
    await tick('waiting');
    await tick('waiting');
    expect(writes).toBe(2);
    expect(records.some((r) => r.type === 'CNAME')).toBe(false);
    expect((await jobs.get(id)).items[0].state).toBe('pending-tls');
  });
  it('rechecks newly introduced mail dependencies before the routing write', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    await tick();
    await tick();
    records.push({
      id: 'e'.repeat(32),
      name: domain,
      type: 'MX',
      content: domain,
      ttl: 300,
    });
    await tick();
    expect(writes).toBe(2);
    expect(records.find((r) => r.id === 'd'.repeat(32))?.type).toBe('A');
    expect((await jobs.get(id)).items[0].reason).toContain('Mail delivery');
  });
  it('cleans a failed preparation and releases its lock before a fresh connection', async () => {
    const id = crypto.randomUUID();
    await jobs.create({ kind: 'domains', domains: [domain] }, id, async () => [
      domain,
    ]);
    const work = (await jobs.work())!;
    records.push({
      id: 'e'.repeat(32),
      name: domain,
      type: 'MX',
      content: domain,
      ttl: 300,
    });
    await jobs.step(work, hosts());
    expect((await jobs.get(id)).items[0].state).toBe('held');
    expect(writes).toBe(0);
    await jobs.cancel(id);
    await jobs.restore(id);
    await tick('detached');
    expect((await jobs.get(id)).items[0].state).toBe('restored');
    expect(
      await db.prepare('SELECT count(*) AS n FROM lander_domain_locks').first(),
    ).toEqual({ n: 0 });
    records = records.filter((r) => r.type !== 'MX');
    const fresh = await prepared();
    expect(fresh.review.counts).toEqual([{ state: 'ready', count: 1 }]);
  });
  it('holds a publication race without DNS writes', async () => {
    const { id, review, work } = await prepared();
    const saved = await store.get(work.listing);
    await store.save(
      { ...saved.draft, description: 'new private terms' },
      saved.revision,
    );
    await jobs.approve(id, review.digest!);
    await tick();
    expect(writes).toBe(0);
    expect((await jobs.get(id)).items[0].state).toBe('held');
  });
  it('rejects a stale generation and an active second worker lease', async () => {
    const { id, review, work } = await prepared();
    await jobs.approve(id, review.digest!);
    await jobs.step(
      { ...work, generation: crypto.randomUUID() },
      undefined,
      'live',
    );
    expect(writes).toBe(0);
    await db
      .prepare('UPDATE lander_items SET lease=?,lease_until=? WHERE job_id=?')
      .bind(crypto.randomUUID(), Date.now() + 60000, id)
      .run();
    await jobs.step(work, undefined, 'live');
    expect(writes).toBe(0);
  });
  it('guards complete parent digest and duplicate request payloads', async () => {
    const { id, review } = await prepared();
    await expect(
      jobs.create(
        { kind: 'domains', domains: ['other.example'] },
        id,
        async () => ['other.example'],
      ),
    ).rejects.toThrow(/another selection/);
    await db
      .prepare('UPDATE lander_items SET digest=? WHERE job_id=?')
      .bind('0'.repeat(64), id)
      .run();
    await expect(jobs.approve(id, review.digest!)).rejects.toThrow(/manifest/);
    expect(writes).toBe(0);
  });
  it('restores exact changed web routing while preserving unrelated later edits', async () => {
    const { id, review } = await prepared(),
      original = structuredClone(records);
    await jobs.approve(id, review.digest!);
    for (let n = 0; n < 6; n++) await tick('live');
    records.push({
      id: 'e'.repeat(32),
      type: 'TXT',
      name: 'later.fixture.example',
      content: 'later-owner-edit',
      ttl: 1800,
    });
    await jobs.restore(id);
    for (let n = 0; n < 6; n++) await tick('detached');
    expect(records).toEqual([
      ...original,
      {
        id: 'e'.repeat(32),
        type: 'TXT',
        name: 'later.fixture.example',
        content: 'later-owner-edit',
        ttl: 1800,
      },
    ]);
    expect((await jobs.get(id)).items[0].state).toBe('restored');
  });
  it('preserves conflicting newer web records during restore', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    for (let n = 0; n < 6; n++) await tick('live');
    records.find((r) => r.name === domain)!.content = 'later.example';
    const before = writes;
    await jobs.restore(id);
    for (let n = 0; n < 6; n++) await tick();
    expect(records.find((r) => r.name === domain)?.content).toBe(
      'later.example',
    );
    expect((await jobs.get(id)).items[0].state).toBe('conflict');
    expect(writes).toBeLessThanOrEqual(before + 1);
  });
  it('cancels future work and imports DNS snapshots only as private recovery data', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    await tick();
    await jobs.cancel(id);
    await tick();
    expect(writes).toBe(1);
    const backup = await exportSales(store);
    expect(backup.version).toBe(6);
    expect(backup.dnsRecovery).toHaveLength(1);
    expect(JSON.stringify(backup)).not.toContain('fixture-secret');
    await restoreSales(store, { ...backup, version: 4, dnsRecovery: [] });
    expect(await jobs.work()).toBeNull();
    expect(
      await db
        .prepare('SELECT count(*) AS n FROM lander_recovery_archive')
        .first(),
    ).toEqual({ n: 1 });
    expect(
      (await store.get(review.items[0].publication!.id)).published,
    ).toBeNull();
    expect(writes).toBe(1);
  });
  it('round-trips Dynadot recovery without importing executable authority', async () => {
    await prepared();
    const backup = await exportSales(store);
    expect(backup.version).toBe(6);
    const snapshot = backup.dnsRecovery[0].payload.plan!.snapshot;
    snapshot.provider = 'dynadot';
    snapshot.nameservers = ['ns1.dynadot.com', 'ns2.dynadot.com'];
    snapshot.settings = {
      glue_type: 'DNS',
      ttl: 3600,
      dns_main_list: [{ record_type: 'a', record_value1: '192.0.2.1' }],
      dns_sub_list: [],
    };
    // Model a destination with no current recovery custody. When importing
    // onto the source, its existing snapshot deliberately wins ID conflicts.
    await db.batch([
      db.prepare('DELETE FROM lander_domain_locks'),
      db.prepare('DELETE FROM lander_jobs'),
    ]);
    await restoreSales(store, backup);
    const exported = await exportSales(store);
    expect(exported.dnsRecovery[0].payload.plan!.snapshot).toEqual(snapshot);
    expect(await jobs.work()).toBeNull();
    expect(writes).toBe(0);
  });
  it('stops unqualified provider work before hosting preparation while retaining recovery', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    const revoked = new LanderJobs(store, observation, fetcher, []);
    expect(await revoked.work()).toBeNull();
    expect((await revoked.get(id)).items[0].state).toBe('held');
    expect(writes).toBe(0);
    await revoked.restore(id);
    expect(await revoked.work()).not.toBeNull();
    expect(writes).toBe(0);
  });
  it('rechecks provider qualification when it changes between scheduling and execution', async () => {
    const { id, review } = await prepared();
    await jobs.approve(id, review.digest!);
    const work = (await jobs.work())!;
    await new LanderJobs(store, observation, fetcher, []).step(
      work,
      undefined,
      'tls-ready',
    );
    expect((await jobs.get(id)).items[0].state).toBe('held');
    expect(writes).toBe(0);
  });
  it.each([false, true])(
    'does not reverse unsubmitted native replacement steps (one proof submitted: %s)',
    async (partial) => {
      await createAccount(
        'dynadot',
        'Fixture DNS',
        { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
        undefined,
        'dynadot',
      );
      const nativeRecords: NativeDnsRecord[] = [
        {
          id: 'old-root',
          type: 'ANAME',
          name: domain,
          content: 'park.io',
          ttl: 300,
        },
        {
          id: 'old-www',
          type: 'CNAME',
          name: 'www.' + domain,
          content: 'park.io',
          ttl: 300,
        },
      ];
      vi.spyOn(LanderDynadot.prototype, 'snapshot').mockResolvedValue({
        provider: 'dynadot',
        accountId: 'dynadot',
        providerAccountId: 'd'.repeat(64),
        zoneId: 'b'.repeat(32),
        domain,
        observedAt: Date.now(),
        nameservers: ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'],
        records: nativeRecords,
        dnssec: {},
        settings: { ttl: 300 },
      });
      const write = vi
        .spyOn(LanderDynadot.prototype, 'write')
        .mockImplementation(async (_snapshot, change) => {
          if (!partial) throw Error('Unexpected DNS write');
          if (change.before) {
            const index = nativeRecords.findIndex(
              (r) => r.id === change.before!.id,
            );
            if (index >= 0) nativeRecords.splice(index, 1);
          }
          if (change.after) {
            const record = {
              ...change.after,
              id: 'owned-proof',
            } as NativeDnsRecord;
            nativeRecords.push(record);
            return record;
          }
          return null;
        });
      const qualified = new LanderJobs(store, observation, fetcher, [
          'dynadot',
        ]),
        id = crypto.randomUUID();
      await qualified.create(
        { kind: 'domains', domains: [domain] },
        id,
        async () => [domain],
      );
      await qualified.step((await qualified.work())!, hosts());
      expect((await qualified.get(id)).items[0].state).toBe('ready');
      if (partial) {
        await qualified.approve(id, (await qualified.get(id)).digest!);
        await qualified.step((await qualified.work())!, undefined, 'tls-ready');
        expect(write).toHaveBeenCalledTimes(1);
        nativeRecords.find((r) => r.id === 'old-www')!.content =
          'newer.owner.example';
      }
      await qualified.cancel(id);
      await qualified.restore(id);
      await qualified.step((await qualified.work())!);
      expect((await qualified.get(id)).items[0].state).toBe('restored-dns');
      if (partial) {
        expect(write).toHaveBeenCalledTimes(2);
        expect(nativeRecords.find((r) => r.id === 'old-www')!.content).toBe(
          'newer.owner.example',
        );
        expect(nativeRecords.some((r) => r.type === 'TXT')).toBe(false);
      } else expect(write).not.toHaveBeenCalled();
      await db.prepare('UPDATE lander_items SET due_at=0').run();
      await qualified.step((await qualified.work())!, undefined, 'detached');
      expect((await qualified.get(id)).items[0].state).toBe('restored');
    },
  );
  it('admits only the selected native qualification fixture before provider-wide activation', async () => {
    await createAccount(
      'dynadot',
      'Fixture DNS',
      { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
      undefined,
      'dynadot',
    );
    vi.spyOn(LanderDynadot.prototype, 'snapshot').mockResolvedValue({
      provider: 'dynadot',
      accountId: 'dynadot',
      providerAccountId: 'd'.repeat(64),
      zoneId: 'b'.repeat(32),
      domain,
      observedAt: Date.now(),
      nameservers: ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'],
      records: [],
      dnssec: {},
      settings: { ttl: 300 },
    });
    const qualified = new LanderJobs(store, observation, fetcher, [], {
        domain,
        accountId: 'dynadot',
      }),
      id = crypto.randomUUID();
    await qualified.create(
      { kind: 'domains', domains: [domain] },
      id,
      async () => [domain],
    );
    const work = (await qualified.work())!;
    expect(work).not.toBeNull();
    await qualified.step(work, hosts());
    const review = await qualified.get(id);
    expect(review.counts).toEqual([{ state: 'ready', count: 1 }]);
    expect(
      review.items[0].changes?.some((c) => c.after?.type === 'ANAME'),
    ).toBe(true);
    expect(writes).toBe(0);
    await qualified.approve(id, review.digest!);
    const scheduled = (await qualified.work())!;
    await new LanderJobs(store, observation, fetcher, []).step(
      scheduled,
      undefined,
      'tls-ready',
    );
    expect((await qualified.get(id)).items[0].state).toBe('held');
    expect(writes).toBe(0);
    await qualified.restore(id);
    expect(
      await new LanderJobs(store, observation, fetcher, []).work(),
    ).not.toBeNull();
  });
  it.each(['other-domain', 'other-account'] as const)(
    'does not broaden qualification to %s',
    async (mode) => {
      await createAccount(
        'dynadot',
        'Fixture DNS',
        { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
        undefined,
        'dynadot',
      );
      vi.spyOn(LanderDynadot.prototype, 'snapshot').mockResolvedValue({
        provider: 'dynadot',
        accountId: 'dynadot',
        providerAccountId: 'd'.repeat(64),
        zoneId: 'b'.repeat(32),
        domain,
        observedAt: Date.now(),
        nameservers: ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'],
        records: [],
        dnssec: {},
        settings: { ttl: 300 },
      });
      const qualified = new LanderJobs(store, observation, fetcher, [], {
          domain: mode === 'other-domain' ? 'other.example' : domain,
          accountId: mode === 'other-account' ? 'other' : 'dynadot',
        }),
        id = crypto.randomUUID();
      await qualified.create(
        { kind: 'domains', domains: [domain] },
        id,
        async () => [domain],
      );
      expect(await qualified.work()).toBeNull();
      expect((await qualified.get(id)).items[0].state).toBe('held');
      expect(writes).toBe(0);
    },
  );
  it('approves a real stored manifest through both gateway and tenant HTTP validators', async () => {
    const { id, review } = await prepared();
    expect(review.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const workspace = '11111111-1111-4111-8111-111111111111',
      secret = 'fixture-gateway-secret'.repeat(3);
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      '/sales-internal/lander',
      createLanderRoutes(async (_c, next) => {
        await next();
      }),
    );
    const workerEnv = {
      DB: db,
      DOMBOT_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(8))),
      DOMBOT_WORKSPACE_ID: workspace,
      DOMBOT_GATEWAY_SECRET: secret,
      DOMBOT_SALES_V1: 'true',
    } as Env;
    const env = {
      CANONICAL_ORIGIN: 'https://accounts.example',
      AUTH_PEPPER: 'fixture-recipient-pepper',
      WORKSPACES: JSON.stringify([
        { id: workspace, binding: 'WORKSPACE_0', label: 'Synthetic' },
      ]),
      GATEWAY_KEYS: JSON.stringify({ [workspace]: secret }),
      CONTROL_DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ email_verified_at: Date.now() }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      WORKSPACE_0: {
        fetch: (request: Request) => app.fetch(request, workerEnv),
      },
    } as unknown as HostedEnv;
    const response = await landerRequest(
      env,
      workspace,
      'owner@example.test',
      '/sales/lander/jobs/' + id + '/approve',
      new Request(
        'https://accounts.example/w/' +
          workspace +
          '/sales/lander/jobs/' +
          id +
          '/approve',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ digest: review.digest }),
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, state: 'running' });
    expect(writes).toBe(0);
  });
  it('never accepts owner/public or cross-tenant proof on internal DNS routes', async () => {
    const secret = 'fixture-gateway-secret'.repeat(3),
      workspace = '11111111-1111-4111-8111-111111111111';
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      '/sales-internal/lander',
      createLanderRoutes(async (_c, next) => {
        await next();
      }),
    );
    for (const [purpose, target] of [
      ['sales-hostnames', workspace],
      ['sales-connections', '22222222-2222-4222-8222-222222222222'],
    ] as const) {
      const request = new Request(
        'https://fixture.example/sales-internal/lander/work',
      );
      request.headers.set(
        'X-DomBot-Gateway-Proof',
        await signGatewayRequest(
          secret,
          target,
          null,
          request,
          purpose === 'sales-connections'
            ? { purpose, recipientVerified: true }
            : { purpose },
        ),
      );
      const response = await app.fetch(request, {
        DB: db,
        DOMBOT_GATEWAY_SECRET: secret,
        DOMBOT_WORKSPACE_ID: workspace,
      } as Env);
      expect(response.status).toBe(403);
    }
  });
});
