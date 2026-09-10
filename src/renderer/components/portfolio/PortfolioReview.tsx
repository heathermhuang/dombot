import { useState } from 'react';
import { Check, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publicationChanges } from '../../../shared/publication-edit';
import { isCurrent } from '../../../shared/portfolio-management';
import type {
  PortfolioDraft,
  PortfolioListing,
  PublishedPortfolio,
} from '../../../shared/publication';
import { visibilityLabel } from './PortfolioInspector';
const fieldLabels = {
  title: 'Portfolio name',
  intro: 'Introduction',
  contactEmail: 'Public email',
  handle: 'Link name',
};
function Details({
  item,
  before,
}: {
  item: PortfolioListing;
  before?: PortfolioListing;
}) {
  const values = (entry: PortfolioListing) => ({
    Availability: visibilityLabel[entry.visibility],
    Collections: entry.collection || 'None',
    Currency: entry.currency,
    Description: entry.description || 'None',
    Price:
      entry.visibility === 'inquiry'
        ? entry.askingPrice === null
          ? 'On request'
          : `${entry.currency} ${entry.askingPrice.toLocaleString()}`
        : 'Not displayed',
  });
  const after = values(item),
    old = before ? values(before) : null;
  return (
    <dl className="pf-change-details">
      {(Object.keys(after) as (keyof typeof after)[])
        .filter((key) => !old || old[key] !== after[key])
        .map((key) => (
          <div key={key}>
            <dt>{key}</dt>
            {old && <dd className="pf-before">{old[key]}</dd>}
            <dd>{after[key]}</dd>
          </div>
        ))}
    </dl>
  );
}
export function PortfolioReview({
  draft,
  published,
  blockers,
  busy,
  ready,
  publicUrl,
  onResolve,
  onPublish,
}: {
  draft: PortfolioDraft;
  published: PublishedPortfolio | null;
  blockers: number;
  busy: boolean;
  ready: boolean;
  publicUrl: string;
  onResolve: () => void;
  onPublish: () => void;
}) {
  const change = publicationChanges(draft, published);
  const groups = [
    { key: 'added', label: 'Added', items: change.added },
    { key: 'removed', label: 'Removed', items: change.removed },
    { key: 'edited', label: 'Edited', items: change.edited },
  ].filter((g) => g.items.length > 0);
  const [group, setGroup] = useState(groups[0]?.key ?? 'page');
  const [page, setPage] = useState(1);
  const active = groups.find((g) => g.key === group) ?? groups[0];
  const items = active?.items ?? [];
  const actualPage = Math.min(page, Math.max(1, Math.ceil(items.length / 40)));
  const current = draft.listings.filter(isCurrent).length;
  const historical = draft.listings.filter(
    (i) => i.visibility === 'historical',
  ).length;
  const emailMissing =
    draft.listings.some((i) => i.visibility === 'inquiry') &&
    !draft.contactEmail;
  return (
    <div className="pf-review-grid">
      <section>
        <div className="pf-review-tabs">
          {groups.map((g) => (
            <button
              key={g.key}
              aria-pressed={active?.key === g.key}
              onClick={() => {
                setGroup(g.key);
                setPage(1);
              }}
            >
              {g.label}
              <span>{g.items.length}</span>
            </button>
          ))}
        </div>
        <div className="pf-review-list">
          {items.slice((actualPage - 1) * 40, actualPage * 40).map((item) => (
            <details key={item.domain} className="pf-change">
              <summary>
                <span>{item.domain}</span>
                <span className="pf-hint">
                  {visibilityLabel[item.visibility]}
                  <ChevronDown aria-hidden="true" className="inline size-3.5" />
                </span>
              </summary>
              <Details
                item={item}
                before={
                  active?.key === 'edited'
                    ? published?.listings.find((i) => i.domain === item.domain)
                    : undefined
                }
              />
            </details>
          ))}
        </div>
        {items.length > 40 && (
          <div className="pf-pagination">
            <span>
              {actualPage} / {Math.ceil(items.length / 40)}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={actualPage === 1}
              onClick={() => setPage(actualPage - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={actualPage * 40 >= items.length}
              onClick={() => setPage(actualPage + 1)}
            >
              Next
            </Button>
          </div>
        )}
        {change.page.length > 0 && (
          <section className="pf-page-changes">
            <h3>Page settings</h3>
            {change.page.map((key) => (
              <details key={key} className="pf-change">
                <summary>{fieldLabels[key]}</summary>
                <div className="pf-change-details">
                  <p className="pf-before">{published?.[key] || 'Empty'}</p>
                  <p>{draft[key] || 'Empty'}</p>
                </div>
              </details>
            ))}
          </section>
        )}
      </section>
      <aside className="pf-publish-panel">
        <span className="pf-eyebrow">Publishing</span>
        <h2>{draft.title}</h2>
        <p className="pf-subtitle">
          {current} current listings
          {historical ? ` · ${historical} historical` : ''}
        </p>
        <dl>
          <div>
            <dt>Ownership</dt>
            <dd className={blockers ? 'pf-warning' : ''}>
              {blockers ? (
                <>
                  <AlertCircle />
                  {blockers} listings need attention
                </>
              ) : (
                <>
                  <Check />
                  Current listings synced
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd className="break-all">
              {draft.contactEmail || 'No public email'}
            </dd>
          </div>
          <div>
            <dt>Page link</dt>
            <dd className="break-all text-xs">{publicUrl}</dd>
          </div>
        </dl>
        {published && published.handle !== draft.handle && (
          <p className="pf-warning">
            The previous /p/{published.handle} address will stop working.
          </p>
        )}
        {(blockers > 0 || emailMissing) && (
          <>
            <p className="pf-warning">
              {emailMissing
                ? 'Add a public email to accept inquiries.'
                : 'Resolve these current listings before publishing.'}
            </p>
            <Button variant="outline" onClick={onResolve}>
              Resolve before publishing
            </Button>
          </>
        )}
        {current + historical === 0 && (
          <p className="pf-warning">
            No names selected. Use Unpublish to remove the page.
          </p>
        )}
        <Button
          className="w-full"
          disabled={
            busy ||
            !ready ||
            blockers > 0 ||
            emailMissing ||
            current + historical === 0 ||
            change.count === 0
          }
          onClick={onPublish}
        >
          {busy
            ? 'Publishing…'
            : published
              ? 'Publish changes'
              : 'Publish portfolio'}
        </Button>
        <p className="pf-hint">
          Draft edits become public only when you publish.
        </p>
      </aside>
    </div>
  );
}
