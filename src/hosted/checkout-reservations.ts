import { z } from 'zod';
import { saleDomainSchema, saleMoneySchema } from '../shared/hosted-sales';

const uuid = z.uuid();
const providerId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const providerReference = z.string().trim().min(1).max(200);
const approvalSchema = z
  .object({
    domain: saleDomainSchema,
    workspace: uuid,
    seller: uuid,
    listing: uuid,
    revision: uuid,
    case: uuid,
    approval: uuid,
    price: saleMoneySchema,
    provider: providerId,
    expiresAt: z.number().int(),
  })
  .strict();

export type CheckoutApproval = z.input<typeof approvalSchema>;
type ReservationState =
  | 'held'
  | 'creating'
  | 'open'
  | 'canceling'
  | 'paid'
  | 'transferred'
  | 'released';
export type CheckoutReservation = {
  id: string;
  domain: string;
  workspace_id: string;
  seller_id: string;
  listing_id: string;
  listing_revision: string;
  listing_generation: number;
  case_id: string;
  approval_id: string;
  currency: string;
  amount: string;
  provider: string;
  provider_session: string | null;
  state: ReservationState;
  expires_at: number;
  created_at: number;
  payment_reference: string | null;
  transfer_reference: string | null;
  refund_reference: string | null;
  release_reference: string | null;
};

// Every observation comes from the authenticated provider adapter, never an
// unsigned webhook payload, buyer redirect, or seller-entered status.
const observationSchema = z
  .object({
    eventId: providerReference,
    provider: providerId,
    session: providerReference,
    type: z.enum(['payment', 'transfer', 'cancel-final', 'refund-final']),
    reference: providerReference,
    price: saleMoneySchema,
  })
  .strict();
export type CheckoutObservation = z.input<typeof observationSchema>;

export class CheckoutConflict extends Error {}

const activeRoute = `
  EXISTS(SELECT 1 FROM public_domain_routes r JOIN workspaces w ON w.id=r.workspace_id
    WHERE r.domain=checkout_reservations.domain
      AND r.workspace_id=checkout_reservations.workspace_id
      AND r.listing_id=checkout_reservations.listing_id
      AND r.revision=checkout_reservations.listing_revision
      AND r.generation=checkout_reservations.listing_generation
      AND r.state='active' AND w.enabled=1
      AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
      AND NOT EXISTS(SELECT 1 FROM sales_domain_controls s WHERE s.workspace_id=w.id AND s.domain=r.domain AND s.status IN ('lost','recovering'))
      AND NOT EXISTS(SELECT 1 FROM checkout_domain_holds h WHERE h.domain=r.domain))`;

/**
 * Durable hosted checkout state. The caller must authenticate the seller and
 * verify the current tenant-side case, publication, and channel interlock before
 * asking to reserve or create a session. The control directory check here closes
 * the race between that approval and a conflicting control-plane update.
 */
export class CheckoutReservations {
  constructor(readonly db: D1Database) {}

  get(id: string) {
    return this.db
      .prepare('SELECT * FROM checkout_reservations WHERE id=?')
      .bind(id)
      .first<CheckoutReservation>();
  }

  async reserve(
    input: CheckoutApproval,
    now = Date.now(),
  ): Promise<CheckoutReservation> {
    const approved = approvalSchema.parse(input);
    const existing = await this.byApproval(approved.approval);
    if (existing) return this.requireSameApproval(existing, approved);
    if (approved.expiresAt <= now || approved.expiresAt - now > 30 * 60_000)
      throw new CheckoutConflict('Approve a current quote before checkout.');

    const reservation = await this.db
      .prepare(
        `INSERT INTO checkout_reservations(
          id,domain,workspace_id,seller_id,listing_id,listing_revision,
          listing_generation,case_id,approval_id,currency,amount,provider,state,
          expires_at,created_at
        )
        SELECT ?1,r.domain,r.workspace_id,?2,r.listing_id,r.revision,r.generation,
          ?3,?4,?5,?6,?7,'held',?8,?9
        FROM public_domain_routes r JOIN workspaces w ON w.id=r.workspace_id
        WHERE r.domain=?10 AND r.workspace_id=?11 AND r.listing_id=?12 AND r.revision=?13
          AND r.state='active' AND w.enabled=1
          AND EXISTS(SELECT 1 FROM users u WHERE u.id=?2 AND u.workspace_id=r.workspace_id)
          AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
          AND NOT EXISTS(SELECT 1 FROM sales_domain_controls s WHERE s.workspace_id=w.id AND s.domain=r.domain AND s.status IN ('lost','recovering'))
          AND NOT EXISTS(SELECT 1 FROM checkout_domain_holds h WHERE h.domain=r.domain)
        ON CONFLICT DO NOTHING RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        approved.seller,
        approved.case,
        approved.approval,
        approved.price.currency,
        approved.price.amount,
        approved.provider,
        approved.expiresAt,
        now,
        approved.domain,
        approved.workspace,
        approved.listing,
        approved.revision,
      )
      .first<CheckoutReservation>();
    if (reservation) return reservation;
    const raced = await this.byApproval(approved.approval);
    if (raced) return this.requireSameApproval(raced, approved);
    throw new CheckoutConflict(
      'The listing is reserved or the approved terms changed.',
    );
  }

  private byApproval(approval: string) {
    return this.db
      .prepare('SELECT * FROM checkout_reservations WHERE approval_id=?')
      .bind(approval)
      .first<CheckoutReservation>();
  }

  private requireSameApproval(
    reservation: CheckoutReservation,
    approved: z.output<typeof approvalSchema>,
  ) {
    if (
      reservation.domain !== approved.domain ||
      reservation.workspace_id !== approved.workspace ||
      reservation.seller_id !== approved.seller ||
      reservation.listing_id !== approved.listing ||
      reservation.listing_revision !== approved.revision ||
      reservation.case_id !== approved.case ||
      reservation.amount !== approved.price.amount ||
      reservation.currency !== approved.price.currency ||
      reservation.provider !== approved.provider ||
      reservation.expires_at !== approved.expiresAt
    )
      throw new CheckoutConflict(
        'This approval already refers to different terms.',
      );
    return reservation;
  }

  async beginCreation(id: string, now = Date.now()) {
    // A durable transition precedes the first provider request. Every attempt
    // shares the same reference, including retries after an unknown response.
    const row = await this.db
      .prepare(
        `UPDATE checkout_reservations SET state='creating'
         WHERE id=? AND state IN ('held','creating') AND expires_at>? AND ${activeRoute}
         RETURNING *`,
      )
      .bind(id, now)
      .first<CheckoutReservation>();
    if (!row)
      throw new CheckoutConflict('The held quote can no longer open checkout.');
    return { reservation: row, idempotencyKey: 'checkout:create:' + id };
  }

  async attachSession(
    id: string,
    provider: string,
    session: string,
    now = Date.now(),
  ) {
    const validated = providerReference.parse(session);
    const row = await this.db
      .prepare(
        `UPDATE checkout_reservations SET provider_session=?1,
         state=CASE WHEN state='creating' AND expires_at>?2 AND ${activeRoute}
           THEN 'open' WHEN state='creating' THEN 'canceling' ELSE state END
         WHERE id=?3 AND provider=?4 AND (
           (state IN ('creating','open','canceling','paid','transferred')
             AND (provider_session IS NULL OR provider_session=?1))
           OR (state='released' AND provider_session=?1)
         )
         RETURNING *`,
      )
      .bind(validated, now, id, providerId.parse(provider))
      .first<CheckoutReservation>();
    if (!row)
      throw new CheckoutConflict('The provider session cannot be attached.');
    return row;
  }

  handoff(id: string, session: string, now = Date.now()) {
    return this.db
      .prepare(
        `SELECT * FROM checkout_reservations WHERE id=? AND provider_session=?
           AND state='open' AND expires_at>? AND ${activeRoute}`,
      )
      .bind(id, session, now)
      .first<CheckoutReservation>();
  }

  async requestCancellation(id: string) {
    const row = await this.db
      .prepare(
        `UPDATE checkout_reservations SET state=CASE
           WHEN state='held' THEN 'released'
           WHEN state IN ('creating','open') THEN 'canceling'
           ELSE state END
         WHERE id=? AND state!='transferred' RETURNING *`,
      )
      .bind(id)
      .first<CheckoutReservation>();
    if (!row)
      throw new CheckoutConflict('This reservation cannot be canceled.');
    return { reservation: row, idempotencyKey: 'checkout:cancel:' + id };
  }

  async observe(id: string, input: CheckoutObservation, now = Date.now()) {
    const event = observationSchema.parse(input);
    const record = JSON.stringify(event);
    const { provider, eventId, session, type, reference, price } = event;
    const [dedupe] = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO checkout_observations(provider,event_id,reservation_id,observation,observed_at)
           SELECT ?1,?2,id,?3,?4 FROM checkout_reservations
           WHERE id=?5 AND provider=?1 AND provider_session=?6 AND currency=?7 AND amount=?8
           ON CONFLICT DO NOTHING RETURNING reservation_id`,
        )
        .bind(
          provider,
          eventId,
          record,
          now,
          id,
          session,
          price.currency,
          price.amount,
        ),
      this.db
        .prepare(
          `UPDATE checkout_reservations SET
           payment_reference=CASE WHEN ?1='payment' THEN coalesce(payment_reference,?2) ELSE payment_reference END,
           transfer_reference=CASE WHEN ?1='transfer' THEN coalesce(transfer_reference,?2) ELSE transfer_reference END,
           refund_reference=CASE WHEN ?1='refund-final' THEN coalesce(refund_reference,?2) ELSE refund_reference END,
           release_reference=CASE
             WHEN ?1='cancel-final' AND state='canceling' AND payment_reference IS NULL AND transfer_reference IS NULL THEN ?2
             WHEN ?1='refund-final' AND state='paid' AND transfer_reference IS NULL THEN ?2
             WHEN ?1='payment' AND refund_reference IS NOT NULL AND transfer_reference IS NULL THEN refund_reference
             ELSE release_reference END,
           state=CASE
             WHEN ?1='payment' AND transfer_reference IS NOT NULL THEN 'transferred'
             WHEN ?1='payment' AND refund_reference IS NOT NULL THEN 'released'
             WHEN ?1='payment' THEN 'paid'
             WHEN ?1='transfer' AND payment_reference IS NOT NULL THEN 'transferred'
             WHEN ?1='cancel-final' AND state='canceling' AND payment_reference IS NULL AND transfer_reference IS NULL THEN 'released'
             WHEN ?1='refund-final' AND state='paid' AND transfer_reference IS NULL THEN 'released'
             ELSE state END
         WHERE id=?3 AND state NOT IN ('transferred','released')
           AND EXISTS(SELECT 1 FROM checkout_observations WHERE provider=?4 AND event_id=?5
             AND reservation_id=?3 AND observation=?6)
           AND changes()=1`,
        )
        .bind(type, reference, id, provider, eventId, record),
      // Cancellation may have committed while another callback was reading
      // the provider. Journal the contradiction and hold the domain together.
      this.db
        .prepare(
          `INSERT INTO checkout_domain_holds(domain,reservation_id,observed_at)
           SELECT r.domain,r.id,?1 FROM checkout_reservations r
           JOIN checkout_observations o ON o.reservation_id=r.id
           WHERE r.id=?2 AND r.state='released' AND o.provider=?3 AND o.event_id=?4
             AND o.observation=?5 AND (
               (?6='payment' AND r.payment_reference IS NOT ?7) OR
               (?6='transfer' AND r.transfer_reference IS NOT ?7)
             )
           ON CONFLICT(domain) DO NOTHING`,
        )
        .bind(now, id, provider, eventId, record, type, reference),
      this.db
        .prepare(
          `UPDATE checkout_reservations SET state='canceling'
           WHERE state IN ('creating','open') AND domain IN (
             SELECT domain FROM checkout_domain_holds WHERE reservation_id=?
           )`,
        )
        .bind(id),
    ]);
    if (!dedupe.results.length) {
      const old = await this.db
        .prepare(
          'SELECT reservation_id,observation FROM checkout_observations WHERE provider=? AND event_id=?',
        )
        .bind(provider, eventId)
        .first<{ reservation_id: string; observation: string }>();
      if (old?.reservation_id !== id || old.observation !== record)
        throw new CheckoutConflict(
          'The observation conflicts with the reserved provider session.',
        );
    }
    const current = await this.get(id);
    if (
      current?.state === 'released' &&
      ((type === 'payment' && current.payment_reference !== reference) ||
        (type === 'transfer' && current.transfer_reference !== reference))
    )
      throw new CheckoutConflict(
        'Provider reports activity after final release.',
      );
    return current;
  }
}
