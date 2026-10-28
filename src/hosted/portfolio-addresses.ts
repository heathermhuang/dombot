import { activePortfolioHostname } from './portfolio-domains';
import { z } from 'zod';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { brandFontBytes, brandFontPath } from './brand-font';

import { reservedPortfolioHandles } from './reserved-portfolio-handles';

export const publicHandleSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers and single hyphens between words.',
  )
  .refine(
    (name) => !name.includes('--') && !reservedPortfolioHandles.has(name),
    'This address is reserved. Choose another name.',
  );

const enabled = (env: HostedEnv) =>
  env.PUBLIC_SITE_ADDRESSES_ENABLED === 'true';
export async function addressState(env: HostedEnv, workspace: string) {
  if (!enabled(env)) return { enabled: false, address: null };
  const row = await env.CONTROL_DB.prepare(
    'SELECT handle FROM portfolio_addresses WHERE workspace_id=?',
  )
    .bind(workspace)
    .first<{ handle: string }>();
  const custom = row ? await activePortfolioHostname(env, workspace) : null;
  return {
    enabled: true,
    address: row
      ? {
          handle: row.handle,
          url: custom
            ? `https://${custom.hostname}/`
            : `${env.CANONICAL_ORIGIN ?? ''}/${row.handle}`,
        }
      : null,
  };
}
export async function claimAddress(
  env: HostedEnv,
  workspace: string,
  raw: unknown,
) {
  if (!enabled(env)) throw new Error('Public addresses are not available yet.');
  const { handle } = z
    .object({ handle: publicHandleSchema })
    .strict()
    .parse(raw);
  const existing = await addressState(env, workspace);
  if (existing.address) {
    if (existing.address.handle === handle) return existing;
    throw new Error(
      'Your public address is already saved. It cannot be changed here.',
    );
  }
  // One unique handle per account and one account per handle, including racing claims.
  const claimed = await env.CONTROL_DB.prepare(
    'INSERT INTO portfolio_addresses(handle,workspace_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING handle',
  )
    .bind(handle, workspace, Date.now())
    .first();
  if (!claimed) {
    const current = await addressState(env, workspace);
    if (current.address?.handle === handle) return current;
    throw new Error('That address is already taken. Choose another name.');
  }
  return addressState(env, workspace);
}

/** Public routes read only the saved public projection. Never forward credentials,
 * POSTs, caller-selected workspace IDs, or owner authority to a public address. */
export async function publicAddressRequest(
  request: Request,
  env: HostedEnv,
): Promise<Response | null> {
  if (!enabled(env) || !env.CANONICAL_ORIGIN) return null;
  const incoming = new URL(request.url);
  const canonical = new URL(env.CANONICAL_ORIGIN);
  let handle: string;
  let publicPath: string;
  if (incoming.hostname === canonical.hostname) {
    const match = incoming.pathname.match(
      /^\/([a-z0-9-]+)(\/c\/[a-z0-9-]+)?\/?$/,
    );
    if (!match || !publicHandleSchema.safeParse(match[1]).success) return null;
    handle = match[1];
    publicPath = `/${handle}${match[2] ?? ''}`;
  } else {
    if (
      env.PUBLIC_SITE_SUBDOMAINS_ENABLED !== 'true' ||
      !incoming.hostname.endsWith(`.${canonical.hostname}`)
    )
      return null;
    handle = incoming.hostname.slice(0, -(canonical.hostname.length + 1));
    if (!publicHandleSchema.safeParse(handle).success) return null;
    if (incoming.pathname === brandFontPath && request.method === 'GET')
      return new Response(brandFontBytes, {
        headers: {
          'Content-Type': 'font/woff2',
          'Cache-Control': 'public,max-age=31536000,immutable',
        },
      });
    if (!/^\/(?:c\/[a-z0-9-]+\/?)?$/.test(incoming.pathname))
      return new Response('Page not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    publicPath = incoming.pathname.replace(/\/$/, '') || '/';
  }
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', { status: 405, headers });
  const row = await env.CONTROL_DB.prepare(
    'SELECT a.workspace_id FROM portfolio_addresses a JOIN workspaces w ON w.id=a.workspace_id WHERE a.handle=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(handle)
    .first<{ workspace_id: string }>();
  if (!row) return new Response('Profile not found', { status: 404, headers });
  const configured = await workspaceFor(env, row.workspace_id);
  if (!configured)
    return new Response('Profile not found', { status: 404, headers });
  if (
    incoming.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(incoming.hostname)
  ) {
    incoming.protocol = 'https:';
    return Response.redirect(incoming.href, 308);
  }
  // Subdomains are aliases of the short path. Redirect before rendering so
  // collection links remain same-origin and canonical URLs have one identity.
  if (incoming.hostname !== canonical.hostname) {
    return new Response(null, {
      status: 308,
      headers: {
        ...headers,
        Location: `${canonical.origin}/${handle}${publicPath === '/' ? '' : publicPath}${incoming.search}`,
      },
    });
  }
  const path = publicPath;
  const target = new URL('/platform-internal/public-site', canonical);
  target.search = incoming.search;
  target.searchParams.set('__public_path', path);
  const forwarded = new Request(target, { method: 'GET' });
  forwarded.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, row.workspace_id),
      row.workspace_id,
      null,
      forwarded,
    ),
  );
  const response = await workspaceService(env, configured.binding).fetch(
    forwarded,
  );
  const custom = response.ok
    ? await activePortfolioHostname(env, row.workspace_id)
    : null;
  if (custom) {
    await response.body?.cancel();
    const destination = new URL(
      publicPath === `/${handle}` ? '/' : publicPath.slice(handle.length + 1),
      `https://${custom.hostname}`,
    );
    destination.search = incoming.search;
    return new Response(null, {
      status: 308,
      headers: { ...headers, Location: destination.href },
    });
  }
  const outgoing = new Headers(response.headers);
  outgoing.delete('Set-Cookie');
  outgoing.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: outgoing,
  });
}
