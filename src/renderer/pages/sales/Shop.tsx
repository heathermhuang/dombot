import { useShopDraft } from '../../lib/sales-drafts';
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
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [cursors, setCursors] = useState<string[]>(['']);
  const { editor, state } = useShopDraft();
  const draft = state?.draft ?? null;
  const setDraft = (value: SaleShop) => {
    editor.update(value);
    setReview(null);
  };
  const remote = useSalesData<SalesShopState>('/shop'),
    rows = useSalesData<SalesPage<SalesListing>>(
      `/listings?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursors.at(-1) ?? '')}`,
    ),
    action = useSalesAction();
  const [review, setReview] = useState<{
    id: string;
    draft: SaleShop;
    before: SaleShop | null;
    terms: { id: string; domain: string }[];
    removed: { id: string; domain: string }[];
  } | null>(null);
  useEffect(() => {
    if (remote.data) editor.initialize(remote.data.draft, remote.data.revision);
  }, [remote.data, editor]);
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
        retry={() => {
          void remote.reload();
          void rows.reload();
        }}
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
                { draft, revision: state?.revision ?? null },
              );
              editor.saved(draft, saved.revision);
              const value = await salesRequest<{
                id: string;
                draft: SaleShop;
                before: SaleShop | null;
                terms: { id: string; domain: string }[];
                removed: { id: string; domain: string }[];
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
            disabled={action.busy || editor.isDirty()}
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
            {draft.listingIds.length} selected across all pages. Page{' '}
            {cursors.length}.
          </p>
          <div className="sales-toolbar">
            <Field label="Find a domain">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <button
              type="button"
              onClick={() => {
                setQuery(search.trim());
                setCursors(['']);
              }}
            >
              Search listings
            </button>
            <button
              type="button"
              disabled={cursors.length === 1 || rows.loading}
              onClick={() => setCursors((value) => value.slice(0, -1))}
            >
              Previous listings
            </button>
            <button
              type="button"
              disabled={!rows.data?.cursor || rows.loading}
              onClick={() =>
                setCursors((value) => [...value, rows.data!.cursor!])
              }
            >
              Next listings
            </button>
          </div>
          {rows.loading && <p role="status">Loading listings…</p>}
          {!rows.loading && !rows.error && !rows.data?.items.length && (
            <p>No listings match. Try another search.</p>
          )}
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
            {review.terms.length} domains will be included. Review the names
            below before publishing.
          </p>
          <ul aria-label="Domains in this publication">
            {review.terms.map((term) => (
              <li key={term.id}>
                {term.domain}
                {review.before?.listingIds.includes(term.id)
                  ? ' · Kept'
                  : ' · Added'}
              </li>
            ))}
          </ul>
          {!!review.removed.length && (
            <>
              <h3>Removed from the shop</h3>
              <ul>
                {review.removed.map((term) => (
                  <li key={term.id}>{term.domain}</li>
                ))}
              </ul>
            </>
          )}
          <p className="small">
            No email address, floors, costs or private notes are included.
          </p>
          <button
            className="primary"
            disabled={action.busy || editor.isDirty()}
            onClick={() =>
              void action.run(async () => {
                await salesRequest('/shop/publications', 'POST', {
                  reviewId: review.id,
                });
                setReview(null);
                const latest = await salesRequest<SalesShopState>('/shop');
                editor.saved(draft!, latest.revision);
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
