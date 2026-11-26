import { z } from 'zod';
import { saleMoneySchema } from '../shared/hosted-sales';
import type { CheckoutProvider } from './checkout-coordinator';
import type { CheckoutReservation } from './checkout-reservations';

export const simulatorProviderId = 'staging-escrow';
const simulatorOrigin = 'https://checkout-simulator.invalid';
const observation = z
  .object({
    eventId: z.string().min(1).max(200),
    provider: z.literal(simulatorProviderId),
    session: z.uuid(),
    type: z.enum(['payment', 'transfer', 'cancel-final', 'refund-final']),
    reference: z.string().min(1).max(200),
    price: saleMoneySchema,
  })
  .strict();
const sessionSchema = z
  .object({
    merchantReference: z.uuid(),
    session: z.uuid(),
    price: saleMoneySchema,
    observations: z.array(observation).max(32),
  })
  .strict();
const callbackSchema = z
  .object({
    merchantReference: z.uuid(),
    issuedAt: z.number().int(),
  })
  .strict();

export async function simulatorCallbackKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export class CheckoutSimulatorProvider implements CheckoutProvider {
  readonly id = simulatorProviderId;

  constructor(
    private readonly service: Fetcher,
    private readonly secret: string,
    private readonly buyerOrigin: string,
  ) {}

  async authenticateCallback(request: Request) {
    const signature = request.headers.get('X-Checkout-Signature');
    if (
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      this.secret.length < 32
    )
      return null;
    const mac = Uint8Array.from(signature.match(/../g)!, (v) =>
      parseInt(v, 16),
    );
    const bytes = await request.arrayBuffer();
    if (
      bytes.byteLength > 1024 ||
      !(await crypto.subtle.verify(
        'HMAC',
        await simulatorCallbackKey(this.secret),
        mac,
        bytes,
      ))
    )
      return null;
    const payload = callbackSchema.safeParse(
      await new Response(bytes).json().catch(() => null),
    );
    return payload.success &&
      Math.abs(Date.now() - payload.data.issuedAt) <= 60_000
      ? payload.data.merchantReference
      : null;
  }

  private async read(response: Response) {
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Staging escrow session needs reconciliation');
    }
    const session = sessionSchema.parse(await response.json());
    return {
      ...session,
      url: this.buyerOrigin + '/checkout/staging/session/' + session.session,
    };
  }

  async find(reference: string) {
    const response = await this.service.fetch(
      simulatorOrigin + '/sessions/' + reference,
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    return this.read(response);
  }

  async create(approval: CheckoutReservation, idempotencyKey: string) {
    return this.read(
      await this.service.fetch(simulatorOrigin + '/sessions/' + approval.id, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          amount: approval.amount,
          currency: approval.currency,
        }),
        signal: AbortSignal.timeout(5000),
      }),
    );
  }

  async cancel(session: string, idempotencyKey: string) {
    const response = await this.service.fetch(
      simulatorOrigin + '/cancel/' + session,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        signal: AbortSignal.timeout(5000),
      },
    );
    await response.body?.cancel();
    if (!response.ok)
      throw new Error('Staging escrow cancellation needs reconciliation');
  }
}
