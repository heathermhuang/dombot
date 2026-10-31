import { publicSite } from './public-site';
import {
  verifyTenantAdmission,
  verifyGatewayRequest,
} from '../shared/gateway-proof';
import worker, { mcpPreflight } from '@domains-domains/dombot-engine';
import { adminInventoryQuerySchema } from '../shared/admin-inventory';
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
    if (platformPath === '/platform-internal/public-site') {
      const proof = await verifyGatewayRequest(
        env.DOMBOT_GATEWAY_SECRET ?? '',
        env.DOMBOT_WORKSPACE_ID ?? '',
        request,
      );
      if (
        request.method !== 'GET' ||
        !proof ||
        proof.owner !== null ||
        proof.sales ||
        proof.mcp
      )
        return new Response('Forbidden', {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        });
      return publicSite(request, env.DB, env.DOMBOT_SALES_ORIGIN);
    }

    if (
      [
        '/platform-internal/reconcile',
        '/platform-internal/resume',
        '/platform-internal/health',
        '/platform-internal/pause',
        '/platform-internal/admin-snapshot',
        '/platform-internal/sync-monitor',
        '/platform-internal/admin-inventory',
        '/platform-internal/renewal-pricing',
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
        platformPath === '/platform-internal/sync-monitor' ||
        platformPath === '/platform-internal/admin-inventory' ||
        platformPath === '/platform-internal/renewal-pricing'
      ) {
        if (
          request.method !==
          (platformPath.endsWith('/admin-inventory') ||
          platformPath.endsWith('/renewal-pricing')
            ? 'POST'
            : 'GET')
        )
          return new Response('Method not allowed', { status: 405 });
        const proof = await verifyGatewayRequest(
          env.DOMBOT_GATEWAY_SECRET ?? '',
          env.DOMBOT_WORKSPACE_ID ?? '',
          request,
        );
        if (!proof || proof.owner !== null || proof.sales || proof.mcp)
          return new Response('Forbidden', { status: 403 });
        if (platformPath.endsWith('/renewal-pricing')) {
          const text = await request.text();
          if (text.length > 64)
            return new Response('Request too large', { status: 413 });
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            return new Response('Invalid pricing request', { status: 400 });
          }
          if (
            !body ||
            typeof body !== 'object' ||
            Object.keys(body).length !== 1 ||
            !('step' in body) ||
            typeof body.step !== 'boolean'
          )
            return new Response('Invalid pricing request', { status: 400 });
          return Response.json(
            await coordinator(env).renewalPricing(body.step),
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }
        if (platformPath.endsWith('/sync-monitor')) {
          // One atomic D1 row does not require the owner coordinator. Keep
          // monitoring independent of its RPC availability and request lifecycle.
          const started = Date.now();
          const id = request.headers.get('X-DomBot-Observation-ID');
          const probeId = id && /^[a-f0-9-]{36}$/.test(id) ? id : undefined;
          const debug =
            request.headers.get('X-DomBot-Observation-Debug') === 'retry';
          if (debug)
            console.info(
              'workspace-monitor-read-start',
              JSON.stringify({ probeId }),
            );
          try {
            const value = await worker.syncMonitor(
              env,
              new URL(request.url).searchParams.get('revision') ?? undefined,
            );
            if (debug || Date.now() - started > 1000)
              console.info(
                'workspace-monitor-read-end',
                JSON.stringify({
                  probeId,
                  outcome: 'ok',
                  durationMs: Date.now() - started,
                }),
              );
            return Response.json(value, {
              headers: {
                'Cache-Control': 'no-store',
                'X-DomBot-Monitor-Path': 'direct-d1',
                'X-DomBot-Monitor-Read-Ms': String(Date.now() - started),
              },
            });
          } catch (error) {
            const candidate =
              error && typeof error === 'object' && 'stage' in error
                ? error.stage
                : null;
            const stage = [
              'storage',
              'envelope',
              'decryption',
              'validation',
            ].includes(String(candidate))
              ? String(candidate)
              : 'unknown';
            console.warn(
              'workspace-monitor-read',
              JSON.stringify({
                code: 'diagnostics_read_failed',
                probeId,
                stage,
                durationMs: Date.now() - started,
              }),
            );
            return Response.json(
              { error: 'Diagnostic read unavailable' },
              {
                status: 503,
                headers: {
                  'Cache-Control': 'no-store',
                  'X-DomBot-Monitor-Path': 'direct-d1',
                  'X-DomBot-Monitor-Failure': stage,
                },
              },
            );
          }
        }
        if (platformPath.endsWith('/admin-inventory')) {
          const body = await request.text();
          if (body.length > 2048)
            return new Response('Request too large', { status: 413 });
          let value: unknown;
          try {
            value = JSON.parse(body);
          } catch {
            return new Response('Invalid inventory query', { status: 400 });
          }
          const parsed = adminInventoryQuerySchema.safeParse(value);
          if (!parsed.success)
            return new Response('Invalid inventory query', { status: 400 });
          return Response.json(
            await coordinator(env).adminInventory(parsed.data),
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }
        return Response.json(await coordinator(env).adminSnapshot(), {
          headers: { 'Cache-Control': 'no-store' },
        });
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
