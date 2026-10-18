import { useMemo, useState } from 'react';
import type { PublishedOwnerSite } from '../../../shared/owner-site';
import { renderOwnerSite } from '../../../shared/render-owner-site';
/** Keep all preview browsing in the approved projection, including conversion.
 * The iframe permits no scripts, forms or external navigation of its own. */
export function SitePreview({
  site,
  title = 'Your site preview',
}: {
  site: PublishedOwnerSite;
  title?: string;
}) {
  const [path, setPath] = useState('');
  const base = `https://preview.invalid/p/${site.handle}`;
  const html = useMemo(
    () => renderOwnerSite(site, new URL(base + path), true),
    [site, base, path],
  );
  return (
    <iframe
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
            setPath(url.pathname.replace(`/p/${site.handle}`, '') + url.search);
        });
        doc.addEventListener('submit', (event) => {
          event.preventDefault();
          const params = new URLSearchParams();
          new FormData(event.target as HTMLFormElement).forEach((value, key) =>
            params.set(key, String(value)),
          );
          setPath(path.split('?')[0] + '?' + params);
        });
      }}
    />
  );
}
