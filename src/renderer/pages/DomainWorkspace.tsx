import { useLocation, useNavigate } from 'react-router-dom';
import { useDomainList, type DomainScope } from '../store/domain-list';
import {
  buildDomainCatalog,
  withInventory,
  matchesRegistrarFilters,
  sortManagementRows,
} from '../../shared/domain-catalog';
import { domainKey } from '../../shared/account-key';
import { HIDDEN_FOLDER_ID } from '../../shared/ipc';
import { useRegistrarManagement } from '../components/domain-workspace/RegistrarManagement';
import { Switch } from '@/components/ui/switch';
import LegacyDomains from './Domains';
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
export default function DomainWorkspace({
  area,
}: {
  area: 'domains' | 'page';
}) {
  const { state, draft: savedDraft, status, error } = usePortfolioEditor();
  const inventory = useAppStore((s) => s.portfolio);
  const enriched = useAppStore((s) => s.enriched);
  const pricing = useAppStore((s) => s.pricing);
  const accounts = useAppStore((s) => s.registrars);
  const folders = useAppStore((s) => s.folders);
  const assignments = useAppStore((s) => s.folderAssignments);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const effectiveInventory = useMemo(
    () =>
      inventory.map((record) =>
        enriched[domainKey(record)]
          ? {
              ...record,
              ...enriched[domainKey(record)],
              accountId: record.accountId,
              accountLabel: record.accountLabel,
              registrar: record.registrar,
              domainName: record.domainName,
            }
          : record,
      ),
    [inventory, enriched],
  );
  const draft = useMemo(
    () => (savedDraft ? withInventory(savedDraft, inventory) : null),
    [savedDraft, inventory],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const requestedView = new URLSearchParams(location.search).get('view');
  const view =
    area === 'domains'
      ? 'domains'
      : requestedView === 'preview' || requestedView === 'review'
        ? requestedView
        : 'settings';
  const list = useDomainList();
  const { mode, scope, query, collection, sort, page, picked } = list;
  const ownershipFilter = list.ownership;
  const setPage = list.setPage,
    setPicked = list.setPicked;
  const setScope = (scope: DomainScope) => list.setFilters({ scope });
  const setQuery = (query: string) => list.setFilters({ query });
  const setCollection = (collection: string) => list.setFilters({ collection });
  const setSort = (sort: string) => list.setFilters({ sort });
  const setOwnershipFilter = (ownership: OwnershipFilter) =>
    list.setFilters({ ownership });
  const refreshTick = useAppStore((s) => s.refreshTick);
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
    void loadRegistrars();
    window.scrollTo(0, 0);
  }, [loadRegistrars]);
  useEffect(() => {
    if (refreshTick)
      void portfolioEditor
        .refreshReview()
        .catch((e: Error) => setActionError(e.message));
  }, [refreshTick]);
  useEffect(() => {
    setUndo(null);
    setEditing(null);
    setNotice('');
    setCollectionAction(false);
  }, [area]);
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
  const catalog = useMemo(
    () =>
      buildDomainCatalog(
        draft?.listings ?? [],
        effectiveInventory,
        accounts,
        list.account,
      ),
    [draft, effectiveInventory, accounts, list.account],
  );
  const filtered = useMemo(() => {
    if (!draft || !state) return [];
    const candidates = filterPortfolio(draft.listings, state.review, {
      scope: scope === 'registered' ? 'all' : scope,
      ownership: ownershipFilter,
      query,
      collection,
      sort,
    }).filter(
      (item) =>
        (scope !== 'registered' ||
          !!catalog.get(item.domain)?.records.length) &&
        matchesRegistrarFilters(
          catalog.get(item.domain)!,
          {
            account: list.account,
            tld: list.tld,
            expiry: list.expiry,
            folder: list.folder,
            nameserver: list.nameserver,
          },
          assignments,
          new Set(folders.map((folder) => folder.id)),
          HIDDEN_FOLDER_ID,
        ),
    );
    return sortManagementRows(candidates, catalog, pricing, sort);
  }, [
    draft,
    state,
    scope,
    ownershipFilter,
    query,
    collection,
    sort,
    catalog,
    list.account,
    list.tld,
    list.expiry,
    list.folder,
    list.nameserver,
    assignments,
    pricing,
    folders,
  ]);
  const displayedPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
  );
  const visibleNames = filtered
    .slice((displayedPage - 1) * PAGE_SIZE, displayedPage * PAGE_SIZE)
    .map((item) => item.domain);
  const management = useRegistrarManagement({
    catalog,
    selected: picked,
    visible: visibleNames,
    active: area === 'domains' && mode === 'manage',
    needsAllDetails: !!list.nameserver,
    clearSelection: () => setPicked(new Set()),
  });
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
  if ((!draft || !state) && error && area === 'domains')
    return (
      <>
        <div className="pf-alert" role="alert">
          Public-page metadata is unavailable. Registrar management remains
          available.
        </div>
        <LegacyDomains hidePublication />
      </>
    );
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
  const selectScope = (next: DomainScope, owner: OwnershipFilter = 'all') => {
    setScope(next);
    setOwnershipFilter(owner);
    setPage(1);
    setQuery('');
    setCollection('');
    clearSelection();
    window.scrollTo(0, 0);
  };
  const resetFilters = () =>
    list.setFilters({
      query: '',
      collection: '',
      ownership: 'all',
      sort: 'az',
      account: '',
      tld: '',
      expiry: '',
      folder: '',
      nameserver: '',
    });
  const filterChange = (action: () => void) => {
    action();
    setPage(1);
    clearSelection();
  };
  const navigateView = (
    next: 'domains' | 'settings' | 'preview' | 'review',
  ) => {
    navigate(
      next === 'domains'
        ? '/'
        : next === 'settings'
          ? '/public-page'
          : `/public-page?view=${next}`,
    );
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
  const registrarRows = filtered.flatMap((item) =>
    catalog.get(item.domain)?.target ? [catalog.get(item.domain)!.target!] : [],
  );
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
      {area === 'page' && (
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
                  : mode === 'manage'
                    ? 'Registrar management'
                    : 'Public page selection'}
          </span>
          <h1>
            {view === 'domains'
              ? 'Domains'
              : view === 'review'
                ? 'Review your changes'
                : draft.title || 'Your public page'}
          </h1>
          <div className="pf-status">
            {area === 'domains' && (
              <span>
                {
                  new Set(
                    inventory.map((item) => item.domainName.toLowerCase()),
                  ).size
                }{' '}
                registrar domains ·{' '}
                {Math.max(
                  0,
                  draft.listings.length -
                    new Set(
                      inventory.map((item) => item.domainName.toLowerCase()),
                    ).size,
                )}{' '}
                history / imported
              </span>
            )}
            {state.published ? (
              <span>
                <i className="pf-live-dot" />
                {area === 'domains'
                  ? `${state.published.count} on public page`
                  : `Live · ${state.published.count} names`}
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
        {area === 'domains' && (
          <div className="domain-view-switch" aria-label="Domain view">
            <button
              aria-pressed={mode === 'manage'}
              onClick={() => {
                list.setMode('manage');
                setEditing(null);
                setCollectionAction(false);
              }}
            >
              Manage
            </button>
            <button
              aria-pressed={mode === 'publish'}
              onClick={() => {
                list.setMode('publish');
                setEditing(null);
              }}
            >
              Publish
            </button>
          </div>
        )}
        <div className="pf-actions">
          {view === 'domains' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateView('settings')}
              >
                <Settings2 />
                Public page
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
                  <DropdownMenuItem
                    disabled={!registrarRows.length}
                    onSelect={() => void management.exportRows(registrarRows)}
                  >
                    Export {registrarRows.length} registered domains (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setImporting(true)}>
                    <Upload />
                    Import domains
                  </DropdownMenuItem>
                  {area === 'page' && state.published && (
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
          {area === 'page' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  list.setMode('publish');
                  navigateView('domains');
                }}
              >
                Choose domains
              </Button>
              {changes.count > 0 && view !== 'review' && (
                <Button size="sm" disabled={busy} onClick={review}>
                  Review changes ({changes.count}) →
                </Button>
              )}
              {liveUrl && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Public page options"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {liveUrl && (
                      <>
                        <DropdownMenuItem asChild>
                          <a href={liveUrl} target="_blank" rel="noreferrer">
                            View live page
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={copyLink}>
                          Copy page link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setConfirmUnpublish(true)}
                        >
                          Unpublish…
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
              list.setMode('publish');
              selectScope('listed', 'blocking');
              navigateView('domains');
            }
          }}
          onPublish={() =>
            void run(async () => {
              await portfolioEditor.publish();
              navigateView('settings');
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
                  [
                    'registered',
                    'Inventory',
                    new Set(
                      inventory.map((item) => item.domainName.toLowerCase()),
                    ).size,
                  ],
                  ['listed', 'Listed', current.length],
                  ['private', 'Private', privateNames.length],
                  ['history', 'History', history.length],
                  ['all', 'All names', draft.listings.length],
                ] as [DomainScope, string, number][]
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
                  aria-label="Search domains"
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
                aria-label="Sort domains"
                className="pf-sort"
                value={sort}
                onChange={(e) => filterChange(() => setSort(e.target.value))}
              >
                <option value="az">Name A–Z</option>
                <option value="za">Name Z–A</option>
                <option value="price">Asking price by currency</option>
                <option value="expiry">Expiration soonest</option>
                <option value="renewal">Renewal cost highest</option>
              </select>
              <Button
                size="sm"
                onClick={() => {
                  list.setMode('publish');
                  selectScope('private', 'owned');
                }}
              >
                <Plus />
                Choose listings
              </Button>
            </div>
            <details className="domain-more-filters">
              <summary>
                Registrar filters
                {[
                  list.account,
                  list.tld,
                  list.expiry,
                  list.folder,
                  list.nameserver,
                ].filter(Boolean).length
                  ? ` · ${[list.account, list.tld, list.expiry, list.folder, list.nameserver].filter(Boolean).length} active`
                  : ''}
              </summary>
              <div>
                <button className="pf-text-button" onClick={resetFilters}>
                  Reset all filters
                </button>
                <label>
                  Account
                  <select
                    aria-label="Filter registrar account"
                    value={list.account}
                    onChange={(e) =>
                      list.setFilters({ account: e.target.value })
                    }
                  >
                    <option value="">All connected accounts</option>
                    {accounts
                      ?.filter((a) => a.configured)
                      .map((a) => (
                        <option
                          key={a.accountId ?? a.name}
                          value={a.accountId ?? a.name}
                        >
                          {a.displayName}
                          {accounts.filter(
                            (x) => x.name === a.name && x.configured,
                          ).length > 1
                            ? ` · ${a.accountLabel}`
                            : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  TLD
                  <select
                    aria-label="Filter TLD"
                    value={list.tld}
                    onChange={(e) => list.setFilters({ tld: e.target.value })}
                  >
                    <option value="">All TLDs</option>
                    {[
                      ...new Set(
                        draft.listings.map((i) =>
                          i.domain.split('.').slice(1).join('.'),
                        ),
                      ),
                    ]
                      .sort()
                      .map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Expiration
                  <select
                    aria-label="Filter expiration"
                    value={list.expiry}
                    onChange={(e) =>
                      list.setFilters({ expiry: e.target.value })
                    }
                  >
                    <option value="">Any expiration</option>
                    <option value="30">Within 30 days</option>
                    <option value="90">Within 90 days</option>
                    <option value="365">Within one year</option>
                    <option value="expired">Expired</option>
                  </select>
                </label>
                <label>
                  Folder
                  <select
                    aria-label="Filter folder"
                    value={list.folder}
                    onChange={(e) =>
                      list.setFilters({ folder: e.target.value })
                    }
                  >
                    <option value="">Visible folders</option>
                    <option value="unassigned">Unassigned</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                    <option value={HIDDEN_FOLDER_ID}>Hidden</option>
                  </select>
                </label>
                <label>
                  Nameserver
                  <Input
                    aria-label="Filter nameserver"
                    placeholder="e.g. cloudflare.com"
                    value={list.nameserver}
                    onChange={(e) =>
                      list.setFilters({ nameserver: e.target.value })
                    }
                  />
                </label>
              </div>
            </details>
            {mode === 'publish' && picked.size > 0 && (
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
                    Include on public page
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
            {mode === 'publish' && collectionAction && picked.size > 0 && (
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
            {management.toolbar}
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
            <div className="domain-table-scroll">
              <table className="pf-table" data-mode={mode}>
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
                    {mode === 'manage' ? (
                      <>
                        <th>Registrar / account</th>
                        <th>Folder</th>
                        <th>Created</th>
                        <th>Expires</th>
                        <th>Renewal</th>
                        <th>Auto</th>
                        <th>Privacy</th>
                        <th>Locked</th>
                        <th>Nameservers</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </>
                    ) : (
                      <>
                        <th>On page</th> <th>Availability</th>
                        <th className="pf-collection-cell">Collections</th>
                        <th>Asking price</th>
                        <th className="pf-check-column">Ownership</th>
                        <th>
                          <span className="sr-only">Edit</span>
                        </th>
                      </>
                    )}
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
                          {mode === 'manage' ? (
                            <span className="pf-domain">{item.domain}</span>
                          ) : (
                            <button
                              className="pf-domain"
                              onClick={() => {
                                if (mode === 'publish')
                                  openInspector(item.domain);
                              }}
                            >
                              {item.domain}
                            </button>
                          )}
                          {check !== 'owned' &&
                            item.visibility !== 'historical' && (
                              <span className="pf-mobile-evidence">
                                {ownershipLabel[check]}
                              </span>
                            )}
                        </td>
                        {mode === 'manage' ? (
                          management.cells(catalog.get(item.domain))
                        ) : (
                          <>
                            <td className="pf-inclusion-cell">
                              <Switch
                                aria-label={`Include ${item.domain} on public page`}
                                checked={item.visibility !== 'private'}
                                disabled={
                                  item.visibility === 'private' &&
                                  (!checks.get(item.domain) ||
                                    checks.get(item.domain)?.ownership ===
                                      'unmatched')
                                }
                                onCheckedChange={(on) =>
                                  apply(
                                    {
                                      kind: 'visibility',
                                      value: on ? 'showcase' : 'private',
                                    },
                                    new Set([item.domain]),
                                  )
                                }
                              />
                            </td>{' '}
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
                                  <option value="showcase">
                                    Showcase only
                                  </option>
                                </select>
                              ) : item.visibility === 'historical' ? (
                                <span className="pf-availability">
                                  Previously owned
                                </span>
                              ) : (
                                <span className="pf-availability">
                                  Not listed
                                </span>
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
                                {collectionTokens(item.collection).length >
                                  2 && (
                                  <span className="pf-hint">
                                    +
                                    {collectionTokens(item.collection).length -
                                      2}
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
                                onClick={() => {
                                  if (mode === 'publish')
                                    openInspector(item.domain);
                                }}
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
                                onClick={() => {
                                  if (mode === 'publish')
                                    openInspector(item.domain);
                                }}
                              >
                                <Pencil />
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="pf-empty">
                <Globe />
                <h2>
                  {draft.listings.length === 0
                    ? 'Connect your domains'
                    : 'No matching domains'}
                </h2>
                <p>
                  {draft.listings.length === 0
                    ? 'Connect a registrar to manage your domains, or import names to prepare your public page.'
                    : 'Try another view or clear the active filters.'}
                </p>
                {draft.listings.length === 0 ? (
                  <div className="pf-actions justify-center">
                    <Button
                      onClick={() => navigate('/settings?tab=registrars')}
                    >
                      Connect registrar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setImporting(true)}
                    >
                      Import collection
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                )}
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
      {management.dialogs}
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
