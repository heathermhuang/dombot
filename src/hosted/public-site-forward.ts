import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';

/** Gateway-only public forwarding. Neither caller cookies nor owner authority
 * enter the tenant request; the public edge never receives gateway keys. */
export async function forwardPublicSite(
  env: HostedEnv,
  workspace: string,
  publicUrl: URL,
): Promise<Response> {
  const configured = await workspaceFor(env, workspace);
  if (!configured)
    return new Response('Profile not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  const target = new URL('/platform-internal/public-site', publicUrl.origin);
  target.search = publicUrl.search;
  target.searchParams.delete('__portfolio_check');
  target.searchParams.set('__public_path', publicUrl.pathname);
  const request = new Request(target, { method: 'GET' });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      request,
    ),
  );
  return workspaceService(env, configured.binding).fetch(request);
}
