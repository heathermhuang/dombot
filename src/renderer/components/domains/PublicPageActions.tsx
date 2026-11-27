import { useEffect, useState } from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  DomainPresence,
  PresencePage,
} from '../../../shared/publishing-presence';
import { publicDomainPath } from '../../../shared/public-publishing-links';
import { publicationRequest } from '../../lib/publication-client';
import { salesRequest } from '../../lib/sales-client';
import { hostPath } from '../../lib/platform';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

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

  function preparePage() {
    setError('');
    setBusy(true);
    void salesRequest<{
      results: { ok: boolean; id?: string; error?: string }[];
    }>('/preparation', 'POST', { domains: [domain] })
      .then((r) => {
        const row = r.results[0];
        if (!row?.ok || !row.id) {
          throw new Error(row?.error || 'Could not prepare the page.');
        }
        navigate(`/sales/listings/${row.id}`);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }

  return (
    <div className="text-xs">
      <div className="inline-flex items-center gap-1 whitespace-nowrap">
        <span
          title={
            sale?.suppression ||
            (state === 'Published'
              ? 'Your inquiry page is published. Domain connection has its own DNS and HTTPS status.'
              : undefined)
          }
        >
          {state}
        </span>
        {sale?.id ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11 text-muted-foreground sm:-my-2 sm:size-7"
                aria-label={`Public page actions for ${domain}`}
                title="Page actions"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/sales/listings/${sale.id}`}>Edit</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={hostPath(`/sales/listings/${sale.id}/preview`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview
                </a>
              </DropdownMenuItem>
              {sale.actionable && (
                <DropdownMenuItem
                  onSelect={() =>
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
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : sale ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11 text-primary sm:-my-2 sm:size-7"
            disabled={busy}
            onClick={preparePage}
            aria-label={`Prepare public page for ${domain}`}
            title="Prepare page"
          >
            <Plus />
          </Button>
        ) : null}
      </div>
      {error && (
        <p className="mt-1 max-w-32 whitespace-normal break-words" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
