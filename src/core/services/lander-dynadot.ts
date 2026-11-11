import { z } from 'zod';
import { accountById } from './accounts';
import { getStoredCredentials } from './credentials';
import { isRegistrarEnabled } from './registrar-state';
import { accountProxyRoute } from './proxies';
import { sendThroughProxy } from './proxy-transport';
import { createDynadotFetch } from './dynadot-transport';
import { resolveNameservers } from '../dns';
import { canonicalDomain } from '../../shared/publication';
import {
  canonicalJson,
  dnsSnapshotSchema,
  type DnsSnapshot,
  type DnsChange,
  type NativeDnsRecord,
} from '../../shared/lander-connection';
import { LanderDnsError, sameRecord } from './lander-cloudflare';

const hash = async (v: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const record = z
  .object({
    sub_host: z.string().max(253).optional(),
    record_type: z.string().max(16),
    record_value1: z.string().max(65536),
    record_value2: z.string().optional(),
  })
  .passthrough();
const glueSchema = z
  .object({
    glue_type: z.literal('DNS'),
    ttl: z.coerce.number().int().positive(),
    dns_main_list: z.array(record).max(20),
    dns_sub_list: z.array(record).max(100),
    email_forward_type: z.string().optional(),
    email_alias_list: z.array(z.unknown()).optional(),
  })
  .passthrough();
const normalize = (s: string) => s.toLowerCase().replace(/\.$/, '');
/** Native append/exact-remove only. Never replaces a zone or changes NS. */
export class LanderDynadot {
  readonly send: typeof fetch;
  constructor(
    readonly accountId: string,
    readonly fetcher: typeof fetch = fetch,
    readonly fence: () => Promise<void> = async () => {},
  ) {
    this.send = createDynadotFetch(async (input, init) => {
      if ((init?.method ?? 'GET') !== 'GET') {
        try {
          await this.fence();
        } catch {
          throw new LanderDnsError(
            'DNS_LEASE',
            'The connection lease is no longer valid. No DNS request was sent.',
          );
        }
      }
      const proxy = accountProxyRoute(accountById(accountId));
      return proxy
        ? sendThroughProxy(proxy, String(input), init ?? {})
        : fetcher(input, init);
    });
  }
  credentials() {
    const a = accountById(this.accountId),
      c = getStoredCredentials(a.id);
    if (
      a.registrar !== 'dynadot' ||
      !isRegistrarEnabled(a.id) ||
      !c.apiKey ||
      !c.apiSecret
    )
      throw new LanderDnsError(
        'DNS_ACCOUNT',
        'Connect the enabled Dynadot account controlling this domain.',
      );
    return c;
  }
  async call(domain: string, suffix: string, method = 'GET', body?: unknown) {
    domain = canonicalDomain(domain);
    const c = this.credentials(),
      p = `/restful/v2/domains/${encodeURIComponent(domain)}${suffix}`,
      text = body === undefined ? '' : JSON.stringify(body);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(c.apiSecret!),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signed = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`${c.apiKey}\n${p}\n\n${text}`),
      ),
    );
    const signature = btoa(String.fromCharCode(...signed));
    let response: Response;
    try {
      response = await this.send('https://api.dynadot.com' + p, {
        method,
        headers: {
          Authorization: `Bearer ${c.apiKey}`,
          'X-Signature': signature,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        ...(body === undefined ? {} : { body: text }),
      });
    } catch (error) {
      if (error instanceof LanderDnsError) throw error;
      throw new LanderDnsError(
        'DNS_UNAVAILABLE',
        'Dynadot DNS submission needs reconciliation before retrying.',
        method !== 'GET',
      );
    }
    const reader = response.body?.getReader();
    let bytes = 0,
      result = '';
    const decoder = new TextDecoder();
    try {
      if (reader)
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 500000) throw Error();
          result += decoder.decode(chunk.value, { stream: true });
        }
      result += decoder.decode();
      const value = z
        .object({ code: z.coerce.number().int(), data: z.unknown().optional() })
        .parse(JSON.parse(result));
      if (!response.ok || value.code !== 200)
        throw new LanderDnsError(
          method === 'GET' && (response.status === 404 || value.code === 404)
            ? 'DNS_ZONE'
            : 'DNS_PROVIDER',
          'Dynadot refused the DNS operation. Review its status before continuing.',
          method !== 'GET' &&
            (response.status >= 500 || response.status === 202),
        );
      return value.data;
    } catch (e) {
      await reader?.cancel().catch(() => {});
      if (e instanceof LanderDnsError) throw e;
      throw new LanderDnsError(
        'DNS_REPLY',
        'Dynadot returned an unreadable or oversized response.',
        method !== 'GET',
      );
    }
  }
  async zoneId(domain: string) {
    return (await hash(canonicalDomain(domain))).slice(0, 32);
  }
  async read(domain: string) {
    const raw = z
      .object({ glue_info: z.object({ glue_type: z.string() }).passthrough() })
      .parse(await this.call(domain, '/records'));
    if (raw.glue_info.glue_type !== 'DNS')
      throw new LanderDnsError(
        'DNS_AUTHORITY',
        'This domain is not using Dynadot DNS.',
      );
    const value = z.object({ glue_info: glueSchema }).parse(raw).glue_info;
    if (
      (value.email_forward_type && value.email_forward_type !== 'MTYPE_NONE') ||
      value.email_alias_list?.length
    )
      throw new LanderDnsError(
        'DNS_DEPENDENCY',
        'Review Dynadot email forwarding before connecting.',
      );
    const records: NativeDnsRecord[] = [];
    for (const [apex, list] of [
      [true, value.dns_main_list],
      [false, value.dns_sub_list],
    ] as const)
      for (const r of list) {
        const type = r.record_type.toUpperCase();
        if (
          ![
            'A',
            'AAAA',
            'CNAME',
            'ANAME',
            'TXT',
            'MX',
            'NS',
            'SRV',
            'CAA',
          ].includes(type)
        )
          throw new LanderDnsError(
            'DNS_DEPENDENCY',
            'Review provider forwarding or unsupported records before connecting.',
          );
        const host = apex
          ? domain
          : r.sub_host
            ? `${r.sub_host}.${domain}`
            : '';
        if (!host || host.length > 253)
          throw new LanderDnsError(
            'DNS_REPLY',
            'Incomplete Dynadot record owner.',
          );
        const priority =
          type === 'MX'
            ? z.coerce.number().int().min(0).max(65535).parse(r.record_value2)
            : undefined;
        if (r.record_value2 && type !== 'MX')
          throw new LanderDnsError(
            'DNS_DEPENDENCY',
            'Review extended provider record fields before connecting.',
          );
        records.push({
          id: await hash(
            canonicalJson([host, type, r.record_value1, priority]),
          ),
          type,
          name: host,
          content: r.record_value1,
          ttl: value.ttl,
          ...(priority === undefined ? {} : { priority }),
          providerRecord: r,
        });
      }
    if (new Set(records.map((r) => r.id)).size !== records.length)
      throw new LanderDnsError(
        'DNS_REPLY',
        'Duplicate DNS records require review before connecting.',
      );
    return { value, records };
  }
  async snapshot(domain: string, zoneId?: string): Promise<DnsSnapshot> {
    domain = canonicalDomain(domain);
    const credentialIdentity = await hash(this.credentials().apiKey!);
    if (zoneId && zoneId !== (await this.zoneId(domain)))
      throw new LanderDnsError(
        'DNS_ZONE',
        'Saved Dynadot zone does not match the domain.',
      );
    const { value, records } = await this.read(domain),
      nsData = z
        .object({
          nameserver_list: z
            .array(z.object({ server_name: z.string() }))
            .min(1),
        })
        .parse(await this.call(domain, '/nameservers'));
    const expected = nsData.nameserver_list
        .map((s) => normalize(s.server_name))
        .sort(),
      ns = (await resolveNameservers(domain, this.fetcher))
        .map(normalize)
        .sort();
    if (
      !expected.length ||
      expected.some((s) => !/^ns[12]\.dynadot\.com$/.test(s)) ||
      canonicalJson(ns) !== canonicalJson(expected)
    )
      throw new LanderDnsError(
        'DNS_AUTHORITY',
        'This domain must already use its assigned authoritative Dynadot DNS nameservers.',
      );
    const dnssec = z
      .object({ dnssec_info_list: z.array(z.record(z.string(), z.unknown())) })
      .passthrough()
      .parse(await this.call(domain, '/dnssec'));
    if (credentialIdentity !== (await hash(this.credentials().apiKey!)))
      throw new LanderDnsError(
        'DNS_ACCOUNT',
        'The Dynadot credential changed during preflight. Review the account again.',
      );
    const snapshot = dnsSnapshotSchema.parse({
      provider: 'dynadot',
      accountId: this.accountId,
      providerAccountId: credentialIdentity,
      zoneId: await this.zoneId(domain),
      domain,
      observedAt: Date.now(),
      nameservers: ns,
      records,
      dnssec,
      settings: value,
    });
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 500000)
      throw new LanderDnsError(
        'DNS_SNAPSHOT_LIMIT',
        'The complete native DNS recovery snapshot exceeds its encrypted size limit. Nothing was truncated or changed.',
      );
    return snapshot;
  }
  async write(snapshot: DnsSnapshot, change: DnsChange) {
    if (change.before && change.after)
      throw new LanderDnsError(
        'DNS_PLAN',
        'Dynadot changes require separate exact removal and append intents.',
      );
    const current = await this.snapshot(snapshot.domain, snapshot.zoneId);
    if (current.providerAccountId !== snapshot.providerAccountId)
      throw new LanderDnsError(
        'DNS_ACCOUNT',
        'The approved Dynadot credential changed.',
      );
    const r = change.before ?? change.after;
    if (!r) throw new LanderDnsError('DNS_PLAN', 'Empty DNS operation.');
    if (r.ttl !== current.settings.ttl)
      throw new LanderDnsError(
        'DNS_TTL',
        'Dynadot has a zone-wide TTL. Preserve it before connecting.',
      );
    if (change.before) {
      const matches = current.records.filter(
        (x) => x.id === change.before!.id && sameRecord(x, change.before!),
      );
      if (matches.length !== 1)
        throw new LanderDnsError(
          'DNS_CONFLICT',
          'The exact record changed before removal.',
        );
    } else if (current.records.some((x) => sameRecord(x, r)))
      throw new LanderDnsError(
        'DNS_CONFLICT',
        'The append is already observable. Reconcile without replaying it.',
      );
    const apex = r.name === snapshot.domain,
      sub = apex ? undefined : r.name.slice(0, -snapshot.domain.length - 1);
    if (!apex && (!sub || r.name !== sub + '.' + snapshot.domain))
      throw new LanderDnsError(
        'DNS_PLAN',
        'The record is outside this DNS zone.',
      );
    const entry = {
      record_type: r.type.toLowerCase(),
      record_value1: r.content,
      ...(r.priority === undefined
        ? {}
        : { record_value2: String(r.priority) }),
      ...(sub ? { sub_host: sub } : {}),
    };
    const body = { [apex ? 'dns_main_list' : 'dns_sub_list']: [entry] };
    await this.call(
      snapshot.domain,
      '/records',
      change.before ? 'DELETE' : 'POST',
      {
        ...body,
        ...(!change.before
          ? { ttl: r.ttl, add_dns_to_current_setting: true }
          : {}),
      },
    );
    // A provider accepting the request is insufficient: verify the complete
    // remainder as well as the changed record. An ambiguous write is never
    // retried by this adapter.
    const after = await this.read(snapshot.domain);
    const retained = current.records.filter((x) => x.id !== change.before?.id);
    const unchanged = retained.every((x) =>
      after.records.some(
        (y) =>
          y.id === x.id &&
          sameRecord(x, y) &&
          canonicalJson(x.providerRecord) === canonicalJson(y.providerRecord),
      ),
    );
    const exactSize =
      after.records.length === retained.length + (change.after ? 1 : 0);
    const written =
      !change.after ||
      after.records.filter((x) => sameRecord(x, change.after!)).length === 1;
    const settings = (v: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(v).filter(
          ([k]) => !['dns_main_list', 'dns_sub_list'].includes(k),
        ),
      );
    if (
      !unchanged ||
      !exactSize ||
      !written ||
      canonicalJson(settings(current.settings)) !==
        canonicalJson(settings(after.value))
    )
      throw new LanderDnsError(
        'DNS_UNKNOWN',
        'The complete DNS readback differs from the approved native operation. Reconcile before continuing.',
        true,
      );
  }
}
