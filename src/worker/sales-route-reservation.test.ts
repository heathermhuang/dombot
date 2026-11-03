import { describe, expect, it } from 'vitest';
import { saleRouteReservation } from './sales-route-reservation';
import { verifyGatewayRequest } from '../shared/gateway-proof';
const workspace = crypto.randomUUID(),
  key = 'synthetic-directory-key'.repeat(3);
const claim = {
  domain: 'working.io',
  listing: crypto.randomUUID(),
  revision: crypto.randomUUID(),
};
describe('publication route admission', () => {
  it('keeps self-hosted publication independent and fails closed for an unconfigured hosted writer', async () => {
    expect(saleRouteReservation({ DOMBOT_AUTH: 'password' })).toBeUndefined();
    await expect(
      saleRouteReservation({ DOMBOT_AUTH: 'gateway' })!(claim),
    ).rejects.toThrow(/routing is not ready/);
  });
  it('binds tenant identity, method and exact revision; unknown responses remain retryable', async () => {
    const bodies: string[] = [];
    const reserve = saleRouteReservation({
      DOMBOT_AUTH: 'gateway',
      DOMBOT_WORKSPACE_ID: workspace,
      DOMBOT_GATEWAY_SECRET: key,
      DOMBOT_PUBLIC_DIRECTORY: {
        fetch: async (request: Request) => {
          const proof = await verifyGatewayRequest(key, workspace, request);
          expect(proof).toEqual({ owner: null });
          bodies.push(await request.text());
          return new Response('', { status: bodies.length === 1 ? 503 : 200 });
        },
      } as unknown as Env,
    })!;
    await expect(reserve(claim)).rejects.toThrow(/reconcile/);
    await reserve(claim);
    expect(bodies[0]).toBe(bodies[1]);
  });
});
