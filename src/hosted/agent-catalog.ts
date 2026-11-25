import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { saleDomainSchema } from '../shared/hosted-sales';
import { Accounts } from './accounts';
import { type DomainRoute } from './public-domain-directory';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import {
  agentListing,
  agentRetention,
  catalogMatch,
  listingProbeSchema,
  priceMatches,
  type AgentSearch,
} from './agent-projection';

const admitted = `
  w.enabled=1 AND r.state IN ('active','reserved')
  AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=r.workspace_id)
  AND NOT EXISTS(SELECT 1 FROM sales_domain_controls s
    WHERE s.workspace_id=r.workspace_id AND s.domain=r.domain AND s.status IN ('lost','recovering'))
`;
const candidateSelect = `SELECT r.* FROM public_domain_routes r JOIN workspaces w ON w.id=r.workspace_id`;

export const agentCatalogEnabled = (env: HostedEnv) =>
  env.AGENT_CATALOG_ENABLED === 'true' && !!env.CANONICAL_ORIGIN;

export async function agentAdmission(
  env: HostedEnv,
  request: Request,
  action: 'read' | 'submit',
) {
  return new Accounts(env.CONTROL_DB, env.AUTH_PEPPER).rateLimit(
    `agent-catalog:${action}:${request.headers.get('cf-connecting-ip') ?? 'local'}`,
    action === 'read' ? 60 : 10,
  );
}

export async function readAgentListing(
  env: HostedEnv,
  domain: string,
  options: { expected?: DomainRoute; owner?: string } = {},
) {
  const currentRoute = () =>
    env.CONTROL_DB.prepare(
      `${candidateSelect} WHERE r.domain=?1 AND (?2 IS NULL OR r.workspace_id=?2) AND ${admitted}`,
    )
      .bind(domain, options.owner ?? null)
      .first<DomainRoute>();
  const route = await currentRoute();
  if (
    !route ||
    (options.expected && route.generation !== options.expected.generation)
  )
    return null;
  const workspaceId = route.workspace_id;
  const workspace = await workspaceFor(env, workspaceId);
  if (!workspace) throw new Error('Published tenant unavailable');
  const url = new URL('/platform-internal/agent-listing', env.CANONICAL_ORIGIN);
  url.searchParams.set('domain', domain);
  if (options.owner) url.searchParams.set('metrics', '1');
  const request = new Request(url, { signal: AbortSignal.timeout(4000) });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspaceId),
      workspaceId,
      null,
      request,
    ),
  );
  const response = await workspaceService(env, workspace.binding).fetch(
    request,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Published tenant reader unavailable');
  }
  const probe = listingProbeSchema.parse(await response.json());
  const sale = probe.sale;
  if (
    sale?.domain !== domain ||
    sale.id !== route.listing_id ||
    sale.revision !== route.revision
  )
    return null;
  const current = await currentRoute();
  if (
    !current ||
    current.generation !== route.generation ||
    current.revision !== route.revision ||
    current.workspace_id !== workspaceId ||
    current.listing_id !== route.listing_id
  )
    return null;
  const listing = agentListing(probe, env.CANONICAL_ORIGIN!);
  if (!listing) return null;
  return { listing, route: current, probe };
}
export type LiveAgentListing = NonNullable<
  Awaited<ReturnType<typeof readAgentListing>>
>;
type AgentEvent = 'query' | 'price' | 'offer' | 'broker' | 'provider';

function queryForOwner(value: string) {
  // Keep the useful search terms while excluding common contact details and URLs.
  return (
    value
      .replace(/https?:\/\/\S+|\S+@\S+|\+?\d[\d ().-]{6,}\d/gi, '[redacted]')
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .slice(0, 120) || null
  );
}
export function agentSource(request: Request, protocol: 'MCP' | 'API') {
  const product = request.headers
    .get('user-agent')
    ?.match(
      /^([a-z0-9][a-z0-9_.-]{0,39})(?:\/[0-9]+(?:[.][0-9]+)*)?(?:\s|$)/i,
    )?.[1];
  return product && !/\d{4}/.test(product)
    ? `${protocol} · ${product}`
    : protocol;
}
export async function recordAgentEvent(
  env: HostedEnv,
  rows: LiveAgentListing[],
  event: AgentEvent,
  source: string,
  query = '',
  receipt: string | null = null,
) {
  if (!rows.length) return;
  const now = Date.now();
  const id = receipt ? 'receipt:' + receipt : crypto.randomUUID();
  await env.CONTROL_DB.batch(
    rows.map(({ route }) =>
      env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO agent_catalog_events(id,workspace_id,listing_id,domain,event,source,query,receipt,occurred_at)
     SELECT ?1,r.workspace_id,r.listing_id,r.domain,?2,?3,?4,?5,?6
     FROM public_domain_routes r JOIN workspaces w ON w.id=r.workspace_id
     WHERE r.domain=?7 AND r.generation=?8 AND r.revision=?9 AND ${admitted}`,
      ).bind(
        id + ':' + route.listing_id,
        event,
        source,
        queryForOwner(query),
        receipt,
        now,
        route.domain,
        route.generation,
        route.revision,
      ),
    ),
  );
}

export class AgentCursorError extends Error {
  constructor() {
    super('Start the search again with the current filters.');
  }
}
async function cursorKey(pepper: string) {
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('domains-agent-catalog-cursor:v1:' + pepper),
  );
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
const cursorPayload = z.object({
  domain: saleDomainSchema,
  scope: z.string(),
  expires: z.number().int(),
});

export async function searchAgentListings(env: HostedEnv, filter: AgentSearch) {
  const scope = JSON.stringify([
    filter.q,
    filter.currency,
    filter.minPrice,
    filter.maxPrice,
  ]);
  let after = '';
  if (filter.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]{30,700}$/.test(filter.cursor))
        throw new AgentCursorError();
      const envelope = Buffer.from(filter.cursor, 'base64url');
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: envelope.subarray(0, 12) },
        await cursorKey(env.AUTH_PEPPER),
        envelope.subarray(12),
      );
      const data = cursorPayload.parse(
        JSON.parse(new TextDecoder().decode(plain)),
      );
      if (data.scope !== scope || data.expires <= Date.now())
        throw new AgentCursorError();
      after = data.domain;
    } catch {
      throw new AgentCursorError();
    }
  }
  const match = catalogMatch(filter.q);
  const exact =
    filter.q.includes('.') && z.string().max(253).safeParse(filter.q).success
      ? filter.q.toLowerCase().replace(/\.$/, '')
      : '';
  const maxProbes = Math.min(30, filter.limit * 3);
  const rows = await env.CONTROL_DB.prepare(
    `
    ${candidateSelect}
    WHERE r.domain>?1 AND ${admitted}
    AND (?2='' OR r.domain=?3 OR r.domain IN (
      SELECT i.domain FROM agent_catalog_search s JOIN agent_catalog_index i ON i.rowid=s.rowid
      JOIN public_domain_routes indexed_route ON indexed_route.domain=i.domain AND indexed_route.revision=i.revision
      WHERE agent_catalog_search MATCH ?2
    ))
    ORDER BY r.domain LIMIT ?4
  `,
  )
    .bind(after, match, exact, maxProbes + 1)
    .all<DomainRoute>();
  const matches: LiveAgentListing[] = [];
  let checked = 0;
  let unavailable = 0;
  const candidates = rows.results.slice(0, maxProbes);
  while (checked < candidates.length && matches.length < filter.limit) {
    const batch = candidates.slice(
      checked,
      checked + Math.min(5, filter.limit - matches.length),
    );
    const results = await Promise.allSettled(
      batch.map((candidate) =>
        readAgentListing(env, candidate.domain, { expected: candidate }),
      ),
    );
    checked += results.length;
    for (const result of results) {
      if (result.status === 'rejected') unavailable++;
      else if (result.value && priceMatches(result.value.listing, filter))
        matches.push(result.value);
    }
  }
  let nextCursor: string | null = null;
  if (rows.results.length > checked) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        domain: rows.results[checked - 1].domain,
        scope,
        expires: Date.now() + 30 * 60_000,
      }),
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await cursorKey(env.AUTH_PEPPER),
      plaintext,
    );
    nextCursor = Buffer.concat([iv, Buffer.from(ciphertext)]).toString(
      'base64url',
    );
  }
  return { matches, nextCursor, partial: unavailable > 0 };
}

/** Traverse the shared published locator on its existing schedule, outside visitor requests. */
export async function refreshAgentCatalog(env: HostedEnv) {
  if (!agentCatalogEnabled(env)) return;
  const now = Date.now();
  const candidates = await env.CONTROL_DB.prepare(
    `
    ${candidateSelect}
    LEFT JOIN agent_catalog_index i ON i.domain=r.domain
    WHERE ${admitted}
    AND (i.domain IS NULL OR (i.revision!=r.revision AND i.checked_at<?3) OR (i.ready=0 AND i.checked_at<?1) OR i.checked_at<?2)
    ORDER BY i.checked_at,r.domain LIMIT 10
  `,
  )
    .bind(now - 60 * 60_000, now - 24 * 60 * 60_000, now - 60_000)
    .all<DomainRoute>();

  for (let offset = 0; offset < candidates.results.length; offset += 5) {
    await Promise.all(
      candidates.results.slice(offset, offset + 5).map(async (candidate) => {
        const { domain, revision, generation } = candidate;
        const live = await readAgentListing(env, domain, {
          expected: candidate,
        }).catch(() => undefined);
        const guard = `EXISTS(SELECT 1 FROM public_domain_routes r WHERE r.domain=?1 AND r.revision=?2
        AND r.generation=?3 AND r.state IN ('active','reserved'))`;
        if (live === undefined) {
          await env.CONTROL_DB.prepare(
            `
            INSERT INTO agent_catalog_index(domain,revision,checked_at,ready)
            SELECT ?1,?2,?4,0 WHERE ${guard}
            ON CONFLICT(domain) DO UPDATE SET checked_at=excluded.checked_at
            WHERE checked_at<=excluded.checked_at
          `,
          )
            .bind(domain, revision, generation, now)
            .run();
          return;
        }
        const listing = live?.listing;
        await env.CONTROL_DB.batch([
          env.CONTROL_DB.prepare(
            `
          INSERT INTO agent_catalog_index(domain,revision,checked_at,ready)
          SELECT ?1,?2,?4,?5 WHERE ${guard}
          ON CONFLICT(domain) DO UPDATE SET revision=excluded.revision,checked_at=excluded.checked_at,ready=excluded.ready
          WHERE checked_at<=excluded.checked_at
        `,
          ).bind(domain, revision, generation, now, listing ? 1 : 0),
          env.CONTROL_DB.prepare(
            `
          DELETE FROM agent_catalog_search WHERE rowid=(
            SELECT rowid FROM agent_catalog_index WHERE domain=?1 AND revision=?2 AND checked_at=?4
          ) AND ${guard}
        `,
          ).bind(domain, revision, generation, now),
          ...(listing
            ? [
                env.CONTROL_DB.prepare(
                  `
          INSERT INTO agent_catalog_search(rowid,domain,name,description,categories)
          SELECT rowid,domain,?5,?6,?7 FROM agent_catalog_index
          WHERE domain=?1 AND revision=?2 AND checked_at=?4 AND ${guard}
        `,
                ).bind(
                  domain,
                  revision,
                  generation,
                  now,
                  domain.replace(/[.-]/g, ' '),
                  listing.description,
                  listing.categories.join(' '),
                ),
              ]
            : []),
        ]);
      }),
    );
  }

  // Withdrawn and suspended material drops out of search immediately and is erased here.
  const hidden = await env.CONTROL_DB.prepare(
    `
    SELECT i.rowid AS id FROM agent_catalog_index i
    WHERE NOT EXISTS(${candidateSelect.replace('SELECT r.*', 'SELECT 1')} WHERE r.domain=i.domain AND ${admitted})
    LIMIT 100
  `,
  ).all<{ id: number }>();
  if (hidden.results.length) {
    const ids = JSON.stringify(hidden.results.map((item) => item.id));
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        'DELETE FROM agent_catalog_search WHERE rowid IN (SELECT value FROM json_each(?))',
      ).bind(ids),
      env.CONTROL_DB.prepare(
        'DELETE FROM agent_catalog_index WHERE rowid IN (SELECT value FROM json_each(?))',
      ).bind(ids),
    ]);
  }
}

export async function pruneAgentEvents(env: HostedEnv) {
  const exists = await env.CONTROL_DB.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_catalog_events'",
  ).first();
  if (!exists) return;
  await env.CONTROL_DB.prepare(
    `
    DELETE FROM agent_catalog_events WHERE occurred_at<?
      OR EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=agent_catalog_events.workspace_id)
  `,
  )
    .bind(Date.now() - agentRetention)
    .run();
}

export async function ownerAgentRows(
  env: HostedEnv,
  owner: string,
  cursor: string,
) {
  const [rows, recent, counts] = await Promise.all([
    env.CONTROL_DB.prepare(
      `${candidateSelect} WHERE r.workspace_id=? AND r.domain>? AND ${admitted} ORDER BY r.domain LIMIT 11`,
    )
      .bind(owner, cursor)
      .all<DomainRoute>(),
    env.CONTROL_DB.prepare(
      `
      SELECT domain,event,source,query,occurred_at AS at FROM agent_catalog_events
      WHERE workspace_id=? AND occurred_at>=? ORDER BY occurred_at DESC LIMIT 30
    `,
    )
      .bind(owner, Date.now() - agentRetention)
      .all<{
        domain: string;
        event: AgentEvent;
        source: string;
        query: string | null;
        at: number;
      }>(),
    env.CONTROL_DB.prepare(
      `
      SELECT domain,listing_id,event,count(*) AS total,
        max(occurred_at) AS latest FROM agent_catalog_events
      WHERE workspace_id=? AND occurred_at>=? GROUP BY domain,listing_id,event
    `,
    )
      .bind(owner, Date.now() - agentRetention)
      .all<{
        domain: string;
        listing_id: string;
        event: AgentEvent;
        total: number;
        latest: number;
      }>(),
  ]);
  return { rows: rows.results, recent: recent.results, counts: counts.results };
}

export async function ownerReceiptActivity(env: HostedEnv, owner: string) {
  const query = await env.CONTROL_DB.prepare(
    `
    SELECT receipt,event,listing_id FROM agent_catalog_events
    WHERE workspace_id=? AND receipt IS NOT NULL AND occurred_at>=?
    ORDER BY occurred_at DESC LIMIT 101
  `,
  )
    .bind(owner, Date.now() - agentRetention)
    .all<{
      receipt: string;
      event: AgentEvent;
      listing_id: string;
    }>();
  if (!query.results.length) return { verified: [], linked: 0, partial: false };
  const workspace = await workspaceFor(env, owner);
  if (!workspace) throw new Error('Portfolio unavailable');
  const url = new URL(
    '/platform-internal/agent-activity',
    env.CANONICAL_ORIGIN,
  );
  const receipts = query.results.slice(0, 100);
  for (const row of receipts) url.searchParams.append('receipt', row.receipt);
  const request = new Request(url, { signal: AbortSignal.timeout(4000) });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, owner),
      owner,
      null,
      request,
    ),
  );
  const response = await workspaceService(env, workspace.binding).fetch(
    request,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Sale evidence is unavailable');
  }
  const data = z
    .object({
      verified: z.array(z.string().uuid()).max(100),
      linked: z.array(z.string().uuid()).max(100),
    })
    .strict()
    .parse(await response.json());
  const verified = new Set(data.verified);
  const linked = new Set(data.linked);
  return {
    verified: receipts.filter((row) => verified.has(row.receipt)),
    linked: receipts.filter((row) => linked.has(row.receipt)).length,
    partial: query.results.length > receipts.length,
  };
}
