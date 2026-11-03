import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import {
  PROOF_HEADER,
  signGatewayRequest,
  verifyGatewayRequest,
} from '../shared/gateway-proof';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';

export const routeClaimSchema = z
  .object({
    domain: z.string().transform(canonicalDomain),
    listing: z.string().uuid(),
    revision: z.string().uuid(),
  })
  .strict();
export type RouteClaim = z.infer<typeof routeClaimSchema>;
export interface DomainRoute {
  domain: string;
  workspace_id: string;
  listing_id: string;
  generation: number;
  revision: string;
  state: 'reserved' | 'active' | 'hold' | 'tombstone';
}
export class DirectoryConflict extends Error {}
/** All writes are compare-and-set. Unknown responses are reconciled by identity,
 * never by releasing another generation or choosing the most recent claimant. */
export class PublicDomainDirectory {
  constructor(readonly db: D1Database) {}
  async get(domain: string): Promise<DomainRoute | null> {
    return this.db
      .prepare('SELECT * FROM public_domain_routes WHERE domain=?')
      .bind(canonicalDomain(domain))
      .first<DomainRoute>();
  }
  async reserve(workspace: string, raw: RouteClaim): Promise<DomainRoute> {
    const claim = routeClaimSchema.parse(raw);
    const row = await this.db
      .prepare(
        `INSERT INTO public_domain_routes(domain,workspace_id,listing_id,generation,revision,state,updated_at)
      SELECT ?1,?2,?3,1,?4,'reserved',?5 FROM workspaces w WHERE w.id=?2 AND w.enabled=1
      AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
      ON CONFLICT(domain) DO UPDATE SET revision=excluded.revision,state='reserved',
        generation=public_domain_routes.generation+CASE WHEN public_domain_routes.revision=excluded.revision AND public_domain_routes.state IN ('reserved','active') THEN 0 ELSE 1 END,updated_at=excluded.updated_at
      WHERE public_domain_routes.workspace_id=excluded.workspace_id AND public_domain_routes.listing_id=excluded.listing_id AND public_domain_routes.state!='hold'
      RETURNING *`,
      )
      .bind(claim.domain, workspace, claim.listing, claim.revision, Date.now())
      .first<DomainRoute>();
    if (row) return row;
    // A conflicting attempt leaves a durable manifest and suppresses ambiguity.
    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO public_domain_route_conflicts(domain,workspace_id,listing_id,revision,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(domain,workspace_id,listing_id) DO UPDATE SET revision=excluded.revision,observed_at=excluded.observed_at',
        )
        .bind(
          claim.domain,
          workspace,
          claim.listing,
          claim.revision,
          Date.now(),
        ),
      this.db
        .prepare(
          "UPDATE public_domain_routes SET state='hold',generation=generation+1,updated_at=? WHERE domain=? AND state!='hold'",
        )
        .bind(Date.now(), claim.domain),
    ]);
    throw new DirectoryConflict(
      'This domain route has a conflicting claim. Review current control and transfer the route explicitly.',
    );
  }
  async settle(route: DomainRoute, eligibleRevision: string | null) {
    await this.db
      .prepare(
        "UPDATE public_domain_routes SET state=?,updated_at=? WHERE domain=? AND workspace_id=? AND listing_id=? AND generation=? AND revision=? AND state IN ('reserved','active')",
      )
      .bind(
        eligibleRevision === route.revision ? 'active' : 'reserved',
        Date.now(),
        route.domain,
        route.workspace_id,
        route.listing_id,
        route.generation,
        route.revision,
      )
      .run();
  }
  async withdraw(route: DomainRoute) {
    await this.db
      .prepare(
        "UPDATE public_domain_routes SET state='tombstone',generation=generation+1,updated_at=? WHERE domain=? AND workspace_id=? AND listing_id=? AND generation=?",
      )
      .bind(
        Date.now(),
        route.domain,
        route.workspace_id,
        route.listing_id,
        route.generation,
      )
      .run();
  }
  /** Review is a control-plane operation after fresh DNS qualification; the
   * exact generation and control proof are rechecked at explicit commit. */
  async reviewTransfer(workspace: string, raw: RouteClaim) {
    const claim = routeClaimSchema.parse(raw),
      route = await this.get(claim.domain);
    if (!route)
      throw new DirectoryConflict('Reserve an unclaimed route instead.');
    const proof = await this.controlProof(
      workspace,
      claim.domain,
      claim.listing,
    );
    if (!proof)
      throw new DirectoryConflict(
        'Fresh verified DNS control is required to transfer a route.',
      );
    const review = {
      id: crypto.randomUUID(),
      ...claim,
      generation: route.generation,
      expiresAt: Date.now() + 900000,
    };
    await this.db
      .prepare(
        'INSERT INTO public_domain_route_transfers(id,domain,generation,workspace_id,listing_id,revision,control_proof,expires_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        review.id,
        claim.domain,
        route.generation,
        workspace,
        claim.listing,
        claim.revision,
        proof,
        review.expiresAt,
      )
      .run();
    return {
      ...review,
      before: { generation: route.generation, state: route.state },
    };
  }
  private async controlProof(
    workspace: string,
    domain: string,
    listing: string,
  ) {
    const row = await this.db
      .prepare(
        "SELECT proof,epoch,observed_at,expires_at FROM sales_domain_controls WHERE workspace_id=? AND domain=? AND listing_id=? AND status='verified' AND observed_at<=? AND expires_at>?",
      )
      .bind(workspace, domain, listing, Date.now() + 30000, Date.now())
      .first<{
        proof: string;
        epoch: number;
        observed_at: number;
        expires_at: number;
      }>();
    return row ? JSON.stringify(row) : null;
  }
  async commitTransfer(workspace: string, id: string) {
    const review = await this.db
      .prepare(
        'SELECT * FROM public_domain_route_transfers WHERE id=? AND workspace_id=?',
      )
      .bind(id, workspace)
      .first<{
        domain: string;
        generation: number;
        listing_id: string;
        revision: string;
        control_proof: string;
        expires_at: number;
        committed_at: number | null;
      }>();
    if (!review) throw new DirectoryConflict('Transfer review not found.');
    if (review.committed_at) return this.get(review.domain);
    if (
      review.expires_at <= Date.now() ||
      (await this.controlProof(workspace, review.domain, review.listing_id)) !==
        review.control_proof
    )
      throw new DirectoryConflict(
        'Control changed. Review the transfer again.',
      );
    const result = await this.db
      .prepare(
        `UPDATE public_domain_routes SET workspace_id=?,listing_id=?,revision=?,generation=generation+1,state='reserved',updated_at=? WHERE domain=? AND generation=?
      AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id))
      AND EXISTS(SELECT 1 FROM sales_domain_controls s WHERE s.workspace_id=? AND s.domain=? AND s.listing_id=? AND s.status='verified' AND s.expires_at>? AND json_object('proof',s.proof,'epoch',s.epoch,'observed_at',s.observed_at,'expires_at',s.expires_at)=?) RETURNING *`,
      )
      .bind(
        workspace,
        review.listing_id,
        review.revision,
        Date.now(),
        review.domain,
        review.generation,
        workspace,
        workspace,
        review.domain,
        review.listing_id,
        Date.now(),
        review.control_proof,
      )
      .first<DomainRoute>();
    // A lost response after the CAS is recognized by the exact target identity.
    const current = result ?? (await this.get(review.domain));
    if (
      !current ||
      current.workspace_id !== workspace ||
      current.listing_id !== review.listing_id ||
      current.revision !== review.revision ||
      current.generation !== review.generation + 1
    )
      throw new DirectoryConflict(
        'The route changed. Review the transfer again.',
      );
    await this.db
      .prepare(
        'UPDATE public_domain_route_transfers SET committed_at=? WHERE id=?',
      )
      .bind(Date.now(), id)
      .run();
    return current;
  }
}

export async function directoryInternal(
  request: Request,
  env: HostedEnv,
  workspace: string,
): Promise<Response> {
  const proof = await verifyGatewayRequest(
    await workspaceKey(env, workspace),
    workspace,
    request,
  );
  if (
    request.method !== 'POST' ||
    !proof ||
    proof.owner !== null ||
    proof.sales ||
    proof.mcp ||
    !(await workspaceFor(env, workspace))
  )
    return new Response('Forbidden', { status: 403 });
  const enabled = await env.CONTROL_DB.prepare(
    'SELECT 1 FROM workspaces w WHERE id=? AND enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(workspace)
    .first();
  if (!enabled) return new Response('Forbidden', { status: 403 });
  try {
    const route = await new PublicDomainDirectory(env.CONTROL_DB).reserve(
      workspace,
      routeClaimSchema.parse(await request.json()),
    );
    return Response.json(
      { generation: route.generation },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof DirectoryConflict)
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

/** One bounded published-only tenant page per invocation. Cursor advances only
 * after every claim is recorded; retrying a lost response is idempotent. */
export async function backfillDomainRoutes(
  env: HostedEnv,
  workspace: string,
  limit = 100,
) {
  limit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const checkpoint = await env.CONTROL_DB.prepare(
    'SELECT cursor,completed_at FROM public_domain_route_backfill WHERE workspace_id=?',
  )
    .bind(workspace)
    .first<{ cursor: string; completed_at: number | null }>();
  if (checkpoint?.completed_at)
    return { done: true, cursor: checkpoint.cursor, conflicts: [] };
  const tenant = await workspaceFor(env, workspace);
  if (!tenant) throw new Error('Tenant unavailable');
  const url = new URL(
    '/platform-internal/public-domain-backfill',
    env.CANONICAL_ORIGIN,
  );
  url.searchParams.set('cursor', checkpoint?.cursor ?? '');
  url.searchParams.set('limit', String(limit));
  const request = new Request(url, { signal: AbortSignal.timeout(10000) });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      request,
    ),
  );
  const response = await workspaceService(env, tenant.binding).fetch(request);
  if (!response.ok)
    throw new Error('Published reader unavailable; checkpoint unchanged');
  const page = z
    .object({
      items: z.array(routeClaimSchema).max(100),
      cursor: z.string().nullable(),
    })
    .strict()
    .parse(await response.json());
  const directory = new PublicDomainDirectory(env.CONTROL_DB),
    conflicts: string[] = [];
  for (const item of page.items) {
    try {
      const route = await directory.reserve(workspace, item);
      await directory.settle(route, item.revision);
    } catch (error) {
      if (!(error instanceof DirectoryConflict)) throw error;
      conflicts.push(item.domain);
    }
  }
  const cursor =
    page.cursor ?? page.items.at(-1)?.domain ?? checkpoint?.cursor ?? '';
  await env.CONTROL_DB.prepare(
    'INSERT INTO public_domain_route_backfill(workspace_id,cursor,completed_at) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET cursor=excluded.cursor,completed_at=excluded.completed_at',
  )
    .bind(workspace, cursor, page.cursor === null ? Date.now() : null)
    .run();
  return { done: page.cursor === null, cursor, conflicts };
}
