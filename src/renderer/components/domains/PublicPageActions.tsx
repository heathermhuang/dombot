import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  DomainPresence,
  PresencePage,
} from '../../../shared/publishing-presence';
import { publicationRequest } from '../../lib/publication-client';
import { salesRequest } from '../../lib/sales-client';
import { hostPath } from '../../lib/platform';
import { publicDomainPath } from '../../../shared/public-publishing-links';

/** Uses the existing presence contract; unknown reads never display "Private". */
export function PublicPageActions({ domain }: { domain: string }) {
  const [presence, setPresence] = useState<DomainPresence | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const abort = new AbortController();
    void publicationRequest<PresencePage>(
      `/presence?names=${encodeURIComponent(JSON.stringify([domain]))}`,
      'GET',
      undefined,
      abort.signal,
    )
      .then((page) => setPresence(page.items[0] ?? null))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [domain]);
  const sale = presence?.sales.state === 'known' ? presence.sales.value : null;
  const state = !sale
    ? 'Check status'
    : !sale.id
      ? 'Private'
      : !sale.publishedRevision
        ? 'Draft'
        : !sale.actionable
          ? 'Paused'
          : sale.pendingChanges
            ? 'Needs review'
            : 'Published';
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span
        title={
          error ||
          sale?.suppression ||
          (state === 'Published'
            ? 'Your inquiry page is published. Domain connection has its own DNS and HTTPS status.'
            : undefined)
        }
      >
        {state}
      </span>
      {sale?.id ? (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <Link
            className="text-primary underline"
            to={`/sales/listings/${sale.id}`}
          >
            Edit
          </Link>
          <a
            className="text-primary underline"
            href={hostPath(`/sales/listings/${sale.id}/preview`)}
            target="_blank"
            rel="noreferrer"
          >
            Preview
          </a>
          {sale.actionable && (
            <button
              className="underline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    new URL(
                      publicDomainPath(hostPath('/'), domain),
                      window.location.origin,
                    ).href,
                  )
                  .catch((e) => setError(e.message))
              }
            >
              Copy page link
            </button>
          )}
        </div>
      ) : (
        <button
          className="text-primary underline text-left"
          disabled={busy || !sale}
          onClick={() => {
            setBusy(true);
            void salesRequest<{
              results: { ok: boolean; id?: string; error?: string }[];
            }>('/preparation', 'POST', { domains: [domain] })
              .then((r) => {
                const row = r.results[0];
                if (!row.ok || !row.id) throw new Error(row.error);
                navigate(`/sales/listings/${row.id}`);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Prepare page
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
