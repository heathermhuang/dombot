import {
  CheckoutConflict,
  CheckoutReservations,
  type CheckoutApproval,
  type CheckoutObservation,
  type CheckoutReservation,
} from './checkout-reservations';

type ProviderSession = {
  merchantReference: string;
  session: string;
  price: CheckoutApproval['price'];
  url: string | null;
  observations: CheckoutObservation[];
};

/**
 * The selected provider adapter authenticates raw callbacks without rewriting
 * their signed content. Session observations come from the provider read API
 * and accepted transfer evidence, not fields in the callback itself.
 */
export interface CheckoutProvider {
  id: string;
  authenticateCallback(request: Request): Promise<string | null>;
  find(merchantReference: string): Promise<ProviderSession | null>;
  create(
    approval: CheckoutReservation,
    idempotencyKey: string,
  ): Promise<ProviderSession>;
  cancel(session: string, idempotencyKey: string): Promise<void>;
}

/** An internal coordinator. Seller auth and cross-channel locks belong to its caller. */
export class CheckoutCoordinator {
  constructor(
    readonly reservations: CheckoutReservations,
    readonly provider: CheckoutProvider,
    readonly currentTerms: (
      reservation: CheckoutReservation,
    ) => Promise<boolean>,
  ) {}

  async approve(approval: CheckoutApproval) {
    if (approval.provider !== this.provider.id)
      throw new CheckoutConflict('This checkout provider is unavailable.');
    return this.reservations.reserve(approval);
  }

  async open(id: string) {
    const held = await this.requireReservation(id);
    if (!['held', 'creating', 'open'].includes(held.state))
      return { reservation: held, checkoutUrl: null };
    if (held.expires_at <= Date.now() || !(await this.currentTerms(held))) {
      return { reservation: await this.cancel(id), checkoutUrl: null };
    }
    let remote = await this.provider.find(id);
    if (!remote && held.state !== 'open') {
      const { reservation, idempotencyKey } =
        await this.reservations.beginCreation(id);
      remote = await this.provider.create(reservation, idempotencyKey);
    }
    if (!remote)
      throw new CheckoutConflict(
        'The original provider session needs reconciliation.',
      );
    let current = await this.reconcile(held, remote);
    if (
      current.state === 'canceling' ||
      (current.state === 'open' &&
        (current.expires_at <= Date.now() ||
          !(await this.currentTerms(current))))
    ) {
      current = await this.cancel(id);
    }
    if (current.state !== 'open' || !remote.url)
      return { reservation: current, checkoutUrl: null };
    const url = new URL(remote.url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new CheckoutConflict(
        'The provider did not return an HTTPS checkout URL.',
      );
    return { reservation: current, checkoutUrl: url.href };
  }

  async cancel(id: string) {
    await this.requireReservation(id);
    const { reservation, idempotencyKey } =
      await this.reservations.requestCancellation(id);
    if (reservation.state === 'released') return reservation;
    const remote = await this.provider.find(id);
    if (!remote) return reservation;
    const reconciled = await this.reconcile(reservation, remote);
    if (reconciled.state !== 'canceling') return reconciled;
    await this.provider.cancel(remote.session, idempotencyKey);
    // An accepted command alone does not establish a safe cancellation.
    const confirmed = await this.provider.find(id);
    return confirmed ? this.reconcile(reconciled, confirmed) : reconciled;
  }

  async callback(request: Request) {
    const id = await this.provider.authenticateCallback(request);
    if (!id) return null;
    const reservation = await this.requireReservation(id);
    const remote = await this.provider.find(id);
    if (!remote)
      throw new CheckoutConflict(
        'Waiting for authoritative provider session state.',
      );
    return this.reconcile(reservation, remote);
  }

  private async requireReservation(id: string) {
    const reservation = await this.reservations.get(id);
    if (!reservation || reservation.provider !== this.provider.id)
      throw new CheckoutConflict('Unknown checkout reservation.');
    return reservation;
  }

  private async reconcile(
    reservation: CheckoutReservation,
    remote: ProviderSession,
  ) {
    if (
      remote.merchantReference !== reservation.id ||
      remote.price.amount !== reservation.amount ||
      remote.price.currency !== reservation.currency ||
      (reservation.provider_session &&
        reservation.provider_session !== remote.session)
    )
      throw new CheckoutConflict(
        'Provider state differs from the approved case.',
      );
    if (reservation.state === 'released') {
      // A provider claiming a new payment or transfer after final release is a
      // contract violation. Do not apply those facts to a newer reservation.
      for (const event of remote.observations)
        if (
          (event.type === 'payment' &&
            event.reference !== reservation.payment_reference) ||
          (event.type === 'transfer' &&
            event.reference !== reservation.transfer_reference)
        )
          throw new CheckoutConflict(
            'Provider reports activity after final release.',
          );
      return reservation;
    }
    let current = await this.reservations.attachSession(
      reservation.id,
      this.provider.id,
      remote.session,
    );
    for (const observation of remote.observations)
      current =
        (await this.reservations.observe(current.id, observation)) ?? current;
    return current;
  }
}
