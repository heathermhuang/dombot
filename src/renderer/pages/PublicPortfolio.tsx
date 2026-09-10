import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Eye,
  Globe,
  Plus,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useAppStore } from '../store/app';
import { portfolioEditor, usePortfolioEditor } from '../lib/publication-client';
import { hostPath } from '../lib/platform';
import { importPublication } from '../../shared/publication-import';
import {
  includeDomains,
  previewSnapshot,
  publicationChanges,
} from '../../shared/publication-edit';
import { renderPortfolio } from '../../shared/render-portfolio';
import type {
  PortfolioListing,
  PortfolioDraft,
} from '../../shared/publication';

const ownershipLabels = {
  owned: 'Owned · synced',
  stale: 'Sync needs attention',
  unmatched: 'Not in connected inventory',
  conflict: 'Multiple accounts · review',
};
const fieldLabels = {
  title: 'Page title',
  intro: 'Introduction',
  contactEmail: 'Public contact email',
  handle: 'Public address',
};
type Tab = 'listings' | 'details' | 'history' | 'attention' | 'add';

function ListingDetails({
  item,
  update,
}: {
  item: PortfolioListing;
  update: (patch: Partial<PortfolioListing>) => void;
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Edit public details
      </summary>
      <div className="mt-4 grid gap-4">
        <label className="grid gap-1.5">
          Collections
          <Input
            aria-label={`Collections for ${item.domain}`}
            value={item.collection}
            maxLength={200}
            onChange={(e) => update({ collection: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            Separate multiple collections with a semicolon.
          </span>
        </label>
        <label className="grid gap-1.5">
          Public description
          <Textarea
            aria-label={`Description for ${item.domain}`}
            value={item.description}
            maxLength={400}
            rows={2}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
        {item.visibility === 'inquiry' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              Asking price (optional)
              <Input
                aria-label={`Asking price for ${item.domain}`}
                type="number"
                min="0.01"
                step="0.01"
                value={item.askingPrice ?? ''}
                onChange={(e) =>
                  update({
                    askingPrice: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label className="grid gap-1.5">
              Currency
              <Input
                aria-label={`Currency for ${item.domain}`}
                value={item.currency}
                maxLength={3}
                onChange={(e) =>
                  update({ currency: e.target.value.toUpperCase() })
                }
              />
            </label>
          </div>
        )}
      </div>
    </details>
  );
}

function ChangedListing({
  item,
  before,
}: {
  item: PortfolioListing;
  before?: PortfolioListing;
}) {
  const labels = {
    visibility: 'Availability',
    description: 'Description',
    collection: 'Collections',
    askingPrice: 'Asking price',
    currency: 'Currency',
  };
  const display = (field: keyof typeof labels, listing: PortfolioListing) => {
    if (field === 'visibility')
      return {
        private: 'Private',
        showcase: 'Showcase',
        inquiry: 'Accept inquiries',
        historical: 'Previously owned',
      }[listing.visibility];
    if (field === 'askingPrice' && listing.visibility !== 'inquiry')
      return 'Not displayed';
    return String(listing[field] ?? '(not set)') || '(empty)';
  };
  return (
    <dl className="w-full space-y-2 text-xs text-muted-foreground">
      {(Object.keys(labels) as (keyof typeof labels)[])
        .filter(
          (field) => !before || display(field, before) !== display(field, item),
        )
        .map((field) => (
          <div key={field}>
            <dt className="font-medium">{labels[field]}</dt>
            <dd className="break-words whitespace-pre-wrap">
              {before ? `${display(field, before)} → ` : ''}
              {display(field, item)}
            </dd>
          </div>
        ))}
    </dl>
  );
}

export default function PublicPortfolio() {
  const { state, draft, status, error } = usePortfolioEditor();
  const refreshTick = useAppStore((s) => s.refreshTick);
  const [tab, setTab] = useState<Tab>('listings');
  const [view, setView] = useState<'edit' | 'preview' | 'review'>('edit');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [mobile, setMobile] = useState(false);
  const [previewHistory, setPreviewHistory] = useState(false);
  const [historical, setHistorical] = useState<string | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [returnFocus, setReturnFocus] = useState(false);
  useEffect(() => {
    void portfolioEditor.load().catch(() => {});
  }, []);
  useEffect(() => {
    if (refreshTick)
      void portfolioEditor
        .refreshReview()
        .catch((e: Error) => setActionError(e.message));
  }, [refreshTick]);
  useEffect(() => {
    if (returnFocus) {
      document.getElementById('portfolio-heading')?.focus();
      setReturnFocus(false);
    }
  }, [returnFocus]);
  const ownership = useMemo(
    () => new Map(state?.review.map((r) => [r.domain, r]) ?? []),
    [state],
  );
  const preview = useMemo(
    () =>
      draft
        ? renderPortfolio(
            previewSnapshot(draft),
            new URL(
              `https://preview.invalid/p/portfolio${previewHistory ? '?view=history' : ''}`,
            ),
            true,
          )
        : '',
    [draft, previewHistory],
  );
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError('');
    setNotice('');
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
      <section className="mx-auto max-w-6xl py-8">
        <h1 className="text-3xl font-semibold">Portfolio</h1>
        <p role={error ? 'alert' : 'status'} className="my-4">
          {error || 'Loading your private draft…'}
        </p>
        {error && (
          <Button onClick={() => void portfolioEditor.load().catch(() => {})}>
            Try again
          </Button>
        )}
      </section>
    );
  const change = (patch: Partial<PortfolioDraft>) => {
    portfolioEditor.update({ ...draft, ...patch });
    setNotice('');
    setActionError('');
  };
  const update = (domain: string, patch: Partial<PortfolioListing>) =>
    change({
      listings: draft.listings.map((item) =>
        item.domain === domain ? { ...item, ...patch } : item,
      ),
    });
  const current = draft.listings.filter(
    (item) => item.visibility === 'showcase' || item.visibility === 'inquiry',
  );
  const history = draft.listings.filter(
    (item) => item.visibility === 'historical',
  );
  const attention = draft.listings.filter(
    (item) =>
      item.visibility !== 'historical' &&
      ownership.get(item.domain)?.ownership !== 'owned',
  );
  const privateNames = draft.listings.filter(
    (item) =>
      item.visibility === 'private' &&
      ownership.get(item.domain)?.ownership !== 'unmatched',
  );
  const blocked = current.filter(
    (item) => ownership.get(item.domain)?.ownership !== 'owned',
  );
  const needsEmail =
    current.some((item) => item.visibility === 'inquiry') &&
    !draft.contactEmail;
  const changes = publicationChanges(draft, state.publishedSnapshot);
  const allRows =
    tab === 'history'
      ? history
      : tab === 'attention'
        ? attention
        : tab === 'add'
          ? privateNames
          : current;
  const filtered = allRows.filter((item) =>
    `${item.domain} ${item.collection}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const activePage = Math.min(page, pages);
  const shown = filtered.slice((activePage - 1) * 40, activePage * 40);
  const switchTab = (next: Tab) => {
    setTab(next);
    setQuery('');
    setPage(1);
    setPicked(new Set());
    setHistorical(null);
  };
  const go = (next: typeof view) => {
    setView(next);
    setReturnFocus(true);
  };
  const prepareReview = () =>
    run(async () => {
      await portfolioEditor.flush();
      await portfolioEditor.refreshReview();
      go('review');
    });
  const previewPanel = (
    <div
      className={`overflow-hidden rounded-lg border bg-muted/20 ${mobile ? 'mx-auto w-full max-w-[390px]' : 'w-full'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <span>Private preview · {current.length} current</span>
        <div className="flex gap-3">
          <button
            type="button"
            className="underline underline-offset-4"
            aria-pressed={!previewHistory}
            onClick={() => setPreviewHistory(false)}
          >
            Current
          </button>
          {history.length > 0 && (
            <button
              type="button"
              className="underline underline-offset-4"
              aria-pressed={previewHistory}
              onClick={() => setPreviewHistory(true)}
            >
              History
            </button>
          )}
        </div>
      </div>
      <iframe
        title="Portfolio draft preview"
        sandbox=""
        srcDoc={preview}
        className={`w-full border-0 ${view === 'preview' ? 'h-[850px]' : 'h-[680px]'}`}
      />
    </div>
  );

  return (
    <section className="mx-auto max-w-6xl space-y-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <h1
            id="portfolio-heading"
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            {view === 'review'
              ? 'Review your changes'
              : view === 'preview'
                ? 'Your page, before it’s public'
                : 'Portfolio'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {view === 'edit'
              ? 'Choose what the world sees.'
              : view === 'review'
                ? 'Only these public fields will change.'
                : 'A private preview of your selected names.'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {status === 'saving'
              ? 'Saving draft…'
              : status === 'unsaved'
                ? 'Changes waiting to save'
                : status === 'error'
                  ? 'Draft not saved'
                  : 'Draft saved'}{' '}
            ·{' '}
            {state.published
              ? `${state.published.count} names live`
              : 'Not published'}
            {changes.count > 0 ? ` · ${changes.count} public changes` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view !== 'edit' && (
            <Button variant="outline" onClick={() => go('edit')}>
              <ArrowLeft />
              Back to editing
            </Button>
          )}
          {view === 'edit' && (
            <>
              <Button variant="outline" onClick={() => go('preview')}>
                <Eye />
                Preview
              </Button>
              <Button
                disabled={busy || changes.count === 0}
                onClick={() => void prepareReview()}
              >
                Review changes →
              </Button>
            </>
          )}
          {view === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setMobile(!mobile)}>
                {mobile ? 'Desktop view' : 'Mobile view'}
              </Button>
              <Button
                disabled={busy || changes.count === 0}
                onClick={() => void prepareReview()}
              >
                Review changes →
              </Button>
            </>
          )}
        </div>
      </div>
      {(error || actionError) && (
        <div
          className="space-y-3 rounded-md border border-destructive/40 p-4 text-sm"
          role="alert"
        >
          <p>{actionError || error}</p>
          <div className="flex flex-wrap gap-3">
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
          {confirmDiscard && (
            <div className="space-y-2 border-t pt-3">
              <p>Discard unsaved edits and load the latest saved draft?</p>
              <Button
                size="sm"
                onClick={() =>
                  void run(async () => {
                    await portfolioEditor.discardAndReload();
                    setConfirmDiscard(false);
                  })
                }
              >
                Discard edits and reload
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </Button>
            </div>
          )}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-primary"
        >
          <Check className="size-4" />
          {notice}
        </p>
      )}
      {view === 'preview' ? (
        <div className="mx-auto max-w-4xl">
          {previewPanel}
          <p className="mt-3 text-xs text-muted-foreground">
            Search and inquiry links are inactive in this embedded preview.{' '}
            <a
              href={hostPath('/publishing/preview')}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open the saved preview ↗
            </a>
          </p>
        </div>
      ) : view === 'review' ? (
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex flex-wrap gap-6 text-sm">
            <span>{changes.added.length} added</span>
            <span>{changes.removed.length} removed</span>
            <span>{changes.edited.length} edited</span>
          </div>
          <div className="divide-y rounded-lg border">
            {[
              ['Added', changes.added],
              ['Removed', changes.removed],
              ['Public details changed', changes.edited],
            ].map(([label, items]) =>
              (items as PortfolioListing[]).map((item) => (
                <div
                  key={`${label}-${item.domain}`}
                  className="flex flex-wrap justify-between gap-3 px-4 py-3 text-sm"
                >
                  <strong className="font-medium">{item.domain}</strong>
                  <span className="text-muted-foreground">
                    {label as string}
                    {item.visibility === 'historical' ? ' · historical' : ''}
                  </span>
                  {label !== 'Removed' && (
                    <ChangedListing
                      item={item}
                      before={state.publishedSnapshot?.listings.find(
                        (entry) => entry.domain === item.domain,
                      )}
                    />
                  )}
                </div>
              )),
            )}
            {changes.page.map((field) => (
              <div key={field} className="space-y-1 px-4 py-3 text-sm">
                <strong className="font-medium">{fieldLabels[field]}</strong>
                <p className="break-words text-muted-foreground">
                  {state.publishedSnapshot?.[field] || '(empty)'} →{' '}
                  {draft[field] || '(empty)'}
                </p>
              </div>
            ))}
          </div>
          <dl className="grid gap-4 border-y py-5 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Public page</dt>
              <dd className="break-all">
                {window.location.origin}
                {hostPath(`/p/${draft.handle}`)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>After publishing</dt>
              <dd>
                {current.length} current · {history.length} historical
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Public contact</dt>
              <dd>{draft.contactEmail || 'None'}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Ownership check</dt>
              <dd>
                {blocked.length
                  ? `${blocked.length} current names need review`
                  : `All ${current.length} current names synced`}
              </dd>
            </div>
          </dl>
          {state.published && state.published.handle !== draft.handle && (
            <p className="text-sm text-destructive">
              Changing the address removes /p/{state.published.handle}. Keep the
              current handle to preserve existing links.
            </p>
          )}
          {(blocked.length > 0 || needsEmail) && (
            <div role="alert" className="space-y-2 text-sm">
              <p>
                {needsEmail
                  ? 'Add a public contact email before accepting inquiries.'
                  : `${blocked.length} selected names need a fresh sync or ownership review.`}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  switchTab(needsEmail ? 'details' : 'attention');
                  go('edit');
                }}
              >
                Resolve before publishing
              </Button>
            </div>
          )}
          {current.length + history.length === 0 && (
            <p className="text-sm">
              No names selected. Use Unpublish in the editor to remove your
              page.
            </p>
          )}
          <div className="flex justify-end">
            <Button
              disabled={
                busy ||
                status !== 'saved' ||
                changes.count === 0 ||
                blocked.length > 0 ||
                needsEmail ||
                current.length + history.length === 0
              }
              onClick={() =>
                void run(async () => {
                  await portfolioEditor.publish();
                  go('edit');
                  setNotice('Your portfolio is published.');
                })
              }
            >
              <Globe />
              {busy ? 'Publishing…' : 'Publish changes'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="flex flex-wrap gap-5 border-b"
            aria-label="Portfolio sections"
          >
            {(
              [
                ['listings', `Listings · ${current.length}`],
                ['details', 'Page details'],
                ['history', `History · ${history.length}`],
                ['attention', `Needs review · ${attention.length}`],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                className={`border-b-2 py-3 text-sm ${tab === key ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground'}`}
                onClick={() => switchTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
            <fieldset
              disabled={busy}
              className="min-w-0 space-y-5 disabled:opacity-60"
            >
              {tab === 'details' ? (
                <div className="grid gap-5">
                  <label className="grid gap-2 text-sm font-medium">
                    Page title
                    <Input
                      value={draft.title}
                      maxLength={100}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    Introduction
                    <Textarea
                      value={draft.intro}
                      maxLength={600}
                      rows={3}
                      onChange={(e) => change({ intro: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    Public inquiry email
                    <Input
                      type="email"
                      value={draft.contactEmail}
                      onChange={(e) => change({ contactEmail: e.target.value })}
                    />
                    <span className="font-normal text-xs text-muted-foreground">
                      Required only when you accept inquiries.
                    </span>
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    Public address
                    <Input
                      value={draft.handle}
                      maxLength={40}
                      onChange={(e) =>
                        change({ handle: e.target.value.toLowerCase() })
                      }
                    />
                    <span className="break-all font-normal text-xs text-muted-foreground">
                      {window.location.origin}
                      {hostPath(`/p/${draft.handle}`)}
                    </span>
                  </label>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-medium">
                      {tab === 'add'
                        ? 'Add from your inventory'
                        : tab === 'history'
                          ? 'Previously owned'
                          : tab === 'attention'
                            ? 'Ownership needs attention'
                            : 'Current listings'}
                    </h2>
                    <div className="flex gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          switchTab(tab === 'add' ? 'listings' : 'add')
                        }
                      >
                        <Plus />
                        {tab === 'add' ? 'Back to listings' : 'Add domains'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setImporting(!importing)}
                      >
                        <Upload />
                        Import
                      </Button>
                    </div>
                  </div>
                  {tab === 'history' && (
                    <p className="text-sm text-muted-foreground">
                      Displayed in a separate “Previously owned” section,
                      without inquiries. Historical ownership is your statement,
                      not a registrar verification.
                    </p>
                  )}
                  {tab === 'attention' && (
                    <p className="text-sm text-muted-foreground">
                      Unlisted names stay private and do not block your other
                      listings. A missing match does not mean a domain was sold.
                    </p>
                  )}
                  {importing && (
                    <div className="space-y-3 rounded-lg border p-4">
                      <label className="grid gap-2 text-sm">
                        Import CSV, JSON, or a domain list
                        <input
                          type="file"
                          accept=".csv,.tsv,.txt,.json"
                          aria-label="Import collection file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 4 * 1024 * 1024) {
                              setActionError(
                                'Choose a file smaller than 4 MB.',
                              );
                              return;
                            }
                            void file
                              .text()
                              .then(setImportText)
                              .catch(() =>
                                setActionError('Could not read that file.'),
                              );
                          }}
                        />
                      </label>
                      <Textarea
                        aria-label="Collection import text"
                        value={importText}
                        rows={4}
                        onChange={(e) => setImportText(e.target.value)}
                        placeholder="domain,collection"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          try {
                            const result = importPublication(
                              importText,
                              draft.listings,
                            );
                            change({ listings: result.listings });
                            setNotice(
                              `${result.added} candidates added privately; existing edits preserved.`,
                            );
                            setImportText('');
                            setImporting(false);
                            switchTab('attention');
                          } catch (e) {
                            setActionError((e as Error).message);
                          }
                        }}
                      >
                        Add privately
                      </Button>
                    </div>
                  )}
                  <Input
                    type="search"
                    aria-label="Search portfolio domains"
                    placeholder="Search domains or collections…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                  />
                  {tab === 'add' && (
                    <div className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
                      <label className="flex items-center gap-2">
                        <Checkbox
                          aria-label="Select all matching domains"
                          checked={
                            filtered.length > 0 &&
                            filtered.every((item) => picked.has(item.domain))
                          }
                          onCheckedChange={(checked) => {
                            const next = new Set(picked);
                            filtered.forEach((item) =>
                              checked
                                ? next.add(item.domain)
                                : next.delete(item.domain),
                            );
                            setPicked(next);
                          }}
                        />
                        Select all {filtered.length} matching names
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <span>{picked.size} selected</span>
                        <Button
                          size="sm"
                          disabled={!picked.size}
                          onClick={() => {
                            change(includeDomains(draft, [...picked]));
                            setNotice(
                              `${picked.size} names included in your private draft. Inquiries are off for new listings.`,
                            );
                            switchTab('listings');
                          }}
                        >
                          Add to draft
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="divide-y">
                    {shown.map((item) => {
                      const check =
                        ownership.get(item.domain)?.ownership ?? 'unmatched';
                      return (
                        <article key={item.domain} className="py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                {tab === 'add' && (
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
                                )}
                                <h3 className="break-all text-lg font-medium tracking-tight">
                                  {item.domain}
                                </h3>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.collection ? `${item.collection} · ` : ''}
                                {item.visibility === 'historical'
                                  ? 'Owner-declared history'
                                  : ownershipLabels[check]}
                              </p>
                            </div>
                            {item.visibility !== 'private' && (
                              <button
                                type="button"
                                className="shrink-0 py-1 text-xs text-muted-foreground underline underline-offset-4"
                                aria-label={`Remove ${item.domain} from portfolio`}
                                onClick={() =>
                                  update(item.domain, { visibility: 'private' })
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          {(item.visibility === 'showcase' ||
                            item.visibility === 'inquiry') && (
                            <label className="mt-3 flex items-center gap-2 text-sm">
                              <Switch
                                aria-label={`Accept inquiries for ${item.domain}`}
                                checked={item.visibility === 'inquiry'}
                                onCheckedChange={(checked) =>
                                  update(item.domain, {
                                    visibility: checked
                                      ? 'inquiry'
                                      : 'showcase',
                                  })
                                }
                              />
                              Accept inquiries
                            </label>
                          )}
                          {tab === 'attention' && (
                            <div className="mt-3 flex flex-wrap gap-4 text-xs">
                              <Link
                                to="/settings"
                                className="underline underline-offset-4"
                              >
                                Review registrar accounts
                              </Link>
                              {item.visibility === 'private' && (
                                <button
                                  className="underline underline-offset-4"
                                  onClick={() => setHistorical(item.domain)}
                                >
                                  Previously owned…
                                </button>
                              )}
                            </div>
                          )}
                          {historical === item.domain && (
                            <div className="mt-3 space-y-3 rounded-md border p-3 text-sm">
                              <p>
                                Confirm that you previously owned {item.domain}.
                                It will be included as history, without
                                inquiries, when you publish.
                              </p>
                              <Button
                                size="sm"
                                onClick={() => {
                                  update(item.domain, {
                                    visibility: 'historical',
                                  });
                                  setHistorical(null);
                                }}
                              >
                                Mark previously owned
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setHistorical(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                          {tab !== 'add' && (
                            <ListingDetails
                              item={item}
                              update={(patch) => update(item.domain, patch)}
                            />
                          )}
                        </article>
                      );
                    })}
                  </div>
                  {!shown.length && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      {query
                        ? 'No matching names.'
                        : tab === 'listings'
                          ? 'Choose names from your inventory to create your public collection.'
                          : tab === 'attention'
                            ? 'No ownership issues need review.'
                            : tab === 'history'
                              ? 'No historical names selected.'
                              : 'All inventory names are already included.'}
                      {tab === 'listings' && (
                        <div className="mt-4">
                          <Button
                            variant="outline"
                            onClick={() => switchTab('add')}
                          >
                            Choose domains
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {filtered.length > 40 && (
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        {filtered.length} names · {activePage} / {pages}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activePage === 1}
                          onClick={() => setPage(activePage - 1)}
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activePage === pages}
                          onClick={() => setPage(activePage + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </fieldset>
            <aside className="min-w-0 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Your page</span>
                <button
                  className="text-primary underline underline-offset-4"
                  onClick={() => go('preview')}
                >
                  Expand preview
                </button>
              </div>
              {previewPanel}
            </aside>
          </div>
          <details className="rounded-md border px-4 py-3 text-sm">
            <summary className="cursor-pointer">
              Registrar coverage ·{' '}
              {state.accounts.filter((a) => a.healthy).length}/
              {state.accounts.length} accounts fresh
            </summary>
            <ul className="mt-3 space-y-2">
              {state.accounts.map((account) => (
                <li
                  key={account.label}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <span>{account.label}</span>
                  <span className="text-muted-foreground">
                    {account.count} domains ·{' '}
                    {account.healthy ? 'Synced' : 'Needs attention'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          {state.published && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
              <a
                href={hostPath(`/p/${state.published.handle}`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline"
              >
                View live page
                <ArrowUpRight className="size-3" />
              </a>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmUnpublish(true)}
              >
                Unpublish…
              </Button>
            </div>
          )}
          {confirmUnpublish && (
            <div className="space-y-3 rounded-md border p-4 text-sm">
              <p>
                Remove the public page? Your draft and registrar inventory
                remain intact.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await portfolioEditor.unpublish();
                    setConfirmUnpublish(false);
                    setNotice('Page unpublished. Your draft is retained.');
                  })
                }
              >
                Confirm unpublish
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmUnpublish(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
