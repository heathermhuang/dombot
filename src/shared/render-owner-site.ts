import { publicPageStyles } from './public-page-style';
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
  const linkedIds = new Set(
    site.version === 3 ? site.salesLinks.map((l) => l.presentationId) : [],
  );
  const priceOf = (id: string) => {
    const d = domains.get(id)!;
    if (linkedIds.has(id)) {
      const p = sales.get(id)?.price;
      return p ? { amount: Number(p.amount), currency: p.currency } : null;
    }
    return d.askingPrice === null
      ? null
      : { amount: d.askingPrice, currency: d.currency };
  };
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
    const linked = linkedIds.has(id);
    const resolved = sales.get(id);
    return `<article class="domain"><div class="domain-identity"><h3>${e(d.domain)}</h3>${d.description ? `<p>${e(d.description)}</p>` : ''}</div><div class="availability">${linked ? (resolved ? `<span class="public-price">${e(salePriceLabel(resolved.price))}</span>${link('View domain page', resolved.url)}` : 'Inquiries currently unavailable') : d.ownership === 'historical' ? 'Previously owned' : d.availability === 'not-for-sale' ? 'Not accepting inquiries' : `${d.askingPrice === null ? '' : `<strong class="public-price">${e(d.currency)} ${d.askingPrice.toLocaleString('en-US')}</strong> `}${link('Inquire', `mailto:${site.profile.contactEmail}?subject=${encodeURIComponent(`Inquiry: ${d.domain}`)}`)}`}</div></article>`;
  };
  const profile = site.profile;
  let content: string;
  let title = profile.name;
  if (missing) {
    title = 'Selection not found';
    content =
      '<section class="empty-state"><h1>Selection not found</h1><p>This selection is not published.</p></section>';
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
      selected.sort((a, b) => {
        const p = priceOf(a.id),
          q = priceOf(b.id);
        return !p
          ? !q
            ? 0
            : 1
          : !q
            ? -1
            : p.currency.localeCompare(q.currency) || p.amount - q.amount;
      });
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
    content = `<section class="view-intro"><p class="eyebrow">${e(profile.name)}</p><h1>${e(title)}</h1>${collection?.intro ? `<p class="intro">${e(collection.intro)}</p>` : ''}</section><form class="filters" method="get"><input type="hidden" name="view" value="${url.searchParams.get('view') === 'history' ? 'history' : 'catalogue'}">${requested ? `<input type="hidden" name="collection" value="${e(requested)}">` : ''}<label>Search this selection<input type="search" name="q" value="${e(q)}"></label><label>Order<select name="sort"><option value="">Owner’s order</option>${[
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
      )}</select></label><button>Apply</button></form>${!collection && site.domainPresentations.some((d) => d.ownership === 'historical') ? `<nav class="selection-views"><a href="${internal('?view=catalogue')}">Selected domains</a><a href="${internal('?view=history')}">Previously owned</a></nav>` : ''}<p class="results">${selected.length} in this selection</p>${
      selected
        .slice((page - 1) * 60, page * 60)
        .map((d) => row(d.id))
        .join('') ||
      '<p class="empty-state">No domains match this selection.</p>'
    }${pages > 1 ? `<nav class="pagination" aria-label="Pagination">${page > 1 ? `<a href="${pageLink(page - 1)}">Previous</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${pageLink(page + 1)}">Next</a>` : ''}</nav>` : ''}`;
  } else {
    content = `<div class="profile-overview"><section class="hero"><p class="eyebrow">${e(profile.headline)}</p><h1>${e(profile.name)}</h1>${profile.intro ? `<p class="intro">${e(profile.intro)}</p>` : ''}${profile.contactEmail ? `<p>${link('Contact owner', `mailto:${profile.contactEmail}`)}</p>` : ''}${profile.links.length ? `<nav aria-label="Owner links">${profile.links.map((v) => link(v.label, v.url)).join(' ')}</nav>` : ''}</section>${profile.interests.length || profile.opportunities.length ? `<section class="context">${profile.interests.length ? `<div><h2>Investment interests</h2><ul>${profile.interests.map((v) => `<li>${e(v)}</li>`).join('')}</ul></div>` : ''}${profile.opportunities.length ? `<div><h2>Conversations welcome</h2><ul>${profile.opportunities.map((v) => `<li>${e(v)}</li>`).join('')}</ul></div>` : ''}</section>` : ''}</div>${
      site.collections.length
        ? `<section><h2 class="section-title">Collections</h2>${site.collections
            .slice(0, 6)
            .map(
              (c) =>
                `<section class="collection"><h3><a href="${collectionLink(c.slug)}">${e(c.title)} →</a></h3><p>${e(c.intro)}</p>${c.domainIds.slice(0, 6).map(row).join('')}<a class="collection-more" href="${collectionLink(c.slug)}">View collection (${c.domainIds.length}) →</a></section>`,
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
    }${site.projects.length ? `<section><h2 class="section-title">Projects</h2>${site.projects.map((p) => `<article class="project"><h3>${link(p.title, p.url)}</h3><p>${e(p.description)}</p>${p.domainIds.map((id) => `<span class="tag">${e(domains.get(id)!.domain)}</span>`).join('')}</article>`).join('')}</section>` : ''}${site.catalogue.enabled ? `<p class="catalogue"><a href="${internal('?view=catalogue')}">Browse selected domains →</a></p>` : ''}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${preview || missing ? 'noindex, nofollow' : 'index, follow'}"><meta name="description" content="${e(collection?.intro ?? (profile.headline || profile.name))}"><link rel="canonical" href="${e(url.origin + url.pathname)}"><title>${e(title)} · domains.domains</title><style>${publicPageStyles}
.profile-overview{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;padding:48px 0 36px;margin-bottom:16px}.profile-overview:has(.context){grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:56px;align-items:start}.hero{padding:0;max-width:780px}.hero h1{font-size:clamp(36px,5.3vw,62px);margin:0 0 24px}.hero .intro{font-size:clamp(17px,2vw,20px);line-height:1.65;max-width:59ch;white-space:pre-line;margin:0 0 24px}.hero .eyebrow:empty{display:none}.hero nav{display:flex;gap:10px 24px;flex-wrap:wrap}.hero nav a{font-size:14px;min-height:44px;display:inline-flex;align-items:center}.context{display:grid;gap:24px;padding:4px 0 4px 28px;border-left:1px solid var(--line);margin:0}.context h2{font-size:16px;margin:0 0 12px}.context ul{padding-left:20px;margin:0;color:var(--muted)}main>section{margin-bottom:40px}.section-title{font-size:26px;margin:0 0 24px}.collection{padding:28px 32px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:20px}.collection>h3{font-size:24px;margin:0 0 8px}.collection>h3 a{text-decoration:none}.collection>p{color:var(--muted);font-size:15px;margin:0 0 24px;white-space:pre-line}.collection>.collection-more{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:600;margin-top:12px}.domain{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px 32px;align-items:center;padding:24px 0;border-top:1px solid var(--line)}.domain h3{font-size:clamp(20px,2.3vw,25px);margin:0;letter-spacing:-.03em}.domain p{color:var(--muted);font-size:14px;max-width:58ch;margin:8px 0 0;white-space:pre-line}.availability{display:flex;align-items:flex-end;flex-direction:column;gap:10px;max-width:300px;text-align:right;font-size:13px;color:var(--muted)}.availability .public-price{font-size:18px;font-weight:600;line-height:1.3;color:var(--ink)}.availability a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border:1px solid var(--line);border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;background:var(--subtle);color:var(--ink)}.availability a:hover{border-color:var(--accent)}.availability .disabled{max-width:24ch}.view-intro{padding:48px 0 28px}.view-intro h1{font-size:clamp(34px,4.7vw,52px);margin:0 0 16px}.view-intro .intro{font-size:18px;color:var(--muted);white-space:pre-line;margin:0}.filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,220px) auto;gap:16px;align-items:end;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px 24px;margin-bottom:20px}.filters label{display:grid;gap:7px;min-width:0;color:var(--muted);font-size:12px;font-weight:500}.filters input,.filters select{width:100%;color:var(--ink);min-height:46px}.results{font-size:13px;color:var(--muted);margin:24px 0 4px}.selection-views,.pagination{display:flex;align-items:center;flex-wrap:wrap;gap:20px;font-size:14px}.selection-views{margin-top:24px}.selection-views a{min-height:44px;display:inline-flex;align-items:center}.pagination{border-top:1px solid var(--line);padding:24px 0;justify-content:space-between}.project{padding:28px 0;border-top:1px solid var(--line)}.project h3{font-size:22px;margin:0 0 12px}.project p{color:var(--muted);margin:0 0 12px;white-space:pre-line}.tag{display:inline-block;font-size:12px;padding:4px 8px;background:var(--subtle);border-radius:4px;margin:4px 8px 0 0}.catalogue{padding:12px 0}.catalogue a{display:inline-flex;align-items:center;min-height:46px;font-weight:600}.empty-state h1{font-size:36px}.header-owner{color:var(--muted);font-size:13px;text-decoration:none;max-width:45%;text-align:right}.header-owner:hover{text-decoration:underline}
@media(max-width:760px){.profile-overview,.profile-overview:has(.context){grid-template-columns:minmax(0,1fr);gap:24px;padding:36px 0 20px}.context{border-left:0;border-block:1px solid var(--line);padding:24px 0;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}}
@media(max-width:640px){.hero{padding:0}.hero h1{margin-bottom:20px}.collection{padding:22px 20px}.collection>h3{font-size:22px}.domain{grid-template-columns:minmax(0,1fr);gap:14px;padding:22px 0}.availability{align-items:flex-start;text-align:left;flex-direction:row;flex-wrap:wrap;align-items:center;gap:12px 16px;max-width:none}.availability .public-price{font-size:17px}.filters{grid-template-columns:minmax(0,1fr) auto;padding:18px;gap:14px}.filters label:first-child{grid-column:1/-1}.filters button{padding-inline:18px}.view-intro{padding:36px 0 24px}.context{gap:24px;padding-block:24px;margin-bottom:32px}.public-footer .attribution{max-width:100%}}
</style></head><body>${preview ? '<div class="preview">Draft preview. External links and contact actions are disabled.</div>' : ''}<a class="skip-link" href="#main-content">Skip to content</a><header class="public-header">${preview ? '<span class="wordmark">domains.domains</span>' : '<a class="wordmark" href="https://domains.domains" rel="noreferrer">domains.domains</a>'}${collection || catalogue || missing ? `<a class="header-owner" href="${internal()}">Back to ${e(profile.name)}</a>` : `<span class="header-context">Selected portfolio</span>`}</header><main id="main-content" tabindex="-1">${content}</main><footer class="public-footer"><span>${preview ? 'Private preview' : `Published ${new Date(site.publishedAt).toISOString().slice(0, 10)}`}</span><span class="attribution">Published with ${link('domains.domains', 'https://domains.domains')} · ${link('Source · AGPL', 'https://github.com/heathermhuang/dombot')}<br>domains.domains is a hosted, multi-tenant version of ${link('aoxborrow/dombot', 'https://github.com/aoxborrow/dombot', false)}.</span></footer></body></html>`;
}
