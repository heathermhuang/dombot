import { useListingDraft } from '../../lib/sales-drafts';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SaleDraft, SaleDestination } from '../../../shared/sales';
import type { SalesListingDetail } from '../../../shared/sales-api';
import type { SalesReview } from '../../../shared/sales-review';
import { sourcePriceFingerprint } from '../../../core/publication/sales';
import {
  salesRequest,
  useSalesAction,
  useSalesData,
} from '../../lib/sales-client';
import { hostPath } from '../../lib/platform';
import { SalesShell, SalesFeedback, Field, listingState } from './shared';

export default function ListingEditor() {
  const { id } = useParams();
  return <ListingEditorView key={id} />;
}
function ListingEditorView() {
  const { id = '' } = useParams(),
    remote = useSalesData<SalesListingDetail>(`/listings/${id}`),
    navigate = useNavigate();
  const { editor, state } = useListingDraft(id);
  const draft = state?.draft ?? null;
  const revision = state?.revision ?? '';
  const setDraft = (
    value: SaleDraft | ((previous: SaleDraft | null) => SaleDraft | null),
  ) => {
    const next =
      typeof value === 'function'
        ? value(editor.getSnapshot()?.draft ?? null)
        : value;
    if (next) editor.update(next);
  };
  const [tab, setTab] = useState('settings'),
    [categoryText, setCategoryText] = useState(
      draft?.categories.join(', ') ?? '',
    ),
    [comparison, setComparison] = useState(false);
  const action = useSalesAction();
  useEffect(() => {
    if (remote.data?.draft.id === id && !editor.getSnapshot()) {
      editor.initialize(remote.data.draft, remote.data.revision);
      setCategoryText(remote.data.draft.categories.join(', '));
    }
  }, [remote.data, editor, id]);
  const dirty = editor.isDirty();
  const update = <K extends keyof SaleDraft>(key: K, value: SaleDraft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : null));
  const save = async () => {
    if (!draft) return '';
    const r = await salesRequest<{ revision: string }>(
      `/listings/${id}`,
      'PUT',
      { draft, revision },
    );
    editor.saved(draft, r.revision);
    action.setNotice('Draft saved. Public sales page unchanged.');
    return r.revision;
  };
  const source = remote.data?.observation.price;
  return (
    <SalesShell>
      <Link className="link" to="/sales">
        ← Sales pages
      </Link>
      <div className="sales-heading">
        <div>
          <p className="sales-kicker">SALES / DOMAIN EDITOR</p>
          <h1>{draft?.domain ?? 'Loading listing…'}</h1>
          <p className="small">
            {remote.data ? listingState(remote.data) : ''}{' '}
            {dirty ? '· Unsaved changes' : '· Saved draft'}
          </p>
        </div>
        <div className="sales-toolbar">
          <button
            disabled={!draft || action.busy}
            onClick={() =>
              void action.run(async () => {
                await save();
              })
            }
          >
            Save draft
          </button>
          <button
            className="primary"
            disabled={!draft || action.busy}
            onClick={() =>
              void action.run(async () => {
                const next = dirty ? await save() : revision;
                const review = await salesRequest<SalesReview>(
                  '/reviews',
                  'POST',
                  { items: [{ id, revision: next }] },
                );
                navigate(`/sales/review/${review.id}`);
              })
            }
          >
            Review changes
          </button>
        </div>
      </div>
      <SalesFeedback
        error={remote.error || action.error}
        notice={action.notice}
        loading={action.busy}
        retry={() => void remote.reload()}
      />
      {action.error && (
        <p className="small">
          Your unsaved form is retained.{' '}
          <button
            onClick={() => {
              setComparison(true);
              void remote.reload();
            }}
          >
            Compare saved version
          </button>{' '}
          <button
            onClick={() => {
              if (
                !window.confirm(
                  'Discard your unsaved edits and load the saved draft?',
                )
              )
                return;
              void action.run(async () => {
                const latest = await salesRequest<SalesListingDetail>(
                  `/listings/${id}`,
                );
                editor.reset(latest.draft, latest.revision);
                setCategoryText(latest.draft.categories.join(', '));
                await remote.reload();
              });
            }}
          >
            Reload saved draft
          </button>
        </p>
      )}
      {remote.data && comparison && (
        <details>
          <summary>Saved version comparison</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(remote.data.draft, null, 2)}
          </pre>
        </details>
      )}
      <div className="sales-mobile-tabs">
        <button
          aria-pressed={tab === 'settings'}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
        <button
          aria-pressed={tab === 'preview'}
          onClick={() => setTab('preview')}
        >
          Saved preview
        </button>
      </div>
      {draft && remote.data && (
        <div className="sales-editor">
          <form
            className={tab === 'preview' ? 'hide-mobile' : ''}
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await save();
              });
            }}
          >
            <section className="sales-section">
              <h2>Sales path</h2>
              <Field label="What can a buyer do?">
                <select
                  value={draft.mode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      mode: e.target.value as SaleDraft['mode'],
                      minimumOffer:
                        e.target.value === 'offer' ? draft.minimumOffer : null,
                    })
                  }
                >
                  {[
                    ['inquiry', 'Send an inquiry'],
                    ['offer', 'Make an offer'],
                    ['buy-now', 'Buy Now with a provider'],
                    ['external', 'Continue to marketplace'],
                  ].map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.allowQuestions}
                  onChange={(e) => update('allowQuestions', e.target.checked)}
                />
                Allow questions alongside this sales path
              </label>
            </section>
            <section className="sales-section">
              <h2>Price and terms</h2>
              <Field label="Public price source">
                <select
                  value={draft.priceSource?.kind ?? 'none'}
                  onChange={(e) =>
                    update(
                      'priceSource',
                      e.target.value === 'portfolio'
                        ? {
                            kind: 'portfolio',
                            fingerprint: sourcePriceFingerprint(source),
                          }
                        : e.target.value === 'override'
                          ? {
                              kind: 'override',
                              price: {
                                amount: source?.amount ?? '1000',
                                currency: source?.currency ?? 'USD',
                              },
                              reason: 'Public channel override',
                            }
                          : null,
                    )
                  }
                >
                  <option value="portfolio">Portfolio asking price</option>
                  <option value="override">
                    Public/channel price override
                  </option>
                  <option value="none">Request price</option>
                </select>
              </Field>
              <p>
                Portfolio source:{' '}
                {source?.amount
                  ? `${source.currency} ${source.amount}`
                  : 'Not set'}
                {source &&
                  ` · updated ${new Date(source.updatedAt).toLocaleString()}`}
                . Private floor, costs and notes are never published.
              </p>
              {draft.priceSource?.kind === 'portfolio' &&
                draft.priceSource.fingerprint !==
                  sourcePriceFingerprint(source) && (
                  <p role="alert">
                    The portfolio price changed.{' '}
                    <button
                      type="button"
                      onClick={() =>
                        update('priceSource', {
                          kind: 'portfolio',
                          fingerprint: sourcePriceFingerprint(source),
                        })
                      }
                    >
                      Use current portfolio price
                    </button>
                  </p>
                )}
              {draft.priceSource?.kind === 'override' && (
                <>
                  <div className="grid-two">
                    <Field label="Public asking amount">
                      <input
                        inputMode="numeric"
                        value={draft.priceSource.price.amount}
                        onChange={(e) => {
                          if (draft.priceSource?.kind === 'override')
                            update('priceSource', {
                              ...draft.priceSource,
                              price: {
                                ...draft.priceSource.price,
                                amount: e.target.value,
                              },
                            });
                        }}
                      />
                    </Field>
                    <Field label="Currency">
                      <input
                        maxLength={3}
                        value={draft.priceSource.price.currency}
                        onChange={(e) => {
                          if (draft.priceSource?.kind === 'override')
                            update('priceSource', {
                              ...draft.priceSource,
                              price: {
                                ...draft.priceSource.price,
                                currency: e.target.value.toUpperCase(),
                              },
                            });
                        }}
                      />
                    </Field>
                  </div>
                  <Field label="Reason for this override">
                    <input
                      value={draft.priceSource.reason}
                      maxLength={200}
                      onChange={(e) => {
                        if (draft.priceSource?.kind === 'override')
                          update('priceSource', {
                            ...draft.priceSource,
                            reason: e.target.value,
                          });
                      }}
                    />
                  </Field>
                </>
              )}
              {draft.mode === 'offer' && (
                <Field label="Public minimum offer (optional)">
                  <input
                    inputMode="numeric"
                    value={draft.minimumOffer?.amount ?? ''}
                    onChange={(e) =>
                      update(
                        'minimumOffer',
                        e.target.value
                          ? {
                              amount: e.target.value,
                              currency:
                                draft.priceSource?.kind === 'override'
                                  ? draft.priceSource.price.currency
                                  : (source?.currency ?? 'USD'),
                            }
                          : null,
                      )
                    }
                  />
                </Field>
              )}
            </section>
            <section className="sales-section">
              <h2>Checkout or contact</h2>
              <Field label="Provider destination">
                <select
                  value={draft.destinationId ?? ''}
                  onChange={(e) =>
                    update('destinationId', e.target.value || null)
                  }
                >
                  <option value="">Direct inquiry</option>
                  {remote.data.destinations.map((v: SaleDestination) => (
                    <option key={v.id} value={v.id}>
                      {v.provider} · {v.url} · {v.check}
                    </option>
                  ))}
                </select>
              </Field>
              <Link className="link" to="/sales/channels">
                Manage provider links
              </Link>
              <p>
                Payment and transfer happen with the selected provider. A manual
                link is seller-configured; provider availability and terms
                apply.
              </p>
            </section>
            <section className="sales-section">
              <h2>Buyer copy</h2>
              <Field label="Display capitalization">
                <input
                  value={draft.displayName}
                  maxLength={253}
                  onChange={(e) => update('displayName', e.target.value)}
                />
              </Field>
              <Field label="Description (up to 400 characters)">
                <textarea
                  value={draft.description}
                  maxLength={400}
                  onChange={(e) => update('description', e.target.value)}
                />
              </Field>
              <Field label="Categories (comma separated)">
                <input
                  value={categoryText}
                  onChange={(e) => (
                    setCategoryText(e.target.value),
                    update(
                      'categories',
                      e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    )
                  )}
                />
              </Field>
              <Field label="Seller display name">
                <input
                  value={draft.sellerDisplayName}
                  maxLength={100}
                  onChange={(e) => update('sellerDisplayName', e.target.value)}
                />
              </Field>
            </section>
            <section className="sales-section">
              <h2>Visibility</h2>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.includeInShop}
                  onChange={(e) => update('includeInShop', e.target.checked)}
                />
                Include in Sales shop when this change is published
              </label>
              <p>
                Your Public profile has its own selection. Publishing this sales
                page does not change that profile. Sales shop includes only the
                sales pages you select for it.
              </p>
            </section>
            <section className="sales-section">
              <h2>Domain setup</h2>
              <p>
                {remote.data.observation.available
                  ? remote.data.observation.controlSource === 'dns'
                    ? 'DNS verification is current and is checked automatically.'
                    : remote.data.observation.controlSource === 'operator-dns'
                      ? 'DNS control verified by the service operator for this managed host.'
                      : 'Current control observed from a connected registrar.'
                  : remote.data.observation.reason}
              </p>
              <p>
                Shareable URL:{' '}
                <a
                  className="link"
                  href={hostPath(`/d/${draft.domain}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {hostPath(`/d/${draft.domain}`)}
                </a>
              </p>
              <p>
                Publishing the shared page does not activate this domain. Review
                hostname, DNS and certificate status separately.
              </p>
              <Link className="link" to={`/sales/listings/${id}/setup`}>
                Review domain setup
              </Link>
            </section>
            {remote.data.published && (
              <section className="sales-section">
                <h2>Availability</h2>
                <button
                  type="button"
                  disabled={
                    dirty || !remote.data.hasPreviousPublication || action.busy
                  }
                  title={
                    dirty
                      ? 'Save your current draft first.'
                      : !remote.data.hasPreviousPublication
                        ? 'There is no earlier public revision yet.'
                        : ''
                  }
                  onClick={() =>
                    void action.run(async () => {
                      const previous = await salesRequest<{
                        draft: SaleDraft;
                        destinationNeedsReview: boolean;
                      }>(`/listings/${id}/previous`);
                      setDraft(previous.draft);
                      setCategoryText(previous.draft.categories.join(', '));
                      action.setNotice(
                        previous.destinationNeedsReview
                          ? 'Previous terms copied into the private form. Select the matching provider destination before saving and reviewing.'
                          : 'Previous terms copied into the private form. Save and review before publishing. Availability is unchanged.',
                      );
                    })
                  }
                >
                  Copy previous public terms to draft
                </button>
                <div className="sales-toolbar">
                  <button
                    type="button"
                    onClick={() =>
                      void action.run(async () => {
                        await salesRequest(`/listings/${id}/pause`, 'POST', {
                          revision: remote.data!.operationalRevision,
                        });
                        await remote.reload();
                        action.setNotice('Sales controls paused.');
                      })
                    }
                  >
                    Pause sales page
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void action.run(async () => {
                        await salesRequest(
                          `/listings/${id}/unpublish`,
                          'POST',
                          { revision },
                        );
                        const latest = await salesRequest<SalesListingDetail>(
                          `/listings/${id}`,
                        );
                        editor.saved(latest.draft, latest.revision);
                        await remote.reload();
                        action.setNotice(
                          'Public sales page removed. Private draft retained.',
                        );
                      })
                    }
                  >
                    Unpublish
                  </button>
                </div>
              </section>
            )}
          </form>
          <aside className={tab === 'settings' ? 'hide-mobile' : ''}>
            <h2>Saved buyer preview</h2>
            <p className="small">Save your draft to update this preview.</p>
            <iframe
              title="Saved buyer sales page preview"
              className="sales-preview"
              sandbox="allow-same-origin"
              src={hostPath(
                `/sales/listings/${id}/preview?revision=${revision}`,
              )}
            />
          </aside>
        </div>
      )}
    </SalesShell>
  );
}
