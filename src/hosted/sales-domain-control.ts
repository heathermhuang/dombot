import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
import { domainControlLeaseSchema } from '../shared/sales-domain-control';
import { salesDns } from './sales-hostnames';
import { gatewayKey, workspaceSchema, workspaceService } from './workspaces';
import type { SalesListingDetail } from '../shared/sales-api';

interface Control {
  workspace_id: string;
  listing_id: string;
  domain: string;
  epoch: number;
  last_loss_epoch: number;
  tenant_ack_epoch: number;
  revision: string;
  proof: string;
  status: string;
  observed_at: number;
  expires_at: number;
  next_check_at: number;
  updated_at: number;
}
class ListingUnavailable extends Error {
  constructor(
    readonly epoch: number,
    readonly revision: string,
  ) {
    super('Listing unavailable');
  }
}
export function domainControlWorkspaces(env: HostedEnv): string[] {
  if (env.SALES_DOMAIN_CONTROL_ENABLED !== 'true') return [];
  return z
    .array(z.string().uuid())
    .max(32)
    .parse(JSON.parse(env.SALES_DOMAIN_CONTROL_WORKSPACES ?? '[]'));
}
const proofName = (domain: string) => `_domains-inquiry.${domain}`;
const proofId = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export class SalesDomainControl {
  constructor(
    readonly env: HostedEnv,
    readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}
  private service(workspace: string) {
    const configured = workspaceSchema
      .parse(JSON.parse(this.env.WORKSPACES))
      .find((w) => w.id === workspace);
    if (!configured) throw Error('Account unavailable');
    return workspaceService(this.env, configured.binding);
  }
  private async lease(row: Control, valid: boolean, observedAt: number) {
    const body = domainControlLeaseSchema.parse({
      listing: row.listing_id,
      domain: row.domain,
      epoch: row.epoch,
      reviewAfter: row.last_loss_epoch,
      proofId: proofId(row.proof),
      observedAt,
      expiresAt: valid ? observedAt + 86400_000 : 0,
      valid,
    });
    const request = new Request(
      new URL('/sales-internal/domain-control', this.env.CANONICAL_ORIGIN),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        gatewayKey(this.env, row.workspace_id),
        row.workspace_id,
        null,
        request,
        { purpose: 'sales-hostnames' },
      ),
    );
    const response = await this.service(row.workspace_id).fetch(request);
    if (response.status === 404)
      throw new ListingUnavailable(row.epoch, row.revision);
    if (!response.ok || !((await response.json()) as { ok: boolean }).ok)
      throw Error('Domain verification could not be saved. Try again.');
    return body;
  }
  async read(workspace: string, listing: string) {
    return this.env.CONTROL_DB.prepare(
      'SELECT * FROM sales_domain_controls WHERE workspace_id=? AND listing_id=?',
    )
      .bind(workspace, listing)
      .first<Control>();
  }
  view(row: Control | null, workspace: string) {
    return {
      enabled: domainControlWorkspaces(this.env).includes(workspace),
      status:
        row?.status === 'verified' && row.expires_at <= Date.now()
          ? 'expired'
          : (row?.status ?? 'unverified'),
      observedAt: row?.observed_at ?? 0,
      expiresAt: row?.expires_at ?? 0,
      proof: row
        ? { type: 'TXT', name: proofName(row.domain), value: row.proof }
        : null,
    };
  }
  async plan(workspace: string, listing: string, domain: string) {
    if (!domainControlWorkspaces(this.env).includes(workspace))
      throw Error('DNS verification is not enabled for this account.');
    domain = canonicalDomain(domain);
    const old = await this.read(workspace, listing);
    if (old && old.domain !== domain)
      throw Error('Listing domain changed. Reload first.');
    if (old && old.status !== 'retired') return this.view(old, workspace);
    const now = Date.now(),
      row: Control = {
        workspace_id: workspace,
        listing_id: listing,
        domain,
        epoch: (old?.epoch ?? 0) + 1,
        last_loss_epoch: 0,
        tenant_ack_epoch: 0,
        revision: crypto.randomUUID(),
        proof: `domains-inquiry=${randomBytes(32).toString('base64url')}`,
        status: 'pending',
        observed_at: 0,
        expires_at: 0,
        next_check_at: 0,
        updated_at: now,
      };
    const changed = await this.env.CONTROL_DB.prepare(
      'INSERT INTO sales_domain_controls(workspace_id,listing_id,domain,epoch,revision,proof,status,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,listing_id) DO UPDATE SET domain=excluded.domain,epoch=excluded.epoch,revision=excluded.revision,proof=excluded.proof,status=excluded.status,last_loss_epoch=0,observed_at=0,expires_at=0,next_check_at=0,updated_at=excluded.updated_at WHERE sales_domain_controls.revision=? RETURNING listing_id',
    )
      .bind(
        workspace,
        listing,
        domain,
        row.epoch,
        row.revision,
        row.proof,
        row.status,
        now,
        old?.revision ?? '',
      )
      .first();
    if (!changed) throw Error('Verification changed. Reload before retrying.');
    return this.view(row, workspace);
  }
  async check(row: Control) {
    if (!domainControlWorkspaces(this.env).includes(row.workspace_id))
      throw Error('DNS verification is not enabled for this account.');
    const dns = await salesDns(proofName(row.domain), 'TXT', this.fetcher),
      now = Date.now();
    const valid = dns.answers.some(
      (a) => a.type === 16 && a.data.replaceAll('"', '') === row.proof,
    );
    const next: Control = {
      ...row,
      epoch: row.epoch + 1,
      revision: crypto.randomUUID(),
      last_loss_epoch: valid
        ? row.last_loss_epoch
        : row.status === 'lost'
          ? row.last_loss_epoch
          : row.epoch + 1,
      status: valid
        ? row.status === 'lost' || row.status === 'recovering'
          ? 'recovering'
          : 'verifying'
        : 'lost',
      observed_at: now,
      expires_at: valid ? now + 86400_000 : 0,
      next_check_at: now + 120_000,
      updated_at: now,
    };
    // Fence the result before issuing a tenant lease. A later loss receives a higher epoch.
    const changed = await this.env.CONTROL_DB.prepare(
      'UPDATE sales_domain_controls SET status=?,epoch=?,last_loss_epoch=?,observed_at=?,expires_at=?,next_check_at=?,updated_at=?,revision=? WHERE workspace_id=? AND listing_id=? AND revision=? RETURNING listing_id',
    )
      .bind(
        next.status,
        next.epoch,
        next.last_loss_epoch,
        now,
        next.expires_at,
        next.next_check_at,
        now,
        next.revision,
        row.workspace_id,
        row.listing_id,
        row.revision,
      )
      .first();
    if (!changed) throw Error('Verification changed. Reload before retrying.');
    if (!valid)
      await this.env.CONTROL_DB.prepare(
        "UPDATE sales_hostnames SET status='control-lost',epoch=epoch+1,control_expires_at=0,updated_at=? WHERE workspace_id=? AND listing_id=? AND status NOT IN ('detached','control-lost') AND EXISTS(SELECT 1 FROM sales_domain_controls WHERE workspace_id=? AND listing_id=? AND revision=?)",
      )
        .bind(
          now,
          row.workspace_id,
          row.listing_id,
          row.workspace_id,
          row.listing_id,
          next.revision,
        )
        .run();
    await this.lease(next, valid, now);
    await this.env.CONTROL_DB.prepare(
      'UPDATE sales_domain_controls SET status=?,next_check_at=?,tenant_ack_epoch=? WHERE workspace_id=? AND listing_id=? AND revision=?',
    )
      .bind(
        valid ? 'verified' : 'lost',
        now + 6 * 3600_000,
        next.epoch,
        row.workspace_id,
        row.listing_id,
        next.revision,
      )
      .run();

    return this.view(
      await this.read(row.workspace_id, row.listing_id),
      row.workspace_id,
    );
  }
  async listing(
    workspace: string,
    owner: string,
    listing: string,
  ): Promise<SalesListingDetail> {
    const request = new Request(
      new URL(`/sales/listings/${listing}`, this.env.CANONICAL_ORIGIN),
    );
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        gatewayKey(this.env, workspace),
        workspace,
        owner,
        request,
        { purpose: 'sales-owner', recipientVerified: false },
      ),
    );
    const r = await this.service(workspace).fetch(request);
    if (!r.ok) throw Error('Listing unavailable.');
    return r.json() as Promise<SalesListingDetail>;
  }
}
export async function domainControlRequest(
  env: HostedEnv,
  workspace: string,
  owner: string,
  request: Request,
) {
  try {
    const controller = new SalesDomainControl(env),
      url = new URL(request.url);
    if (request.method === 'GET') {
      const listing = z.string().uuid().parse(url.searchParams.get('listing'));
      const details = await controller.listing(workspace, owner, listing);
      const state = controller.view(
        await controller.read(workspace, listing),
        workspace,
      );
      return Response.json({
        ...state,
        enabled: state.enabled && details.dnsVerificationEnabled === true,
      });
    }
    if (request.method !== 'POST')
      return Response.json({ error: 'Method unavailable' }, { status: 405 });
    const input = z
      .object({ listingId: z.string().uuid() })
      .strict()
      .parse(await request.json());
    const listing = await controller.listing(workspace, owner, input.listingId);
    if (!listing.dnsVerificationEnabled)
      throw Error('DNS verification is not enabled for this account.');
    const row = await controller.read(workspace, input.listingId);
    const result = url.pathname.endsWith('/plan')
      ? await controller.plan(workspace, input.listingId, listing.draft.domain)
      : url.pathname.endsWith('/check') && row
        ? await controller.check(row)
        : null;
    if (!result) throw Error('Prepare a verification record first.');
    return Response.json(result);
  } catch {
    return Response.json(
      { error: 'Domain verification unavailable. Check the record and retry.' },
      { status: 409 },
    );
  }
}
/** Only previously verified, explicitly enabled domains are polled; no inventory scan. */
export async function refreshDomainControls(
  env: HostedEnv,
  fetcher?: typeof fetch,
) {
  const allowed = domainControlWorkspaces(env);
  if (!allowed.length) return;
  const now = Date.now(),
    rows = await env.CONTROL_DB.prepare(
      "SELECT c.* FROM sales_domain_controls c JOIN workspaces w ON w.id=c.workspace_id WHERE c.workspace_id IN (SELECT value FROM json_each(?)) AND c.status IN ('verified','verifying','recovering','lost') AND c.next_check_at<=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests r WHERE r.workspace_id=w.id) ORDER BY c.next_check_at LIMIT 20",
    )
      .bind(JSON.stringify(allowed), now)
      .all<Control>();
  const controller = new SalesDomainControl(env, fetcher);
  for (const row of rows.results) {
    const claimed = await env.CONTROL_DB.prepare(
      'UPDATE sales_domain_controls SET next_check_at=? WHERE workspace_id=? AND listing_id=? AND revision=? AND next_check_at<=? RETURNING listing_id',
    )
      .bind(now + 120_000, row.workspace_id, row.listing_id, row.revision, now)
      .first();
    if (!claimed) continue;
    try {
      await controller.check(row);
    } catch (error) {
      if (error instanceof ListingUnavailable) {
        await env.CONTROL_DB.prepare(
          "UPDATE sales_domain_controls SET status='retired',expires_at=0,next_check_at=0,revision=? WHERE workspace_id=? AND listing_id=? AND epoch=? AND revision=?",
        )
          .bind(
            crypto.randomUUID(),
            row.workspace_id,
            row.listing_id,
            error.epoch,
            error.revision,
          )
          .run();
        continue;
      }
      // Keep the last bounded lease on transient failures; retry only this due record.
    }
  }
}
