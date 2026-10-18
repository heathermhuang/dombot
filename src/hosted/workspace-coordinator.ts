import { DurableObject } from 'cloudflare:workers';
import worker from '@domains-domains/dombot-engine';
import { verifyTenantAdmission } from '../shared/gateway-proof';

/** One coordinator per tenant deployment. DomBot owns a single-instance,
 * in-memory store, so every API/MCP request and scheduled sync must reach
 * the same runtime before its hydrate -> mutate -> flush request lock. */
export class WorkspaceCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    let rejected = 'invalid';
    if (
      !(await verifyTenantAdmission(this.env, request, (reason) => {
        rejected = reason;
      }))
    ) {
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
    return worker.fetch(request, this.env, {
      waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work),
    });
  }

  async runScheduled(cron: string, scheduledTime: number): Promise<void> {
    // RPC is available only through the private Durable Object binding.
    // The original handler uses the same request lock as fetch requests.
    await worker.scheduled({ cron, scheduledTime, noRetry() {} }, this.env);
  }
}
