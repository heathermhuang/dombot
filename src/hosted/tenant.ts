import {
  verifyTenantAdmission,
  verifyGatewayRequest,
} from '../shared/gateway-proof';
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
    if (!(await verifyTenantAdmission(env, request))) {
      return Response.json(
        { error: 'Trusted gateway request required' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const platformPath = new URL(request.url).pathname;
    if (
      [
        '/platform-internal/reconcile',
        '/platform-internal/resume',
        '/platform-internal/health',
        '/platform-internal/pause',
        '/platform-internal/admin-snapshot',
        '/platform-internal/sync-monitor',
      ].includes(platformPath)
    ) {
      // Anonymous lander admission cannot operate platform lifecycle controls.
      if (
        !(await verifyGatewayRequest(
          env.DOMBOT_GATEWAY_SECRET ?? '',
          env.DOMBOT_WORKSPACE_ID ?? '',
          request,
        ))
      )
        return new Response('Forbidden', { status: 403 });
      if (
        platformPath === '/platform-internal/admin-snapshot' ||
        platformPath === '/platform-internal/sync-monitor'
      ) {
        if (request.method !== 'GET')
          return new Response('Method not allowed', { status: 405 });
        const proof = await verifyGatewayRequest(
          env.DOMBOT_GATEWAY_SECRET ?? '',
          env.DOMBOT_WORKSPACE_ID ?? '',
          request,
        );
        if (!proof || proof.owner !== null || proof.sales || proof.mcp)
          return new Response('Forbidden', { status: 403 });
        return Response.json(
          platformPath.endsWith('/sync-monitor')
            ? await coordinator(env).syncMonitor(
                new URL(request.url).searchParams.get('revision') ?? undefined,
              )
            : await coordinator(env).adminSnapshot(),
          {
            headers: { 'Cache-Control': 'no-store' },
          },
        );
      }
      const controlProof = await verifyGatewayRequest(
        env.DOMBOT_GATEWAY_SECRET ?? '',
        env.DOMBOT_WORKSPACE_ID ?? '',
        request,
      );
      if (
        !controlProof ||
        controlProof.owner !== null ||
        controlProof.sales ||
        controlProof.mcp
      )
        return new Response('Forbidden', { status: 403 });
      if (Reflect.get(env, 'DOMBOT_PLATFORM_ALARMS') !== 'true')
        return new Response('Not found', { status: 404 });
      if (
        platformPath.endsWith('/reconcile') ||
        platformPath.endsWith('/resume')
      ) {
        if (request.method !== 'POST')
          return new Response('Method not allowed', { status: 405 });
        return Response.json(
          platformPath.endsWith('/resume')
            ? await coordinator(env).resumePlatformAlarm()
            : await coordinator(env).reconcileMaintenance(),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      if (platformPath.endsWith('/pause')) {
        if (request.method !== 'POST')
          return new Response('Method not allowed', { status: 405 });
        await coordinator(env).pausePlatformAlarm();
      }
      return Response.json(await coordinator(env).platformHealth(), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const denied = await mcpPreflight(request, env);
    const response = denied ?? (await coordinator(env).fetch(request));
    const headers = new Headers(response.headers);
    // During deployment the coordinator can still run its previous release.
    // Preserve its provenance; only local preflight responses use this wrapper's.
    if (denied) {
      headers.set('X-DomBot-Engine', engineManifest.version);
      headers.set('X-DomBot-Engine-Source', engineManifest.sourceSha256);
    }
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(event, env) {
    await coordinator(env).runScheduled(event.cron, event.scheduledTime);
  },
} satisfies ExportedHandler<HostedTenantEnv>;
