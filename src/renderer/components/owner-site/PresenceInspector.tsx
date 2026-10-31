import { useEffect, useRef, useState } from 'react';
import { InventoryPicker } from './InventoryPicker';
import {
  publicationRequest,
  portfolioEditor,
} from '../../lib/publication-client';
import { loadSite, siteEditor } from '../../lib/owner-site-client';
import { isOwnerSite, type AnyPublished } from '../../../shared/owner-site';
import type { PresencePage } from '../../../shared/publishing-presence';
import type { PublicationReceipt } from '../../../shared/publication-change-set';

/** Available to legacy, profile-only and inventory users without a format migration. */
export function PresenceInspector() {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [presence, setPresence] = useState<PresencePage | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<PublicationReceipt | null>(null);
  const [review, setReview] = useState<{
    id: string;
    request: { requestKey: string };
    after: AnyPublished | null;
  } | null>(null);
  const pending = useRef<{ id: string; requestKey: string } | null>(null);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem('publishing-pending-receipt');
      if (value) pending.current = JSON.parse(value);
    } catch {
      /* Receipt recovery remains available in this session. */
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
  const read = async () => {
    if (!selected.length) throw new Error('Choose exact names to inspect.');
    const result = await publicationRequest<PresencePage>(
      `/presence?names=${encodeURIComponent(JSON.stringify(selected))}`,
    );
    setPresence(result);
  };
  const refresh = async () => {
    const state = await loadSite(),
      editor = isOwnerSite(state.draft) ? siteEditor : portfolioEditor;
    if (!editor.isDirty()) await editor.discardAndReload();
    await read();
  };
  return (
    <section className="os-editor os-presence">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Inspect public presence
      </button>
      {open && (
        <section>
          <h2>Where is each domain public?</h2>
          <p>
            Read existing draft and published surfaces without converting your
            profile or publishing holdings.
          </p>
          <fieldset disabled={busy || !!review}>
            <InventoryPicker
              selected={selected}
              onChange={(names) => {
                setSelected(names);
                setPresence(null);
              }}
              limit={100}
            />
            <button onClick={() => void run(read)}>
              Read selected public surfaces
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
                  {r.profile.state === 'unknown'
                    ? r.profile.reason
                    : `Profile: ${r.profile.value.publishedSelected ? 'published' : 'not published'}; saved draft ${r.profile.value.draftSelected ? 'selected' : 'not selected'}. ${r.profile.value.pendingChanges ? 'Draft differences pending. ' : ''}${r.profile.value.collections.map((c) => c.title).join(', ')} ${r.profile.value.publicPrice ? `${r.profile.value.publicPrice.currency} ${r.profile.value.publicPrice.amount}` : 'No public profile price'}. ${r.profile.value.currentActionSuppressed ? 'Linked action unavailable. ' : ''}${r.profile.value.newPublicationBlockers.join(' ')}`}
                </p>
                <p>
                  {r.sales.state === 'unknown'
                    ? r.sales.reason
                    : `Domain page: ${r.sales.value.publishedRevision ? 'published' : 'not published'} · ${r.sales.value.mode ?? 'No public mode'} · ${r.sales.value.price ? `${r.sales.value.price.currency} ${r.sales.value.price.amount}` : 'Request price'} · ${r.sales.value.priceSource ?? 'No price source'}. ${r.sales.value.suppression ?? ''} ${r.sales.value.pendingChanges ? 'Draft changes pending.' : ''}`}
                </p>
                <p>
                  {r.shop.state === 'unknown'
                    ? r.shop.reason
                    : `Shop: ${r.shop.value.publishedSelected ? 'published member' : 'not a published member'}; saved draft ${r.shop.value.draftSelected ? 'selected' : 'not selected'}.`}
                </p>
                {[r.profile, r.sales, r.shop]
                  .flatMap((s) =>
                    s.state === 'known' && s.value.url ? [s.value.url] : [],
                  )
                  .map((url) => (
                    <p key={url}>
                      <a href={url} target="_blank" rel="noreferrer">
                        View public surface ↗
                      </a>
                    </p>
                  ))}
              </article>
            ))}
            <button
              onClick={() =>
                void run(async () => {
                  if (!selected.length)
                    throw new Error('Choose at least one exact name.');
                  const initial = await loadSite(),
                    editor = isOwnerSite(initial.draft)
                      ? siteEditor
                      : portfolioEditor;
                  await editor.flush();
                  const saved = await loadSite();
                  setReceipt(null);
                  setReview(
                    await publicationRequest('/change-sets/review', 'POST', {
                      requestKey: crypto.randomUUID(),
                      draftRevision: saved.revision,
                      operation: { kind: 'withdraw', domains: selected },
                    }),
                  );
                })
              }
            >
              Review withdrawal from all public pages
            </button>
          </fieldset>
          {review && (
            <section>
              <h3>Review exact withdrawal</h3>
              <p>
                Remove {selected.join(', ')} from this tenant’s published
                profile references, domain pages and shop memberships. Private
                descriptions, holdings and conversations remain. External
                marketplaces, DNS and cached copies are excluded.
              </p>
              <p>
                {review.after
                  ? 'The remaining profile stays published.'
                  : 'The legacy profile becomes unpublished when its last name is removed.'}
              </p>
              <button
                disabled={busy}
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
                    const result = await publicationRequest<PublicationReceipt>(
                      `/change-sets/${review.id}/commit`,
                      'POST',
                      { requestKey: review.request.requestKey },
                    );
                    setReceipt(result);
                    setReview(null);
                    pending.current = null;
                    sessionStorage.removeItem('publishing-pending-receipt');
                    await refresh();
                  })
                }
              >
                Withdraw this exact selection
              </button>
              <button disabled={busy} onClick={() => setReview(null)}>
                Cancel; keep saved drafts
              </button>
            </section>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const p = pending.current;
                if (!p)
                  throw new Error('No pending commit is saved in this tab.');
                const r = await publicationRequest<PublicationReceipt | null>(
                  `/change-sets/${p.id}/receipt?requestKey=${p.requestKey}`,
                );
                if (!r)
                  throw new Error(
                    'No committed receipt yet. Reconcile this review before retrying.',
                  );
                setReceipt(r);
                setReview(null);
                pending.current = null;
                sessionStorage.removeItem('publishing-pending-receipt');
                await refresh();
              })
            }
          >
            Recover pending publication receipt
          </button>
          {busy && (
            <p role="status">Reading or reconciling the exact selection…</p>
          )}
          {error && <p role="alert">{error}</p>}
          {receipt && (
            <p role="status">
              {receipt.kind === 'withdraw' ? 'Withdrawn' : 'Published'} ·
              receipt {receipt.id}. {receipt.scope}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
