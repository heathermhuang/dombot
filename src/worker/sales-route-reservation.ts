import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { SalesError } from '../shared/sales-review';

export type ReserveSaleRoute = (claim: {
  domain: string;
  listing: string;
  revision: string;
}) => Promise<void>;
/** Runs before the tenant's atomic commit, including composite/bulk writers.
 * No successful reserve means no new publication. Unknown outcomes retain the
 * reservation and can be retried under the same reviewed revision. */
export function saleRouteReservation(
  env: Partial<Env>,
): ReserveSaleRoute | undefined {
  if (env.DOMBOT_AUTH !== 'gateway') return undefined;
  return async (claim) => {
    if (
      !env.DOMBOT_PUBLIC_DIRECTORY ||
      !env.DOMBOT_WORKSPACE_ID ||
      !env.DOMBOT_GATEWAY_SECRET
    )
      throw new SalesError(
        'DIRECTORY_UNAVAILABLE',
        'Public routing is not ready. Your draft and review are retained.',
        503,
      );
    const request = new Request(
      `https://directory.internal/internal/public-directory/${env.DOMBOT_WORKSPACE_ID}`,
      {
        method: 'POST',
        body: JSON.stringify(claim),
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      },
    );
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        env.DOMBOT_GATEWAY_SECRET,
        env.DOMBOT_WORKSPACE_ID,
        null,
        request,
      ),
    );
    const result = await env.DOMBOT_PUBLIC_DIRECTORY.fetch(request);
    await result.body?.cancel();
    if (!result.ok)
      throw new SalesError(
        'ROUTE_UNRESOLVED',
        result.status === 409
          ? 'The domain route is held for an ownership review.'
          : 'The route reservation could not be confirmed. Retry this reviewed publication to reconcile it.',
        result.status === 409 ? 409 : 503,
      );
  };
}
