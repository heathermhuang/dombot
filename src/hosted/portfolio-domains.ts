import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import type {
  PortfolioDomainStatus,
  PortfolioDomainsState,
  PortfolioDomainPlan,
} from '../shared/portfolio-domains';
import {
  claimHostname,
  HostnameClaimError,
  ownsHostname,
  releaseHostname,
  rememberHostnameProvider,
} from './hostname-claims';
import { forwardPublicSite } from './public-site-forward';
import {
  PortfolioDomainProvider,
  DomainServiceError,
  DomainInputError,
  certificateInstructions,
  observePortfolioDns,
} from './portfolio-domain-provider';

export const PORTFOLIO_DOMAIN_LIMIT = 20;
const LEASE_MS = 3600000;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
interface DomainPlanRow {
  workspace_id: string;
  revision: string;
  hostname: string;
  challenge: string;
  plan: string;
  created_at: number;
}
export interface PortfolioHostnameRow {
  hostname: string;
  workspace_id: string;
  epoch: number;
  owner_key: string;
  plan_revision: string;
  challenge: string;
  status: PortfolioDomainStatus;
  provider_id: string | null;
  route_id: string | null;
  operation: string | null;
  check_generation: number;
  probe_hash: string | null;
  verification_url: string | null;
  provider_records: string;
  last_error: string | null;
  control_expires_at: number;
  next_check_at: number;
  observed_revision: string | null;
  created_at: number;
  updated_at: number;
}
const messages: Record<string, string> = {
  'dns-proof': 'The ownership TXT record is not visible yet.',
  'dns-unavailable':
    'DNS could not be checked. Check delegation and try again.',
  'not-published':
    'Choose a short public address and publish your profile before connecting a domain.',
  'provider-unavailable':
    'The domain service is temporarily unavailable. Try again later.',
  'provider-mismatch': 'The domain service needs to review this setup.',
  'needs-review':
    'A previous setup request needs a service-side check before it can continue.',
  capacity: 'Custom-domain capacity is currently full.',
  stale: 'The domain setup changed. Reload before trying again.',
  'not-ready': 'Custom domains are not available yet.',
  paused:
    'Custom domain connections are paused. Your short portfolio link still works.',
  'lease-expired':
    'Connection verification expired. Check the domain connection again.',
};
export function domainMessage(error: unknown) {
  if (error instanceof DomainInputError) return error.message;
  return error instanceof DomainServiceError
    ? (messages[error.code] ?? messages['provider-unavailable'])
    : messages['provider-unavailable'];
}
export function portfolioDomainsEnabled(env: HostedEnv) {
  return env.PORTFOLIO_CUSTOM_HOSTS_ENABLED === 'true';
}
export function portfolioProviderConfigured(env: HostedEnv) {
  try {
    const origin = new URL(env.CANONICAL_ORIGIN ?? '');
    return (
      origin.protocol === 'https:' &&
      origin.origin === env.CANONICAL_ORIGIN &&
      !!env.PORTFOLIO_CF_API_TOKEN &&
      /^[a-f0-9]{32}$/.test(env.PORTFOLIO_CF_ZONE_ID ?? '') &&
      !!env.PORTFOLIO_CNAME_TARGET &&
      /^[a-z0-9][a-z0-9_-]{0,62}$/.test(env.PORTFOLIO_EDGE_WORKER ?? '')
    );
  } catch {
    return false;
  }
}

export function portfolioDomainsReady(env: HostedEnv) {
  return portfolioDomainsEnabled(env) && portfolioProviderConfigured(env);
}
export function portfolioWorkspaceAllowed(env: HostedEnv, workspace: string) {
  try {
    const list = z
      .array(z.union([z.literal('*'), z.string().uuid()]))
      .max(1000)
      .parse(JSON.parse(env.PORTFOLIO_HOST_WORKSPACES ?? '[]'));
    return list.includes('*') || list.includes(workspace);
  } catch {
    return false;
  }
}
export function portfolioHostname(raw: string, env: HostedEnv) {
  let hostname: string;
  try {
    hostname = canonicalDomain(raw.trim().toLowerCase().replace(/\.$/, ''));
  } catch {
    throw new DomainInputError(
      'Enter a domain name without a URL path or port.',
    );
  }
  const base = new URL(env.CANONICAL_ORIGIN ?? 'https://domains.domains')
    .hostname;
  if (
    hostname === base ||
    hostname.endsWith('.' + base) ||
    hostname.endsWith('.workers.dev') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname === env.PORTFOLIO_CNAME_TARGET
  )
    throw new DomainInputError(
      'Choose your own domain or subdomain, without a URL path or port. Platform hostnames cannot be connected.',
    );
  return hostname;
}
export async function activePortfolioHostname(
  env: HostedEnv,
  workspace: string,
) {
  if (
    !portfolioDomainsEnabled(env) ||
    !portfolioWorkspaceAllowed(env, workspace)
  )
    return null;
  return env.CONTROL_DB.prepare(
    "SELECT h.hostname FROM portfolio_hostnames h JOIN public_hostname_claims c ON c.hostname=h.hostname AND c.kind='portfolio' AND c.owner_key=h.owner_key AND c.held=1 WHERE h.workspace_id=? AND h.status='active' AND h.control_expires_at>?",
  )
    .bind(workspace, Date.now())
    .first<{ hostname: string }>();
}
export class PortfolioDomains {
  readonly provider: PortfolioDomainProvider;
  constructor(
    readonly env: HostedEnv,
    fetcher?: typeof fetch,
  ) {
    this.provider = new PortfolioDomainProvider(env, fetcher);
  }
  private async planRow(workspace: string) {
    return this.env.CONTROL_DB.prepare(
      'SELECT * FROM portfolio_domain_plans WHERE workspace_id=?',
    )
      .bind(workspace)
      .first<DomainPlanRow>();
  }
  async binding(workspace: string) {
    return this.env.CONTROL_DB.prepare(
      "SELECT * FROM portfolio_hostnames WHERE workspace_id=? AND status!='detached'",
    )
      .bind(workspace)
      .first<PortfolioHostnameRow>();
  }
  async state(workspace: string): Promise<PortfolioDomainsState> {
    const enabled =
      portfolioDomainsReady(this.env) &&
      portfolioWorkspaceAllowed(this.env, workspace);
    if (
      !enabled &&
      !(await this.env.CONTROL_DB.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='portfolio_hostnames'",
      ).first())
    )
      return { enabled: false, plan: null, domain: null };
    const [plan, domain] = await Promise.all([
      this.planRow(workspace),
      this.binding(workspace),
    ]);
    const paused =
      !portfolioDomainsEnabled(this.env) ||
      !portfolioWorkspaceAllowed(this.env, workspace);
    const expired =
      !!domain &&
      ['active', 'checking'].includes(domain.status) &&
      domain.control_expires_at <= Date.now();
    return {
      enabled,
      plan: plan ? (JSON.parse(plan.plan) as PortfolioDomainPlan) : null,
      domain: domain
        ? {
            hostname: domain.hostname,
            epoch: domain.epoch,
            status:
              (paused &&
                !['detaching', 'needs-review'].includes(domain.status)) ||
              expired
                ? 'blocked'
                : domain.status,
            records: JSON.parse(domain.provider_records),
            needsServiceReview:
              domain.status === 'needs-review' ||
              domain.last_error === 'needs-review' ||
              !!domain.operation,
            verificationUrl: paused || expired ? null : domain.verification_url,
            message:
              paused && !['detaching', 'needs-review'].includes(domain.status)
                ? messages.paused
                : expired
                  ? messages['lease-expired']
                  : domain.last_error
                    ? (messages[domain.last_error] ??
                      messages['provider-unavailable'])
                    : null,
          }
        : null,
    };
  }
  async plan(
    workspace: string,
    raw: string,
    expectedRevision: string | null = null,
  ) {
    if (
      !portfolioDomainsReady(this.env) ||
      !portfolioWorkspaceAllowed(this.env, workspace)
    )
      throw new DomainServiceError('not-ready');
    const hostname = portfolioHostname(raw, this.env),
      bound = await this.binding(workspace);
    if (bound) {
      if (bound.hostname === hostname) return this.state(workspace);
      throw new DomainInputError(
        'Remove the current domain before connecting another one. Your short portfolio link will keep working.',
      );
    }
    const target = canonicalDomain(this.env.PORTFOLIO_CNAME_TARGET!);
    const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA', 'NS', 'DS'];
    const answers = await Promise.all(
      types.map((type) =>
        observePortfolioDns(hostname, type, this.provider.fetcher),
      ),
    );
    const revision = crypto.randomUUID(),
      challenge = opaque(),
      createdAt = Date.now();
    const plan: PortfolioDomainPlan = {
      hostname,
      revision,
      createdAt,
      records: [
        {
          type: 'TXT',
          name: '_domains-portfolio.' + hostname,
          value: 'domains-portfolio=' + challenge,
        },
        { type: 'CNAME', name: hostname, value: target },
      ],
      dnsBefore: Object.fromEntries(types.map((type, i) => [type, answers[i]])),
    };
    const changed = await this.env.CONTROL_DB.prepare(
      `INSERT INTO portfolio_domain_plans(workspace_id,revision,hostname,challenge,plan,created_at)
      SELECT ?1,?2,?3,?4,?5,?6 FROM workspaces w WHERE w.id=?1 AND w.enabled=1
      AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
      AND NOT EXISTS(SELECT 1 FROM portfolio_hostnames h WHERE h.workspace_id=w.id AND h.status!='detached')
      AND (?7 IS NULL OR EXISTS(SELECT 1 FROM portfolio_domain_plans p WHERE p.workspace_id=w.id AND p.revision=?7))
      ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision,hostname=excluded.hostname,challenge=excluded.challenge,plan=excluded.plan,created_at=excluded.created_at
      WHERE portfolio_domain_plans.revision=?7 RETURNING workspace_id`,
    )
      .bind(
        workspace,
        revision,
        hostname,
        challenge,
        JSON.stringify(plan),
        createdAt,
        expectedRevision,
      )
      .first();
    if (!changed) throw new DomainServiceError('stale');
    return this.state(workspace);
  }
  private async proof(hostname: string, challenge: string) {
    const rows = await observePortfolioDns(
      '_domains-portfolio.' + hostname,
      'TXT',
      this.provider.fetcher,
    );
    if (
      !rows.some(
        (r) =>
          r.type === 16 &&
          r.data.replaceAll('"', '') === 'domains-portfolio=' + challenge,
      )
    )
      throw new DomainServiceError('dns-proof');
  }
  private async published(workspace: string) {
    const address = await this.env.CONTROL_DB.prepare(
      'SELECT handle FROM portfolio_addresses WHERE workspace_id=?',
    )
      .bind(workspace)
      .first<{ handle: string }>();
    if (!address) throw new DomainServiceError('not-published');
    const response = await forwardPublicSite(
      this.env,
      workspace,
      new URL('/' + address.handle, this.env.CANONICAL_ORIGIN),
    );
    const revision = response.headers.get('X-Domains-Public-Revision');
    await response.body?.cancel();
    if (!response.ok || !z.string().uuid().safeParse(revision).success)
      throw new DomainServiceError('not-published');
    return revision!;
  }
  private async update(
    row: PortfolioHostnameRow,
    sql: string,
    params: unknown[] = [],
  ) {
    const changed = await this.env.CONTROL_DB.prepare(
      sql +
        ` WHERE hostname=? AND workspace_id=? AND epoch=?${row.status === 'detaching' ? " AND status='detaching'" : " AND status NOT IN ('detaching','detached') AND check_generation=?"} RETURNING hostname`,
    )
      .bind(
        ...params,
        row.hostname,
        row.workspace_id,
        row.epoch,
        ...(row.status === 'detaching' ? [] : [row.check_generation]),
      )
      .first();
    if (!changed) throw new DomainServiceError('stale');
  }
  private async newBinding(workspace: string, plan: DomainPlanRow) {
    const previous = await this.env.CONTROL_DB.prepare(
      'SELECT epoch,status FROM portfolio_hostnames WHERE hostname=?',
    )
      .bind(plan.hostname)
      .first<{ epoch: number; status: string }>();
    if (previous && previous.status !== 'detached')
      throw new DomainInputError('This domain is already connected.');
    const epoch = (previous?.epoch ?? 0) + 1,
      ownerKey = `${workspace}:${epoch}:${plan.revision}`;
    try {
      await claimHostname(
        this.env.CONTROL_DB,
        plan.hostname,
        'portfolio',
        workspace,
        ownerKey,
        PORTFOLIO_DOMAIN_LIMIT,
      );
    } catch (error) {
      if (error instanceof HostnameClaimError)
        throw new DomainInputError(error.message);
      throw error;
    }
    let changed = false;
    try {
      changed = !!(await this.env.CONTROL_DB.prepare(
        `INSERT INTO portfolio_hostnames(hostname,workspace_id,epoch,owner_key,plan_revision,challenge,status,created_at,updated_at)
        SELECT ?1,?2,?3,?4,?5,?6,'pending-certificate',?7,?7 FROM portfolio_domain_plans p JOIN workspaces w ON w.id=p.workspace_id
        WHERE p.workspace_id=?2 AND p.revision=?5 AND p.hostname=?1 AND w.enabled=1
          AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
        ON CONFLICT(hostname) DO UPDATE SET workspace_id=excluded.workspace_id,epoch=excluded.epoch,owner_key=excluded.owner_key,plan_revision=excluded.plan_revision,challenge=excluded.challenge,status=excluded.status,provider_id=NULL,route_id=NULL,operation=NULL,probe_hash=NULL,verification_url=NULL,provider_records='[]',last_error=NULL,control_expires_at=0,next_check_at=0,observed_revision=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at
        WHERE portfolio_hostnames.status='detached' AND portfolio_hostnames.epoch=?8 RETURNING hostname`,
      )
        .bind(
          plan.hostname,
          workspace,
          epoch,
          ownerKey,
          plan.revision,
          plan.challenge,
          Date.now(),
          previous?.epoch ?? 0,
        )
        .first());
    } catch {
      /* Read back the exact binding before releasing or retrying anything. */
    }
    const current = await this.binding(workspace);
    if (current?.owner_key === ownerKey) return current;
    if (!changed)
      await releaseHostname(
        this.env.CONTROL_DB,
        plan.hostname,
        'portfolio',
        ownerKey,
      );
    throw new DomainServiceError('stale');
  }
  private async queueRemoval(row: PortfolioHostnameRow) {
    await this.env.CONTROL_DB.prepare(
      "UPDATE portfolio_hostnames SET next_check_at=? WHERE hostname=? AND workspace_id=? AND epoch=? AND status='detaching' AND operation IS NULL",
    )
      .bind(Date.now(), row.hostname, row.workspace_id, row.epoch)
      .run();
  }
  private async startOperation(
    row: PortfolioHostnameRow,
    kind: 'certificate' | 'route',
  ) {
    const operation = kind + ':' + opaque();
    const result = await this.env.CONTROL_DB.prepare(
      "UPDATE portfolio_hostnames SET operation=?,updated_at=? WHERE hostname=? AND workspace_id=? AND epoch=? AND check_generation=? AND operation IS NULL AND status NOT IN ('detaching','detached','needs-review') RETURNING hostname",
    )
      .bind(
        operation,
        Date.now(),
        row.hostname,
        row.workspace_id,
        row.epoch,
        row.check_generation,
      )
      .first();
    return result ? operation : null;
  }
  async verify(workspace: string, hostname: string, revision: string) {
    if (
      !portfolioDomainsReady(this.env) ||
      !portfolioWorkspaceAllowed(this.env, workspace)
    )
      throw new DomainServiceError('not-ready');
    const plan = await this.planRow(workspace);
    if (!plan || plan.hostname !== hostname || plan.revision !== revision)
      throw new DomainServiceError('stale');
    let row = await this.binding(workspace);
    if (row?.hostname !== hostname && row)
      throw new DomainServiceError('stale');
    if (!row && Date.now() - plan.created_at > 86400000)
      throw new DomainInputError(
        'Prepare a new domain setup before trying again.',
      );
    if (
      row?.status === 'needs-review' ||
      row?.operation ||
      row?.status === 'detaching'
    )
      return this.state(workspace);
    if (row) {
      const checked = await this.env.CONTROL_DB.prepare(
        "UPDATE portfolio_hostnames SET check_generation=check_generation+1 WHERE hostname=? AND epoch=? AND operation IS NULL AND status NOT IN ('detaching','detached','needs-review') RETURNING *",
      )
        .bind(hostname, row.epoch)
        .first<PortfolioHostnameRow>();
      if (!checked) return this.state(workspace);
      row = checked;
    }
    await this.published(workspace);
    try {
      await this.proof(hostname, plan.challenge);
    } catch (error) {
      if (
        row &&
        error instanceof DomainServiceError &&
        error.code === 'dns-proof'
      )
        await this.update(
          row,
          "UPDATE portfolio_hostnames SET status='blocked',control_expires_at=0,last_error=?,updated_at=?",
          [
            error instanceof DomainServiceError
              ? error.code
              : 'dns-unavailable',
            Date.now(),
          ],
        );
      throw error;
    }
    if (!row) row = await this.newBinding(workspace, plan);
    if (
      !(await ownsHostname(
        this.env.CONTROL_DB,
        hostname,
        'portfolio',
        row.owner_key,
      ))
    )
      throw new DomainServiceError('stale');
    try {
      if (!row.provider_id) {
        const operation = await this.startOperation(row, 'certificate');
        if (!operation) return this.state(workspace);
        let writeStarted = false;
        let resourceReturned = false;
        try {
          const existing = await this.provider.findCertificate(hostname);
          const managed = await this.env.CONTROL_DB.prepare(
            "SELECT provider_id FROM public_hostname_claims WHERE hostname=? AND kind='portfolio' AND owner_key=? AND held=1",
          )
            .bind(hostname, row.owner_key)
            .first<{ provider_id: string | null }>();
          // Reuse only a known managed certificate after fresh DNS proof. Unknown
          // creations retain their operation marker and require reconciliation.
          if (
            existing.length &&
            (existing.length !== 1 || existing[0].id !== managed?.provider_id)
          )
            throw new DomainServiceError('provider-mismatch');
          writeStarted = true;
          const provider =
            existing[0] ?? (await this.provider.createCertificate(hostname));
          resourceReturned = true;
          await this.env.CONTROL_DB.prepare(
            "UPDATE portfolio_hostnames SET provider_id=?,provider_records=?,operation=NULL,status=CASE WHEN status='detaching' THEN status ELSE 'pending-certificate' END,last_error=NULL,updated_at=? WHERE hostname=? AND epoch=? AND operation=?",
          )
            .bind(
              provider.id,
              JSON.stringify(certificateInstructions(provider, hostname)),
              Date.now(),
              hostname,
              row.epoch,
              operation,
            )
            .run();
          await rememberHostnameProvider(
            this.env.CONTROL_DB,
            hostname,
            'portfolio',
            row.owner_key,
            provider.id,
          );
        } catch (error) {
          const uncertain =
            resourceReturned ||
            (error instanceof DomainServiceError
              ? error.uncertain
              : writeStarted);
          await this.env.CONTROL_DB.prepare(
            "UPDATE portfolio_hostnames SET status=CASE WHEN status='detaching' THEN status ELSE ? END,operation=?,last_error=?,updated_at=? WHERE hostname=? AND epoch=? AND operation=?",
          )
            .bind(
              uncertain ? 'needs-review' : 'blocked',
              uncertain ? operation : null,
              error instanceof DomainServiceError
                ? error.code
                : 'provider-unavailable',
              Date.now(),
              hostname,
              row.epoch,
              operation,
            )
            .run();
          throw error;
        } finally {
          await this.queueRemoval(row);
        }
        return this.state(workspace);
      }
      const provider = await this.provider.getCertificate(
          row.provider_id,
          hostname,
        ),
        records = certificateInstructions(provider, hostname);
      await this.update(
        row,
        'UPDATE portfolio_hostnames SET provider_records=?,updated_at=?',
        [JSON.stringify(records), Date.now()],
      );
      if (provider.status !== 'active' || provider.ssl.status !== 'active') {
        await this.update(
          row,
          "UPDATE portfolio_hostnames SET status='pending-certificate',control_expires_at=0,last_error=NULL,updated_at=?",
          [Date.now()],
        );
        return this.state(workspace);
      }
      if (!row.route_id) {
        const operation = await this.startOperation(row, 'route');
        if (!operation) return this.state(workspace);
        let writeStarted = false;
        try {
          if (
            (await this.provider.routes()).some(
              (r) => r.pattern === hostname + '/*',
            )
          )
            throw new DomainServiceError('provider-mismatch');
          writeStarted = true;
          const route = await this.provider.createRoute(hostname);
          await this.env.CONTROL_DB.prepare(
            "UPDATE portfolio_hostnames SET route_id=?,operation=NULL,status=CASE WHEN status='detaching' THEN status ELSE 'pending-routing' END,updated_at=? WHERE hostname=? AND epoch=? AND operation=?",
          )
            .bind(route.id, Date.now(), hostname, row.epoch, operation)
            .run();
        } catch (error) {
          const uncertain =
            error instanceof DomainServiceError
              ? error.uncertain
              : writeStarted;
          await this.env.CONTROL_DB.prepare(
            "UPDATE portfolio_hostnames SET status=CASE WHEN status='detaching' THEN status ELSE ? END,operation=?,last_error=?,updated_at=? WHERE hostname=? AND epoch=? AND operation=?",
          )
            .bind(
              uncertain ? 'needs-review' : 'blocked',
              uncertain ? operation : null,
              error instanceof DomainServiceError
                ? error.code
                : 'provider-unavailable',
              Date.now(),
              hostname,
              row.epoch,
              operation,
            )
            .run();
          throw error;
        } finally {
          await this.queueRemoval(row);
        }
        row = await this.binding(workspace);
        if (!row) return this.state(workspace);
      }
      if (row.status === 'detaching') return this.state(workspace);
      const route = (await this.provider.routes()).find(
        (r) => r.id === row!.route_id,
      );
      if (
        !route ||
        route.pattern !== hostname + '/*' ||
        route.script !== this.env.PORTFOLIO_EDGE_WORKER
      )
        throw new DomainServiceError('provider-mismatch');
      if (row.status === 'active') {
        await this.update(
          row,
          'UPDATE portfolio_hostnames SET control_expires_at=?,next_check_at=?,last_error=NULL,updated_at=?',
          [Date.now() + LEASE_MS, Date.now() + 900000, Date.now()],
        );
        return this.state(workspace);
      }
      if (row.status === 'checking' && row.control_expires_at > Date.now())
        return this.state(workspace);
      const nonce = opaque(),
        url = `https://${hostname}/?__portfolio_check=${nonce}`;
      await this.update(
        row,
        "UPDATE portfolio_hostnames SET status='checking',probe_hash=?,verification_url=?,control_expires_at=?,last_error=NULL,updated_at=?",
        [digest(nonce), url, Date.now() + LEASE_MS, Date.now()],
      );
      return this.state(workspace);
    } catch (error) {
      if (
        row &&
        error instanceof DomainServiceError &&
        !error.uncertain &&
        ['provider-mismatch', 'provider-not-found'].includes(error.code)
      ) {
        await this.env.CONTROL_DB.prepare(
          "UPDATE portfolio_hostnames SET status='blocked',control_expires_at=0,last_error=?,updated_at=? WHERE hostname=? AND epoch=? AND check_generation=? AND status IN ('active','checking') AND operation IS NULL",
        )
          .bind(
            error.code,
            Date.now(),
            hostname,
            row.epoch,
            row.check_generation,
          )
          .run();
      }
      if (error instanceof DomainServiceError) throw error;
      throw new DomainServiceError('provider-unavailable');
    }
  }
  async detach(workspace: string, hostname: string, epoch: number) {
    const row = await this.binding(workspace);
    if (!row || row.hostname !== hostname || row.epoch !== epoch)
      throw new DomainServiceError('stale');
    const revoked = await this.env.CONTROL_DB.prepare(
      "UPDATE portfolio_hostnames SET status='detaching',control_expires_at=0,verification_url=NULL,probe_hash=NULL,updated_at=? WHERE hostname=? AND workspace_id=? AND epoch=? AND status!='detached' RETURNING *",
    )
      .bind(Date.now(), hostname, workspace, epoch)
      .first<PortfolioHostnameRow>();
    if (!revoked) throw new DomainServiceError('stale');
    Object.assign(row, revoked);
    row.status = 'detaching';
    if (
      !(await ownsHostname(
        this.env.CONTROL_DB,
        hostname,
        'portfolio',
        row.owner_key,
      ))
    ) {
      await this.update(
        row,
        "UPDATE portfolio_hostnames SET last_error='needs-review',next_check_at=?",
        [Number.MAX_SAFE_INTEGER],
      );
      return this.state(workspace);
    }
    if (row.operation) {
      await this.update(
        row,
        "UPDATE portfolio_hostnames SET last_error='needs-review',next_check_at=?",
        [Number.MAX_SAFE_INTEGER],
      );
      return this.state(workspace);
    }
    try {
      if (row.route_id) await this.provider.deleteRoute(row.route_id, hostname);
      if (row.provider_id)
        await this.provider.deleteCertificate(row.provider_id, hostname);
      await this.update(
        row,
        "UPDATE portfolio_hostnames SET status='detached',route_id=NULL,provider_id=NULL,operation=NULL,last_error=NULL,next_check_at=0,updated_at=?",
        [Date.now()],
      );
      await releaseHostname(
        this.env.CONTROL_DB,
        hostname,
        'portfolio',
        row.owner_key,
      );
      await this.env.CONTROL_DB.prepare(
        'DELETE FROM portfolio_domain_plans WHERE workspace_id=? AND revision=?',
      )
        .bind(workspace, row.plan_revision)
        .run();
      return this.state(workspace);
    } catch (error) {
      await this.update(
        row,
        'UPDATE portfolio_hostnames SET last_error=?,next_check_at=?,updated_at=?',
        [
          error instanceof DomainServiceError
            ? error.code
            : 'provider-unavailable',
          Date.now() + 900000,
          Date.now(),
        ],
      );
      return this.state(workspace);
    }
  }
}
export { digest as portfolioProbeHash, LEASE_MS as portfolioControlLease };
