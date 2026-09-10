import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FolderPlus,
  Globe,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Upload,
  X,
  AlertCircle,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '../store/app';
import { portfolioEditor, usePortfolioEditor } from '../lib/publication-client';
import { hostPath } from '../lib/platform';
import { importPublication } from '../../shared/publication-import';
import {
  previewSnapshot,
  publicationChanges,
} from '../../shared/publication-edit';
import {
  collectionTokens,
  editPortfolioSelection,
  filterPortfolio,
  isCurrent,
  type BulkPortfolioEdit,
  type PortfolioScope,
  type OwnershipFilter,
} from '../../shared/portfolio-management';
import { renderPortfolio } from '../../shared/render-portfolio';
import type {
  PortfolioDraft,
  PortfolioListing,
} from '../../shared/publication';
import {
  PortfolioInspector,
  ownershipLabel,
} from '../components/portfolio/PortfolioInspector';
import { PortfolioSettings } from '../components/portfolio/PortfolioSettings';
import { PortfolioReview } from '../components/portfolio/PortfolioReview';
import '../components/portfolio/portfolio.css';

const PAGE_SIZE = 50;
export default function PublicPortfolio() {
  const { state, draft, status, error } = usePortfolioEditor();
  const refreshTick = useAppStore((s) => s.refreshTick);
  const [view, setView] = useState<
    'domains' | 'settings' | 'preview' | 'review'
  >('domains');
  const [scope, setScope] = useState<PortfolioScope>('listed');
  const [ownershipFilter, setOwnershipFilter] =
    useState<OwnershipFilter>('all');
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('');
  const [sort, setSort] = useState('az');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<PortfolioDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [collectionAction, setCollectionAction] = useState(false);
  const [collectionMode, setCollectionMode] = useState<
    'add' | 'remove' | 'replace'
  >('add');
  const [collectionValue, setCollectionValue] = useState('');
  const [historyNames, setHistoryNames] = useState<Set<string> | null>(null);
  const [mobile, setMobile] = useState(false);
  const [previewHistory, setPreviewHistory] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    void portfolioEditor.load().catch(() => {});
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (refreshTick)
      void portfolioEditor
        .refreshReview()
        .catch((e: Error) => setActionError(e.message));
  }, [refreshTick]);
  const checks = useMemo(
    () => new Map(state?.review.map((item) => [item.domain, item]) ?? []),
    [state],
  );
  // The public document is rendered only when requested, never on each table edit.
  const preview = useMemo(
    () =>
      view === 'preview' && draft
        ? renderPortfolio(
            previewSnapshot(draft),
            new URL(
              `https://preview.invalid/p/portfolio${previewHistory ? '?view=history' : ''}`,
            ),
            true,
          )
        : '',
    [view, draft, previewHistory],
  );
  const filtered = useMemo(
    () =>
      draft && state
        ? filterPortfolio(draft.listings, state.review, {
            scope,
            ownership: ownershipFilter,
            query,
            collection,
            sort,
          })
        : [],
    [draft, state, scope, ownershipFilter, query, collection, sort],
  );
  const collections = useMemo(
    () =>
      [
        ...new Set(
          draft?.listings.flatMap((item) =>
            collectionTokens(item.collection),
          ) ?? [],
        ),
      ].sort(),
    [draft],
  );
  const saveStatus =
    status === 'saving'
      ? 'Saving…'
      : status === 'unsaved'
        ? 'Saving shortly…'
        : status === 'error'
          ? 'Not saved'
          : 'All changes saved';
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  if (!draft || !state)
    return (
      <section className="pf-workspace">
        <header className="pf-header">
          <div>
            <span className="pf-eyebrow">Portfolio</span>
            <h1>Your collection</h1>
            <p className="pf-subtitle">
              {error || 'Loading your private workspace…'}
            </p>
          </div>
        </header>
        {error ? (
          <Button onClick={() => void portfolioEditor.load().catch(() => {})}>
            Try again
          </Button>
        ) : (
          <div className="pf-shell" aria-label="Loading domains" role="status">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="pf-skeleton" />
            ))}
          </div>
        )}
      </section>
    );
  const current = draft.listings.filter(isCurrent);
  const history = draft.listings.filter(
    (item) => item.visibility === 'historical',
  );
  const privateNames = draft.listings.filter(
    (item) => item.visibility === 'private',
  );
  const blockers = current.filter(
    (item) => checks.get(item.domain)?.ownership !== 'owned',
  );
  const unmatched = privateNames.filter(
    (item) => checks.get(item.domain)?.ownership !== 'owned',
  );
  const changes = publicationChanges(draft, state.publishedSnapshot);
  const publicUrl = window.location.origin + hostPath(`/p/${draft.handle}`);
  const liveUrl = state.published
    ? hostPath(`/p/${state.published.handle}`)
    : null;
  const rows = filtered.slice(
    (Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))) - 1) *
      PAGE_SIZE,
    Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))) *
      PAGE_SIZE,
  );
  const actualPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleSelected = rows.filter((item) => picked.has(item.domain)).length;
  const chosen = draft.listings.filter((item) => picked.has(item.domain));
  const allPrivate =
    chosen.length > 0 && chosen.every((item) => item.visibility === 'private');
  const allCurrent = chosen.length > 0 && chosen.every(isCurrent);
  const hasUnmatched = chosen.some(
    (item) =>
      !checks.get(item.domain) ||
      checks.get(item.domain)?.ownership === 'unmatched',
  );
  const inspector =
    draft.listings.find((item) => item.domain === editing) ?? null;
  const clearSelection = () => {
    setPicked(new Set());
    setCollectionAction(false);
  };
  const selectPage = (checked: boolean) => {
    const next = new Set(picked);
    rows.forEach((item) =>
      checked ? next.add(item.domain) : next.delete(item.domain),
    );
    setPicked(next);
  };
  const openInspector = (domain: string) => {
    clearSelection();
    setEditing(domain);
  };
  const change = (patch: Partial<PortfolioDraft>) => {
    portfolioEditor.update({ ...draft, ...patch });
    setUndo(null);
    setNotice('');
    setActionError('');
  };
  const update = (domain: string, patch: Partial<PortfolioListing>) =>
    change({
      listings: draft.listings.map((item) =>
        item.domain === domain ? { ...item, ...patch } : item,
      ),
    });
  const apply = (edit: BulkPortfolioEdit, names = picked) => {
    try {
      const next = editPortfolioSelection(draft, names, edit);
      const affected = next.listings.filter(
        (item, i) => JSON.stringify(item) !== JSON.stringify(draft.listings[i]),
      ).length;
      portfolioEditor.update(next);
      setUndo(affected ? draft : null);
      setNotice(
        edit.kind === 'collection'
          ? `Collections updated for ${affected} domains.`
          : edit.value === 'private'
            ? `${affected} domains removed from the draft. They remain in your inventory.`
            : edit.value === 'historical'
              ? `${affected} domains added to history.`
              : `${affected} domains updated in your draft.`,
      );
      setActionError('');
      clearSelection();
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    }
  };
  const selectScope = (
    next: PortfolioScope,
    owner: OwnershipFilter = 'all',
  ) => {
    setScope(next);
    setOwnershipFilter(owner);
    setPage(1);
    setQuery('');
    setCollection('');
    clearSelection();
    window.scrollTo(0, 0);
  };
  const filterChange = (action: () => void) => {
    action();
    setPage(1);
    clearSelection();
  };
  const navigateView = (next: typeof view) => {
    setView(next);
    setNotice('');
    setUndo(null);
    window.scrollTo(0, 0);
  };
  const review = () =>
    void run(async () => {
      await portfolioEditor.flush();
      await portfolioEditor.refreshReview();
      navigateView('review');
    });
  const copyLink = () =>
    void navigator.clipboard
      .writeText(
        window.location.origin + (liveUrl ?? hostPath(`/p/${draft.handle}`)),
      )
      .then(() => setNotice('Page link copied.'))
      .catch(() =>
        setActionError(
          'Could not copy the link. Open the live page and copy its address.',
        ),
      );

  return (
    <section className="pf-workspace">
      {view !== 'domains' && (
        <button className="pf-back" onClick={() => navigateView('domains')}>
          <ArrowLeft />
          Back to domains
        </button>
      )}
      <header className="pf-header">
        <div>
          <span className="pf-eyebrow">
            {view === 'settings'
              ? 'Page settings'
              : view === 'review'
                ? 'Publish review'
                : view === 'preview'
                  ? 'Private preview'
                  : 'Public portfolio'}
          </span>
          <h1>
            {view === 'review'
              ? 'Review your changes'
              : draft.title || 'Your collection'}
          </h1>
          <div className="pf-status">
            {state.published ? (
              <span>
                <i className="pf-live-dot" />
                Live · {state.published.count} names
              </span>
            ) : (
              <span>Not published</span>
            )}
            <span aria-hidden="true">/</span>
            <span role="status">
              {status === 'saved' && <Check />}
              {saveStatus}
            </span>
            {changes.count > 0 && (
              <span>· {changes.count} unpublished changes</span>
            )}
          </div>
        </div>
        <div className="pf-actions">
          {view === 'domains' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateView('settings')}
              >
                <Settings2 />
                Page settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateView('preview')}
              >
                <Eye />
                Preview
              </Button>
              {changes.count > 0 && (
                <Button
                  size="sm"
                  disabled={busy || changes.count === 0}
                  onClick={review}
                >
                  Review changes{changes.count > 0 ? ` (${changes.count})` : ''}{' '}
                  →
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="pf-icon-button"
                    aria-label="Portfolio options"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {liveUrl && (
                    <>
                      <DropdownMenuItem asChild>
                        <a href={liveUrl} target="_blank" rel="noreferrer">
                          <ArrowUpRight />
                          View live page
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={copyLink}>
                        <Copy />
                        Copy page link
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onSelect={() => setImporting(true)}>
                    <Upload />
                    Import domains
                  </DropdownMenuItem>
                  {state.published && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setConfirmUnpublish(true)}
                      >
                        Unpublish…
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {view === 'settings' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateView('preview')}
            >
              <Eye />
              Preview page
            </Button>
          )}
          {view === 'preview' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMobile(!mobile)}
              >
                {mobile ? 'Desktop view' : 'Mobile view'}
              </Button>
              <Button
                size="sm"
                disabled={busy || changes.count === 0}
                onClick={review}
              >
                Review changes →
              </Button>
            </>
          )}
        </div>
      </header>
      {(error || actionError) && (
        <div role="alert" className="pf-alert">
          <span>{actionError || error}</span>
          <div className="pf-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => portfolioEditor.flush())}
            >
              Retry save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscard(true)}
            >
              Reload saved draft…
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <div role="status" className="pf-alert">
          <span>{notice}</span>
          {undo && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                portfolioEditor.update(undo);
                setUndo(null);
                setNotice('Change undone in your draft.');
              }}
            >
              <Undo2 />
              Undo
            </Button>
          )}
          <button
            className="pf-row-edit"
            aria-label="Dismiss message"
            onClick={() => {
              setNotice('');
              setUndo(null);
            }}
          >
            <X />
          </button>
        </div>
      )}
      {view === 'settings' ? (
        <div className="pf-shell">
          <PortfolioSettings
            draft={draft}
            onChange={change}
            publicUrl={publicUrl}
          />
        </div>
      ) : view === 'preview' ? (
        <>
          <div className="pf-preview-frame" data-mobile={mobile}>
            <div className="pf-preview-toolbar">
              <span>
                {current.length} current listings · {history.length} historical
              </span>
              <div className="pf-preview-switches">
                <button
                  aria-pressed={!previewHistory}
                  onClick={() => setPreviewHistory(false)}
                >
                  Current holdings
                </button>
                {history.length > 0 && (
                  <button
                    aria-pressed={previewHistory}
                    onClick={() => setPreviewHistory(true)}
                  >
                    Previously owned
                  </button>
                )}
              </div>
            </div>
            <iframe
              title="Portfolio draft preview"
              sandbox=""
              srcDoc={preview}
            />
          </div>
          <p className="pf-preview-foot">
            Read-only preview.{' '}
            <a
              className="ml-1 underline"
              href={hostPath('/publishing/preview')}
              target="_blank"
              rel="noreferrer"
            >
              Open the saved preview ↗
            </a>
          </p>
        </>
      ) : view === 'review' ? (
        <PortfolioReview
          draft={draft}
          published={state.publishedSnapshot}
          blockers={blockers.length}
          busy={busy}
          ready={status === 'saved'}
          publicUrl={publicUrl}
          onResolve={() => {
            if (
              current.some((item) => item.visibility === 'inquiry') &&
              !draft.contactEmail
            )
              navigateView('settings');
            else {
              selectScope('listed', 'blocking');
              navigateView('domains');
            }
          }}
          onPublish={() =>
            void run(async () => {
              await portfolioEditor.publish();
              navigateView('domains');
              setNotice('Your portfolio is published.');
            })
          }
        />
      ) : (
        <>
          <div className="pf-shell">
            <div className="pf-scopes">
              {(
                [
                  ['listed', 'Listed', current.length],
                  ['private', 'Not listed', privateNames.length],
                  ['history', 'History', history.length],
                  ['all', 'All names', draft.listings.length],
                ] as [PortfolioScope, string, number][]
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  aria-pressed={scope === key}
                  onClick={() => selectScope(key)}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <div className="pf-toolbar">
              <div className="pf-search">
                <Search />
                <Input
                  type="search"
                  aria-label="Search portfolio"
                  placeholder="Search domains or collections…"
                  value={query}
                  onChange={(e) => filterChange(() => setQuery(e.target.value))}
                />
              </div>
              <select
                aria-label="Filter collection"
                value={collection}
                onChange={(e) =>
                  filterChange(() => setCollection(e.target.value))
                }
              >
                <option value="">All collections</option>
                {collections.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              <select
                aria-label="Filter ownership"
                value={ownershipFilter}
                onChange={(e) =>
                  filterChange(() =>
                    setOwnershipFilter(e.target.value as OwnershipFilter),
                  )
                }
              >
                <option value="all">Ownership: all</option>
                <option value="owned">Synced</option>
                <option value="attention">Needs review</option>
                <option value="blocking">Blocks publishing</option>
              </select>
              <select
                aria-label="Sort portfolio"
                className="pf-sort"
                value={sort}
                onChange={(e) => filterChange(() => setSort(e.target.value))}
              >
                <option value="az">Name A–Z</option>
                <option value="za">Name Z–A</option>
                <option value="price">Price by currency</option>
              </select>
              <Button size="sm" onClick={() => selectScope('private', 'owned')}>
                <Plus />
                Add domains
              </Button>
            </div>
            {picked.size > 0 && (
              <div className="pf-bulk">
                <strong>{picked.size} selected</strong>
                {allPrivate ? (
                  <Button
                    size="sm"
                    disabled={busy || hasUnmatched}
                    onClick={() =>
                      apply({ kind: 'visibility', value: 'showcase' })
                    }
                  >
                    Add to portfolio
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!allCurrent}
                      >
                        Inquiries
                        <ChevronDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onSelect={() =>
                          apply({ kind: 'inquiries', value: 'inquiry' })
                        }
                      >
                        Accept inquiries
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          apply({ kind: 'inquiries', value: 'showcase' })
                        }
                      >
                        Showcase only
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCollectionAction(!collectionAction)}
                >
                  <FolderPlus />
                  Collections
                </Button>
                {!allPrivate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      apply({ kind: 'visibility', value: 'private' })
                    }
                  >
                    Remove from page
                  </Button>
                )}
                {allPrivate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setHistoryNames(new Set(picked))}
                  >
                    Previously owned…
                  </Button>
                )}
                <button
                  className="pf-text-button pf-clear"
                  onClick={clearSelection}
                >
                  Clear selection
                </button>
                {allPrivate && hasUnmatched && (
                  <span className="pf-hint w-full">
                    Some names have no inventory match. Verify them before
                    adding them as current listings.
                  </span>
                )}
              </div>
            )}
            {collectionAction && picked.size > 0 && (
              <div className="pf-bulk-form">
                <label className="pf-field">
                  Action
                  <select
                    aria-label="Collection edit action"
                    value={collectionMode}
                    onChange={(e) =>
                      setCollectionMode(e.target.value as typeof collectionMode)
                    }
                  >
                    <option value="add">Add collection</option>
                    <option value="remove">Remove collection</option>
                    <option value="replace">Replace collections</option>
                  </select>
                </label>
                <label className="pf-field">
                  Collection name
                  <Input
                    aria-label="Bulk collection name"
                    value={collectionValue}
                    onChange={(e) => setCollectionValue(e.target.value)}
                    placeholder="e.g. Short names"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={!collectionValue.trim()}
                  onClick={() => {
                    const applied = apply({
                      kind: 'collection',
                      mode: collectionMode,
                      value: collectionValue,
                    });
                    if (applied) setCollectionValue('');
                  }}
                >
                  Apply to {picked.size}
                </Button>
                <button
                  className="pf-text-button"
                  onClick={() => setCollectionAction(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            {picked.size > 0 && filtered.length > rows.length && (
              <div className="pf-selection-banner">
                <span>{picked.size} selected across this result.</span>
                {!filtered.every((item) => picked.has(item.domain)) && (
                  <button
                    className="pf-text-button"
                    onClick={() =>
                      setPicked(new Set(filtered.map((item) => item.domain)))
                    }
                  >
                    Select all {filtered.length} matching domains
                  </button>
                )}
              </div>
            )}
            <label className="pf-mobile-select">
              <Checkbox
                aria-label="Select visible domains"
                checked={
                  visibleSelected === 0
                    ? false
                    : visibleSelected === rows.length
                      ? true
                      : 'indeterminate'
                }
                onCheckedChange={(checked) => selectPage(checked === true)}
              />
              Select this page
            </label>
            <table className="pf-table">
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      aria-label="Select this page"
                      checked={
                        visibleSelected === 0
                          ? false
                          : visibleSelected === rows.length
                            ? true
                            : 'indeterminate'
                      }
                      onCheckedChange={(checked) => {
                        const next = new Set(picked);
                        rows.forEach((item) =>
                          checked
                            ? next.add(item.domain)
                            : next.delete(item.domain),
                        );
                        setPicked(next);
                      }}
                    />
                  </th>
                  <th>Domain</th>
                  <th>Availability</th>
                  <th className="pf-collection-cell">Collections</th>
                  <th>Asking price</th>
                  <th className="pf-check-column">Ownership</th>
                  <th>
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const check =
                    checks.get(item.domain)?.ownership ?? 'unmatched';
                  return (
                    <tr
                      key={item.domain}
                      data-selected={picked.has(item.domain)}
                    >
                      <td>
                        <Checkbox
                          aria-label={`Select ${item.domain}`}
                          checked={picked.has(item.domain)}
                          onCheckedChange={(checked) => {
                            const next = new Set(picked);
                            if (checked) next.add(item.domain);
                            else next.delete(item.domain);
                            setPicked(next);
                          }}
                        />
                      </td>
                      <td className="pf-domain-cell">
                        <button
                          className="pf-domain"
                          onClick={() => openInspector(item.domain)}
                        >
                          {item.domain}
                        </button>
                        {check !== 'owned' &&
                          item.visibility !== 'historical' && (
                            <span className="pf-mobile-evidence">
                              {ownershipLabel[check]}
                            </span>
                          )}
                      </td>
                      <td className="pf-availability-cell">
                        {isCurrent(item) ? (
                          <select
                            className="pf-inline-availability"
                            aria-label={`Availability for ${item.domain}`}
                            value={item.visibility}
                            onChange={(e) =>
                              update(item.domain, {
                                visibility: e.target.value as
                                  'inquiry' | 'showcase',
                              })
                            }
                          >
                            <option value="inquiry">Inquiries on</option>
                            <option value="showcase">Showcase only</option>
                          </select>
                        ) : item.visibility === 'historical' ? (
                          <span className="pf-availability">
                            Previously owned
                          </span>
                        ) : (
                          <button
                            className="pf-text-button"
                            disabled={check === 'unmatched'}
                            onClick={() =>
                              apply(
                                { kind: 'visibility', value: 'showcase' },
                                new Set([item.domain]),
                              )
                            }
                          >
                            {check === 'unmatched'
                              ? 'Not listed'
                              : '+ Add to page'}
                          </button>
                        )}
                      </td>
                      <td className="pf-collection-cell">
                        <div className="pf-collection">
                          {collectionTokens(item.collection)
                            .slice(0, 2)
                            .map((name) => (
                              <span key={name} className="pf-tag">
                                {name}
                              </span>
                            ))}
                          {collectionTokens(item.collection).length > 2 && (
                            <span className="pf-hint">
                              +{collectionTokens(item.collection).length - 2}
                            </span>
                          )}
                          {!item.collection && (
                            <span className="pf-hint">—</span>
                          )}
                        </div>
                      </td>
                      <td className="pf-price-cell">
                        <button
                          className="pf-price"
                          aria-label={`Edit asking price for ${item.domain}`}
                          onClick={() => openInspector(item.domain)}
                        >
                          {item.visibility === 'historical' ? (
                            '—'
                          ) : item.askingPrice === null ? (
                            <span className="pf-hint">On request</span>
                          ) : (
                            `${item.currency} ${item.askingPrice.toLocaleString()}`
                          )}
                        </button>
                      </td>
                      <td className="pf-check-column">
                        <span
                          className="pf-evidence-label"
                          data-ok={check === 'owned'}
                        >
                          {item.visibility === 'historical' ? (
                            'Owner-declared'
                          ) : check === 'owned' ? (
                            <>
                              <Check />
                              Synced
                            </>
                          ) : (
                            <>
                              <AlertCircle />
                              {check === 'unmatched'
                                ? 'No match'
                                : check === 'stale'
                                  ? 'Needs sync'
                                  : 'Conflict'}
                            </>
                          )}
                        </span>
                      </td>
                      <td>
                        <button
                          className="pf-row-edit"
                          aria-label={`Edit ${item.domain}`}
                          onClick={() => openInspector(item.domain)}
                        >
                          <Pencil />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && (
              <div className="pf-empty">
                <Globe />
                <h2>
                  {scope === 'listed' &&
                  !query &&
                  !collection &&
                  ownershipFilter === 'all'
                    ? 'Your collection starts here'
                    : 'No matching domains'}
                </h2>
                <p>
                  {scope === 'listed' && current.length === 0
                    ? 'Choose names from your inventory. Everything stays private until you publish.'
                    : 'Try another filter or clear your search.'}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    selectScope(
                      scope === 'listed' && current.length === 0
                        ? 'private'
                        : scope,
                      scope === 'listed' && current.length === 0
                        ? 'owned'
                        : 'all',
                    )
                  }
                >
                  {current.length === 0 && scope === 'listed'
                    ? 'Choose domains'
                    : 'Clear filters'}
                </Button>
              </div>
            )}
            <div className="pf-footer">
              <span>
                {filtered.length
                  ? `${(actualPage - 1) * PAGE_SIZE + 1}–${Math.min(actualPage * PAGE_SIZE, filtered.length)} of ${filtered.length} domains`
                  : '0 domains'}
                {picked.size ? ` · ${picked.size} selected` : ''}
              </span>
              <div className="pf-pagination">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Previous portfolio page"
                  disabled={actualPage === 1}
                  onClick={() => {
                    setPage(actualPage - 1);
                    window.scrollTo(0, 0);
                  }}
                >
                  <ChevronLeft />
                </Button>
                <span>
                  {actualPage} / {pages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Next portfolio page"
                  disabled={actualPage === pages}
                  onClick={() => {
                    setPage(actualPage + 1);
                    window.scrollTo(0, 0);
                  }}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
          <div className="pf-health-line">
            <Check />
            <span>
              {state.accounts.filter((account) => account.healthy).length}/
              {state.accounts.length} registrar accounts synced.
            </span>
            {blockers.length > 0 ? (
              <button
                className="pf-text-button"
                onClick={() => selectScope('listed', 'blocking')}
              >
                {blockers.length} listed names block publishing
              </button>
            ) : (
              <span>No ownership blockers on your page.</span>
            )}
            {unmatched.length > 0 && (
              <button
                className="pf-text-button"
                onClick={() => selectScope('private', 'attention')}
              >
                {unmatched.length} unlisted names need review
              </button>
            )}
          </div>
        </>
      )}
      <PortfolioInspector
        item={inspector}
        check={inspector ? checks.get(inspector.domain) : undefined}
        onClose={() => setEditing(null)}
        onChange={(patch) => {
          if (inspector) update(inspector.domain, patch);
        }}
        onHistory={() => {
          if (inspector) {
            setHistoryNames(new Set([inspector.domain]));
            setEditing(null);
          }
        }}
        saveStatus={saveStatus}
        error={error}
      />
      <Dialog
        open={!!historyNames}
        onOpenChange={(open) => {
          if (!open) setHistoryNames(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Add {historyNames?.size} names to history?</DialogTitle>
          <DialogDescription>
            This is your statement that you previously owned these names. They
            will appear under Previously owned, without inquiries, after you
            publish.
          </DialogDescription>
          <p className="break-words text-sm">
            {[...(historyNames ?? [])].slice(0, 5).join(', ')}
            {(historyNames?.size ?? 0) > 5
              ? ` and ${historyNames!.size - 5} more`
              : ''}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setHistoryNames(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (historyNames)
                  apply(
                    { kind: 'visibility', value: 'historical' },
                    historyNames,
                  );
                setHistoryNames(null);
              }}
            >
              Confirm previous ownership
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogTitle>Import a collection</DialogTitle>
          <DialogDescription>
            Imported names start private. Existing edits and public selections
            are preserved.
          </DialogDescription>
          <input
            type="file"
            accept=".csv,.tsv,.json,.txt"
            aria-label="Import collection file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 4 * 1024 * 1024) {
                setActionError('Choose a file smaller than 4 MB.');
                return;
              }
              void file
                .text()
                .then(setImportText)
                .catch(() => setActionError('Could not read that file.'));
            }}
          />
          <Textarea
            aria-label="Collection import text"
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste domains, CSV, or JSON"
          />
          <Button
            onClick={() => {
              try {
                const result = importPublication(importText, draft.listings);
                change({ listings: result.listings });
                setNotice(
                  `${result.added} names imported privately. ${result.duplicates} existing names kept.`,
                );
                setImportText('');
                setImporting(false);
                selectScope('private');
              } catch (e) {
                setActionError((e as Error).message);
              }
            }}
          >
            Import privately
          </Button>
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <DialogContent>
          <DialogTitle>Unpublish this portfolio?</DialogTitle>
          <DialogDescription>
            The public page will be removed. Your draft and registrar inventory
            remain.
          </DialogDescription>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setUndo(null);
                clearSelection();
                setEditing(null);
                await portfolioEditor.unpublish();
                setConfirmUnpublish(false);
                setNotice('Portfolio unpublished. Your draft is retained.');
              })
            }
          >
            Confirm unpublish
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogTitle>Discard unsaved edits?</DialogTitle>
          <DialogDescription>
            This loads the latest saved draft, including any changes made in
            another tab.
          </DialogDescription>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setUndo(null);
                clearSelection();
                setEditing(null);
                await portfolioEditor.discardAndReload();
                setConfirmDiscard(false);
                setNotice('Latest saved draft loaded.');
              })
            }
          >
            Discard edits and reload
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
