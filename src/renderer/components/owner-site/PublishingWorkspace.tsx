import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { InventoryPicker } from './InventoryPicker';
import { publicationRequest } from '../../lib/publication-client';
import { salesRequest } from '../../lib/sales-client';
import {
  siteEditor,
  type EditableSiteState,
} from '../../lib/owner-site-client';
import {
  editableSite,
  isOwnerSite,
  selectedSite,
  type AnyPublished,
  type OwnerSiteDraft,
} from '../../../shared/owner-site';
import type { PresencePage } from '../../../shared/publishing-presence';
import type { SalesListing } from '../../../shared/sales-api';
import type { SalesReview } from '../../../shared/sales-review';
import type { PublicationReceipt } from '../../../shared/publication-change-set';
import { salePriceLabel, saleModeLabel } from '../../../shared/sales';
import { siteChanges } from '../../../shared/owner-site-review';
import { SitePreview } from './SitePreview';

type Review = {
  id: string;
  request: { requestKey: string };
  after: AnyPublished | null;
  salesReviewId: string | null;
  nextPublicRevision: string;
};
export function PublishingWorkspace({
  draft,
  state,
  fullPage = false,
}: {
  fullPage?: boolean;
  draft: OwnerSiteDraft;
  state: EditableSiteState;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [catalogue, setCatalogue] = useState(false),
    [collection, setCollection] = useState(''),
    [domainPages, setDomainPages] = useState(false),
    [shop, setShop] = useState(false),
    [action, setAction] = useState('display');
  const [presence, setPresence] = useState<PresencePage | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [terms, setTerms] = useState<SalesReview | null>(null),
    [receipt, setReceipt] = useState<PublicationReceipt | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const errorFocus = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorFocus.current?.focus();
  }, [error]);
  const pending = useRef<{ id: string; requestKey: string } | null>(null);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('publishing-pending-receipt');
      if (saved) pending.current = JSON.parse(saved);
    } catch {
      /* Recovery remains available with a review ID. */
    }
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    if (!selected.length || selected.length > 100)
      throw new Error('Select between 1 and 100 names to inspect.');
    setPresence(
      await publicationRequest(
        `/presence?names=${encodeURIComponent(JSON.stringify(selected))}`,
      ),
    );
  };
  const prepare = async (withdraw = false) => {
    setReceipt(null);
    setReview(null);
    setTerms(null);
    if ((!selected.length && !fullPage) || selected.length > 100)
      throw new Error('Review between 1 and 100 exact names.');
    // Flush this editor before binding the revision; another tab still causes a conflict.
    await siteEditor.flush();
    if (!withdraw) {
      if (!fullPage && !catalogue && !collection && !domainPages)
        throw new Error('Choose a public destination first.');
      if (action === 'linked' && draft.version !== 3)
        throw new Error(
          'Preview and save the explicit v3 conversion in Settings first.',
        );
      if (action === 'linked' && !domainPages)
        throw new Error('Choose domain pages for a linked inquiry path.');
      const next = structuredClone(siteEditor.getSnapshot().draft!);
      const added = selected
        .filter((n) => !next.domainPresentations.some((d) => d.domain === n))
        .map((domain) => ({
          id: `domain-${crypto.randomUUID()}`,
          domain,
          ownership: 'current' as const,
          availability: 'not-for-sale' as const,
          description: '',
          askingPrice: null,
          currency: 'USD',
        }));
      next.domainPresentations.push(...added);
      const ids = next.domainPresentations
        .filter((d) => selected.includes(d.domain))
        .map((d) => d.id);
      if (catalogue)
        next.catalogue = {
          enabled: true,
          domainIds: [...new Set([...next.catalogue.domainIds, ...ids])],
        };
      if (collection) {
        const c = next.collections.find((c) => c.id === collection);
        if (!c) throw new Error('Destination collection changed.');
        c.domainIds = [...new Set([...c.domainIds, ...ids])];
        next.homepage.collectionIds = [
          ...new Set([...next.homepage.collectionIds, collection]),
        ];
      }
      let listings: SalesListing[] = [];
      if (domainPages)
        listings = (
          await salesRequest<{ items: SalesListing[] }>('/listings', 'POST', {
            domains: selected,
          })
        ).items;
      for (const d of next.domainPresentations.filter((d) =>
        ids.includes(d.id),
      )) {
        if (catalogue || collection) {
          d.availability = action === 'display' ? 'not-for-sale' : 'inquiries';
          if (action === 'linked') {
            if (d.askingPrice !== null)
              throw new Error(
                `${d.domain}: review removal of its independent email price under Domain details before linking. No price was rounded or copied.`,
              );
            const sale = listings.find((l) => l.draft.domain === d.domain)!;
            if (next.version === 3)
              next.salesLinks = [
                ...next.salesLinks.filter((l) => l.presentationId !== d.id),
                {
                  presentationId: d.id,
                  listingId: sale.draft.id,
                  expectedPublishedRevision:
                    sale.published?.revision ?? sale.revision,
                },
              ];
          } else if (next.version === 3)
            next.salesLinks = next.salesLinks.filter(
              (l) => l.presentationId !== d.id,
            );
        }
      }
      siteEditor.update(next);
      await siteEditor.flush();
      const saved = siteEditor.getSnapshot().state!;
      const m = await publicationRequest<Review>(
        '/change-sets/review',
        'POST',
        {
          requestKey: crypto.randomUUID(),
          draftRevision: saved.revision,
          operation: {
            kind: 'publish',
            fullPage,
            domains: fullPage
              ? selectedSite(next).domainPresentations.map((d) => d.domain)
              : catalogue || collection
                ? selected
                : [],
            collectionIds: collection ? [collection] : [],
            catalogue,
            sales: listings.map((l) => ({
              id: l.draft.id,
              revision: l.revision,
            })),
            shopListingIds: shop ? listings.map((l) => l.draft.id) : [],
          },
        },
      );
      if (m.salesReviewId)
        setTerms(await salesRequest(`/reviews/${m.salesReviewId}`));
      setReview(m);
    } else {
      const saved = siteEditor.getSnapshot().state!;
      setReview(
        await publicationRequest('/change-sets/review', 'POST', {
          requestKey: crypto.randomUUID(),
          draftRevision: saved.revision,
          operation: { kind: 'withdraw', domains: selected },
        }),
      );
    }
  };
  const refreshAfterCommit = async () => {
    if (siteEditor.isDirty()) {
      await siteEditor.refreshReview();
      setError(
        'The operation committed. Your newer local edits are kept; reload the saved draft before saving them again.',
      );
    } else await siteEditor.discardAndReload();
  };
  const recover = async () => {
    if (!pending.current)
      throw new Error('No unresolved commit is saved in this tab.');
    const value = await publicationRequest<PublicationReceipt | null>(
      `/change-sets/${pending.current.id}/receipt?requestKey=${pending.current.requestKey}`,
    );
    if (!value)
      throw new Error(
        'No committed receipt is recorded. Reopen the exact review before retrying; do not create a new operation for an uncertain result.',
      );
    setReceipt(value);
    pending.current = null;
    sessionStorage.removeItem('publishing-pending-receipt');
    await refreshAfterCommit();
  };
  return (
    <section>
      <h2>Domain pages and public presence</h2>
      <p>
        Choose names from your inventory, inspect their public surfaces, then
        review exact destinations. Saving drafts never publishes.
      </p>
      <p>
        <Link to="/sales/listings">Domain inquiry pages</Link> ·{' '}
        <Link to="/sales/inbox">Inquiry inbox</Link> ·{' '}
        <Link to="/sales/shop">Shop settings</Link>
      </p>
      <fieldset disabled={busy || !!review} hidden={fullPage}>
        <InventoryPicker
          selected={selected}
          onChange={(names) => {
            setSelected(names);
            setPresence(null);
          }}
          limit={100}
        />
        <button type="button" onClick={() => void run(inspect)}>
          Inspect public presence
        </button>
        {presence?.items.map((r) => (
          <article className="os-section" key={r.domain}>
            <h3>{r.domain}</h3>
            <p>
              Control: {r.inventory.status}
              {r.inventory.observedAt
                ? ` · observed ${new Date(r.inventory.observedAt).toLocaleString()}`
                : ''}
            </p>
            <p>
              {r.profile.state === 'known'
                ? `Profile: ${r.profile.value.publishedSelected ? 'Published' : 'Not published'}; draft ${r.profile.value.draftSelected ? 'selected' : 'not selected'}. ${r.profile.value.collections.map((c) => c.title).join(', ')}`
                : r.profile.reason}
            </p>
            <p>
              {r.sales.state === 'known'
                ? `Domain page: ${r.sales.value.publishedRevision ? 'Published' : 'Not published'} · ${r.sales.value.mode ?? 'No public mode'} · ${salePriceLabel(r.sales.value.price)}${r.sales.value.suppression ? ` · ${r.sales.value.suppression}` : ''}`
                : r.sales.reason}
            </p>
            <p>
              {r.shop.state === 'known'
                ? `Shop: ${r.shop.value.publishedSelected ? 'Published member' : 'Not a published member'}; draft ${r.shop.value.draftSelected ? 'selected' : 'not selected'}`
                : r.shop.reason}
            </p>
          </article>
        ))}
        <h3>Where should these appear?</h3>
        <label className="os-check">
          <input
            type="checkbox"
            checked={catalogue}
            onChange={(e) => setCatalogue(e.target.checked)}
          />
          Selected-domain catalogue
        </label>
        <label>
          Collection
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">No additional collection</option>
            {draft.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || 'Untitled'}
              </option>
            ))}
          </select>
        </label>
        <label className="os-check">
          <input
            type="checkbox"
            checked={domainPages}
            onChange={(e) => {
              setDomainPages(e.target.checked);
              if (!e.target.checked) setShop(false);
            }}
          />
          Standalone domain inquiry pages
        </label>
        <label className="os-check">
          <input
            type="checkbox"
            disabled={!domainPages}
            checked={shop}
            onChange={(e) => setShop(e.target.checked)}
          />
          Also add these exact domain pages to my existing published shop
        </label>
        <label>
          Profile visitor action
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="display">Display only</option>
            <option value="email">Email my public contact address</option>
            <option value="linked" disabled={draft.version !== 3}>
              Use reviewed domain inquiry pages (v3)
            </option>
          </select>
        </label>
        <p>
          Descriptions and public prices come from saved domain details.
          Configure inquiry modes and deliberate price overrides in Domain
          inquiry pages before review. Private floors, costs and notes are
          excluded.
        </p>
        <button
          type="button"
          disabled={!state.compositeEnabled}
          onClick={() => void run(() => prepare())}
        >
          Prepare saved drafts and review exact publication
        </button>
        <p>
          {state.compositeEnabled
            ? 'Only the reviewed domains and destinations are committed. Other saved edits stay pending.'
            : 'New combined publication is disabled. Inspection and withdrawal remain available.'}
        </p>
        <button type="button" onClick={() => void run(() => prepare(true))}>
          Review withdrawal from all public pages
        </button>
      </fieldset>
      {fullPage && !review && (
        <button
          disabled={busy || !state.compositeEnabled}
          onClick={() => void run(() => prepare())}
        >
          Prepare full-page review
        </button>
      )}
      {review && (
        <section>
          <h2>Review exact public changes</h2>
          <p>
            Operation {review.id}. Selected names: {selected.join(', ')}.
          </p>
          {review.after && isOwnerSite(review.after) && (
            <>
              <SitePreview
                site={review.after}
                stagedSales={terms?.items.map((i) => i.after)}
              />
              {siteChanges(
                editableSite(review.after),
                state.publishedSnapshot,
              ).map((c) => (
                <article className="os-change" key={c.key}>
                  <h3>{c.label}</h3>
                  <p>Currently public: {c.before || 'Not included'}</p>
                  <p>After: {c.after || 'Not included'}</p>
                </article>
              ))}
            </>
          )}
          {review.after &&
            isOwnerSite(review.after) &&
            review.after.version === 3 &&
            review.after.salesLinks.map((l) => (
              <p key={l.presentationId}>
                Reviewed domain page {l.listingId} · {saleModeLabel(l.mode)} ·{' '}
                {salePriceLabel(l.publicPrice)} · minimum offer{' '}
                {l.publicMinimumOffer
                  ? salePriceLabel(l.publicMinimumOffer)
                  : 'None'}{' '}
                · revision {l.publishedRevision}
              </p>
            ))}
          {!review.after && (
            <p>
              The public profile becomes unpublished if its last legacy domain
              is removed.
            </p>
          )}
          {terms?.items.map((i) => (
            <article className="os-change" key={i.id}>
              <h3>{i.after.domain}</h3>
              <p>
                {saleModeLabel(i.after.mode)} ·{' '}
                {salePriceLabel(i.after.publicPrice)} · minimum offer{' '}
                {i.after.publicMinimumOffer
                  ? salePriceLabel(i.after.publicMinimumOffer)
                  : 'None'}
              </p>
              <p>{i.after.description}</p>
              <p>
                Public contact identity:{' '}
                {i.after.sellerDisplayName || 'Not specified'}. Provider:{' '}
                {i.after.destination?.url || 'Direct inquiry'}. Shop membership:{' '}
                {i.includeInShop ? 'included' : 'excluded'}.
              </p>
            </article>
          ))}
          <button
            type="button"
            disabled={busy || (!!review.salesReviewId && !terms)}
            onClick={() =>
              void run(async () => {
                pending.current = {
                  id: review.id,
                  requestKey: review.request.requestKey,
                };
                sessionStorage.setItem(
                  'publishing-pending-receipt',
                  JSON.stringify(pending.current),
                );
                setReceipt(
                  await publicationRequest(
                    `/change-sets/${review.id}/commit`,
                    'POST',
                    { requestKey: review.request.requestKey },
                  ),
                );
                setReview(null);
                setTerms(null);
                pending.current = null;
                sessionStorage.removeItem('publishing-pending-receipt');
                await refreshAfterCommit();
              })
            }
          >
            Commit this exact reviewed operation
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setTerms(null);
            }}
          >
            Close review; keep saved drafts
          </button>
        </section>
      )}
      <button type="button" disabled={busy} onClick={() => void run(recover)}>
        Recover pending commit receipt
      </button>
      {busy && <p role="status">Preparing or checking the exact operation…</p>}
      {error && (
        <p role="alert" tabIndex={-1} ref={errorFocus}>
          {error}
        </p>
      )}
      {receipt && (
        <div role="status">
          <p>
            {receipt.kind === 'withdraw' ? 'Withdrawn' : 'Published'} · receipt{' '}
            {receipt.id}. {receipt.scope}
          </p>
          {receipt.urls.map((url) => (
            <p key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
