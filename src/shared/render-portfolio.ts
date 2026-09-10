import type { PublishedPortfolio } from './publication';

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
    if (query) params.set('q', query);
    return `?${e(params.toString())}`;
  };
  const collections = [
    ...new Set(visible.flatMap((item) => collectionNames(item.collection))),
  ].sort();
  const filtered = visible.filter(
    (item) =>
      (!collection || collectionNames(item.collection).includes(collection)) &&
      `${item.domain} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
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
          ? `<a class="inquire" href="mailto:${e(snapshot.contactEmail)}?subject=${e(encodeURIComponent(`Inquiry: ${item.domain}`))}">${price || 'Inquire'} <span aria-hidden="true">↗</span></a>`
          : `<span class="status">${item.visibility === 'historical' ? 'Previously owned' : 'Showcase'}</span>`;
      return `<article><div class="name"><h2>${e(item.domain)}</h2>${item.description ? `<p>${e(item.description)}</p>` : ''}</div><span class="collection">${e(item.collection)}</span>${contact}</article>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="${preview ? 'noindex, nofollow' : 'index, follow'}"><meta name="description" content="${e(snapshot.intro || snapshot.title)}"><title>${e(snapshot.title)} · domains.domains</title><style>
  :root{color-scheme:light;--ink:#21342a;--muted:#56665c;--line:#dce3db;--paper:#f7f9f5;--green:#31613b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #7ac28d;outline-offset:3px}header,main,footer{max-width:1120px;margin:auto;padding:0 32px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-top:28px;padding-bottom:28px;border-bottom:1px solid var(--line)}.brand{font-weight:750;letter-spacing:-.6px;font-size:22px}.edition{font-size:13px;color:var(--muted)}.hero{padding:72px 0 40px}.eyebrow{font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:var(--green);font-weight:650}h1{font-size:clamp(36px,6vw,68px);line-height:1.08;letter-spacing:-.045em;max-width:900px;margin:18px 0 24px;overflow-wrap:anywhere}.intro{font-size:19px;max-width:680px;color:var(--muted);white-space:pre-line}.meta{font-size:14px;color:var(--muted);margin-top:28px}.preview{background:#e6efdf;text-align:center;padding:12px 20px;font-size:14px}.view-tabs{display:flex;gap:24px;flex-wrap:wrap;margin:0 0 25px;border-bottom:1px solid var(--line);padding-bottom:14px}.view-tabs a[aria-current="page"]{color:var(--green);font-weight:650}.tools{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0 28px}input,select,button{font:inherit;padding:11px 14px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}input{flex:1;min-width:180px}button{background:var(--green);color:#fff;cursor:pointer;border-color:var(--green)}article{display:grid;grid-template-columns:minmax(0,1fr) 150px 150px;gap:24px;align-items:center;border-top:1px solid var(--line);padding:24px 0}h2{font-size:23px;letter-spacing:-.025em;margin:0;overflow-wrap:anywhere}.name p{margin:8px 0 0;color:var(--muted);max-width:620px;overflow-wrap:anywhere}.collection,.status{font-size:13px;color:var(--muted)}.inquire{text-align:right;color:var(--green);font-weight:600}.status{text-align:right}.pagination{display:flex;gap:24px;justify-content:center;border-top:1px solid var(--line);padding:28px 0}.empty{padding:60px 0;color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:64px;padding-top:24px;padding-bottom:36px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;font-size:13px}label{display:flex;flex-direction:column;gap:6px;font-size:12px}.tools label:first-child{flex:1}.tools button{align-self:end}@media(max-width:640px){header,main,footer{padding-left:20px;padding-right:20px}.hero{padding-top:44px}article{grid-template-columns:minmax(0,1fr) auto;gap:12px}.collection{grid-column:1}.inquire,.status{grid-column:2;grid-row:1/3}.edition{max-width:120px;text-align:right}footer{flex-direction:column}.tools label{width:100%}.tools button{width:100%}}
  </style></head><body>${preview ? '<div class="preview"><strong>Private preview.</strong> Only the selected public fields appear here. Publishing is a separate step in the app.</div>' : ''}<header><a class="brand" href="/">domains.domains</a><span class="edition">An independently curated collection</span></header><main><section class="hero"><span class="eyebrow">Domain collection</span><h1>${e(snapshot.title)}</h1>${snapshot.intro ? `<p class="intro">${e(snapshot.intro)}</p>` : ''}<p class="meta">${current.length.toLocaleString('en-US')} current ${current.length === 1 ? 'holding' : 'holdings'}${history.length ? ` · ${history.length} previously owned` : ''} · ${preview ? 'Draft preview' : `Published ${new Date(snapshot.publishedAt).toISOString().slice(0, 10)}`}</p></section>${history.length ? `<nav class="view-tabs" aria-label="Holdings"><a href="${viewLink(false)}"${!viewingHistory ? ' aria-current="page"' : ''}>Current holdings (${current.length})</a><a href="${viewLink(true)}"${viewingHistory ? ' aria-current="page"' : ''}>Previously owned (${history.length})</a></nav>` : ''}<form class="tools" method="get">${viewingHistory ? '<input type="hidden" name="view" value="history">' : ''}<label>Search domains<input name="q" value="${e(query)}" placeholder="Find a name…" type="search"></label><label>Collection<select name="collection"><option value="">All collections</option>${collections.map((name) => `<option value="${e(name)}"${name === collection ? ' selected' : ''}>${e(name)}</option>`).join('')}</select></label><button type="submit">Search</button></form><section aria-label="Domain listings">${listings || '<p class="empty">No domains match this selection.</p>'}</section>${pages > 1 ? `<nav class="pagination" aria-label="Pagination">${page > 1 ? `<a href="${pageUrl(page - 1)}">← Previous</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${pageUrl(page + 1)}">Next →</a>` : ''}</nav>` : ''}</main><footer><span>Curated by the portfolio owner.</span><span>Published with domains.domains · Built on DomBot</span></footer></body></html>`;
}

export const publicHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
