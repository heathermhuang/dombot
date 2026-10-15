import { verifyGatewayRequest } from '../shared/gateway-proof';
import { mcpPreflight } from '@domains-domains/dombot-engine';
import engineManifest from '@domains-domains/dombot-engine/manifest';
import { WorkspaceCoordinator } from './workspace-coordinator';
export { WorkspaceCoordinator };

interface HostedTenantEnv extends Env {
  WORKSPACE_COORDINATOR?: DurableObjectNamespace<WorkspaceCoordinator>;
}

function coordinator(env: HostedTenantEnv) {
  if (!env.WORKSPACE_COORDINATOR || !env.DOMBOT_WORKSPACE_ID)
    throw new Error('Workspace coordinator is not configured');
  return env.WORKSPACE_COORDINATOR.get(
    env.WORKSPACE_COORDINATOR.idFromName(env.DOMBOT_WORKSPACE_ID),
  );
}

/** Each deployment has its own DB, encryption root, workspace ID and gateway
 * key. No caller can select a database or tenant through a request parameter. */
export default {
  async fetch(request, env) {
    if (
      !(await verifyGatewayRequest(
        env.DOMBOT_GATEWAY_SECRET ?? '',
        env.DOMBOT_WORKSPACE_ID ?? '',
        request,
      ))
    ) {
      return Response.json(
        { error: 'Trusted gateway request required' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const denied = await mcpPreflight(request, env);
    const response = denied ?? (await coordinator(env).fetch(request));
    const headers = new Headers(response.headers);
    headers.set('X-DomBot-Engine', engineManifest.version);
    headers.set('X-DomBot-Engine-Source', engineManifest.sourceSha256);
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(event, env) {
    await coordinator(env).runScheduled(event.cron, event.scheduledTime);
  },
} satisfies ExportedHandler<HostedTenantEnv>;
