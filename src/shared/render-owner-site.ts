import { brandFontPath } from './brand-font';
import { escapeHtml as e } from './render-portfolio';
import type { PublishedOwnerSite } from './owner-site';
import { salePriceLabel, type SaleMoney } from './sales';
export interface ResolvedSiteLink {
  url: string;
  mode: string;
  price: SaleMoney | null;
}

/** Same escaped, script-free output for private previews and approved snapshots. */
export function renderOwnerSite(
  site: PublishedOwnerSite,
  url: URL,
  preview = false,
  sales = new Map<string, ResolvedSiteLink>(),
): string {
  const domains = new Map(site.domainPresentations.map((d) => [d.id, d]));
  const pathSlug = url.pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  const requested = pathSlug ?? url.searchParams.get('collection');
  const collection =
    requested === null || requested === undefined
      ? undefined
      : site.collections.find(
          (c) => c.slug === requested || c.title === requested,
        );
  const catalogue =
    url.searchParams.get('view') === 'catalogue' ||
    url.searchParams.get('view') === 'history' ||
    url.searchParams.has('q') ||
    url.searchParams.has('sort');
  const missing =
    (requested !== null && requested !== undefined && !collection) ||
    (!collection && catalogue && !site.catalogue.enabled);
  const root = url.pathname.replace(/\/c\/[^/]+\/?$/, '').replace(/\/$/, '');
  const internal = (query = '') =>
    `${e(root || (query.startsWith('/') ? '' : '/'))}${query}`;
  const collectionLink = (slug: string) =>
    preview
      ? `?collection=${e(encodeURIComponent(slug))}`
      : internal(`/c/${e(slug)}`);
  const link = (label: string, href: string, arrow = true) =>
    preview
      ? `<span class="disabled">${e(label)} · disabled in preview</span>`
      : `<a href="${e(href)}" rel="noopener noreferrer">${e(label)}${arrow ? ' ↗' : ''}</a>`;
  const row = (id: string) => {
    const d = domains.get(id)!;
    const linked =
      site.version === 3 &&
      site.salesLinks.some((l) => l.presentationId === id);
    const resolved = sales.get(id);
    return `<article class="domain"><div><h3>${e(d.domain)}</h3>${d.description ? `<p>${e(d.description)}</p>` : ''}</div><div class="availability">${linked ? (resolved ? `${e(salePriceLabel(resolved.price))} ${link('View domain page', resolved.url)}` : 'Inquiries currently unavailable') : d.ownership === 'historical' ? 'Previously owned' : d.availability === 'not-for-sale' ? 'Not accepting inquiries' : `${d.askingPrice === null ? '' : `<strong>${e(d.currency)} ${d.askingPrice.toLocaleString('en-US')}</strong> `}${link('Inquire', `mailto:${site.profile.contactEmail}?subject=${encodeURIComponent(`Inquiry: ${d.domain}`)}`)}`}</div></article>`;
  };
  const profile = site.profile;
  let content: string;
  let title = profile.name;
  if (missing) {
    title = 'Selection not found';
    content =
      '<h1>Selection not found</h1><p>This selection is not published.</p>';
  } else if (collection || catalogue) {
    title =
      collection?.title ??
      (url.searchParams.get('view') === 'history'
        ? 'Previously owned'
        : 'Selected domains');
    const q = (url.searchParams.get('q') ?? '').slice(0, 200);
    let selected = (collection?.domainIds ?? site.catalogue.domainIds).map(
      (id) => domains.get(id)!,
    );
    if (!collection)
      selected = selected.filter((d) =>
        url.searchParams.get('view') === 'history'
          ? d.ownership === 'historical'
          : d.ownership === 'current',
      );
    selected = selected.filter((d) =>
      `${d.domain} ${d.description}`.toLowerCase().includes(q.toLowerCase()),
    );
    const sort = url.searchParams.get('sort');
    if (sort === 'az')
      selected.sort((a, b) => a.domain.localeCompare(b.domain));
    if (sort === 'short')
      selected.sort(
        (a, b) =>
          a.domain.length - b.domain.length || a.domain.localeCompare(b.domain),
      );
    if (sort === 'price')
      selected.sort((a, b) =>
        a.askingPrice === null
          ? 1
          : b.askingPrice === null
            ? -1
            : a.currency.localeCompare(b.currency) ||
              a.askingPrice - b.askingPrice,
      );
    const pages = Math.max(1, Math.ceil(selected.length / 60));
    const page = Math.max(
      1,
      Math.min(
        pages,
        Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1,
      ),
    );
    const pageLink = (n: number) => {
      const params = new URLSearchParams(url.searchParams);
      params.set('page', String(n));
      return `?${e(params.toString())}`;
    };
    content = `<h1>${e(title)}</h1>${collection?.intro ? `<p class="intro">${e(collection.intro)}</p>` : ''}<form method="get"><input type="hidden" name="view" value="${url.searchParams.get('view') === 'history' ? 'history' : 'catalogue'}">${requested ? `<input type="hidden" name="collection" value="${e(requested)}">` : ''}<label>Search this selection<input type="search" name="q" value="${e(q)}"></label><label>Order<select name="sort"><option value="">Owner’s order</option>${[
      ['az', 'Name A–Z'],
      ['short', 'Shortest names'],
      ['price', 'Price by currency'],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}"${sort === v ? ' selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></label><button>Apply</button></form>${!collection && site.domainPresentations.some((d) => d.ownership === 'historical') ? `<nav><a href="${internal('?view=catalogue')}">Selected domains</a><a href="${internal('?view=history')}">Previously owned</a></nav>` : ''}<p>${selected.length} in this selection</p>${
      selected
        .slice((page - 1) * 60, page * 60)
        .map((d) => row(d.id))
        .join('') || '<p>No domains match this selection.</p>'
    }${pages > 1 ? `<nav aria-label="Pagination">${page > 1 ? `<a href="${pageLink(page - 1)}">Previous</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${pageLink(page + 1)}">Next</a>` : ''}</nav>` : ''}`;
  } else {
    content = `<section class="hero"><p class="eyebrow">${e(profile.headline)}</p><h1>${e(profile.name)}</h1>${profile.intro ? `<p class="intro">${e(profile.intro)}</p>` : ''}${profile.contactEmail ? `<p>${link('Contact owner', `mailto:${profile.contactEmail}`)}</p>` : ''}${profile.links.length ? `<nav aria-label="Owner links">${profile.links.map((v) => link(v.label, v.url)).join(' ')}</nav>` : ''}</section>${profile.interests.length || profile.opportunities.length ? `<section class="context">${profile.interests.length ? `<div><h2>Investment interests</h2><ul>${profile.interests.map((v) => `<li>${e(v)}</li>`).join('')}</ul></div>` : ''}${profile.opportunities.length ? `<div><h2>Conversations welcome</h2><ul>${profile.opportunities.map((v) => `<li>${e(v)}</li>`).join('')}</ul></div>` : ''}</section>` : ''}${
      site.collections.length
        ? `<section><h2>Collections</h2>${site.collections
            .slice(0, 6)
            .map(
              (c) =>
                `<section class="collection"><h3><a href="${collectionLink(c.slug)}">${e(c.title)} →</a></h3><p>${e(c.intro)}</p>${c.domainIds.slice(0, 6).map(row).join('')}<a href="${collectionLink(c.slug)}">View collection (${c.domainIds.length}) →</a></section>`,
            )
            .join('')}${
            site.collections.length > 6
              ? `<nav aria-label="More collections">${site.collections
                  .slice(6)
                  .map(
                    (c) =>
                      `<a href="${collectionLink(c.slug)}">${e(c.title)}</a>`,
                  )
                  .join('')}</nav>`
              : ''
          }</section>`
        : ''
    }${site.projects.length ? `<section><h2>Projects</h2>${site.projects.map((p) => `<article class="project"><h3>${link(p.title, p.url)}</h3><p>${e(p.description)}</p>${p.domainIds.map((id) => `<span class="tag">${e(domains.get(id)!.domain)}</span>`).join('')}</article>`).join('')}</section>` : ''}${site.catalogue.enabled ? `<p class="catalogue"><a href="${internal('?view=catalogue')}">Browse selected domains →</a></p>` : ''}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${preview || missing ? 'noindex, nofollow' : 'index, follow'}"><meta name="description" content="${e(collection?.intro ?? (profile.headline || profile.name))}"><link rel="canonical" href="${e(url.origin + url.pathname)}"><title>${e(title)} · domains.domains</title><style>
  :root{color-scheme:light;--ink:#21342a;--muted:#56665c;--line:#dce3db;--paper:#f7f9f5;--green:#31613b}*{box-sizing:border-box}@font-face{font-family:Archivo;src:url('${brandFontPath}') format('woff2');font-display:swap}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Archivo,Arial,sans-serif}a{color:var(--green);text-underline-offset:4px;overflow-wrap:anywhere}a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #7ac28d;outline-offset:3px}header,main,footer{max-width:1040px;margin:auto;padding:24px 32px}header,footer{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);flex-wrap:wrap}.brand{font-weight:700;color:var(--ink)}h1{font-size:clamp(34px,5vw,60px);letter-spacing:-.045em;line-height:1.12;margin:16px 0}h2{font-size:25px;margin:0 0 20px}h3{font-size:20px;margin:0}h1,h2,h3,p,li{overflow-wrap:anywhere}p{white-space:pre-line;color:var(--muted)}.hero{padding:32px 0 48px;max-width:740px}.eyebrow{color:var(--green);font-weight:600}.intro{font-size:20px;max-width:720px}.context{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:32px;border-top:1px solid var(--line);padding:32px 0}.context ul{padding-left:20px}main>section{margin-bottom:48px}.collection{padding:24px 0;border-top:1px solid var(--line)}.domain{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;padding:20px 0;border-bottom:1px solid var(--line)}.domain p{margin:4px 0}.availability{font-size:14px;align-self:center}.project{padding:24px 0;border-top:1px solid var(--line)}.tag{display:inline-block;margin:4px 12px 0 0;color:var(--muted)}nav,form{display:flex;gap:16px;flex-wrap:wrap;align-items:end}nav a,header a,footer a,.catalogue a,.availability a{display:inline-block;min-height:44px;padding:10px 0}label{display:grid;gap:6px;flex:1;min-width:0}input,select,button{font:inherit;min-height:44px;padding:10px;border:1px solid var(--line);border-radius:4px;background:white;color:var(--ink);max-width:100%}button{background:var(--green);color:white}footer{border-top:1px solid var(--line);border-bottom:0;margin-top:48px;font-size:13px}.preview{padding:12px;text-align:center;background:#e6efdf}.disabled{color:var(--muted)}@media(prefers-color-scheme:dark){:root{color-scheme:dark;--ink:#e0e9df;--muted:#b3c2b7;--line:#3c5043;--paper:#12271d;--green:#aad2a8}input,select{background:#20392b;color:var(--ink)}button{color:#12271d}}@media(max-width:640px){header,main,footer{padding:20px}.hero{padding:12px 0 24px}.domain{grid-template-columns:1fr;gap:8px}.intro{font-size:18px}form{display:grid;grid-template-columns:minmax(0,1fr)}.availability{text-align:left}}
  </style></head><body>${preview ? '<div class="preview">Draft preview. External links and contact actions are disabled.</div>' : ''}<header><a class="brand" href="${internal()}">${e(profile.name)}</a>${collection || catalogue || missing ? `<a href="${internal()}">Back to owner</a>` : ''}</header><main>${content}</main><footer><span>${preview ? 'Private preview' : `Published ${new Date(site.publishedAt).toISOString().slice(0, 10)}`}</span><span>Published with ${link('domains.domains', 'https://domains.domains')} · ${link('Source · AGPL', 'https://github.com/heathermhuang/dombot')}<br>domains.domains is a hosted, multi-tenant version of ${link('aoxborrow/dombot', 'https://github.com/aoxborrow/dombot', false)}.</span></footer></body></html>`;
}
