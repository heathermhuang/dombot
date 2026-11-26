import {
  salesEscape as escape,
  salesHeaders,
  salesPage,
} from '../shared/render-sales-lander';
import { brandFontBytes, brandFontPath } from '../shared/brand-font';
import { boundedText, scanDomain, scanReadiness } from './scan';

type Result = Awaited<ReturnType<typeof scanReadiness>>;
type ScanEnv = {
  SCAN_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> };
};
const maxDomains = 5;
const headers = {
  ...salesHeaders,
  'Cache-Control': 'no-store, no-transform',
  'Referrer-Policy': 'same-origin',
};
const scannerCss = `
.scan{max-width:820px;margin:clamp(30px,8vw,88px) auto}.scan h1{font-size:clamp(32px,7vw,60px);line-height:1.05;letter-spacing:-.045em;margin:14px 0}.scan textarea{margin:10px 0 14px}.scan form{margin:28px 0}.scan .scan-result{margin-block:18px}.scan summary{display:flex;justify-content:space-between;gap:16px;font-size:17px;color:var(--ink);overflow-wrap:anywhere}.scan summary strong{white-space:nowrap;color:var(--accent)}.scan ul{list-style:none;padding:0;margin:8px 0}.scan li{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:13px 0;border-top:1px solid var(--line)}.scan li span:last-child{grid-column:1/-1;color:var(--muted);font-size:14px}.scan .cta{margin-top:12px}
`;

function page(domains = '', results: Result[] = [], error = '', status = 200) {
  const total = Math.round(
    results.reduce((sum, item) => sum + item.score, 0) / results.length,
  );
  const output = results
    .map(
      (item) => `
    <details class="panel scan-result" ${results.length === 1 ? 'open' : ''}>
      <summary>${escape(item.domain)} <strong>${item.score}/100</strong></summary>
      <ul>${item.checks.map((check) => `<li><strong>${escape(check.label)}</strong><span>${check.status === 'pass' ? 'Passed' : check.status === 'unverified' ? 'Unverified' : 'Missing'}</span><span>${escape(check.detail)}</span></li>`).join('')}</ul>
    </details>`,
    )
    .join('');
  const html = salesPage(
    'Domain agent-readiness scanner',
    `
    <section class="scan">
      <p class="eyebrow">Free portfolio scanner</p>
      <h1>Can agents find and price your domains?</h1>
      <p>Check your landing pages, prices, inquiry routes and DNS discovery.</p>
      <form method="post" action="/">
        <label for="domains">Domain names</label>
        <textarea id="domains" name="domains" required maxlength="1300" aria-describedby="scan-hint">${escape(domains)}</textarea>
        <p id="scan-hint" class="note">Enter up to ${maxDomains} domains, one per line or separated by commas.</p>
        <button type="submit">Scan domains</button>
      </form>
      ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
      ${
        results.length
          ? `<h2>Portfolio score ${total}/100</h2>${output}
        <a class="cta" href="https://domains.domains/">Fix this in Domains.Domains</a>`
          : ''
      }
    </section>`,
    false,
  )
    .replace(
      '</head>',
      '<meta name="description" content="Check your domain portfolio for agent-ready listings, prices, DNS discovery and purchase routes."><style>' +
        scannerCss +
        '</style></head>',
    )
    .replace(
      '<span class="header-context">Domain inquiries</span>',
      '<span class="header-context">Portfolio scanner</span>',
    )
    .replace(
      '<p>Payment and transfer happen with your selected provider.</p>',
      '',
    );
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
  if (!domains && !results.length && !error)
    responseHeaders.delete('X-Robots-Tag');
  return new Response(html, { status, headers: responseHeaders });
}

export default {
  async fetch(request: Request, env: ScanEnv) {
    const url = new URL(request.url);
    if (url.pathname === brandFontPath && request.method === 'GET')
      return new Response(brandFontBytes, {
        headers: {
          'Content-Type': 'font/woff2',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    if (url.pathname !== '/' && url.pathname !== '/api/scan')
      return new Response('Not found', { status: 404, headers });
    const json = url.pathname === '/api/scan';
    if (!json && request.method === 'GET') return page();
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers });
    const error = (message: string, status: number, values = '') =>
      json
        ? Response.json({ error: message }, { status, headers })
        : page(values, [], message, status);
    if (!json && request.headers.get('origin') !== url.origin)
      return error('Open the scanner and submit the form again.', 403);
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    if (!(await env.SCAN_LIMIT.limit({ key: ip })).success)
      return error('Scan limit reached. Try again in a minute.', 429);
    let values = '';
    let domains: string[];
    try {
      const raw = await boundedText(new Response(request.body), 4096);
      const list: unknown = json
        ? JSON.parse(raw)?.domains
        : new URLSearchParams(raw).get('domains');
      if (json) {
        if (
          !Array.isArray(list) ||
          list.length > maxDomains ||
          list.some((item) => typeof item !== 'string')
        )
          return error('Provide an array of up to five domain names.', 400);
        values = list.join('\n');
      } else {
        if (typeof list !== 'string')
          return error('Enter at least one domain.', 400);
        values = list;
      }
      if (values.length > 1300)
        return error('The domain list is too long.', 400);
      domains = [
        ...new Set(
          values
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(scanDomain),
        ),
      ];
      if (!domains.length || domains.length > maxDomains)
        return error('Enter between one and five domains.', 400, values);
    } catch {
      return error(
        'Enter valid public domain names.',
        400,
        values.slice(0, 1300),
      );
    }
    const results = await Promise.all(
      domains.map((domain) => scanReadiness(domain)),
    );
    return json
      ? Response.json(
          { results, fixUrl: 'https://domains.domains/' },
          { headers },
        )
      : page(values, results);
  },
};
