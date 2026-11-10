import { z } from 'zod';
import { accountById, listAccounts } from './accounts';
import { getStoredCredentials } from './credentials';
import { isRegistrarEnabled } from './registrar-state';
import { accountProxyRoute } from './proxies';
import { sendThroughProxy } from './proxy-transport';
import { resolveNameservers } from '../dns';
import { canonicalDomain } from '../../shared/publication';
import {
  canonicalJson,
  dnsRecordSchema,
  dnsSnapshotSchema,
  type DnsSnapshot,
  type DnsChange,
  type NativeDnsRecord,
} from '../../shared/lander-connection';

export class LanderDnsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}
const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
const normalize = (s: string) => s.toLowerCase().replace(/\.$/, '');
const writableKeys = [
  'type',
  'name',
  'content',
  'ttl',
  'proxied',
  'priority',
  'data',
  'settings',
  'comment',
  'tags',
] as const;
export function writableRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    writableKeys
      .filter((k) => record[k] !== undefined)
      .map((k) => [k, record[k]]),
  );
}
export function sameRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  const comparable = (record: Record<string, unknown>) => {
    const value = writableRecord(record);
    value.proxied = value.proxied ?? false;
    value.settings = value.settings ?? {};
    value.tags = Array.isArray(value.tags) ? [...value.tags].sort() : [];
    if (value.comment === null || value.comment === undefined)
      delete value.comment;
    return value;
  };
  return canonicalJson(comparable(a)) === canonicalJson(comparable(b));
}

/** Native record operations only. No SDK replacement method and no write retry. */
export class LanderCloudflare {
  constructor(
    readonly accountId: string,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async call(path: string, method = 'GET', body?: unknown) {
    const account = accountById(this.accountId),
      credentials = getStoredCredentials(account.id);
    if (
      account.registrar !== 'cloudflare' ||
      !isRegistrarEnabled(account.id) ||
      !credentials.apiToken ||
      !idSchema.safeParse(credentials.accountId).success
    )
      throw new LanderDnsError(
        'DNS_ACCOUNT',
        'Connect an enabled Cloudflare DNS account with its exact account ID.',
      );
    const proxy = accountProxyRoute(account);
    let response: Response;
    try {
      const url = 'https://api.cloudflare.com/client/v4' + path;
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          'Content-Type': 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      };
      response = await (proxy
        ? sendThroughProxy(proxy, url, init)
        : this.fetcher(url, init));
    } catch {
      throw new LanderDnsError(
        'DNS_UNAVAILABLE',
        'DNS provider response is unavailable. Reconcile submitted writes before retrying.',
        method !== 'GET',
      );
    }
    // Bound all provider replies, including error bodies. Never expose them.
    const reader = response.body?.getReader();
    let size = 0,
      raw = '';
    const decoder = new TextDecoder();
    try {
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024) throw Error();
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
    } catch {
      await reader?.cancel().catch(() => {});
      throw new LanderDnsError(
        'DNS_REPLY',
        'DNS provider returned an unreadable reply.',
        method !== 'GET',
      );
    }
    if (!response.ok)
      throw new LanderDnsError(
        response.status === 429 ? 'DNS_RATE_LIMIT' : 'DNS_ACCESS',
        'The DNS provider refused this operation. Check permissions and retry after review.',
        method !== 'GET' && (response.status >= 500 || response.status === 429),
      );
    let value;
    try {
      value = z
        .object({
          success: z.literal(true),
          result: z.unknown(),
          result_info: z
            .object({
              page: z.number().int(),
              per_page: z.number().int(),
              total_pages: z.number().int(),
              total_count: z.number().int(),
            })
            .optional(),
        })
        .parse(JSON.parse(raw));
    } catch {
      throw new LanderDnsError(
        'DNS_REPLY',
        'The DNS provider reply could not be validated.',
        method !== 'GET',
      );
    }
    return value;
  }
  async records(zoneId: string): Promise<NativeDnsRecord[]> {
    idSchema.parse(zoneId);
    const rows: NativeDnsRecord[] = [];
    let bytes = 0;
    let page = 1,
      total: number | undefined;
    for (;;) {
      const r = await this.call(
          `/zones/${zoneId}/dns_records?per_page=100&page=${page}&order=name&direction=asc`,
        ),
        info = r.result_info;
      if (
        !info ||
        info.page !== page ||
        info.per_page !== 100 ||
        (info.total_pages < 1 &&
          !(page === 1 && info.total_count === 0 && info.total_pages === 0)) ||
        (total !== undefined && total !== info.total_count)
      )
        throw new LanderDnsError(
          'DNS_PAGINATION',
          'The complete DNS zone could not be read consistently.',
        );
      total = info.total_count;
      const part = z.array(dnsRecordSchema).max(100).parse(r.result);
      if (page === 1 && info.total_count === 0 && !part.length) return [];
      bytes += new TextEncoder().encode(JSON.stringify(part)).length;
      if (bytes > 500000)
        throw new LanderDnsError(
          'DNS_SNAPSHOT_LIMIT',
          'The complete zone exceeds the encrypted snapshot limit. No records were truncated or changed.',
        );
      rows.push(...part);
      if (
        rows.length > 100000 ||
        new Set(rows.map((v) => v.id)).size !== rows.length
      )
        throw new LanderDnsError(
          'DNS_PAGINATION',
          'DNS record pagination is inconsistent or exceeds the explicit safety limit.',
        );
      if (page === info.total_pages) {
        if (rows.length !== total)
          throw new LanderDnsError(
            'DNS_PAGINATION',
            'DNS records changed during pagination.',
          );
        return rows;
      }
      if (!part.length || page >= 1000)
        throw new LanderDnsError(
          'DNS_PAGINATION',
          'The DNS zone read was incomplete.',
        );
      page++;
    }
  }
  async snapshot(domain: string, zoneId?: string): Promise<DnsSnapshot> {
    domain = canonicalDomain(domain);
    const credentials = getStoredCredentials(this.accountId),
      providerAccountId = idSchema.parse(credentials.accountId);
    const zoneSchema = z
      .object({
        id: idSchema,
        name: z.string(),
        status: z.literal('active'),
        type: z.literal('full'),
        account: z.object({ id: idSchema }),
        name_servers: z.array(z.string()).min(1),
      })
      .passthrough();
    let zone;
    if (zoneId)
      zone = zoneSchema.parse(
        (await this.call(`/zones/${idSchema.parse(zoneId)}`)).result,
      );
    else {
      const r = await this.call(
        `/zones?name=${encodeURIComponent(domain)}&account.id=${providerAccountId}&per_page=50&page=1`,
      );
      const rows = z.array(zoneSchema).max(50).parse(r.result);
      if (r.result_info?.total_count !== 1 || rows.length !== 1)
        throw new LanderDnsError(
          'DNS_ZONE',
          'An exact, unique authoritative zone is required.',
        );
      zone = rows[0];
    }
    const ns = (await resolveNameservers(domain, this.fetcher))
      .map(normalize)
      .sort();
    if (
      zone.name !== domain ||
      zone.account.id !== providerAccountId ||
      !ns.length ||
      canonicalJson(ns) !==
        canonicalJson(zone.name_servers.map(normalize).sort())
    )
      throw new LanderDnsError(
        'DNS_AUTHORITY',
        'Current nameservers must match this exact DNS account and zone. Empty evidence cannot authorize changes.',
      );
    const records = await this.records(zone.id);
    // Complete provider-side routing inspection is mandatory. Missing read
    // permission is a hold, never interpreted as an empty rule set.
    const rules = await this.call(`/zones/${zone.id}/rulesets`);
    const pageRules = await this.call(`/zones/${zone.id}/pagerules`);
    const ruleRows = z
      .array(z.object({ phase: z.string() }).passthrough())
      .parse(rules.result);
    if (
      ruleRows.some((r) =>
        [
          'http_request_dynamic_redirect',
          'http_request_redirect',
          'http_request_origin',
        ].includes(r.phase),
      ) ||
      z.array(z.unknown()).parse(pageRules.result).length
    )
      throw new LanderDnsError(
        'DNS_ROUTING',
        'Review existing provider forwarding and origin rules before connecting.',
      );
    const dnssec = z
      .record(z.string(), z.unknown())
      .parse((await this.call(`/zones/${zone.id}/dnssec`)).result);
    const settings = z
      .record(z.string(), z.unknown())
      .parse(
        (await this.call(`/zones/${zone.id}/settings/cname_flattening`)).result,
      );
    if (
      settings.value !== 'flatten_at_root' &&
      settings.value !== 'flatten_all'
    )
      throw new LanderDnsError(
        'DNS_APEX',
        'A qualified root-domain flattening configuration is required.',
      );
    return dnsSnapshotSchema.parse({
      provider: 'cloudflare',
      accountId: this.accountId,
      providerAccountId,
      zoneId: zone.id,
      domain,
      observedAt: Date.now(),
      nameservers: ns,
      records,
      dnssec,
      settings,
    });
  }
  async write(snapshot: DnsSnapshot, change: DnsChange): Promise<void> {
    // Caller persists intent and rechecks identity/generation before this call.
    if (change.before) {
      const path = `/zones/${snapshot.zoneId}/dns_records/${idSchema.parse(change.before.id)}`;
      if (!change.after) await this.call(path, 'DELETE');
      else await this.call(path, 'PATCH', writableRecord(change.after));
    } else if (change.after)
      await this.call(
        `/zones/${snapshot.zoneId}/dns_records`,
        'POST',
        writableRecord(change.after),
      );
  }
}
export async function discoverLanderZone(
  domain: string,
  fetcher?: typeof fetch,
): Promise<DnsSnapshot> {
  const matches: DnsSnapshot[] = [];
  for (const account of listAccounts().filter(
    (a) =>
      a.registrar === 'cloudflare' &&
      isRegistrarEnabled(a.id) &&
      getStoredCredentials(a.id).apiToken,
  )) {
    try {
      matches.push(
        await new LanderCloudflare(account.id, fetcher).snapshot(domain),
      );
    } catch (error) {
      if (
        error instanceof LanderDnsError &&
        ['DNS_ZONE', 'DNS_AUTHORITY'].includes(error.code)
      )
        continue;
      throw error;
    }
  }
  if (matches.length !== 1)
    throw new LanderDnsError(
      'DNS_ACCOUNT',
      matches.length
        ? 'Multiple DNS accounts can edit this zone. Resolve the account ambiguity.'
        : 'Connect the current authoritative Cloudflare DNS account. Other DNS providers are not qualified for automatic changes.',
    );
  return matches[0];
}
