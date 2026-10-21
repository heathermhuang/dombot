import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { SalesListing } from '../../../shared/sales-api';
import { salePriceLabel } from '../../../shared/sales';
import './sales.css';
import { useSalesData } from '../../lib/sales-client';
import { webAuthMode } from '../../lib/platform';

export { salePriceLabel };
export function SalesShell({ children }: { children: ReactNode }) {
  const recipient = useSalesData<{ verified?: boolean; address?: string }>(
    webAuthMode() === 'gateway' ? '/recipient' : '/capabilities',
  );
  return (
    <div className="sales">
      <nav aria-label="Sales navigation" className="sales-nav">
        {[
          ['/sales', 'Listings'],
          ['/sales/inbox', 'Inbox'],
          ['/sales/shop', 'Shop'],
          ['/sales/channels', 'Channels'],
        ].map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/sales'}>
            {label}
          </NavLink>
        ))}
      </nav>
      {recipient.data?.verified === false && (
        <p className="sales-error">
          Verify {recipient.data.address} before receiving sales notifications.{' '}
          <a className="link" href="/login">
            Confirm your account email
          </a>
        </p>
      )}
      {children}
    </div>
  );
}
export function SalesFeedback({
  error,
  notice,
  loading,
  retry,
}: {
  error?: string;
  notice?: string;
  loading?: boolean;
  retry?: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="sales-error">
          {error} {retry && <button onClick={retry}>Retry</button>}
        </p>
      )}
      <p role="status" className="sales-notice">
        {loading ? 'Loading…' : notice}
      </p>
    </>
  );
}
export function listingState(item: SalesListing): string {
  if (item.availability === 'paused' && item.published) return 'Paused';
  if (
    ['sold', 'ownership-uncertain', 'control-lost'].includes(item.availability)
  )
    return item.availability.replaceAll('-', ' ');
  if (!item.published) return 'Draft';
  if (item.controlExpiresAt <= Date.now()) return 'Ownership uncertain';
  if (item.priceChanged) return 'Portfolio price changed';
  if (item.revision !== item.publishedDraftRevision) return 'Changes pending';
  return 'Published';
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="sales-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function saleModeLabel(mode: string): string {
  return (
    (
      {
        inquiry: 'Inquiry',
        offer: 'Make an offer',
        'buy-now': 'Buy now',
        external: 'Marketplace link',
      } as Record<string, string>
    )[mode] ?? mode
  );
}
export function conversationStatusLabel(status: string): string {
  return (
    (
      {
        new: 'New',
        negotiating: 'Negotiating',
        'awaiting-buyer': 'Awaiting buyer',
        agreed: 'Agreed',
        closed: 'Closed',
        spam: 'Spam',
      } as Record<string, string>
    )[status] ?? status
  );
}
