import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Eye,
  Globe,
  LockKeyhole,
  Search,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '../store/app';
import { importPublication } from '../../shared/publication-import';
import {
  draftSchema,
  type PortfolioDraft,
  type PortfolioListing,
  type PublicationState,
} from '../../shared/publication';

async function request<T>(
  path = '',
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/publishing${path}`, {
    method,
    credentials: 'same-origin',
    ...(body !== undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(json.error ?? 'Could not load the publication workspace.');
  return json;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
const visibilityLabels = {
  private: 'Private',
  showcase: 'Showcase',
  inquiry: 'Accept inquiries',
  historical: 'Previously owned',
};
const ownershipLabels = {
  owned: 'Owned · synced',
  stale: 'Sync needs attention',
  unmatched: 'Not in synced inventory',
  conflict: 'Multiple accounts · review',
};

export default function PublicPortfolio() {
  const refreshTick = useAppStore((s) => s.refreshTick);
  const [state, setState] = useState<PublicationState | null>(null);
  const [draft, setDraft] = useState<PortfolioDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | null>(null);

  const reload = useCallback(async (replace = true) => {
    const next = await request<PublicationState>();
    setState(next);
    if (replace) {
      setDraft({
        ...next.draft,
        listings: next.review.map(
          ({
            domain,
            collection,
            description,
            visibility,
            askingPrice,
            currency,
          }) => ({
            domain,
            collection,
            description,
            visibility,
            askingPrice,
            currency,
          }),
        ),
      });
      setDirty(false);
      setSelected(new Set());
    }
  }, []);
  useEffect(() => {
    void reload().catch((e: Error) => setError(e.message));
  }, [reload]);
  // Sync updates reconciliation without overwriting unsaved editorial work.
  useEffect(() => {
    if (refreshTick)
      void reload(false).catch((e: Error) => setError(e.message));
  }, [refreshTick, reload]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);

  const review = useMemo(
    () => new Map(state?.review.map((r) => [r.domain, r]) ?? []),
    [state],
  );
  const listings = draft?.listings ?? [];
  const publicCount = listings.filter(
    (item) => item.visibility !== 'private',
  ).length;
  const blocked = listings.filter(
    (item) =>
      item.visibility !== 'private' &&
      item.visibility !== 'historical' &&
      review.get(item.domain)?.ownership !== 'owned',
  );
  const filtered = listings.filter((item) => {
    const status = review.get(item.domain)?.ownership ?? 'unmatched';
    return (
      `${item.domain} ${item.collection}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'selected'
          ? item.visibility !== 'private'
          : filter === 'review'
            ? status !== 'owned'
            : item.visibility === 'private'))
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  const change = (patch: Partial<PortfolioDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setConfirm(null);
    setNotice('');
  };
  const updateListing = (domain: string, patch: Partial<PortfolioListing>) =>
    change({
      listings: listings.map((item) =>
        item.domain === domain ? { ...item, ...patch } : item,
      ),
    });
  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    action(async () => {
      if (!draft || !state) return;
      const parsed = draftSchema.safeParse(draft);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .slice(0, 3)
            .join('; '),
        );
      await request('', 'PUT', {
        draft: parsed.data,
        revision: state.revision,
      });
      await reload();
      setNotice('Draft saved. The public page has not changed.');
    });
  const importRows = () => {
    try {
      const result = importPublication(importText, listings);
      change({ listings: result.listings });
      setImporting(false);
      setImportText('');
      setNotice(
        `${result.added} candidates added privately. ${result.duplicates} existing records kept.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  };
  if (!draft || !state)
    return (
      <section className="mx-auto max-w-6xl py-8">
        <h1 className="text-3xl font-semibold">Public portfolio</h1>
        <p role={error ? 'alert' : 'status'} className="mt-4">
          {error || 'Loading your private publication workspace…'}
        </p>
        {error && (
          <Button className="mt-4" onClick={() => void action(() => reload())}>
            Try again
          </Button>
        )}
      </section>
    );

  return (
    <section className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Your collection, your choice
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Public portfolio
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Choose the names you want to share. Save a private draft, preview
            it, then publish.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setImporting(!importing)}
          >
            <Upload className="size-4" />
            Import collection
          </Button>
          <Button
            disabled={busy || (!dirty && state.revision !== null)}
            onClick={() => void save()}
          >
            {busy ? 'Working…' : 'Save draft'}
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-4 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await reload();
                setNotice('Latest saved draft loaded.');
              })
            }
          >
            Discard edits and reload
          </Button>
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
      <fieldset
        disabled={busy}
        className="min-w-0 w-full space-y-6 disabled:opacity-70"
      >
        {importing && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-5">
            <h2 className="font-semibold">Bring your existing collection</h2>
            <p className="text-sm text-muted-foreground">
              Paste domains or import CSV/JSON. CSV columns: domain, collection,
              description, askingPrice, currency. Imports start private and
              never replace existing edits.
            </p>
            <input
              aria-label="Import collection file"
              type="file"
              accept=".csv,.tsv,.json,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 4 * 1024 * 1024) {
                    setError('Choose a file smaller than 4 MB.');
                    return;
                  }
                  void file
                    .text()
                    .then(setImportText)
                    .catch(() => setError('Could not read the file.'));
                }
              }}
            />
            <Textarea
              aria-label="Collection import text"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'domain,collection\nexample.com,Short names'}
              rows={5}
            />
            <div className="flex gap-2">
              <Button onClick={importRows}>Add privately</Button>
              <Button variant="ghost" onClick={() => setImporting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="grid gap-8 border-b pb-6 md:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                Collection title
                <Input
                  value={draft.title}
                  maxLength={100}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Public address
                <Input
                  value={draft.handle}
                  maxLength={40}
                  onChange={(e) =>
                    change({ handle: e.target.value.toLowerCase() })
                  }
                />
                <span className="block text-xs font-normal text-muted-foreground">
                  /p/{draft.handle}
                </span>
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Introduction
              <Textarea
                value={draft.intro}
                maxLength={600}
                rows={3}
                placeholder="Tell visitors about your collection."
                onChange={(e) => change({ intro: e.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Public inquiry email
              <Input
                type="email"
                value={draft.contactEmail}
                placeholder="Optional unless accepting inquiries"
                onChange={(e) => change({ contactEmail: e.target.value })}
              />
            </label>
          </div>
          <aside className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LockKeyhole className="size-4" />
              Private until you publish
            </div>
            <p className="text-sm text-muted-foreground">
              Only selected names, public descriptions, collections, and asking
              prices appear. Account details, renewal costs, and private notes
              stay in your workspace.
            </p>
            <div className="border-t pt-4 text-sm">
              {state.published ? (
                <>
                  <p className="font-medium">
                    {state.published.count} names currently published
                  </p>
                  <a
                    className="mt-1 inline-flex items-center gap-1 text-primary underline"
                    href={`/p/${state.published.handle}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View published collection
                    <ArrowUpRight className="size-3" />
                  </a>
                </>
              ) : (
                <p>No public page yet.</p>
              )}
              <p className="mt-2 text-muted-foreground">
                {dirty
                  ? 'Unsaved changes'
                  : state.published?.revision === state.revision
                    ? 'Saved draft matches the published version'
                    : 'Draft changes are private'}
              </p>
            </div>
          </aside>
        </div>
        <details className="rounded-md border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Account coverage · {state.accounts.filter((a) => a.healthy).length}/
            {state.accounts.length} connected accounts fresh
          </summary>
          <p className="mt-2 text-muted-foreground">
            Coverage includes connected accounts only. Missing or stale data
            does not mean a domain was sold.
          </p>
          <ul className="mt-3 space-y-2">
            {state.accounts.map((a) => (
              <li
                key={a.label}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{a.label}</span>
                <span className="text-muted-foreground">
                  {a.count} domains · {a.healthy ? 'Synced' : 'Needs attention'}
                </span>
              </li>
            ))}
          </ul>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search collection"
              className="pl-9"
              value={query}
              placeholder="Search domains or collections…"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Filter collection"
            className={`${selectClass} sm:w-auto`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All {listings.length} names</option>
            <option value="selected">
              Selected for public page ({publicCount})
            </option>
            <option value="review">Needs ownership review</option>
            <option value="private">Private</option>
          </select>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <span>{selected.size} selected</span>
            <select
              aria-label="Set visibility for selected domains"
              className={`${selectClass} max-w-52`}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const visibility = e.target
                  .value as PortfolioListing['visibility'];
                change({
                  listings: listings.map((item) =>
                    selected.has(item.domain) ? { ...item, visibility } : item,
                  ),
                });
                setSelected(new Set());
              }}
            >
              <option value="">Set visibility…</option>
              {Object.entries(visibilityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          </div>
        )}
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full min-w-[740px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label="Select visible domains"
                    checked={
                      shown.length > 0 &&
                      shown.every((item) => selected.has(item.domain))
                    }
                    onChange={(e) => {
                      const next = new Set(selected);
                      for (const item of shown) {
                        if (e.target.checked) next.add(item.domain);
                        else next.delete(item.domain);
                      }
                      setSelected(next);
                    }}
                  />
                </th>
                <th className="p-3 font-medium">Domain / collection</th>
                <th className="p-3 font-medium">Inventory check</th>
                <th className="w-48 p-3 font-medium">Visibility</th>
                <th className="w-20 p-3">
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const reconciled = review.get(item.domain);
                return (
                  <Fragment key={item.domain}>
                    <tr className="border-b last:border-0">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.domain}`}
                          checked={selected.has(item.domain)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(item.domain);
                            else next.delete(item.domain);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{item.domain}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.collection || 'No collection'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={
                            reconciled?.ownership === 'owned'
                              ? 'text-primary'
                              : 'text-muted-foreground'
                          }
                        >
                          {
                            ownershipLabels[
                              reconciled?.ownership ?? 'unmatched'
                            ]
                          }
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {reconciled?.accountLabels.join(', ')}
                        </span>
                      </td>
                      <td className="p-3">
                        <select
                          aria-label={`Visibility for ${item.domain}`}
                          value={item.visibility}
                          className={selectClass}
                          onChange={(e) =>
                            updateListing(item.domain, {
                              visibility: e.target
                                .value as PortfolioListing['visibility'],
                            })
                          }
                        >
                          {Object.entries(visibilityLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${item.domain}`}
                          onClick={() =>
                            setEditing(
                              editing === item.domain ? null : item.domain,
                            )
                          }
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                    {editing === item.domain && (
                      <tr>
                        <td colSpan={5}>
                          {' '}
                          <div className="space-y-4 rounded-lg border p-5">
                            <div className="flex items-center justify-between">
                              <h2 className="font-semibold">
                                Public details · {item.domain}
                              </h2>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditing(null)}
                              >
                                Done
                              </Button>
                            </div>
                            <label className="block space-y-1.5 text-sm">
                              Collections (separate with ;)
                              <Input
                                value={item.collection}
                                maxLength={200}
                                onChange={(e) =>
                                  updateListing(item.domain, {
                                    collection: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="block space-y-1.5 text-sm">
                              Public description
                              <Textarea
                                value={item.description}
                                maxLength={400}
                                onChange={(e) =>
                                  updateListing(item.domain, {
                                    description: e.target.value,
                                  })
                                }
                              />
                            </label>
                            {item.visibility === 'inquiry' && (
                              <div className="grid grid-cols-2 gap-3">
                                <label className="space-y-1.5 text-sm">
                                  Asking price (optional)
                                  <Input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={item.askingPrice ?? ''}
                                    onChange={(e) =>
                                      updateListing(item.domain, {
                                        askingPrice: e.target.value
                                          ? Number(e.target.value)
                                          : null,
                                      })
                                    }
                                  />
                                </label>
                                <label className="space-y-1.5 text-sm">
                                  Currency
                                  <Input
                                    value={item.currency}
                                    maxLength={3}
                                    onChange={(e) =>
                                      updateListing(item.domain, {
                                        currency: e.target.value.toUpperCase(),
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            )}
                            {item.visibility === 'historical' && (
                              <p className="text-sm text-muted-foreground">
                                This is your explicit statement of prior
                                ownership. It will appear as “Previously owned”
                                and will not accept inquiries.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!shown.length && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {listings.length
                ? 'No names match these filters.'
                : 'Connect a registrar or import your existing collection to get started.'}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {filtered.length} names · page {currentPage} of {pages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </fieldset>
      <div className="space-y-4 rounded-lg border bg-muted/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">
              {publicCount} names selected for your public page
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {blocked.length
                ? `${blocked.length} selected names need ownership review or a fresh sync.`
                : 'Review the saved draft before making it public.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || dirty || !state.revision || blocked.length > 0}
              asChild={!dirty && !!state.revision && !blocked.length && !busy}
            >
              {!dirty && state.revision && !blocked.length && !busy ? (
                <a href="/publishing/preview" target="_blank" rel="noreferrer">
                  <Eye className="size-4" />
                  Preview saved draft
                </a>
              ) : (
                <span>Preview saved draft</span>
              )}
            </Button>
            <Button
              disabled={
                busy ||
                dirty ||
                !state.revision ||
                blocked.length > 0 ||
                publicCount === 0
              }
              onClick={() => setConfirm('publish')}
            >
              <Globe className="size-4" />
              Publish…
            </Button>
            {state.published && (
              <Button
                variant="outline"
                disabled={busy || dirty}
                onClick={() => setConfirm('unpublish')}
              >
                Unpublish…
              </Button>
            )}
          </div>
        </div>
        {confirm && (
          <div
            role="region"
            aria-label="Confirm publication"
            className="space-y-3 border-t pt-4"
          >
            <p className="text-sm">
              {confirm === 'publish'
                ? `Publish ${publicCount} selected names at /p/${draft.handle}? ${draft.contactEmail ? `Your contact email ${draft.contactEmail} will be public.` : 'No contact email will be shown.'} This replaces the current public page.`
                : 'Remove the public page now? Your saved draft and private inventory will remain.'}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await request(`/${confirm}`, 'POST', {
                      revision: state.revision,
                    });
                    await reload();
                    setNotice(
                      confirm === 'publish'
                        ? 'Your selected collection is now public.'
                        : 'The public page has been removed.',
                    );
                    setConfirm(null);
                  })
                }
              >
                {busy
                  ? 'Working…'
                  : confirm === 'publish'
                    ? 'Confirm publish'
                    : 'Confirm unpublish'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
