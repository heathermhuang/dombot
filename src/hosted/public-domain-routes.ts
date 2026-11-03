import { PublicDomainDirectory } from './public-domain-directory';
import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
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
  .object({
    revision: z.string().uuid().nullable(),
    listing: z.string().uuid().nullable(),
  })
  .strict();

/** Constant-fleet-cost locator lookup followed by the selected tenant eligibility read. */
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
    /^\/w\/([a-f0-9-]{36})\/d\/([^/]+)(\/(?:inquiries|provider))?\/?$/,
  );
  const short = incoming.pathname.match(
    /^\/([^/]+\.[^/]+)(\/(?:inquiries|provider))?\/?$/,
  );
  if (!legacy && !short) return null;
  const raw = legacy?.[2] ?? short![1];
  const suffix = legacy?.[3] ?? short?.[2] ?? '';
  const inquiry = suffix === '/inquiries';
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
    const directory = new PublicDomainDirectory(env.CONTROL_DB);
    const route = await directory.get(domain);
    // Explicit release bridge only: preserve the old qualified tenant path
    // until its directory row exists. Known holds/tombstones never fall back.
    if (!route && legacy && env.PUBLIC_DOMAIN_DIRECTORY_READY === 'false')
      return null;
    if (!route || route.state === 'tombstone') return unavailable();
    if (route.state === 'hold') return unavailable(409);
    const id = route.workspace_id;
    if (legacy && id !== legacy[1]) return unavailable();
    const admitted = await env.CONTROL_DB.prepare(
      `SELECT 1 FROM workspaces w WHERE w.id=? AND w.enabled=1
      AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
      AND NOT EXISTS(SELECT 1 FROM sales_domain_controls s WHERE s.workspace_id=w.id AND s.domain=? AND s.status IN ('lost','recovering'))`,
    )
      .bind(id, domain)
      .first();
    if (!admitted) return unavailable();
    const selected = await workspaceFor(env, id);
    if (!selected) return unavailable(503);
    const probeUrl = new URL(
      '/platform-internal/public-domain',
      env.CANONICAL_ORIGIN,
    );
    probeUrl.searchParams.set('domain', domain);
    const probe = new Request(probeUrl, { signal: AbortSignal.timeout(5000) });
    probe.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(await workspaceKey(env, id), id, null, probe),
    );
    const checked = await workspaceService(env, selected.binding).fetch(probe);
    if (!checked.ok) {
      await checked.body?.cancel();
      return unavailable(503);
    }
    const result = eligibility.parse(await checked.json());
    if (!result.revision && route.state === 'active')
      await directory.withdraw(route);
    if (
      result.revision !== route.revision ||
      result.listing !== route.listing_id
    )
      return unavailable();
    await directory.settle(route, result.revision);
    const canonicalPath = `/${domain}${suffix}`;
    if (legacy || incoming.pathname !== canonicalPath)
      return new Response(null, {
        status: 308,
        headers: { ...headers, Location: canonicalPath + incoming.search },
      });

    const workspace = await workspaceFor(env, id);
    if (!workspace) return unavailable(503);
    const url = new URL(incoming);
    url.pathname = `/d/${domain}${suffix}`;
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
    const current = await directory.get(domain);
    if (
      !current ||
      current.generation !== route.generation ||
      current.state !== 'active'
    ) {
      await response.body?.cancel();
      return unavailable();
    }
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
