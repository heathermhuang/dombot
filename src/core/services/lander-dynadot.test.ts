import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import { createAccount } from './accounts';
import { setStoredCredentials } from './credentials';
import { LanderDynadot } from './lander-dynadot';
import { discoverLanderZone } from './lander-dns-provider';
import {
  planLanderDns,
  observeDnsChange,
  isLanderWebChange,
} from './lander-dns-plan';
import type { LanderHostingPlan } from '../../shared/lander-connection';
const domain = 'fixture.example';
type Row = {
  record_type: string;
  record_value1: string;
  record_value2?: string;
  sub_host?: string;
};
let main: Row[],
  sub: Row[],
  ns: string[],
  assignedNs: string[],
  glueType: string,
  ttl: number,
  writes: Request[],
  unknown: boolean;
let corruptRemoval = false;
let emptyDnssecReply = false;
const hosts: LanderHostingPlan[] = [domain, 'www.' + domain].map(
  (hostname) => ({
    hostname,
    epoch: 1,
    challenge: 'a'.repeat(32),
    target: 'origin.example',
    records: [
      {
        type: 'TXT',
        name: '_domains-sales.' + hostname,
        value: 'domains-sales=' + 'a'.repeat(32),
      },
    ],
  }),
);
const fetcher: typeof fetch = async (input, init) => {
  const r = new Request(input, init),
    u = new URL(r.url);
  if (u.hostname === 'cloudflare-dns.com')
    return Response.json({
      Status: 0,
      Answer: ns.map((data) => ({ type: 2, data })),
    });
  expect(u.hostname).toBe('api.dynadot.com');
  expect(u.pathname.startsWith('/restful/v2/domains/' + domain)).toBe(true);
  expect(r.headers.get('Authorization')).toBe('Bearer fixture-key');
  expect(r.headers.get('X-Signature')).toBeTruthy();
  const ok = (data: unknown) => Response.json({ code: 200, data });
  if (u.pathname.endsWith('/nameservers'))
    return ok({
      nameserver_list: assignedNs.map((server_name) => ({ server_name })),
    });
  if (u.pathname.endsWith('/dnssec'))
    return ok(emptyDnssecReply ? {} : { dnssec_info_list: [] });
  if (r.method === 'GET')
    return ok({
      glue_info: {
        glue_type: glueType,
        ttl: String(ttl),
        dns_main_list: main,
        dns_sub_list: sub,
      },
    });
  writes.push(r.clone());
  const b = (await r.json()) as {
    dns_main_list?: Row[];
    dns_sub_list?: Row[];
    ttl?: number;
    add_dns_to_current_setting?: boolean;
  };
  if (r.method === 'POST') {
    expect(b.add_dns_to_current_setting).toBe(true);
    expect(b.ttl).toBe(ttl);
    main.push(...(b.dns_main_list ?? []));
    sub.push(...(b.dns_sub_list ?? []));
  } else {
    expect(r.method).toBe('DELETE');
    expect((b.dns_main_list?.length ?? 0) + (b.dns_sub_list?.length ?? 0)).toBe(
      1,
    );
    main = main.filter(
      (x) =>
        !b.dns_main_list?.some((y) => JSON.stringify(x) === JSON.stringify(y)),
    );
    sub = sub.filter(
      (x) =>
        !b.dns_sub_list?.some((y) => JSON.stringify(x) === JSON.stringify(y)),
    );
    if (corruptRemoval) main = [];
  }
  if (unknown) throw Error('transport lost after submission');
  return ok({
    main_record_removed_count: b.dns_main_list?.length ?? 0,
    sub_record_removed_count: b.dns_sub_list?.length ?? 0,
  });
};
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  await createAccount(
    'dynadot',
    'DNS',
    { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
    undefined,
    'dynadot',
  );
  main = [
    { record_type: 'aname', record_value1: 'park.example' },
    { record_type: 'mx', record_value1: 'mail.example', record_value2: '10' },
  ];
  sub = [
    {
      record_type: 'txt',
      record_value1: 'v=DMARC1; p=reject',
      sub_host: '_dmarc',
    },
  ];
  ns = ['ns1.dynadot.com', 'ns2.dynadot.com'];
  assignedNs = [...ns];
  glueType = 'DNS';
  ttl = 1800;
  writes = [];
  unknown = false;
  corruptRemoval = false;
  emptyDnssecReply = false;
  let time = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => (time += 100000));
});
afterEach(() => vi.restoreAllMocks());
it('reads complete native records, credential identity, authoritative NS and shared TTL without writes', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain);
  expect(s.provider).toBe('dynadot');
  expect(s.records).toHaveLength(3);
  expect(s.records[1]).toMatchObject({ type: 'MX', priority: 10, ttl: 1800 });
  expect(s.settings.dns_main_list).toEqual(main);
  expect(JSON.stringify(s)).not.toMatch(/fixture-key|fixture-secret/);
  expect(writes).toHaveLength(0);
});
it('accepts provider-assigned dyna-ns.net DNS while requiring exact public delegation agreement', async () => {
  ns = ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'];
  assignedNs = [...ns];
  expect(
    (await new LanderDynadot('dynadot', fetcher).snapshot(domain)).nameservers,
  ).toEqual(ns);
  ns = ['a.dns.park.io', 'b.dns.park.io'];
  await expect(
    new LanderDynadot('dynadot', fetcher).snapshot(domain),
  ).rejects.toMatchObject({ code: 'DNS_AUTHORITY' });
  expect(writes).toHaveLength(0);
});
it('rejects a non-provider delegation even when the API and public NS agree', async () => {
  ns = ['ns1.foreign.invalid', 'ns2.foreign.invalid'];
  assignedNs = [...ns];
  await expect(
    new LanderDynadot('dynadot', fetcher).snapshot(domain),
  ).rejects.toMatchObject({ code: 'DNS_AUTHORITY' });
  expect(writes).toHaveLength(0);
});
it('preserves a successful empty DNSSEC response without inventing provider fields', async () => {
  emptyDnssecReply = true;
  expect(
    (await new LanderDynadot('dynadot', fetcher).snapshot(domain)).dnssec,
  ).toEqual({});
  expect(writes).toHaveLength(0);
});
it('requires explicit provider qualification even for a connected authoritative Dynadot account', async () => {
  await expect(discoverLanderZone(domain, fetcher)).rejects.toMatchObject({
    code: 'DNS_ACCOUNT',
  });
  expect(
    (await discoverLanderZone(domain, fetcher, ['dynadot'])).provider,
  ).toBe('dynadot');
  expect(writes).toHaveLength(0);
});
it.each(['external', 'wrong-ns', 'duplicate'] as const)(
  'holds %s before any mutation',
  async (mode) => {
    if (mode === 'external') glueType = 'NAME_SERVERS';
    if (mode === 'wrong-ns') ns = ['a.dns.park.io'];
    if (mode === 'duplicate') main.push({ ...main[0] });
    await expect(
      new LanderDynadot('dynadot', fetcher).snapshot(domain),
    ).rejects.toThrow();
    expect(writes).toHaveLength(0);
  },
);
it('plans apex ANAME and www CNAME, proves first, preserves TTL and unrelated records through cutover and restoration', async () => {
  const original = { main: structuredClone(main), sub: structuredClone(sub) },
    p = new LanderDynadot('dynadot', fetcher),
    snapshot = await p.snapshot(domain),
    changes = planLanderDns(snapshot, hosts, 'generation');
  expect(changes.slice(0, 2).every((c) => !isLanderWebChange(c))).toBe(true);
  expect(changes.some((c) => c.after?.type === 'ANAME')).toBe(true);
  expect(changes.every((c) => !c.before || !c.after)).toBe(true);
  for (const c of changes) {
    const current = await p.snapshot(domain);
    await p.write(current, c);
    const read = await new LanderDynadot('dynadot', fetcher).snapshot(domain);
    expect(observeDnsChange(read.records, c).state).toBe('after');
  }
  expect(
    main.some((x) => x.record_type === 'mx' && x.record_value2 === '10'),
  ).toBe(true);
  expect(sub).toContainEqual(original.sub[0]);
  for (const c of [...changes].reverse()) {
    const current = await p.snapshot(domain),
      seen = observeDnsChange(current.records, c);
    await p.write(current, { before: seen.record, after: c.before });
    expect(observeDnsChange((await p.snapshot(domain)).records, c).state).toBe(
      'before',
    );
  }
  expect(main).toEqual(expect.arrayContaining(original.main));
  expect(main).toHaveLength(original.main.length);
  expect(sub).toEqual(original.sub);
});
it('does not replay a timed-out append and reconciles it with a fresh provider instance', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain),
    c = planLanderDns(s, hosts, 'generation')[0];
  unknown = true;
  await expect(p.write(s, c)).rejects.toMatchObject({ uncertain: true });
  expect(writes).toHaveLength(1);
  expect(
    observeDnsChange(
      (await new LanderDynadot('dynadot', fetcher).snapshot(domain)).records,
      c,
    ).state,
  ).toBe('after');
  expect(writes).toHaveLength(1);
});
it('refuses zone replacement and a changed global TTL without a request', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain),
    c = planLanderDns(s, hosts, 'generation')[0];
  await expect(
    p.write(s, { before: s.records[0], after: s.records[0] }),
  ).rejects.toThrow(/separate/);
  ttl = 3600;
  await expect(p.write(s, c)).rejects.toThrow(/TTL/);
  expect(writes).toHaveLength(0);
});
it('requires a new review when the exact approved credential changes', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain),
    c = planLanderDns(s, hosts, 'generation')[0];
  await setStoredCredentials('dynadot', {
    apiKey: 'changed-key',
    apiSecret: 'changed-secret',
  });
  // A provider may accept the rotated credential; the plan identity still fences it.
  const rotated: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', 'Bearer fixture-key');
    return fetcher(input, { ...init, headers });
  };
  await expect(
    new LanderDynadot('dynadot', rotated).write(s, c),
  ).rejects.toThrow(/credential changed/);
  expect(writes).toHaveLength(0);
});
it('fences the lease immediately before an external mutation', async () => {
  const p = new LanderDynadot('dynadot', fetcher, async () => {
      throw Error('lease expired');
    }),
    s = await p.snapshot(domain),
    c = planLanderDns(s, hosts, 'generation')[0];
  await expect(p.write(s, c)).rejects.toMatchObject({
    code: 'DNS_LEASE',
    uncertain: false,
  });
  expect(writes).toHaveLength(0);
});
it('does not accept a provider removal that also removes an unrelated record', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain);
  corruptRemoval = true;
  await expect(
    p.write(s, { before: s.records[0], after: null }),
  ).rejects.toMatchObject({ code: 'DNS_UNKNOWN', uncertain: true });
  expect(writes).toHaveLength(1);
});
it('holds plans exceeding the native record count before any mutation', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain);
  s.records = Array.from({ length: 20 }, (_, i) => ({
    id: 'root-' + i,
    name: domain,
    type: 'TXT',
    content: 'txt-' + i,
    ttl: 1800,
  }));
  expect(() => planLanderDns(s, hosts, 'generation')).toThrow(/capacity/);
  expect(writes).toHaveLength(0);
});
it('holds a provider-complete snapshot that would exceed encrypted custody limits', async () => {
  main = Array.from({ length: 3 }, (_, i) => ({
    record_type: 'txt',
    record_value1: String(i) + 'x'.repeat(59999),
  }));
  sub = [];
  await expect(
    new LanderDynadot('dynadot', fetcher).snapshot(domain),
  ).rejects.toMatchObject({ code: 'DNS_SNAPSHOT_LIMIT' });
  expect(writes).toHaveLength(0);
});
it('preserves a web record or proof alias added after the approved plan', async () => {
  const p = new LanderDynadot('dynadot', fetcher),
    s = await p.snapshot(domain),
    changes = planLanderDns(s, hosts, 'generation');
  const web = changes.find(
    (c) => c.after?.name === 'www.' + domain && c.after.type === 'CNAME',
  )!;
  sub.push({ sub_host: 'www', record_type: 'a', record_value1: '192.0.2.99' });
  await expect(p.write(s, web)).rejects.toMatchObject({ code: 'DNS_CONFLICT' });
  sub.push({
    sub_host: '_domains-sales',
    record_type: 'cname',
    record_value1: 'later.example',
  });
  await expect(p.write(s, changes[0])).rejects.toMatchObject({
    code: 'DNS_CONFLICT',
  });
  expect(writes).toHaveLength(0);
});
