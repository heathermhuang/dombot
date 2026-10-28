import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';

export interface DnsInstruction {
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
}
export class DomainInputError extends Error {}
export class DomainServiceError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
const jsonProviderSchema = z.object({
  success: z.boolean(),
  result: z.unknown(),
  result_info: z
    .object({ total_count: z.number().int().nonnegative() })
    .optional(),
});
const providerSchema = z
  .object({
    id: z.string().uuid(),
    hostname: z.string(),
    status: z.string(),
    ssl: z.object({
      status: z.string(),
      validation_records: z
        .array(
          z
            .object({
              txt_name: z.string().optional(),
              txt_value: z.string().optional(),
            })
            .passthrough(),
        )
        .max(20)
        .optional(),
    }),
    ownership_verification: z
      .object({ type: z.string(), name: z.string(), value: z.string() })
      .optional(),
  })
  .passthrough();
export type CertificateState = z.infer<typeof providerSchema>;
export class PortfolioDomainProvider {
  readonly fetcher: typeof fetch;
  constructor(
    readonly env: HostedEnv,
    fetcher?: typeof fetch,
  ) {
    this.fetcher = fetcher ?? globalThis.fetch.bind(globalThis);
  }
  async call(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<{ result?: unknown; result_info?: { total_count: number } }> {
    if (
      !this.env.PORTFOLIO_CF_API_TOKEN ||
      !/^[a-f0-9]{32}$/.test(this.env.PORTFOLIO_CF_ZONE_ID ?? '')
    )
      throw new DomainServiceError('provider-unavailable');
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.cloudflare.com/client/v4/zones/${this.env.PORTFOLIO_CF_ZONE_ID}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.env.PORTFOLIO_CF_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      throw new DomainServiceError('provider-unavailable', method !== 'GET');
    }
    if (method === 'DELETE' && response.status === 404) return { result: null };
    if (response.status === 404)
      throw new DomainServiceError('provider-not-found');
    if (!response.ok)
      throw new DomainServiceError(
        'provider-unavailable',
        method !== 'GET' && response.status >= 500,
      );
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new DomainServiceError('provider-unavailable', method !== 'GET');
    }
    const parsed = jsonProviderSchema.safeParse(value);
    if (!parsed.success || !parsed.data.success)
      throw new DomainServiceError('provider-unavailable', method !== 'GET');
    return parsed.data;
  }
  certificate(value: unknown, hostname: string): CertificateState {
    const parsed = providerSchema.safeParse(value);
    if (!parsed.success || parsed.data.hostname !== hostname)
      throw new DomainServiceError('provider-mismatch');
    return parsed.data;
  }
  async findCertificate(hostname: string) {
    const result = await this.call(
      '/custom_hostnames?hostname=' + encodeURIComponent(hostname),
    );
    const rows = z.array(z.unknown()).max(100).parse(result.result);
    return rows.map((row) => this.certificate(row, hostname));
  }
  async getCertificate(id: string, hostname: string) {
    return this.certificate(
      (await this.call('/custom_hostnames/' + z.string().uuid().parse(id)))
        .result,
      hostname,
    );
  }
  async createCertificate(hostname: string) {
    const count = await this.call('/custom_hostnames?per_page=1');
    if (count.result_info === undefined || count.result_info.total_count >= 100)
      throw new DomainServiceError('capacity');
    try {
      return this.certificate(
        (
          await this.call('/custom_hostnames', 'POST', {
            hostname,
            ssl: {
              method: 'txt',
              type: 'dv',
              settings: { min_tls_version: '1.2' },
            },
          })
        ).result,
        hostname,
      );
    } catch (error) {
      if (
        error instanceof DomainServiceError &&
        !error.uncertain &&
        ['capacity', 'provider-unavailable'].includes(error.code)
      )
        throw error;
      throw new DomainServiceError('provider-mismatch', true);
    }
  }
  async routes() {
    const value = (await this.call('/workers/routes')).result;
    return z
      .array(
        z.object({
          id: z.string(),
          pattern: z.string(),
          script: z.string().nullable().optional(),
        }),
      )
      .max(2000)
      .parse(value);
  }
  async createRoute(hostname: string) {
    const value = (
      await this.call('/workers/routes', 'POST', {
        pattern: hostname + '/*',
        script: this.env.PORTFOLIO_EDGE_WORKER,
      })
    ).result;
    try {
      return z
        .object({ id: z.string(), pattern: z.string(), script: z.string() })
        .refine(
          (r) =>
            r.pattern === hostname + '/*' &&
            r.script === this.env.PORTFOLIO_EDGE_WORKER,
        )
        .parse(value);
    } catch {
      throw new DomainServiceError('provider-mismatch', true);
    }
  }
  async deleteRoute(id: string, hostname: string) {
    const found = (await this.routes()).find((r) => r.id === id);
    if (!found) return;
    if (
      found.pattern !== hostname + '/*' ||
      found.script !== this.env.PORTFOLIO_EDGE_WORKER
    )
      throw new DomainServiceError('provider-mismatch');
    await this.call('/workers/routes/' + encodeURIComponent(id), 'DELETE');
  }
  async deleteCertificate(id: string, hostname: string) {
    let current;
    try {
      current = await this.getCertificate(id, hostname);
    } catch (error) {
      if (
        error instanceof DomainServiceError &&
        error.code === 'provider-not-found'
      )
        return;
      throw error;
    }
    if (current.hostname !== hostname)
      throw new DomainServiceError('provider-mismatch');
    await this.call('/custom_hostnames/' + id, 'DELETE');
  }
}
export function certificateInstructions(
  provider: CertificateState,
  hostname: string,
): DnsInstruction[] {
  const rows: DnsInstruction[] = [];
  const add = (name: string, value: string) => {
    name = name.toLowerCase().replace(/\.$/, '');
    if (
      ![
        `_cf-custom-hostname.${hostname}`,
        `_acme-challenge.${hostname}`,
      ].includes(name) ||
      value.length > 2048 ||
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new DomainServiceError('provider-mismatch');
    rows.push({ type: 'TXT', name, value });
  };
  const own = provider.ownership_verification;
  if (own) {
    if (own.type !== 'txt') throw new DomainServiceError('provider-mismatch');
    add(own.name, own.value);
  }
  for (const record of provider.ssl.validation_records ?? [])
    if (record.txt_name && record.txt_value)
      add(record.txt_name, record.txt_value);
  return rows;
}
export async function observePortfolioDns(
  hostname: string,
  type: string,
  fetcher: typeof fetch,
) {
  const name = hostname.startsWith('_domains-portfolio.')
    ? '_domains-portfolio.' +
      canonicalDomain(hostname.slice('_domains-portfolio.'.length))
    : canonicalDomain(hostname);
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.search = new URLSearchParams({ name, type, do: 'true' }).toString();
  let response;
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/dns-json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new DomainServiceError('dns-unavailable');
  }
  if (!response.ok) throw new DomainServiceError('dns-unavailable');
  const parsed = z
    .object({
      Status: z.number(),
      Answer: z
        .array(z.object({ type: z.number(), data: z.string().max(4096) }))
        .max(64)
        .optional(),
    })
    .safeParse(await response.json());
  if (!parsed.success || ![0, 3].includes(parsed.data.Status))
    throw new DomainServiceError('dns-unavailable');
  return parsed.data.Answer ?? [];
}
