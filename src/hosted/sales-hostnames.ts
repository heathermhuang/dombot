import { managedHosts } from '../shared/sales-managed-control';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalDomain } from '../shared/publication';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { gatewayKey, workspaceSchema, workspaceService } from './workspaces';

export interface HostBinding {
  hostname: string;
  workspace_id: string;
  listing_id: string;
  domain: string;
  epoch: number;
  status: string;
  challenge_hash: string;
  provider_id: string | null;
  plan: string;
  updated_at: number;
  control_expires_at: number;
  observed_revision: string | null;
  provider_status: string | null;
  ssl_status: string | null;
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const dnsSchema = z.object({
  Status: z.number(),
  AD: z.boolean().optional(),
  Answer: z
    .array(
      z.object({
        name: z.string(),
        type: z.number(),
        TTL: z.number(),
        data: z.string(),
      }),
    )
    .optional(),
});
export async function salesDns(
  host: string,
  type: string,
  fetcher: typeof fetch = fetch,
) {
  host = host.startsWith('_domains-sales.')
    ? '_domains-sales.' + canonicalDomain(host.slice(15))
    : canonicalDomain(host);
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.search = new URLSearchParams({ name: host, type, do: 'true' }).toString();
  const r = await fetcher(url, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error('DNS observation unavailable');
  const data = dnsSchema.parse(await r.json());
  if (![0, 3].includes(data.Status))
    throw new Error('DNS validation failed. Check delegation and DNSSEC.');
  return {
    type,
    status: data.Status,
    authenticated: data.AD ?? false,
    answers: data.Answer ?? [],
  };
}
async function bindingWrite(
  env: HostedEnv,
  workspace: string,
  hostname: string,
  listing: string,
  epoch: number,
  enabled: boolean,
) {
  const configured = workspaceSchema
    .parse(JSON.parse(env.WORKSPACES))
    .find((w) => w.id === workspace);
  if (!configured) throw new Error('Workspace not configured');
  const r = new Request(
    new URL('/sales-internal/host-binding', env.CANONICAL_ORIGIN),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, listing, epoch, enabled }),
    },
  );
  r.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(gatewayKey(env, workspace), workspace, null, r, {
      purpose: 'sales-hostnames',
    }),
  );
  if (!(await workspaceService(env, configured.binding).fetch(r)).ok)
    throw new Error('Tenant binding update failed');
}
export class SalesHostnames {
  constructor(
    readonly env: HostedEnv,
    readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  async list(workspace: string, listing: string) {
    const rows = await this.env.CONTROL_DB.prepare(
      'SELECT * FROM sales_hostnames WHERE workspace_id=? AND listing_id=? ORDER BY hostname LIMIT 10',
    )
      .bind(workspace, listing)
      .all<HostBinding>();
    return rows.results.map((row) => {
      const r: Partial<HostBinding> = { ...row };
      delete r.challenge_hash;
      return { ...r, plan: JSON.parse(row.plan) };
    });
  }
  async plan(
    workspace: string,
    listing: string,
    hostname: string,
    domain: string,
  ) {
    hostname = canonicalDomain(hostname);
    domain = canonicalDomain(domain);
    if (hostname !== domain && hostname !== `www.${domain}`)
      throw new Error(
        'Only this listing’s exact domain or www alias can be claimed.',
      );
    const current = await this.env.CONTROL_DB.prepare(
      'SELECT * FROM sales_hostnames WHERE hostname=?',
    )
      .bind(hostname)
      .first<HostBinding>();
    if (
      current &&
      (current.workspace_id !== workspace || current.listing_id !== listing) &&
      current.status !== 'detached'
    )
      throw new Error('This hostname is already reserved.');
    if (
      current &&
      current.status !== 'detached' &&
      current.status !== 'pending-proof'
    )
      throw new Error(
        'Detach the existing binding before preparing a new claim.',
      );
    const managed = managedHosts(this.env.SALES_MANAGED_HOSTS).find(
      (v) => v.hostname === hostname,
    );
    if (
      managed &&
      (managed.workspace !== workspace || managed.domain !== domain)
    )
      throw new Error('This managed hostname belongs to another account.');
    if (
      managed &&
      (managed.observedAt > Date.now() || managed.expiresAt <= Date.now())
    )
      throw new Error(
        'The operator must renew the managed hostname observation.',
      );
    const epoch = (current?.epoch ?? 0) + 1,
      challenge = randomBytes(32).toString('base64url');
    const before = await Promise.all(
      ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA', 'NS', 'DS'].map((type) =>
        salesDns(hostname, type, this.fetcher),
      ),
    );
    const target = this.env.SALES_CNAME_TARGET
      ? canonicalDomain(this.env.SALES_CNAME_TARGET)
      : null;
    const plan = {
      hostname,
      epoch,
      observedAt: Date.now(),
      before,
      proof: {
        type: 'TXT',
        name: `_domains-sales.${hostname}`,
        value: `domains-sales=${challenge}`,
      },
      changes: target
        ? [
            {
              type: 'CNAME',
              name: hostname,
              target,
              prerequisite:
                'Apex requires qualified ALIAS/CNAME flattening or separately entitled apex proxying. No A-record target is inferred.',
            },
          ]
        : [],
      preserve: ['MX', 'TXT', 'CAA', 'NS', 'DS'],
      automaticDnsWrites: false,
      controlMethod: managed ? 'managed-worker' : 'dns-txt',
      rollback:
        'Detach this binding first, then restore only the exact A/AAAA/CNAME records in this snapshot if those records still equal your reviewed change. Keep unrelated later changes and mail/verification records.',
    };
    const row = await this.env.CONTROL_DB.prepare(
      "INSERT INTO sales_hostnames(hostname,workspace_id,listing_id,domain,epoch,status,challenge_hash,plan,updated_at) VALUES(?,?,?,?,?,'pending-proof',?,?,?) ON CONFLICT(hostname) DO UPDATE SET workspace_id=excluded.workspace_id,listing_id=excluded.listing_id,domain=excluded.domain,epoch=excluded.epoch,status=excluded.status,challenge_hash=excluded.challenge_hash,provider_id=NULL,plan=excluded.plan,updated_at=excluded.updated_at,control_expires_at=0,observed_revision=NULL WHERE sales_hostnames.epoch=? RETURNING hostname",
    )
      .bind(
        hostname,
        workspace,
        listing,
        domain,
        epoch,
        digest(challenge),
        JSON.stringify(plan),
        Date.now(),
        current?.epoch ?? 0,
      )
      .first();
    if (!row) throw new Error('The binding changed. Prepare a fresh plan.');
    return { ...plan, challenge };
  }
  async provider(path: string, body?: unknown): Promise<unknown> {
    if (!this.env.SALES_CF_ZONE_ID || !this.env.SALES_CF_API_TOKEN)
      throw new Error('Custom hostname provider access is not configured.');
    const r = await this.fetcher(
      `https://api.cloudflare.com/client/v4/zones/${this.env.SALES_CF_ZONE_ID}/custom_hostnames${path}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${this.env.SALES_CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
      },
    );
    if (!r.ok) throw new Error('Custom hostname provider refused the request.');
    const result = (await r.json()) as { success?: boolean; result?: unknown };
    if (!r.ok || !result.success)
      throw new Error(
        'Custom hostname provider refused the request. Check provider access and certificate/DNS settings.',
      );
    return result.result;
  }
  async activate(
    workspace: string,
    listing: string,
    hostname: string,
    epoch: number,
    challenge: string,
    revision: string,
  ) {
    if (
      this.env.SALES_CUSTOM_HOSTS_ENABLED !== 'true' ||
      !(this.env.SALES_HOST_ALLOWLIST ?? '').split(',').includes(hostname)
    )
      throw new Error(
        'This hostname has not been qualified for the controlled rollout.',
      );
    const r = await this.env.CONTROL_DB.prepare(
      'SELECT * FROM sales_hostnames WHERE hostname=? AND workspace_id=? AND listing_id=? AND epoch=?',
    )
      .bind(hostname, workspace, listing, epoch)
      .first<HostBinding>();
    if (!r || r.status === 'detached' || digest(challenge) !== r.challenge_hash)
      throw new Error('Hostname claim changed. Prepare a fresh plan.');
    const managed = managedHosts(this.env.SALES_MANAGED_HOSTS).find(
      (v) => v.hostname === hostname,
    );
    if (
      managed &&
      (managed.workspace !== workspace ||
        managed.domain !== r.domain ||
        managed.observedAt > Date.now() ||
        managed.expiresAt <= Date.now())
    )
      throw new Error(
        'The managed hostname observation is unavailable or expired.',
      );
    if (!managed) {
      const proof = await salesDns(
        `_domains-sales.${hostname}`,
        'TXT',
        this.fetcher,
      );
      if (
        !proof.answers.some(
          (a) =>
            a.type === 16 &&
            a.data.replaceAll('"', '') === `domains-sales=${challenge}`,
        )
      )
        throw new Error('The domain-control TXT proof is not visible yet.');
    }
    const providerSchema = z
      .object({
        id: z.string(),
        hostname: z.string(),
        status: z.string(),
        ssl: z.object({ status: z.string() }),
      })
      .passthrough();
    let provider;
    if (managed) {
      provider = {
        id: managed.providerId,
        hostname,
        status: 'active',
        ssl: { status: 'active' },
      };
    } else if (r.provider_id)
      provider = providerSchema.parse(await this.provider(`/${r.provider_id}`));
    else {
      // Reconcile any earlier ambiguous creation before issuing another request.
      const candidates = z
        .array(providerSchema)
        .parse(
          await this.provider(`?hostname=${encodeURIComponent(hostname)}`),
        );
      provider =
        candidates.find((v) => v.hostname === hostname) ??
        providerSchema.parse(
          await this.provider('', {
            hostname,
            ssl: {
              method: 'txt',
              type: 'dv',
              settings: { min_tls_version: '1.2' },
            },
          }),
        );
    }
    if (provider.hostname !== hostname)
      throw new Error('Provider hostname mismatch.');
    const ready =
      provider.status === 'active' && provider.ssl.status === 'active';
    const state = !ready
      ? provider.status === 'active'
        ? 'pending-tls'
        : 'pending-dns'
      : 'checking-page';
    if (
      !(await this.env.CONTROL_DB.prepare(
        'UPDATE sales_hostnames SET provider_id=?,provider_status=?,ssl_status=?,status=?,updated_at=?,control_expires_at=? WHERE hostname=? AND workspace_id=? AND epoch=? RETURNING hostname',
      )
        .bind(
          provider.id,
          provider.status,
          provider.ssl.status,
          state,
          Date.now(),
          managed ? managed.expiresAt : Date.now() + 86400_000,
          hostname,
          workspace,
          epoch,
        )
        .first())
    )
      throw new Error('Binding changed during activation.');
    if (!ready)
      return {
        status: state,
        providerStatus: provider.status,
        sslStatus: provider.ssl.status,
      };
    await bindingWrite(this.env, workspace, hostname, listing, epoch, true);
    // The edge allows checking-page only for a signed controller probe, handled by the registry status below.
    const probe = new Request(`https://${hostname}/`, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const edgeKey = z
      .record(z.string().min(32))
      .parse(JSON.parse(this.env.SALES_EDGE_KEYS ?? '{}'))[workspace];
    if (!edgeKey) throw new Error('Public edge admission is not configured.');
    probe.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(edgeKey, workspace, null, probe, {
        purpose: 'sales-public',
        host: hostname,
        listing,
        epoch,
      }),
    );
    const served = await this.fetcher(probe);
    const observed = served.headers.get('X-Domains-Sales-Revision');
    if (!served.ok || observed !== revision)
      return {
        status: 'checking-page',
        error: 'The exact published revision is not served yet.',
      };
    const updated = await this.env.CONTROL_DB.prepare(
      "UPDATE sales_hostnames SET status='active',observed_revision=?,updated_at=? WHERE hostname=? AND workspace_id=? AND epoch=? AND status='checking-page' RETURNING hostname",
    )
      .bind(revision, Date.now(), hostname, workspace, epoch)
      .first();
    if (!updated) throw new Error('Binding changed during page verification.');
    return { status: 'active', revision, epoch };
  }
  async detach(
    workspace: string,
    listing: string,
    hostname: string,
    epoch: number,
  ) {
    const r = await this.env.CONTROL_DB.prepare(
      "UPDATE sales_hostnames SET status='detached',epoch=epoch+1,control_expires_at=0,updated_at=? WHERE hostname=? AND workspace_id=? AND listing_id=? AND epoch=? RETURNING epoch",
    )
      .bind(Date.now(), hostname, workspace, listing, epoch)
      .first<{ epoch: number }>();
    if (!r) throw new Error('Binding changed. Reload before detaching.');
    await bindingWrite(this.env, workspace, hostname, listing, r.epoch, false);
    return { status: 'detached', epoch: r.epoch };
  }
}
