import { z } from 'zod';
import { saleMoneySchema } from '../shared/hosted-sales';
import {
  simulatorCallbackKey,
  simulatorProviderId,
} from './checkout-simulator-provider';
import type { CheckoutObservation } from './checkout-reservations';

interface SimulatorEnv {
  CHECKOUT_SIMULATOR_LEDGER: DurableObjectNamespace;
  CHECKOUT_SIMULATOR_KEY: string;
}
type Session = {
  merchantReference: string;
  session: string;
  price: CheckoutObservation['price'];
  observations: CheckoutObservation[];
};
const settlementEvent = z
  .object({
    eventId: z.uuid(),
    type: z.enum(['payment', 'transfer', 'cancel-final', 'refund-final']),
    reference: z.string().min(1).max(200),
  })
  .strict();
const faultSchema = z
  .object({
    loseCreationResponse: z.boolean(),
  })
  .strict();

async function json(request: Request) {
  const body = await request.text();
  if (body.length > 1024) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export class CheckoutSimulatorLedger {
  constructor(
    private state: DurableObjectState,
    private env: SimulatorEnv,
  ) {}

  async fetch(request: Request) {
    const route =
      /^\/(sessions|cancel|qualification\/events|qualification\/faults)\/([a-f0-9-]+)$/.exec(
        new URL(request.url).pathname,
      );
    if (!route || !z.uuid().safeParse(route[2]).success)
      return new Response(null, { status: 404 });
    const [, action, reference] = route;

    if (action === 'sessions' && request.method === 'GET') {
      const saved = await this.state.storage.get<Session>(
        'session:' + reference,
      );
      return saved ? Response.json(saved) : new Response(null, { status: 404 });
    }
    if (action === 'sessions' && request.method === 'PUT') {
      if (
        request.headers.get('Idempotency-Key') !==
        'checkout:create:' + reference
      )
        return new Response(null, { status: 400 });
      const price = saleMoneySchema.safeParse(await json(request));
      if (!price.success) return new Response(null, { status: 400 });
      const key = 'session:' + reference;
      return this.state.storage.transaction(async (tx) => {
        const existing = await tx.get<Session>(key);
        if (existing) {
          if (
            existing.price.amount !== price.data.amount ||
            existing.price.currency !== price.data.currency
          )
            return new Response(null, { status: 409 });
          return Response.json(existing);
        }
        const value: Session = {
          merchantReference: reference,
          session: crypto.randomUUID(),
          price: price.data,
          observations: [],
        };
        await tx.put(key, value);
        await tx.put('ref:' + value.session, reference);
        const lost = await tx.get('lost-response:' + reference);
        if (lost) {
          await tx.delete('lost-response:' + reference);
          return new Response(null, { status: 503 });
        }
        return Response.json(value, { status: 201 });
      });
    }
    if (action === 'cancel' && request.method === 'POST') {
      return this.state.storage.transaction(async (tx) => {
        const reservation = await tx.get<string>('ref:' + reference);
        if (
          !reservation ||
          request.headers.get('Idempotency-Key') !==
            'checkout:cancel:' + reservation
        )
          return new Response(null, { status: 404 });
        const key = 'session:' + reservation;
        const value = (await tx.get<Session>(key))!;
        if (
          !value.observations.some((item) =>
            ['payment', 'transfer', 'cancel-final'].includes(item.type),
          )
        ) {
          value.observations.push({
            eventId: 'cancel:' + value.session,
            provider: simulatorProviderId,
            session: value.session,
            type: 'cancel-final',
            reference: 'simulator-cancel:' + value.session,
            price: value.price,
          });
          await tx.put(key, value);
        }
        return new Response(null, { status: 204 });
      });
    }
    if (action === 'qualification/faults' && request.method === 'PUT') {
      const fault = faultSchema.safeParse(await json(request));
      if (!fault.success) return new Response(null, { status: 400 });
      await this.state.storage.put(
        'lost-response:' + reference,
        fault.data.loseCreationResponse,
      );
      return new Response(null, { status: 204 });
    }
    if (action === 'qualification/events' && request.method === 'POST') {
      const event = settlementEvent.safeParse(await json(request));
      if (!event.success) return new Response(null, { status: 400 });
      const stored = await this.state.storage.transaction(async (tx) => {
        const key = 'session:' + reference;
        const value = await tx.get<Session>(key);
        if (!value) return false;
        const existing = value.observations.find(
          (item) => item.eventId === event.data.eventId,
        );
        if (existing)
          return (
            existing.type === event.data.type &&
            existing.reference === event.data.reference
          );
        if (value.observations.length >= 30) return false;
        value.observations.push({
          ...event.data,
          provider: simulatorProviderId,
          session: value.session,
          price: value.price,
        });
        await tx.put(key, value);
        return true;
      });
      if (!stored) return new Response(null, { status: 409 });
      const body = JSON.stringify({
        merchantReference: reference,
        issuedAt: Date.now(),
      });
      const bytes = await crypto.subtle.sign(
        'HMAC',
        await simulatorCallbackKey(this.env.CHECKOUT_SIMULATOR_KEY),
        new TextEncoder().encode(body),
      );
      const signature = Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      return Response.json({ body, signature });
    }
    if (action === 'qualification/events' && request.method === 'DELETE') {
      await this.state.storage.transaction(async (tx) => {
        const saved = await tx.get<Session>('session:' + reference);
        if (saved) await tx.delete('ref:' + saved.session);
        await tx.delete(['session:' + reference, 'lost-response:' + reference]);
      });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }
}

// Deploy as a private service binding in isolated staging with no public routes.
export default {
  fetch(request, env) {
    if ((env.CHECKOUT_SIMULATOR_KEY?.length ?? 0) < 32)
      return new Response(null, { status: 503 });
    const ledger = env.CHECKOUT_SIMULATOR_LEDGER;
    return ledger.get(ledger.idFromName('staging-escrow')).fetch(request);
  },
} satisfies ExportedHandler<SimulatorEnv>;
