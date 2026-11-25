import {
  lookup,
  mcpDiscoveryUrl,
  scoreReadiness,
} from '../agent-readiness/scan';
import { salesEscape as e, salesPage } from '../shared/render-sales-lander';
import { salePriceLabel } from '../shared/hosted-sales';
import {
  ownerAgentRows,
  ownerReceiptActivity,
  readAgentListing,
  type LiveAgentListing,
} from './agent-catalog';

export function addAgentMetadata(
  response: Response,
  live: LiveAgentListing,
  buyerHandoff = false,
) {
  const { listing } = live;
  if (response.headers.get('X-Domains-Sales-Revision') !== listing.revision)
    return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-transform');
  headers.append(
    'Link',
    '<' + listing.urls.detail + '>; rel="alternate"; type="application/json"',
  );
  headers.append(
    'Link',
    '<' + listing.urls.discovery + '>; rel="llms-txt"; type="text/plain"',
  );
  if (!response.body)
    return new Response(null, { status: response.status, headers });
  const offers = listing.askingPrice && {
    '@type': 'Offer',
    price: listing.askingPrice.amount,
    priceCurrency: listing.askingPrice.currency,
    priceValidUntil: listing.priceValidUntil?.slice(0, 10),
    availability: 'https://schema.org/InStock',
    url: listing.urls.listing,
  };
  const data = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    additionalType: 'DomainName',
    forSale: true,
    name: listing.domain,
    description: listing.description,
    url: listing.urls.listing,
    ...(offers ? { offers } : {}),
  }).replace(/</g, '\\u003c');
  headers.delete('Content-Length');
  const rewriter = new HTMLRewriter().on('head', {
    element(head) {
      head.append(
        `<link rel="alternate" type="application/json" href="${e(listing.urls.detail)}">
<link rel="llms-txt" type="text/plain" href="${e(listing.urls.discovery)}">
<script type="application/ld+json">${data}</script>`,
        { html: true },
      );
    },
  });
  if (buyerHandoff)
    rewriter.on('form[action$="/inquiries"]', {
      element(form) {
        form.setAttribute(
          'action',
          '/' + listing.domain + '/inquiries?from=agent',
        );
      },
    });
  return rewriter.transform(
    new Response(response.body, { status: response.status, headers }),
  );
}

const labels = {
  query: 'Search appearance',
  price: 'Price check',
  offer: 'Offer submitted',
  broker: 'Buyer brief submitted',
  provider: 'Provider handoff opened',
};
const date = (at: number) =>
  new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

type Counts = Awaited<ReturnType<typeof ownerAgentRows>>['counts'];
function countsFor(counts: Counts, listing: string) {
  const stages = new Map(
    counts
      .filter((row) => row.listing_id === listing)
      .map((row) => [row.event, row.total]),
  );
  return {
    query: stages.get('query') ?? 0,
    price: stages.get('price') ?? 0,
    offer: stages.get('offer') ?? 0,
    broker: stages.get('broker') ?? 0,
    provider: stages.get('provider') ?? 0,
  };
}

async function ownerListing(
  env: HostedEnv,
  owner: string,
  domain: string,
  listingId: string,
  dnsDomain: string,
) {
  const live = await readAgentListing(env, domain, { owner });
  if (!live || live.route.listing_id !== listingId) return null;
  const { listing } = live;
  const evidence: Parameters<typeof scoreReadiness>[0] = {
    lander: 'The approved listing has a public lander.',
    llms: 'The approved listing has a public discovery file.',
  };
  if (listing.askingPrice) {
    evidence.structuredPrice =
      'The approved listing has a confirmed structured price.';
    evidence.anonymousPrice = 'The catalog exposes the confirmed price.';
  }
  if (listing.route)
    evidence.completion = 'The seller has a public completion route.';
  let dnsStatus = 'Check DNS to include the discovery points.';
  const unknown: ('mcp' | 'dns')[] = ['mcp', 'dns'];
  if (dnsDomain === domain) {
    try {
      const txt = await lookup('_mcp.' + domain, 'TXT');
      const matching = txt.some(
        (row) => mcpDiscoveryUrl(row.data) === listing.urls.mcp,
      );
      unknown.length = 0;
      if (matching) {
        evidence.mcp = 'DNS points to this listing’s public MCP catalog.';
        evidence.dns = 'The public _mcp record is parseable.';
        dnsStatus = 'Public DNS points to this catalog.';
      } else {
        if (txt.some((row) => mcpDiscoveryUrl(row.data)))
          evidence.dns = 'DNS publishes a parseable MCP record.';
        dnsStatus = 'The catalog record was not found in public DNS.';
      }
    } catch {
      dnsStatus = 'Public DNS could not be verified. Try again shortly.';
    }
  }
  return {
    listing,
    ...scoreReadiness(evidence, unknown),
    dnsStatus,
    linkedSales: live.probe.sales,
  };
}

export async function agentOwnerPage(
  env: HostedEnv,
  owner: string,
  cursor: string,
  dnsDomain: string,
) {
  const [{ rows, recent, counts }, activity] = await Promise.all([
    ownerAgentRows(env, owner, cursor),
    ownerReceiptActivity(env, owner).catch(() => null),
  ]);
  const visible = rows.slice(0, 10);
  const results: PromiseSettledResult<
    Awaited<ReturnType<typeof ownerListing>>
  >[] = [];
  for (let i = 0; i < visible.length; i += 5)
    results.push(
      ...(await Promise.allSettled(
        visible
          .slice(i, i + 5)
          .map((row) =>
            ownerListing(env, owner, row.domain, row.listing_id, dnsDomain),
          ),
      )),
    );
  const detail = results.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : [],
  );
  const interest = new Map<string, { query: number; price: number }>();
  for (const row of counts) {
    if (row.event !== 'query' && row.event !== 'price') continue;
    const total = interest.get(row.domain) ?? { query: 0, price: 0 };
    total[row.event] += row.total;
    interest.set(row.domain, total);
  }
  const leaders = [...interest.entries()]
    .sort(([, a], [, b]) => b.price - a.price || b.query - a.query)
    .slice(0, 5);
  const stats = ['query', 'price', 'offer', 'broker', 'provider'].map((stage) =>
    counts
      .filter((row) => row.event === stage)
      .reduce((total, row) => total + row.total, 0),
  );
  const stages = [
    'Search appearances',
    'Price checks',
    'Offers submitted',
    'Buyer briefs',
    'Provider handoffs',
    'Linked sale evidence',
  ];
  const linked = activity
    ? activity.linked + (activity.partial ? '+' : '')
    : '—';
  const pagination =
    rows.length > visible.length
      ? `<p><a href="?cursor=${encodeURIComponent(visible.at(-1)!.domain)}">More published names →</a></p>`
      : '';
  const cards = detail
    .map((row) => {
      const { listing } = row;
      const current = rows.find((item) => item.domain === listing.domain)!;
      const count = countsFor(counts, current.listing_id);
      const record = listing.dnsRecord.value;
      const submissions = activity?.verified.filter(
        (row) => row.listing_id === current.listing_id,
      );
      const offers = submissions
        ? submissions.filter((row) => row.event === 'offer').length
        : '—';
      const briefs = submissions
        ? submissions.filter((row) => row.event === 'broker').length
        : '—';
      const receiptSuffix = activity?.partial ? '+' : '';
      return `<article class="panel report-card">
      <header><h3><a href="${e(listing.urls.listing)}">${e(listing.domain)}</a></h3><strong>${row.score}/100</strong></header>
      <p>${e(listing.priceStatus === 'needs-reconfirmation' ? 'Price needs review' : salePriceLabel(listing.askingPrice))}
        · Last reviewed ${e(date(Date.parse(listing.lastVerified)))}</p>
      <p>${count.query} search appearances · ${count.price} price checks · ${offers}${receiptSuffix} email-verified offers · ${briefs}${receiptSuffix} email-verified buyer briefs</p>
      <p>${row.linkedSales} sale evidence links across all channels</p>
      <details${dnsDomain === listing.domain ? ' open' : ''}><summary>Agent readiness and DNS</summary>
        <ul>${row.checks.map((check) => `<li><b>${e(check.label)}</b> · ${e(check.status)}. ${e(check.detail)}</li>`).join('')}</ul>
        <p>${e(row.dnsStatus)}</p>
        <p>Add a TXT record at your DNS provider. Use <code>_mcp</code> as the record name and paste this value.</p>
        <input type="text" aria-label="TXT record value for ${e(listing.domain)}" readonly value="${e(record)}">
        <p><a href="?cursor=${encodeURIComponent(cursor)}&amp;dns=${encodeURIComponent(listing.domain)}">Check DNS</a> ·
        <a href="${e(listing.urls.detail)}">View listing JSON</a> · <a href="${e(listing.urls.discovery)}">Discovery file</a></p>
      </details>
    </article>`;
    })
    .join('');
  const recentHtml = recent
    .map(
      (row) =>
        `<li><strong>${e(row.domain)}</strong> · ${e(labels[row.event])}<br><span>${e(row.source)} · ${e(date(row.at))}</span>${row.query ? `<br><span>Search “${e(row.query)}”</span>` : ''}</li>`,
    )
    .join('');
  const html = salesPage(
    'Agent listings',
    `
  <section class="agent-report">
    <nav aria-label="Portfolio"><a href="/app">Your portfolio</a> · <a href="/account">Account</a></nav>
    <h1>Agent listings</h1>
    <p>Agents can discover seller-approved published listings. Review changed prices in Sales and publish them again to update the catalog.</p>
    <p><a href="/w/${e(owner)}/#/sales/listings">Manage published listings</a> · <a href="/api/agent">Catalog API</a> · <a href="https://scan.domains.domains/">Scan a portfolio</a></p>
    <h2>Agent activity <small>Last 30 days</small></h2>
    <div class="stage-counts">${stages.map((stage, index) => `<div><strong>${index === stats.length ? linked : stats[index]}</strong><span>${e(stage)}</span></div>`).join('')}</div>
    <p class="note">Counts are listing events. Caller-reported client names describe the source. Linked sale evidence in the activity summary is matched to these offers or briefs.</p>
    <div class="interest"><section><h2>Most interest</h2>
      ${leaders.length ? `<ol>${leaders.map(([domain, total]) => `<li><strong>${e(domain)}</strong><br><span>${total.price} price checks · ${total.query} search appearances</span></li>`).join('')}</ol>` : '<p>No agent activity yet.</p>'}
    </section><section><h2>Recent activity</h2>${recentHtml ? '<ul>' + recentHtml + '</ul>' : '<p>No recent activity.</p>'}</section></div>
    <h2>Published names</h2>
    ${results.some((result) => result.status === 'rejected') ? '<p role="status">Some listing details are temporarily unavailable.</p>' : ''}
    ${cards || '<p>No eligible published listings on this page.</p>'}
    ${pagination}${cursor ? '<p><a href="/account/agent-listings">Back to the first page</a></p>' : ''}
  </section>`,
    false,
  );
  return html
    .replace(
      '<span class="header-context">Domain inquiries</span>',
      '<span class="header-context">Agent listings</span>',
    )
    .replace(
      '<p>Payment and transfer happen with your selected provider.</p>',
      '',
    )
    .replace(
      '</head>',
      `<style>
    .agent-report{margin:44px 0}.agent-report h1{font-size:clamp(34px,6vw,58px);margin:22px 0}.agent-report h2 small{font-size:13px;font-weight:400;margin-left:8px;color:var(--muted)}.agent-report nav{font-size:14px}.stage-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:12px}.stage-counts>div,.interest>section{border:1px solid var(--line);border-radius:var(--radius);padding:16px;background:var(--surface)}.stage-counts strong,.stage-counts span{display:block}.stage-counts strong{font-size:25px}.stage-counts span,.interest span{color:var(--muted);font-size:13px}.interest{display:grid;grid-template-columns:1fr 2fr;gap:18px;margin:28px 0}.interest ul,.interest ol{margin:0;padding-left:22px;max-height:310px;overflow:auto}.interest li{padding:5px 0;overflow-wrap:anywhere}.interest h2{margin-top:0}.report-card{margin:12px 0}.report-card header{display:flex;justify-content:space-between;gap:12px}.report-card h3{margin:0;overflow-wrap:anywhere;min-width:0}.report-card header strong{white-space:nowrap}.report-card input{font-family:ui-monospace,monospace}.report-card p{margin:9px 0}.report-card details li{margin:8px 0}@media(max-width:650px){.interest{grid-template-columns:1fr}.agent-report{margin-top:28px}}
    </style></head>`,
    );
}
