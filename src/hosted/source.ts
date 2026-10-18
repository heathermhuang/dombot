import { publicSourceLinks, upstreamSource } from './attribution';
import { page } from './views';

export function sourcePage(commit?: string): string {
  const source = publicSourceLinks(commit);
  return page(
    'Open-source DomBot and SaaS layer',
    `<article class="legal"><span class="eyebrow">Open source</span><h1>DomBot, hosted for you.</h1><p>The original <a href="${upstreamSource}">DomBot</a> project was created by Aaron Oxborrow. domains.domains adds managed, multi-tenant hosting and a SaaS layer.</p><h2>The SaaS layer is open source too</h2><p>Our public repository includes the hosted gateway, registration and recovery flows, tenant isolation, database migrations, deployment templates, build scripts and tests, alongside the maintained DomBot engine source.</p><p>The code is available under the <a href="${source.license}">GNU Affero General Public License v3.0 or later</a>. The original DomBot copyright and license notices are retained. Third-party components keep their own licenses; see <a href="${source.notices}">credits and notices</a>.</p><h2>${source.pinned ? 'Source for this deployment' : 'Public source'}</h2>${source.pinned ? `<p>Deployment revision: <code>${source.revision}</code>.</p>` : '<p>Browse the current public source, including its version history.</p>'}<ul><li><a href="${source.tree}">Complete source repository</a></li><li><a href="${source.hosted}">Hosted SaaS layer</a></li><li><a href="${source.setup}">Build and self-hosting instructions</a></li><li><a href="${source.archive}">Download the complete source archive</a></li><li><a href="${upstreamSource}">Original DomBot by Aaron Oxborrow</a></li></ul><p>These links are available without a domains.domains sign-in or a fee. The source includes the software and deployment templates; customer portfolios, credentials and production secrets are private.</p></article>`,
  );
}
