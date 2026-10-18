import { useEffect, useState } from 'react';
import type { SaleShop } from '../../../shared/sales';
import type {
  SalesShopState,
  SalesListing,
  SalesPage,
} from '../../../shared/sales-api';
import {
  salesRequest,
  useSalesAction,
  useSalesData,
} from '../../lib/sales-client';
import { hostPath } from '../../lib/platform';
import { SalesShell, SalesFeedback, Field } from './shared';

export default function Shop() {
  const remote = useSalesData<SalesShopState>('/shop'),
    rows = useSalesData<SalesPage<SalesListing>>('/listings'),
    action = useSalesAction();
  const [draft, setDraft] = useState<SaleShop | null>(null),
    [review, setReview] = useState<{
      id: string;
      draft: SaleShop;
      before: SaleShop | null;
    } | null>(null);
  useEffect(() => {
    if (remote.data && !draft) setDraft(remote.data.draft);
  }, [remote.data, draft]);
  return (
    <SalesShell>
      <div className="sales-heading">
        <div>
          <p className="sales-kicker">SALES / SHOP</p>
          <h1>Domain shop</h1>
          <p className="small">
            A separate publication. Existing public sites and private inventory
            stay independent.
          </p>
        </div>
        {remote.data?.published && (
          <a
            className="sales-button"
            href={hostPath(`/shop/${remote.data.published.handle}`)}
            target="_blank"
            rel="noreferrer"
          >
            Open published shop
          </a>
        )}
      </div>
      <SalesFeedback
        error={remote.error || rows.error || action.error}
        notice={action.notice}
        loading={action.busy}
        retry={() => void remote.reload()}
      />
      {draft && (
        <form
          style={{ maxWidth: 800 }}
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const saved = await salesRequest<{ revision: string }>(
                '/shop',
                'PUT',
                { draft, revision: remote.data?.revision ?? null },
              );
              const value = await salesRequest<{
                id: string;
                draft: SaleShop;
                before: SaleShop | null;
              }>('/shop/reviews', 'POST', { revision: saved.revision });
              setReview(value);
              await remote.reload();
            });
          }}
        >
          <Field label="Shop address">
            <input
              value={draft.handle}
              pattern="[a-z0-9][a-z0-9-]{0,39}"
              onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
            />
          </Field>
          <Field label="Title">
            <input
              value={draft.title}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field label="Introduction">
            <textarea
              value={draft.intro}
              maxLength={600}
              onChange={(e) => setDraft({ ...draft, intro: e.target.value })}
            />
          </Field>
          <button
            type="button"
            disabled={
              action.busy ||
              JSON.stringify(draft) !== JSON.stringify(remote.data?.draft)
            }
            title="Save your current draft before copying another presentation."
            onClick={() =>
              void action.run(async () => {
                setDraft(await salesRequest<SaleShop>('/shop/site-copy'));
                setReview(null);
                action.setNotice(
                  'Presentation copied to this private form. Names stay selected here; the old Public site is unchanged.',
                );
              })
            }
          >
            Copy saved public-site presentation
          </button>
          <p className="small">
            Copies the address, title and introduction only. Shop selections and
            old collections remain independent.
          </p>
          <h2>Selected public listings</h2>
          <p className="small">
            Only currently published, available listings can appear in search.
            Showing this page of up to 100 listings.
          </p>
          {rows.data?.items.map((r) => (
            <label key={r.draft.id} className="checkbox-label">
              <input
                type="checkbox"
                disabled={!r.published}
                checked={draft.listingIds.includes(r.draft.id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    listingIds: e.target.checked
                      ? [...draft.listingIds, r.draft.id]
                      : draft.listingIds.filter((id) => id !== r.draft.id),
                  })
                }
              />
              {r.draft.domain}{' '}
              {!r.published && (
                <span className="small">Publish the listing first</span>
              )}
            </label>
          ))}
          <button className="primary" disabled={action.busy}>
            Save draft and review shop
          </button>
        </form>
      )}
      {review && (
        <section className="sales-section">
          <h2>Review shop publication</h2>
          <p>
            Title: {review.before?.title ?? 'Not published'} →{' '}
            {review.draft.title}
          </p>
          <p>
            Address: {review.before?.handle ?? 'Not published'} →{' '}
            {review.draft.handle}
          </p>
          <p>
            Selected listing IDs: {review.draft.listingIds.join(', ') || 'None'}
          </p>
          <p className="small">
            No email address, floors, costs or private notes are included.
          </p>
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await salesRequest('/shop/publications', 'POST', {
                  reviewId: review.id,
                });
                setReview(null);
                await remote.reload();
                action.setNotice(
                  'Selected shop published. Domain availability is rechecked for each public result.',
                );
              })
            }
          >
            Publish this reviewed shop
          </button>
        </section>
      )}
    </SalesShell>
  );
}
