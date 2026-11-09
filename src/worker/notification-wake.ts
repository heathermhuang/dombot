import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';

/** Persist a wake hint after a completed cache change; never waits for a send. */
export async function wakePortfolioNotifications(env: Env) {
  if (
    Reflect.get(env, 'DOMBOT_NOTIFICATION_V1') !== 'true' ||
    !env.DOMBOT_GATEWAY_SECRET ||
    !env.DOMBOT_WORKSPACE_ID ||
    !env.DOMBOT_SALES_ORIGIN
  )
    return;
  const origin = new URL(env.DOMBOT_SALES_ORIGIN).origin;
  if (origin !== 'https://domains.domains') return;
  const request = new Request(
    `${origin}/internal/notifications/${env.DOMBOT_WORKSPACE_ID}/wake`,
    {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    },
  );
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      env.DOMBOT_GATEWAY_SECRET,
      env.DOMBOT_WORKSPACE_ID,
      null,
      request,
      { purpose: 'portfolio-notifications' },
    ),
  );
  const response = await fetch(request);
  await response.body?.cancel();
  if (!response.ok) throw Error('Notification wake checkpoint unavailable.');
}
