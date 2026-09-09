import worker from '../worker';
import { verifyGatewayRequest } from '../shared/gateway-proof';

/** Each deployment has its own DB, encryption root, workspace ID and gateway
 * key. No caller can select a database or tenant through a request parameter. */
export default {
  async fetch(request, env, ctx) {
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
    return worker.fetch(request, env, ctx);
  },
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;
