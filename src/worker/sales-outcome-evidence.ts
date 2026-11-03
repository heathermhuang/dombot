import { z } from 'zod';
import { listEvents, putEvents } from '../core/services/domain-events';
import { marketSales } from '../core/services/markets/sync';
import { DomainEventType } from '../shared/domain-events';
import { parseCanonicalAmount } from '../shared/money';
const sameMoney = (
  a: { amount: string; currency: string },
  b: { amount: string; currency: string },
) => {
  try {
    return (
      a.currency === b.currency &&
      parseCanonicalAmount(a.amount, a.currency) ===
        parseCanonicalAmount(b.amount, b.currency)
    );
  } catch {
    return false;
  }
};
import type { SaleOutcome } from '../shared/sales-events';
import { coreSaleReferenceSchema } from '../shared/sales-events';
import { SalesError } from '../shared/sales-review';

type Reference = z.infer<typeof coreSaleReferenceSchema>;
export function saleEvidenceChoices(domain: string) {
  const events = listEvents().filter(
    (e) => e.domain === domain && e.type === DomainEventType.Sold,
  );
  const sales = marketSales().filter((s) => s.name === domain);
  return [
    ...events.map((e) => ({
      reference: { kind: 'event' as const, eventId: e.id },
      label: `Your sale ${e.date ?? 'undated'} · ${e.currency ?? ''} ${e.amount ?? 'Amount missing'}`,
      status: 'seller-recorded',
      price:
        e.amount && e.currency
          ? { amount: e.amount, currency: e.currency }
          : null,
    })),
    ...sales.flatMap((s) => [
      {
        reference: {
          kind: 'market' as const,
          market: s.market,
          accountId: s.accountId,
          transactionId: s.id,
        },
        label: `${s.market} · ${s.id} · ${s.status} · ${s.currency} ${s.price ?? 'Amount unknown'}`,
        status: s.status,
        price: s.price ? { amount: s.price, currency: s.currency } : null,
      },
      ...events
        .filter(
          (e) =>
            !e.marketSale &&
            e.amount &&
            s.price &&
            e.currency === s.currency &&
            sameMoney(
              { amount: e.amount, currency: e.currency },
              { amount: s.price, currency: s.currency },
            ),
        )
        .map((e) => ({
          reference: {
            kind: 'match' as const,
            market: s.market,
            accountId: s.accountId,
            transactionId: s.id,
            eventId: e.id,
          },
          label: `Match ${s.market} transaction ${s.id} to your sale ${e.date ?? 'undated'}`,
          status: s.status,
          price: { amount: s.price!, currency: s.currency },
        })),
    ]),
  ];
}
export function resolveSaleEvidence(
  domain: string,
  reference: Reference,
  reportedPrice: SaleOutcome['price'] = null,
) {
  const event =
    reference.kind === 'event' || reference.kind === 'match'
      ? listEvents().find(
          (e) =>
            e.id === reference.eventId &&
            e.domain === domain &&
            e.type === DomainEventType.Sold,
        )
      : null;
  const sale =
    reference.kind === 'market' || reference.kind === 'match'
      ? marketSales().find(
          (s) =>
            s.market === reference.market &&
            s.accountId === reference.accountId &&
            s.id === reference.transactionId &&
            s.name === domain,
        )
      : null;
  if (
    (reference.kind !== 'market' && !event) ||
    (reference.kind !== 'event' && !sale)
  )
    throw new SalesError(
      'SALE_EVIDENCE_MISSING',
      'Choose a sale for this domain from core Sales.',
      409,
    );
  const price = sale?.price
    ? { amount: sale.price, currency: sale.currency }
    : event?.amount && event.currency
      ? { amount: event.amount, currency: event.currency }
      : null;
  if (
    reportedPrice &&
    price &&
    (reportedPrice.currency !== price.currency ||
      !sameMoney(reportedPrice, price))
  )
    throw new SalesError(
      'SALE_PRICE_MISMATCH',
      'The reported amount differs from the linked transaction. Review the evidence.',
      409,
    );
  if (reference.kind === 'match') {
    if (
      !price ||
      !event?.amount ||
      !event.currency ||
      event.currency !== price.currency ||
      !sameMoney({ amount: event.amount, currency: event.currency }, price) ||
      sale?.status !== 'completed'
    )
      throw new SalesError(
        'SALE_MATCH_UNCONFIRMED',
        'Match only a completed provider transaction with the same exact recorded amount and currency.',
        409,
      );
    const key = `${sale.accountId}:${sale.id}`;
    if (
      (event.marketSale && event.marketSale !== key) ||
      listEvents().some((e) => e.id !== event.id && e.marketSale === key)
    )
      throw new SalesError(
        'SALE_ALREADY_LINKED',
        'This transaction or sale is already linked. Review core Sales.',
        409,
      );
  }
  return {
    source: sale ? 'provider-recorded' : 'seller-recorded',
    status: sale?.status ?? 'seller-recorded',
    price,
    commission: sale?.commission ?? null,
    net: sale?.net ?? null,
    installments: sale?.installments ?? null,
    paidOutOn: sale?.paidOutOn ?? null,
    // A provider's aggregate completed state is not independent proof of each leg.
    paymentEvidence: sale?.paidOutOn
      ? 'provider-payout-date'
      : 'not-separately-confirmed',
    transferEvidence:
      sale?.status === 'completed'
        ? 'provider-completion-record'
        : 'not-separately-confirmed',
    ...(event ? { eventId: event.id } : {}),
    ...(sale ? { transactionId: sale.id, market: sale.market } : {}),
  };
}
/** Only an explicit exact event/transaction match changes the core link. It
 * preserves amount, fees, notes and source; it never creates a second sale. */
export function matchSaleEvidence(domain: string, reference: Reference) {
  resolveSaleEvidence(domain, reference);
  if (reference.kind !== 'match') return;
  const event = listEvents().find((e) => e.id === reference.eventId)!;
  const key = `${reference.accountId}:${reference.transactionId}`;
  if (event.marketSale === key) return;
  putEvents([{ ...event, marketSale: key, updatedAt: Date.now() }]);
}
