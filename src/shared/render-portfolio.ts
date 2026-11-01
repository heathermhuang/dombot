import type { PublishedPortfolio } from './publication';
import { publicPageStyles } from './public-page-style';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
}

const collectionNames = (value: string) =>
  value
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);

export function renderPortfolio(
  snapshot: PublishedPortfolio,
  url: URL,
  preview = false,
  embeddedPreview = false,
): string {
  const e = escapeHtml;
  const query = (url.searchParams.get('q') ?? '').slice(0, 200);
  const collection = url.searchParams.get('collection') ?? '';
  const current = snapshot.listings.filter(
    (item) => item.visibility !== 'historical',
  );
  const history = snapshot.listings.filter(
    (item) => item.visibility === 'historical',
  );
  // Preserve old collection bookmarks while keeping the default view current.
  const historicalCollection =
    !!collection &&
    history.some((item) =>
      collectionNames(item.collection).includes(collection),
    ) &&
    !current.some((item) =>
      collectionNames(item.collection).includes(collection),
    );
  const viewingHistory =
    url.searchParams.get('view') === 'history' ||
    historicalCollection ||
    (!current.length && history.length > 0);
  const visible = viewingHistory ? history : current;
  const viewLink = (historical: boolean) => {
    const params = new URLSearchParams();
    if (historical) params.set('view', 'history');
    // Switching holdings starts a new browsing task with no hidden filters.
    return `?${e(params.toString())}`;
  };
  const collections = [
    ...new Set(visible.flatMap((item) => collectionNames(item.collection))),
  ].sort();
  const sort = url.searchParams.get('sort') ?? '';
  const filtered = visible.filter(
    (item) =>
      (!collection || collectionNames(item.collection).includes(collection)) &&
      `${item.domain} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!sort || sort === 'az')
    filtered.sort((a, b) => a.domain.localeCompare(b.domain));
  if (sort === 'short')
    filtered.sort(
      (a, b) =>
        a.domain.length - b.domain.length || a.domain.localeCompare(b.domain),
    );
  if (sort === 'price')
    filtered.sort((a, b) => {
      const ap = a.visibility === 'inquiry' ? a.askingPrice : null;
      const bp = b.visibility === 'inquiry' ? b.askingPrice : null;
      return ap === null
        ? bp === null
          ? 0
          : 1
        : bp === null
          ? -1
          : a.currency.localeCompare(b.currency) || ap - bp;
    });
  const clearUrl = viewingHistory ? '?view=history' : '?';
  const pages = Math.max(1, Math.ceil(filtered.length / 60));
  const page = Math.max(
    1,
    Math.min(
      pages,
      Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1,
    ),
  );
  const pageUrl = (n: number) => {
    const params = new URLSearchParams(url.searchParams);
    params.set('page', String(n));
    return `?${e(params.toString())}`;
  };
  const listings = filtered
    .slice((page - 1) * 60, page * 60)
    .map((item) => {
      const price =
        item.visibility === 'inquiry' && item.askingPrice !== null
          ? `${e(item.currency)} ${item.askingPrice.toLocaleString('en-US')}`
          : '';
      const contact =
        item.visibility === 'inquiry' && snapshot.contactEmail
          ? `<div class="contact">${price ? `<span class="price">${price}</span>` : ''}${preview ? '<span class="status">Inquire · disabled in draft</span>' : `<a class="inquire" href="mailto:${e(snapshot.contactEmail)}?subject=${e(encodeURIComponent(`Inquiry: ${item.domain}`))}">Inquire <span aria-hidden="true">↗</span></a>`}</div>`
          : `<span class="status">${item.visibility === 'historical' ? 'Previously owned' : 'Display only'}</span>`;
      return `<article class="domain-listing"><div class="name"><h2>${e(item.domain)}</h2>${item.description ? `<p>${e(item.description)}</p>` : ''}</div><span class="collection">${collectionNames(
        item.collection,
      )
        .map((name) => `<span class="collection-chip">${e(name)}</span>`)
        .join('')}</span>${contact}</article>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="${preview ? 'noindex, nofollow' : 'index, follow'}"><meta name="description" content="${e(snapshot.intro || snapshot.title)}"><title>${e(snapshot.title)} · domains.domains</title><style>${publicPageStyles}
.hero{padding:clamp(40px,6vw,72px) 0 32px}.hero h1{font-size:clamp(35px,5.2vw,58px);max-width:900px;margin:0 0 22px}.hero h1 a{color:var(--ink);text-decoration:none}.intro{font-size:clamp(17px,2vw,20px);line-height:1.7;max-width:62ch;color:var(--muted);white-space:pre-line;margin:0 0 20px}.meta{font-size:13px;color:var(--muted);margin:0}.meta a{color:inherit}.view-tabs{display:flex;gap:24px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin:0 0 28px;padding-bottom:12px;font-size:14px}.view-tabs a{display:inline-flex;align-items:center;min-height:44px;text-decoration:none}.view-tabs a[aria-current="page"]{color:var(--ink);font-weight:650;text-decoration:underline}.tools{display:grid;grid-template-columns:minmax(0,1fr) minmax(140px,180px) minmax(140px,180px) auto;gap:16px;padding:20px 24px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin:0 0 22px;align-items:end}.tools label{display:grid;gap:7px;min-width:0;font-size:12px;font-weight:500;color:var(--muted)}.tools input,.tools select{width:100%;min-height:46px;color:var(--ink)}.tools button{align-self:end}.results{font-size:13px;color:var(--muted);margin:0 0 8px}.domain-listing{display:grid;grid-template-columns:minmax(0,1fr) 160px minmax(130px,auto);gap:24px;align-items:center;border-top:1px solid var(--line);padding:26px 0}.name h2{font-size:clamp(21px,2.4vw,27px);margin:0;letter-spacing:-.03em}.name p{color:var(--muted);font-size:14px;max-width:58ch;margin:8px 0 0;white-space:pre-line}.collection{display:flex;gap:5px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.collection-chip{padding:4px 8px;background:var(--subtle);border-radius:4px}.contact{display:grid;gap:10px;text-align:right}.price{font-size:18px;line-height:1.3;font-weight:600;font-variant-numeric:tabular-nums}.inquire{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--line);border-radius:7px;padding:8px 14px;background:var(--subtle);color:var(--ink);font-size:13px;font-weight:600;text-decoration:none}.inquire:hover{border-color:var(--accent);text-decoration:none}.status{color:var(--muted);font-size:13px}.pagination{display:flex;gap:24px;justify-content:space-between;border-top:1px solid var(--line);padding:24px 0;font-size:14px}.empty{padding:48px 0;color:var(--muted)}.contact-help{padding:32px 0;margin-top:32px;border-top:1px solid var(--line)}.contact-help h2{font-size:22px;margin:0 0 12px}.contact-help p{font-size:14px;color:var(--muted);max-width:64ch}.contact-help label{display:grid;gap:8px;font-size:12px;color:var(--muted)}.contact-help input{width:min(100%,460px);user-select:all;color:var(--ink)}
@media(max-width:800px){.tools{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.tools label:first-child,.tools button{grid-column:1/-1}.domain-listing{grid-template-columns:minmax(0,1fr) auto;gap:12px 20px}.collection{grid-column:1}.contact,.status{grid-column:2;grid-row:1/3}.contact{min-width:130px}}
@media(max-width:540px){.hero{padding:36px 0 28px}.hero h1{margin-bottom:18px}.tools{padding:18px;gap:14px}.domain-listing{grid-template-columns:minmax(0,1fr);gap:12px;padding:24px 0}.collection,.contact,.status{grid-column:1;grid-row:auto;text-align:left}.contact{display:flex;align-items:center;flex-wrap:wrap;gap:16px}.price{font-size:17px}.view-tabs{gap:16px;font-size:13px}.contact-help{padding-block:24px}}
</style></head><body>${preview ? '<div class="preview"><strong>Draft preview.</strong> Search and browse freely. Contact actions are disabled; nothing is sent.</div>' : ''}<a class="skip-link" href="#main-content">Skip to content</a><header class="public-header">${preview ? '<span class="wordmark">domains.domains</span>' : '<a class="wordmark" href="https://domains.domains" rel="noreferrer">domains.domains</a>'}<span class="header-context">Selected portfolio</span></header><main id="main-content" tabindex="-1"><section class="hero"><h1><a href="?">${e(snapshot.title)}</a></h1>${snapshot.intro ? `<p class="intro">${e(snapshot.intro)}</p>` : ''}<p class="meta">${current.length.toLocaleString('en-US')} current ${current.length === 1 ? 'holding' : 'holdings'}${history.length ? ` · ${history.length} previously owned` : ''} · ${preview ? 'Draft preview' : `Published ${new Date(snapshot.publishedAt).toISOString().slice(0, 10)}`}${!viewingHistory && snapshot.contactEmail && current.some((item) => item.visibility === 'inquiry') ? ' · <a href="#contact">Contact owner</a>' : ''}</p></section>${history.length ? `<nav class="view-tabs" aria-label="Holdings"><a href="${viewLink(false)}"${!viewingHistory ? ' aria-current="page"' : ''}>Current holdings (${current.length})</a><a href="${viewLink(true)}"${viewingHistory ? ' aria-current="page"' : ''}>Previously owned (${history.length})</a></nav>` : ''}<form class="tools" method="get">${viewingHistory ? '<input type="hidden" name="view" value="history">' : ''}<label>Search domains<input name="q" value="${e(query)}" placeholder="Find a name…" type="search"></label><label>Collection<select name="collection"><option value="">All collections</option>${collections.map((name) => `<option value="${e(name)}"${name === collection ? ' selected' : ''}>${e(name)}</option>`).join('')}</select></label><label>Sort<select name="sort"><option value="">Name A–Z</option><option value="short"${sort === 'short' ? ' selected' : ''}>Shortest names</option><option value="price"${sort === 'price' ? ' selected' : ''}>Price (by currency)</option></select></label><button type="${preview && embeddedPreview ? 'button' : 'submit'}">Apply</button></form><p class="results">${filtered.length} of ${visible.length} ${viewingHistory ? 'previously owned names' : 'current holdings'}${query || collection || sort ? ` · <a href="${clearUrl}">Clear filters</a>` : ''}</p><section aria-label="Domain listings">${listings || `<p class="empty">No domains match this selection. <a href="${clearUrl}">Clear filters</a>${viewingHistory ? ' or <a href="?">Browse current holdings</a>' : ''}.</p>`}</section>${pages > 1 ? `<nav class="pagination" aria-label="Pagination">${page > 1 ? `<a href="${pageUrl(page - 1)}">← Previous</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${pageUrl(page + 1)}">Next →</a>` : ''}</nav>` : ''}${!viewingHistory && visible.some((item) => item.visibility === 'inquiry') && snapshot.contactEmail ? `<section class="contact-help" id="contact"><h2>Contact the portfolio owner</h2><p>${preview ? 'Draft preview: contact is disabled.' : 'Inquire opens your email app. You can also copy this address into your preferred email service; include the domain name.'}</p><label>Email address<input aria-label="Owner email address" readonly value="${e(snapshot.contactEmail)}"></label></section>` : ''}</main><footer class="public-footer"><span>${e(snapshot.title)}</span><span class="attribution">Published with domains.domains · <a href="https://domains.domains/source" rel="noreferrer">Source · AGPL</a><br>domains.domains is a hosted, multi-tenant version of <a href="https://github.com/aoxborrow/dombot" rel="noreferrer">aoxborrow/dombot</a>.</span></footer></body></html>`;
}

export const publicHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
