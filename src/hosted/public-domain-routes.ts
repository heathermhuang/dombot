import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import {
  workspaceFor,
  workspaceKey,
  workspaceSchema,
  workspaceService,
} from './workspaces';
import { Accounts } from './accounts';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};
const unavailable = (status = 404) =>
  new Response(
    status === 503
      ? 'Domain page temporarily unavailable'
      : 'Domain page unavailable',
    { status, headers },
  );
const eligibility = z
  .object({ revision: z.string().uuid().nullable() })
  .strict();

/** Published-only discovery: no inventory, private initialization, provider reads,
 * or caller authority. Check every admitted account so a conflict cannot choose
 * an arbitrary seller. Reads are bounded to 64 accounts, four at a time. */
export async function publicDomainRequest(
  request: Request,
  env: HostedEnv,
): Promise<Response | null> {
  if (!env.CANONICAL_ORIGIN) return null;
  const incoming = new URL(request.url);
  if (incoming.origin !== new URL(env.CANONICAL_ORIGIN).origin) return null;
  if (
    [
      '/robots.txt',
      '/sitemap.xml',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/sw.js',
      '/service-worker.js',
    ].includes(incoming.pathname)
  )
    return null;
  const legacy = incoming.pathname.match(
    /^\/w\/([a-f0-9-]{36})\/d\/([^/]+)(\/inquiries)?\/?$/,
  );
  const short = incoming.pathname.match(/^\/([^/]+\.[^/]+)(\/inquiries)?\/?$/);
  if (!legacy && !short) return null;
  const raw = legacy?.[2] ?? short![1];
  const inquiry = Boolean(legacy?.[3] ?? short?.[2]);
  let domain: string;
  try {
    domain = canonicalDomain(decodeURIComponent(raw));
  } catch {
    return unavailable();
  }
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    !(request.method === 'POST' && inquiry)
  )
    return new Response('Method not allowed', { status: 405, headers });
  if (inquiry && request.method !== 'POST') return unavailable();
  if (
    request.method === 'POST' &&
    request.headers.get('origin') !== incoming.origin
  )
    return new Response('Bad origin', { status: 403, headers });

  try {
    if (
      !(await new Accounts(env.CONTROL_DB, env.AUTH_PEPPER).rateLimit(
        `public-domain:${request.headers.get('cf-connecting-ip') ?? 'local'}`,
        300,
      ))
    )
      return new Response('Too many requests. Try again later.', {
        status: 429,
        headers,
      });
    const configured = workspaceSchema.parse(JSON.parse(env.WORKSPACES));
    const rows = await env.CONTROL_DB.prepare(
      `SELECT w.id FROM workspaces w WHERE w.enabled=1
       AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
       AND (w.id IN (SELECT value FROM json_each(?)) OR
         (?=1 AND EXISTS(SELECT 1 FROM platform_workspaces p WHERE p.workspace_id=w.id AND p.qualified_at>0)))
       ORDER BY w.id LIMIT 65`,
    )
      .bind(
        JSON.stringify(configured.map((w) => w.id)),
        env.PLATFORM_ENABLED === 'true' && env.DISPATCHER ? 1 : 0,
      )
      .all<{ id: string }>();
    if (rows.results.length > 64) return unavailable(503);
    const losses = await env.CONTROL_DB.prepare(
      "SELECT workspace_id FROM sales_domain_controls WHERE domain=? AND status IN ('lost','recovering')",
    )
      .bind(domain)
      .all<{ workspace_id: string }>();
    const lost = new Set(losses.results.map((row) => row.workspace_id));
    const candidates = rows.results.filter((row) => !lost.has(row.id));
    const found: { id: string; revision: string }[] = [];
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const results = await Promise.allSettled(
        candidates.slice(offset, offset + 4).map(async ({ id }) => {
          const workspace = await workspaceFor(env, id);
          if (!workspace) throw new Error('Account unavailable');
          const url = new URL(
            '/platform-internal/public-domain',
            env.CANONICAL_ORIGIN,
          );
          url.searchParams.set('domain', domain);
          const probe = new Request(url, {
            signal: AbortSignal.timeout(5_000),
          });
          probe.headers.set(
            PROOF_HEADER,
            await signGatewayRequest(
              await workspaceKey(env, id),
              id,
              null,
              probe,
            ),
          );
          const response = await workspaceService(env, workspace.binding).fetch(
            probe,
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('Public reader unavailable');
          }
          const result = eligibility.parse(await response.json());
          return result.revision ? { id, revision: result.revision } : null;
        }),
      );
      if (results.some((result) => result.status === 'rejected'))
        return unavailable(503);
      for (const result of results)
        if (result.status === 'fulfilled' && result.value)
          found.push(result.value);
      if (found.length > 1) return unavailable(409);
    }
    if (found.length !== 1 || (legacy && found[0].id !== legacy[1]))
      return unavailable();
    const canonicalPath = `/${domain}${inquiry ? '/inquiries' : ''}`;
    if (legacy || incoming.pathname !== canonicalPath)
      return new Response(null, {
        status: 308,
        headers: { ...headers, Location: canonicalPath + incoming.search },
      });

    const id = found[0].id;
    const workspace = await workspaceFor(env, id);
    if (!workspace) return unavailable(503);
    const url = new URL(incoming);
    url.pathname = `/d/${domain}${inquiry ? '/inquiries' : ''}`;
    const forwardedHeaders = new Headers(request.headers);
    for (const name of [...forwardedHeaders.keys()])
      if (
        /^(?:cookie$|authorization$|host$|x-dombot-|x-forwarded-|forwarded$)/i.test(
          name,
        )
      )
        forwardedHeaders.delete(name);
    const forwarded = new Request(new Request(url, request), {
      headers: forwardedHeaders,
      redirect: 'manual',
    });
    forwarded.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        await workspaceKey(env, id),
        id,
        null,
        forwarded,
        {
          purpose: 'sales-public',
          host: incoming.hostname,
          listing: null,
          epoch: 0,
        },
      ),
    );
    const response = await workspaceService(env, workspace.binding).fetch(
      forwarded,
    );
    const outgoing = new Headers(response.headers);
    outgoing.delete('set-cookie');
    outgoing.set('Cache-Control', 'no-store');
    if (request.method === 'HEAD') await response.body?.cancel();
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return unavailable(503);
  }
}
