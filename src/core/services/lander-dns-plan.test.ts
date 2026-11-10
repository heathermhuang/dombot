import { describe, expect, it } from 'vitest';
import { planLanderDns, observeDnsChange } from './lander-dns-plan';
import { sameRecord, writableRecord } from './lander-cloudflare';
import type {
  DnsSnapshot,
  NativeDnsRecord,
  LanderHostingPlan,
} from '../../shared/lander-connection';
const domain = 'fixture.example';
const record = (
  type: string,
  name = domain,
  content = '192.0.2.1',
): NativeDnsRecord => ({
  id: 'a'.repeat(32),
  type,
  name,
  content,
  ttl: 3600,
  proxied: false,
  comment: 'Keep this comment',
  tags: ['team:owner'],
  settings: { ipv4_only: false },
  meta: { managed_by_apps: false },
});
const snapshot = (records: NativeDnsRecord[]): DnsSnapshot => ({
  provider: 'cloudflare',
  accountId: 'cloudflare',
  providerAccountId: 'b'.repeat(32),
  zoneId: 'c'.repeat(32),
  domain,
  observedAt: Date.now(),
  nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'],
  records,
  dnssec: { status: 'active' },
  settings: { value: 'flatten_at_root' },
});
const hosts: LanderHostingPlan[] = [domain, `www.${domain}`].map(
  (hostname) => ({
    hostname,
    epoch: 1,
    challenge: 'a'.repeat(32),
    records: [
      {
        type: 'TXT',
        name: `_domains-sales.${hostname}`,
        value: 'domains-sales=' + 'a'.repeat(32),
      },
    ],
    target: 'fallback.example',
  }),
);
describe('preservation-safe lander DNS planning', () => {
  it('changes only exact root/www web routing, preserving IDs and provider metadata', () => {
    const web = record('A'),
      mail = record('MX', domain, 'mail.fixture.example'),
      txt = record('TXT', '_dmarc.fixture.example', 'v=DMARC1; p=reject');
    const before = snapshot([web, mail, txt]),
      copy = structuredClone(before),
      changes = planLanderDns(before, hosts, 'generation');
    expect(before).toEqual(copy);
    expect(changes).toHaveLength(4);
    const change = changes.find((c) => c.before?.id === web.id)!;
    expect(change.before).toEqual(web);
    expect(change.after).toMatchObject({
      id: web.id,
      type: 'CNAME',
      content: 'fallback.example',
      ttl: 3600,
      comment: web.comment,
      tags: web.tags,
      settings: web.settings,
    });
    expect(changes[0].after?.type).toBe('TXT');
    expect(changes.at(-1)?.after?.type).toBe('CNAME');
    expect(changes.some((c) => c.before === mail || c.before === txt)).toBe(
      false,
    );
  });
  it.each([
    record('MX', domain, domain),
    record('MX', domain, 'www.fixture.example.'),
    record('TXT', domain, 'v=spf1 a -all'),
    record('TXT', domain, 'v=spf1 mx -all'),
    record('TXT', 'mail.fixture.example', 'v=spf1 a:fixture.example -all'),
    record('TXT', domain, 'v=spf1 include:mail.example -all'),
    record('CNAME', '*.fixture.example', 'old.example'),
    record('HTTPS'),
    record('SVCB'),
    record('SRV', '_sip._tcp.fixture.example', '1 1 443 fixture.example.'),
    record('NS', 'www.fixture.example', 'ns.other.example'),
    { ...record('A'), proxied: true },
  ])('holds ambiguous/dependent routing: $type $content', (r) =>
    expect(() => planLanderDns(snapshot([r]), hosts, 'g')).toThrow(),
  );
  it('follows in-zone aliases used by mail', () =>
    expect(() =>
      planLanderDns(
        snapshot([
          record('CNAME', 'mail.fixture.example', domain),
          record('MX', domain, 'mail.fixture.example'),
        ]),
        hosts,
        'g',
      ),
    ).toThrow(/Mail/));
  it('preserves independent SPF, DKIM, DMARC, CAA, DNSSEC and mail records', () => {
    const records = [
      record('TXT', domain, 'v=spf1 ip4:192.0.2.5 -all'),
      record('MX', domain, 'mail.example.net'),
      record('TXT', 'selector._domainkey.fixture.example', 'key'),
      record('CAA', domain, '0 issue "letsencrypt.org"'),
      record('TXT', '_dmarc.fixture.example', 'v=DMARC1; p=reject'),
    ];
    expect(
      planLanderDns(snapshot(records), hosts, 'g').every((c) => !c.before),
    ).toBe(true);
  });
  it('holds multiple A/AAAA records instead of deleting record identities', () =>
    expect(() =>
      planLanderDns(
        snapshot([record('A'), { ...record('AAAA'), id: 'd'.repeat(32) }]),
        hosts,
        'g',
      ),
    ).toThrow(/Multiple/));
  it('requires both root and www', () =>
    expect(() => planLanderDns(snapshot([]), hosts.slice(1), 'g')).toThrow(
      /Root and www/,
    ));
  it('rejects unrelated validation names and conflicting proof aliases', () => {
    expect(() =>
      planLanderDns(
        snapshot([]),
        [
          {
            ...hosts[0],
            records: [
              {
                type: 'TXT',
                name: '_acme-challenge.other.example',
                value: 'bad',
              },
            ],
          },
          hosts[1],
        ],
        'g',
      ),
    ).toThrow(/outside/);
    expect(() =>
      planLanderDns(
        snapshot([
          record('CNAME', '_domains-sales.fixture.example', 'other.example'),
        ]),
        hosts,
        'g',
      ),
    ).toThrow(/conflicts/);
  });
  it('recognizes before, after, unknown and later edits without dropping metadata', () => {
    const before = record('A'),
      after = { ...before, type: 'CNAME', content: 'fallback.example' },
      change = { before, after };
    expect(observeDnsChange([before], change).state).toBe('before');
    expect(observeDnsChange([after], change).state).toBe('after');
    expect(
      observeDnsChange([{ ...after, comment: 'new owner edit' }], change).state,
    ).toBe('conflict');
    expect(observeDnsChange([], change).state).toBe('conflict');
    expect(
      sameRecord(before, { ...before, modified_on: 'server-generated' }),
    ).toBe(true);
    expect(writableRecord(before)).not.toHaveProperty('meta');
  });
  it('reconciles tagged creations and rejects duplicates', () => {
    expect(
      sameRecord(
        {
          type: 'TXT',
          name: 'proof.example',
          content: 'proof',
          ttl: 300,
          proxied: false,
          settings: {},
          tags: [],
          comment: null,
        },
        { type: 'TXT', name: 'proof.example', content: 'proof', ttl: 300 },
      ),
    ).toBe(true);
    const after = {
      ...record('TXT', '_domains-sales.fixture.example', 'proof'),
      comment: 'unique-connection',
    };
    expect(observeDnsChange([], { before: null, after }).state).toBe('before');
    expect(observeDnsChange([after], { before: null, after }).state).toBe(
      'after',
    );
    expect(
      observeDnsChange([after, { ...after, id: 'different' }], {
        before: null,
        after,
      }).state,
    ).toBe('conflict');
  });
});
