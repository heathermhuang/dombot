import {
  claimHostname,
  releaseSalesHostname,
  rememberHostnameProvider,
} from './hostname-claims';
import { managedHosts, operatorHosts } from '../shared/sales-managed-control';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalDomain } from '../shared/publication';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { workspaceKey, workspaceFor, workspaceService } from './workspaces';

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
  next_check_at: number;
}

/** Renew only existing approved bindings. Never discover or activate private inventory. */
export async function refreshSalesHostnames(
  env: HostedEnv,
  fetcher?: typeof fetch,
) {
  if (env.SALES_CUSTOM_HOSTS_ENABLED !== 'true') return;
  const legacy = new Set(
    managedHosts(env.SALES_MANAGED_HOSTS).map((h) => h.hostname),
  );
  const policies = new Set(
    operatorHosts(env.SALES_OPERATOR_HOSTS).map((h) => h.hostname),
  );
  const names = (env.SALES_HOST_ALLOWLIST ?? '')
    .split(',')
    .filter((name) => !!name && (!legacy.has(name) || policies.has(name)));
  if (!names.length) return;
  const now = Date.now(),
    rows = await env.CONTROL_DB.prepare(
      "SELECT h.* FROM sales_hostnames h JOIN workspaces w ON w.id=h.workspace_id WHERE h.hostname IN (SELECT value FROM json_each(?)) AND h.status IN ('active','checking-page','pending-dns','pending-tls') AND h.next_check_at<=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id) ORDER BY h.next_check_at LIMIT 20",
    )
      .bind(JSON.stringify(names), now)
      .all<HostBinding>();
  const controller = new SalesHostnames(env, fetcher);
  for (const row of rows.results) {
    const claimed = await env.CONTROL_DB.prepare(
      'UPDATE sales_hostnames SET next_check_at=? WHERE hostname=? AND epoch=? AND next_check_at<=? RETURNING hostname',
    )
      .bind(now + 120_000, row.hostname, row.epoch, now)
      .first();
    if (!claimed) continue;
    try {
      const configured = await workspaceFor(env, row.workspace_id);
      if (!configured) throw Error('Account unavailable');
      const request = new Request(
        new URL(
          `/sales-internal/host-state?listing=${row.listing_id}`,
          env.CANONICAL_ORIGIN,
        ),
      );
      request.headers.set(
        PROOF_HEADER,
        await signGatewayRequest(
          await workspaceKey(env, row.workspace_id),
          row.workspace_id,
          null,
          request,
          { purpose: 'sales-hostnames' },
        ),
      );
      const response = await workspaceService(env, configured.binding).fetch(
        request,
      );
      if (!response.ok) throw Error('Publication unavailable');
      const value = z
        .object({
          published: z
            .object({ domain: z.string(), revision: z.string() })
            .nullable(),
        })
        .parse(await response.json());
      if (!value.published || value.published.domain !== row.domain) {
        await controller.detach(
          row.workspace_id,
          row.listing_id,
          row.hostname,
          row.epoch,
        );
        continue;
      }
      const plan = z
        .object({ proof: z.object({ value: z.string() }) })
        .passthrough()
        .parse(JSON.parse(row.plan));
      const challenge = plan.proof.value.replace(/^domains-sales=/, '');
      await controller.activate(
        row.workspace_id,
        row.listing_id,
        row.hostname,
        row.epoch,
        challenge,
        value.published.revision,
      );
    } catch {
      await env.CONTROL_DB.prepare(
        'UPDATE sales_hostnames SET next_check_at=? WHERE hostname=? AND epoch=?',
      )
        .bind(Date.now() + 120_000, row.hostname, row.epoch)
        .run();
    }
  }
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
  const prefix = ['_domains-sales.', '_domains-inquiry.'].find((p) =>
    host.startsWith(p),
  );
  host = prefix
    ? prefix + canonicalDomain(host.slice(prefix.length))
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
  const configured = await workspaceFor(env, workspace);
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
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      r,
      {
        purpose: 'sales-hostnames',
      },
    ),
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
    const policy = operatorHosts(this.env.SALES_OPERATOR_HOSTS).find(
      (v) => v.hostname === hostname,
    );
    if (policy && (policy.workspace !== workspace || policy.domain !== domain))
      throw Error('This hostname belongs to another account.');
    const managed = !policy
      ? managedHosts(this.env.SALES_MANAGED_HOSTS).find(
          (v) => v.hostname === hostname,
        )
      : undefined;
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
      controlMethod: managed
        ? 'managed-worker'
        : policy
          ? 'operator-worker'
          : 'dns-txt',
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
    const policy = operatorHosts(this.env.SALES_OPERATOR_HOSTS).find(
      (v) => v.hostname === hostname,
    );
    if (
      policy &&
      (policy.workspace !== workspace || policy.domain !== r.domain)
    )
      throw Error('This hostname belongs to another account.');
    const managed = !policy
      ? managedHosts(this.env.SALES_MANAGED_HOSTS).find(
          (v) => v.hostname === hostname,
        )
      : undefined;
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
      ) {
        if (r.status === 'active') {
          const lost = await this.env.CONTROL_DB.prepare(
            "UPDATE sales_hostnames SET status='control-lost',epoch=epoch+1,control_expires_at=0,updated_at=? WHERE hostname=? AND workspace_id=? AND epoch=? RETURNING epoch",
          )
            .bind(Date.now(), hostname, workspace, epoch)
            .first<{ epoch: number }>();
          if (lost)
            await bindingWrite(
              this.env,
              workspace,
              hostname,
              listing,
              lost.epoch,
              false,
            );
        }
        throw new Error('The domain-control TXT proof is not visible yet.');
      }
    }
    await claimHostname(
      this.env.CONTROL_DB,
      hostname,
      'sales',
      workspace,
      `${workspace}:${listing}:${epoch}`,
    );
    const providerSchema = z
      .object({
        id: z.string(),
        hostname: z.string(),
        status: z.string(),
        ssl: z.object({ status: z.string() }),
      })
      .passthrough();
    let provider;
    if (managed || policy) {
      provider = {
        id: (managed ?? policy)!.providerId,
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
    await rememberHostnameProvider(
      this.env.CONTROL_DB,
      hostname,
      'sales',
      `${workspace}:${listing}:${epoch}`,
      provider.id,
    );
    const ready =
      provider.status === 'active' && provider.ssl.status === 'active';
    const state = !ready
      ? provider.status === 'active'
        ? 'pending-tls'
        : 'pending-dns'
      : r.status === 'active' && r.control_expires_at > Date.now()
        ? 'active'
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
          state === 'active'
            ? r.control_expires_at
            : managed
              ? managed.expiresAt
              : Date.now() + 86400_000,
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
    if (!served.ok || observed !== revision) {
      await this.env.CONTROL_DB.prepare(
        "UPDATE sales_hostnames SET status='checking-page',control_expires_at=0,updated_at=? WHERE hostname=? AND workspace_id=? AND epoch=?",
      )
        .bind(Date.now(), hostname, workspace, epoch)
        .run();
      return {
        status: 'checking-page',
        error: 'The exact published revision is not served yet.',
      };
    }
    const updated = await this.env.CONTROL_DB.prepare(
      "UPDATE sales_hostnames SET status='active',observed_revision=?,updated_at=?,control_expires_at=?,next_check_at=? WHERE hostname=? AND workspace_id=? AND epoch=? AND status IN ('checking-page','active') RETURNING hostname",
    )
      .bind(
        revision,
        Date.now(),
        managed ? managed.expiresAt : Date.now() + 86400_000,
        Date.now() + 6 * 3600_000,
        hostname,
        workspace,
        epoch,
      )
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
    await releaseSalesHostname(
      this.env.CONTROL_DB,
      hostname,
      workspace,
      listing,
      epoch,
    );
    return { status: 'detached', epoch: r.epoch };
  }
}
