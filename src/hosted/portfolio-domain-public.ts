import { timingSafeEqual } from 'node:crypto';
import {
  portfolioDomainsEnabled,
  portfolioWorkspaceAllowed,
  portfolioProbeHash,
  portfolioControlLease,
  type PortfolioHostnameRow,
} from './portfolio-domains';
import { ownsHostname } from './hostname-claims';
import { forwardPublicSite } from './public-site-forward';
const noStore = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const missing = () =>
  new Response('Profile not found', { status: 404, headers: noStore });
function validNonce(value: string | null, expected: string | null) {
  return (
    !!value &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    !!expected &&
    /^[a-f0-9]{64}$/.test(expected) &&
    timingSafeEqual(
      Buffer.from(portfolioProbeHash(value), 'hex'),
      Buffer.from(expected, 'hex'),
    )
  );
}
/** Public-only external hostname. The actual successful HTTPS GET completes
 * setup; no server-side fetch is made to a customer-controlled DNS address. */
export async function portfolioDomainPublicRequest(
  request: Request,
  env: HostedEnv,
): Promise<Response | null> {
  if (!portfolioDomainsEnabled(env) || !env.CANONICAL_ORIGIN) return null;
  const url = new URL(request.url),
    base = new URL(env.CANONICAL_ORIGIN).hostname;
  if (url.hostname === base || url.hostname.endsWith('.' + base)) return null;
  const row = await env.CONTROL_DB.prepare(
    'SELECT * FROM portfolio_hostnames WHERE hostname=?',
  )
    .bind(url.hostname)
    .first<PortfolioHostnameRow>();
  if (!row) return null;
  if (!portfolioWorkspaceAllowed(env, row.workspace_id)) return missing();
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', {
      status: 405,
      headers: noStore,
    });
  if (url.port || !/^\/(?:c\/[a-z0-9-]+\/?)?$/.test(url.pathname))
    return missing();
  if (url.protocol !== 'https:') {
    url.protocol = 'https:';
    return new Response(null, {
      status: 308,
      headers: { ...noStore, Location: url.href },
    });
  }
  if (
    !['active', 'checking'].includes(row.status) ||
    row.control_expires_at <= Date.now()
  )
    return missing();
  const enabled = await env.CONTROL_DB.prepare(
    'SELECT 1 FROM workspaces w WHERE w.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(row.workspace_id)
    .first();
  if (
    !enabled ||
    !(await ownsHostname(
      env.CONTROL_DB,
      row.hostname,
      'portfolio',
      row.owner_key,
    ))
  )
    return missing();
  const nonce = url.searchParams.get('__portfolio_check');
  if (row.status === 'checking' && !validNonce(nonce, row.probe_hash))
    return missing();
  const clean = new URL(url);
  clean.searchParams.delete('__portfolio_check');
  clean.pathname = clean.pathname.replace(/\/$/, '') || '/';
  const response = await forwardPublicSite(env, row.workspace_id, clean);
  const headers = new Headers(response.headers);
  headers.delete('Set-Cookie');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  if (
    row.status === 'checking' &&
    request.method === 'GET' &&
    response.ok &&
    response.headers.get('X-Domains-Public-Revision')
  ) {
    const activated = await env.CONTROL_DB.prepare(
      "UPDATE portfolio_hostnames SET status='active',probe_hash=NULL,verification_url=NULL,observed_revision=?,control_expires_at=?,next_check_at=?,last_error=NULL,updated_at=? WHERE hostname=? AND workspace_id=? AND epoch=? AND status='checking' AND probe_hash=? AND control_expires_at>? AND EXISTS(SELECT 1 FROM public_hostname_claims c WHERE c.hostname=portfolio_hostnames.hostname AND c.kind='portfolio' AND c.owner_key=portfolio_hostnames.owner_key AND c.held=1) AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=portfolio_hostnames.workspace_id AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests x WHERE x.workspace_id=w.id)) RETURNING hostname",
    )
      .bind(
        response.headers.get('X-Domains-Public-Revision'),
        Date.now() + portfolioControlLease,
        Date.now() + 900000,
        Date.now(),
        row.hostname,
        row.workspace_id,
        row.epoch,
        row.probe_hash,
        Date.now(),
      )
      .first();
    await response.body?.cancel();
    if (!activated) return missing();
    return new Response(null, {
      status: 303,
      headers: { ...noStore, Location: clean.href },
    });
  }
  if (request.method === 'HEAD') await response.body?.cancel();
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}
