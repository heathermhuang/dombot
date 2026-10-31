import { useEffect, useMemo, useState } from 'react';
import type { PublishedOwnerSite } from '../../../shared/owner-site';
import { publicationRequest } from '../../lib/publication-client';
import {
  previewSalesTermsSchema,
  resolvedPreviewLinks,
  type PreviewSalesTerm,
} from '../../../shared/preview-sales-links';
import type { PublishedSale } from '../../../shared/sales';
import { renderOwnerSite } from '../../../shared/render-owner-site';
/** Keep all preview browsing in the approved projection, including conversion.
 * The iframe permits no scripts, forms or external navigation of its own. */
export function SitePreview({
  site,
  title = 'Your site preview',
  stagedSales = [],
}: {
  site: PublishedOwnerSite;
  stagedSales?: PublishedSale[];
  title?: string;
}) {
  const [path, setPath] = useState('');
  const [terms, setTerms] = useState<PreviewSalesTerm[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const domains = new Map(
    site.domainPresentations.map((d) => [d.id, d.domain]),
  );
  const refs =
    site.version === 3
      ? site.salesLinks.map((l) => ({
          presentationId: l.presentationId,
          listingId: l.listingId,
          publishedRevision: l.publishedRevision,
          domain: domains.get(l.presentationId)!,
        }))
      : [];
  const referenceKey = JSON.stringify(refs);
  useEffect(() => {
    const references = JSON.parse(referenceKey);
    if (!references.length) {
      setTerms([]);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController(),
      timeout = setTimeout(() => {
        controller.abort();
        setLoading(false);
        setError(
          'Loading domain-page terms timed out. Unchecked links are unavailable in this preview.',
        );
      }, 15000);
    setLoading(true);
    setError('');
    setTerms([]);
    void publicationRequest(
      '/site/preview-links',
      'POST',
      references,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setTerms(previewSalesTermsSchema.parse(value));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Could not check published domain-page terms. Unchecked links are unavailable in this preview.',
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [referenceKey]);
  const resolved = useMemo(
    () => resolvedPreviewLinks(site, terms, stagedSales),
    [site, terms, stagedSales],
  );

  const base = `https://preview.invalid/p/${site.handle}`;
  const html = useMemo(
    () => renderOwnerSite(site, new URL(base + path), true, resolved),
    [site, base, path, resolved],
  );
  return (
    <>
      {loading && (
        <p role="status">Loading reviewed domain-page preview terms…</p>
      )}
      {error && <p role="alert">{error}</p>}
      <iframe
        aria-busy={loading}
        title={title}
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (!doc) return;
          doc.addEventListener('click', (event) => {
            const a = (event.target as Element).closest('a');
            if (!a) return;
            event.preventDefault();
            const url = new URL(a.getAttribute('href') ?? '', base + path);
            if (url.origin === 'https://preview.invalid')
              setPath(
                url.pathname.replace(`/p/${site.handle}`, '') + url.search,
              );
          });
          doc.addEventListener('submit', (event) => {
            event.preventDefault();
            const params = new URLSearchParams();
            new FormData(event.target as HTMLFormElement).forEach(
              (value, key) => params.set(key, String(value)),
            );
            setPath(path.split('?')[0] + '?' + params);
          });
        }}
      />
    </>
  );
}
