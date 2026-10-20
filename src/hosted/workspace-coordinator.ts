import { DurableObject } from 'cloudflare:workers';
import worker from '@domains-domains/dombot-engine';
import engineManifest from '@domains-domains/dombot-engine/manifest';
import { verifyTenantAdmission } from '../shared/gateway-proof';

/** One coordinator per tenant deployment. DomBot owns a single-instance,
 * in-memory store, so every API/MCP request and scheduled sync must reach
 * the same runtime before its hydrate -> mutate -> flush request lock. */
export class WorkspaceCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    let rejected = 'invalid';
    const admission = await verifyTenantAdmission(
      this.env,
      request,
      (reason) => {
        rejected = reason;
      },
    );
    if (!admission) {
      return Response.json(
        { error: 'Trusted gateway request required' },
        {
          status: 403,
          headers: {
            'Cache-Control': 'no-store',
            'X-DomBot-Proof-Failure': rejected,
          },
        },
      );
    }
    // User Workers do not need one ordinary cron per tenant. Only the new
    // platform deployments opt in; existing customer schedules stay unchanged.
    if (
      Reflect.get(this.env, 'DOMBOT_PLATFORM_ALARMS') === 'true' &&
      admission.owner &&
      !(await this.ctx.storage.getAlarm())
    )
      await this.ctx.storage.setAlarm(Date.now() + 300_000);
    const response = await worker.fetch(request, this.env, {
      waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work),
    });
    const headers = new Headers(response.headers);
    headers.set('X-DomBot-Engine', engineManifest.version);
    headers.set('X-DomBot-Engine-Source', engineManifest.sourceSha256);
    return new Response(response.body, { status: response.status, headers });
  }

  async alarm(): Promise<void> {
    if (Reflect.get(this.env, 'DOMBOT_PLATFORM_ALARMS') !== 'true') return;
    try {
      await this.runScheduled('platform-alarm', Date.now());
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 300_000);
    }
  }

  async platformHealth() {
    return {
      workspace: this.env.DOMBOT_WORKSPACE_ID,
      alarmAt: await this.ctx.storage.getAlarm(),
      release: Reflect.get(this.env, 'DOMBOT_PLATFORM_RELEASE') ?? '',
    };
  }

  async pausePlatformAlarm() {
    await this.ctx.storage.deleteAlarm();
  }

  async runScheduled(cron: string, scheduledTime: number): Promise<void> {
    // RPC is available only through the private Durable Object binding.
    // The original handler uses the same request lock as fetch requests.
    await worker.scheduled({ cron, scheduledTime, noRetry() {} }, this.env);
  }
}
