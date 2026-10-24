import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  SalesHealth,
  SalesInventory,
  SalesListing,
  SalesPage,
} from '../../../shared/sales-api';
import {
  useSalesData,
  useSalesAction,
  salesRequest,
  downloadSales,
} from '../../lib/sales-client';
import type { SalesReview } from '../../../shared/sales-review';
import { hostPath } from '../../lib/platform';
import {
  SalesShell,
  SalesFeedback,
  listingState,
  salePriceLabel,
  saleModeLabel,
} from './shared';
import BulkActions from './BulkActions';
import BulkJobs from './BulkJobs';

export default function Listings() {
  const [cursor, setCursor] = useState(''),
    [q, setQ] = useState(''),
    [searchQ, setSearchQ] = useState(''),
    [filter, setFilter] = useState('All'),
    [mode, setMode] = useState(''),
    [create, setCreate] = useState(false),
    [inventoryQuery, setInventoryQuery] = useState('');
  const [jobsRevision, setJobsRevision] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set()),
    [domains, setDomains] = useState<Set<string>>(new Set()),
    [matchingSelection, setMatchingSelection] = useState<SalesListing[] | null>(
      null,
    );
  const rows = useSalesData<SalesPage<SalesListing>>(
      `/listings?cursor=${cursor}&q=${encodeURIComponent(searchQ)}&mode=${encodeURIComponent(mode)}&state=${encodeURIComponent(filter)}`,
    ),
    health = useSalesData<SalesHealth>('/health');
  const inventory = useSalesData<SalesPage<SalesInventory>>(
    `/inventory?q=${encodeURIComponent(inventoryQuery)}`,
  );
  const action = useSalesAction(),
    navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => setSearchQ(q), 200);
    return () => clearTimeout(timer);
  }, [q]);
  const visible = rows.data?.items ?? [];
  const hasFilters = !!q.trim() || !!mode || filter !== 'All';
  const picked =
    matchingSelection ??
    rows.data?.items.filter((r) => selection.has(r.draft.id)) ??
    [];
  const toggle = (
    id: string,
    set: Set<string>,
    update: (v: Set<string>) => void,
  ) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  return (
    <SalesShell>
      <div className="sales-heading">
        <div>
          <p className="sales-kicker">SALES / LISTINGS</p>
          <h1>Sales pages</h1>
          <p className="small">
            Manage sales pages and inquiries alongside your portfolio.
          </p>
        </div>
        <button className="primary" onClick={() => setCreate(!create)}>
          Create sales pages
        </button>
      </div>
      <SalesFeedback
        error={rows.error || health.error || action.error}
        notice={action.notice}
        loading={rows.loading || action.busy}
        retry={() => {
          void rows.reload();
          void health.reload();
        }}
      />
      {health.data &&
        (health.data.publications.length > 0 ||
          health.data.delivery.length > 0) && (
          <details className="sales-section">
            <summary>
              Needs attention · {health.data.publications.length} pages ·{' '}
              {health.data.delivery.reduce((n, r) => n + r.count, 0)} email
              events
            </summary>
            {health.data.publications.map((r) => (
              <p key={r.id}>
                <Link className="link" to={`/sales/listings/${r.id}`}>
                  {r.domain}
                </Link>{' '}
                · {r.availability} · control expires{' '}
                {new Date(r.control_expires_at).toLocaleString()}
              </p>
            ))}
            {health.data.delivery.map((r) => (
              <p key={r.state}>
                {r.count} {r.state} · oldest due{' '}
                {new Date(r.oldest).toLocaleString()}
              </p>
            ))}
          </details>
        )}
      {create && (
        <section className="sales-section">
          <h2>Create private drafts</h2>
          <p>
            Choose up to 100 names from your inventory. New drafts stay private.
          </p>
          <label className="sales-field">
            Find inventory
            <input
              value={inventoryQuery}
              onChange={(e) => {
                setInventoryQuery(e.target.value);
                setDomains(new Set());
              }}
            />
          </label>
          <SalesFeedback error={inventory.error} loading={inventory.loading} />
          {inventory.data?.items.map((r) => (
            <label className="checkbox-label" key={r.domain}>
              <input
                type="checkbox"
                checked={domains.has(r.domain)}
                onChange={() => toggle(r.domain, domains, setDomains)}
              />
              <span>
                {r.domain}{' '}
                <small className="small">
                  {r.available ? 'Control observed' : r.reason}
                </small>
              </span>
            </label>
          ))}
          <button
            disabled={!domains.size || action.busy}
            className="primary"
            onClick={() =>
              void action.run(async () => {
                const r = await salesRequest<{ items: SalesListing[] }>(
                  '/listings',
                  'POST',
                  { domains: [...domains] },
                );
                setCreate(false);
                setDomains(new Set());
                await rows.reload();
                if (r.items.length === 1)
                  navigate(`/sales/listings/${r.items[0].draft.id}`);
                else
                  action.setNotice(
                    `${r.items.length} private drafts ready to edit.`,
                  );
              })
            }
          >
            Create {domains.size || ''} private drafts
          </button>
          <p className="small">
            Showing the first 100 matching inventory names. Refine search to
            choose another batch.
          </p>
        </section>
      )}
      <div
        className="sales-toolbar sales-state-tabs"
        role="group"
        aria-label="Listing filters"
      >
        {['All', 'Published', 'Drafts', 'Needs attention', 'Paused'].map(
          (label) => (
            <button
              key={label}
              aria-pressed={filter === label}
              onClick={() => {
                setFilter(label);
                setMatchingSelection(null);
                setCursor('');
                setSelection(new Set());
              }}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <div className="sales-toolbar">
        <select
          className="sales-state-picker"
          aria-label="Listing status"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setMatchingSelection(null);
            setCursor('');
            setSelection(new Set());
          }}
        >
          {['All', 'Published', 'Drafts', 'Needs attention', 'Paused'].map(
            (label) => (
              <option key={label} value={label}>
                {label === 'All' ? 'All statuses' : label}
              </option>
            ),
          )}
        </select>
        <input
          aria-label="Search sales listings"
          placeholder="Search domains…"
          style={{ width: 250 }}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMatchingSelection(null);
            setCursor('');
            setSelection(new Set());
          }}
        />
        <select
          aria-label="Sale mode"
          style={{ width: 180 }}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setMatchingSelection(null);
            setCursor('');
            setSelection(new Set());
          }}
        >
          <option value="">All paths</option>
          {['inquiry', 'offer', 'buy-now', 'external'].map((v) => (
            <option key={v} value={v}>
              {saleModeLabel(v)}
            </option>
          ))}
        </select>
        <span className="small">{visible.length} on this page</span>
        <details className="sales-selection-tools">
          <summary>Selection tools</summary>
          <button
            disabled={rows.loading || q !== searchQ || action.busy}
            onClick={() =>
              void action.run(async () => {
                const all: SalesListing[] = [];
                let next: string | null = '';
                for (let n = 0; n < 5 && next !== null; n++) {
                  const page: SalesPage<SalesListing> = await salesRequest<
                    SalesPage<SalesListing>
                  >(
                    `/listings?cursor=${next}&q=${encodeURIComponent(searchQ)}&mode=${encodeURIComponent(mode)}&state=${encodeURIComponent(filter)}`,
                  );
                  all.push(...page.items);
                  next = page.cursor;
                }
                if (next !== null)
                  throw new Error(
                    'Narrow the filters: the controlled release supports up to 500 exact selected names per job.',
                  );
                setMatchingSelection(all);
                setSelection(new Set(all.map((r) => r.draft.id)));
                action.setNotice(
                  `${all.length} exact matching names selected. Selection stays fixed until you clear it.`,
                );
              })
            }
          >
            Select all matching (up to 500)
          </button>
        </details>
      </div>
      {!!picked.length && (
        <div className="sales-toolbar" aria-label="Selected listing actions">
          <strong>
            {picked.length}{' '}
            {matchingSelection
              ? 'selected across all matching results'
              : 'selected on this page'}
          </strong>
          <button
            onClick={() => {
              setMatchingSelection(null);
              setSelection(new Set());
            }}
          >
            Clear selection
          </button>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const items = picked.map((r) => ({
                  id: r.draft.id,
                  revision: r.revision,
                }));
                if (items.length > 100) {
                  const job = await salesRequest<{ id: string }>(
                    '/bulk-reviews',
                    'POST',
                    { items, requestKey: crypto.randomUUID() },
                  );
                  navigate(`/sales/bulk-review/${job.id}`);
                } else {
                  const review = await salesRequest<SalesReview>(
                    '/reviews',
                    'POST',
                    { items },
                  );
                  navigate(`/sales/review/${review.id}`);
                }
              })
            }
          >
            Review publication
          </button>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const receipts = [];
                for (const r of picked) {
                  try {
                    await salesRequest(
                      `/listings/${r.draft.id}/pause`,
                      'POST',
                      { revision: r.operationalRevision },
                    );
                    receipts.push({ domain: r.draft.domain, result: 'paused' });
                  } catch (e) {
                    receipts.push({
                      domain: r.draft.domain,
                      result: e instanceof Error ? e.message : 'Failed',
                    });
                  }
                }
                downloadSales('pause-receipts.json', receipts);
                setSelection(new Set());
                await rows.reload();
                action.setNotice(
                  'Pause finished. Exact per-domain results downloaded.',
                );
              })
            }
          >
            Pause selected
          </button>
          <button
            onClick={() =>
              downloadSales(
                'selected-sales-settings.json',
                picked.map((r) => ({
                  domain: r.draft.domain,
                  mode: r.draft.mode,
                  priceSource: r.draft.priceSource,
                  minimumOffer: r.draft.minimumOffer,
                  includeInShop: r.draft.includeInShop,
                  destinationId: r.draft.destinationId,
                })),
              )
            }
          >
            Export selected settings
          </button>
        </div>
      )}
      {!!picked.length && (
        <BulkActions
          items={picked}
          disabled={rows.loading || !!rows.error}
          onChange={async (finished) => {
            await rows.reload();
            setJobsRevision((value) => value + 1);
            if (finished && matchingSelection) {
              setMatchingSelection(null);
              setSelection(new Set());
              action.setNotice(
                'Bulk changes finished. Select listings again to review their updated terms or make another change.',
              );
            }
          }}
        />
      )}
      <BulkJobs
        key={jobsRevision}
        onChange={() => {
          setMatchingSelection(null);
          setSelection(new Set());
          action.setNotice(
            'Job updated. Select listings again to review their current terms or make another change.',
          );
          void rows.reload();
        }}
      />
      <div
        className="sales-table-region"
        role="region"
        aria-label="Sales pages"
        tabIndex={0}
      >
        <table className="sales-listings-table">
          <thead>
            <tr>
              <th className="selection">
                <input
                  type="checkbox"
                  aria-label="Select all visible rows on this page"
                  disabled={
                    rows.loading || q !== searchQ || !!matchingSelection
                  }
                  checked={
                    visible.length > 0 &&
                    visible.every((r) => selection.has(r.draft.id))
                  }
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? new Set(visible.map((r) => r.draft.id))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th>Domain</th>
              <th>Public price / Mode</th>
              <th>Page status</th>
              <th>Destination</th>
              <th>Latest inquiry</th>
              <th>Public sales page</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.draft.id}>
                <td>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.draft.domain}`}
                      disabled={
                        rows.loading || q !== searchQ || !!matchingSelection
                      }
                      checked={selection.has(r.draft.id)}
                      onChange={() =>
                        toggle(r.draft.id, selection, setSelection)
                      }
                    />
                  </label>
                </td>
                <td>
                  <Link className="domain" to={`/sales/listings/${r.draft.id}`}>
                    {r.draft.displayName}
                  </Link>
                  <p className="small">
                    {r.published &&
                    r.published.description !== r.draft.description
                      ? 'Changes pending'
                      : 'Private terms kept separate'}
                  </p>
                  <details className="sales-row-details">
                    <summary>Page details</summary>
                    <dl>
                      <dt>Destination</dt>
                      <dd>
                        {r.published?.destination?.provider ?? 'Direct inquiry'}
                      </dd>
                      <dt>Latest inquiry</dt>
                      <dd>
                        {r.lastInquiryAt ? (
                          <Link className="link" to="/sales/inbox">
                            {new Date(r.lastInquiryAt).toLocaleString()}
                          </Link>
                        ) : (
                          'No inquiries yet'
                        )}
                      </dd>
                    </dl>
                    {r.published && (
                      <a
                        className="link"
                        href={hostPath(`/d/${r.draft.domain}`)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open public sales page ↗
                      </a>
                    )}
                  </details>
                </td>
                <td>
                  {salePriceLabel(r.published?.publicPrice ?? null)}
                  <p className="small">{saleModeLabel(r.draft.mode)}</p>
                </td>
                <td>
                  <span className="badge">{listingState(r)}</span>
                </td>
                <td>
                  {r.published?.destination?.provider ?? 'Direct inquiry'}
                </td>
                <td>
                  {r.lastInquiryAt ? (
                    <Link className="link" to="/sales/inbox">
                      {new Date(r.lastInquiryAt).toLocaleString()}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {r.published && (
                    <a
                      className="link"
                      href={hostPath(`/d/${r.draft.domain}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open public sales page
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && !rows.loading && !rows.error && (
        <div className="sales-empty">
          <h2>
            {hasFilters
              ? 'No matching listings'
              : 'Start with the names you want to sell.'}
          </h2>
          <p>
            {hasFilters
              ? 'Clear the filters to see your other listings.'
              : 'Create sales drafts from your existing inventory. Prices, floors and registrar details stay in Domains.'}
          </p>
          {hasFilters && (
            <button
              onClick={() => {
                setQ('');
                setSearchQ('');
                setMode('');
                setFilter('All');
                setCursor('');
                setSelection(new Set());
                setMatchingSelection(null);
              }}
            >
              Clear filters
            </button>
          )}
          <Link className="link" to="/">
            Open inventory
          </Link>
        </div>
      )}
      <div className="sales-toolbar">
        <button
          disabled={!cursor}
          onClick={() => {
            setCursor('');
            setSelection(new Set());
          }}
        >
          First page
        </button>
        <button
          disabled={!rows.data?.cursor}
          onClick={() => {
            setCursor(rows.data!.cursor!);
            setSelection(new Set());
          }}
        >
          Next page
        </button>
      </div>
    </SalesShell>
  );
}
