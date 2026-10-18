export const upstreamSource = 'https://github.com/aoxborrow/dombot';
export const saasSource = 'https://github.com/heathermhuang/dombot';

export const softwareCredit = `<p class="software-credit">Original <a href="${upstreamSource}">DomBot</a> by <a href="https://github.com/aoxborrow">Aaron Oxborrow</a>. Hosting and multi-tenant SaaS layer by domains.domains.</p>`;

export function publicSourceLinks(commit?: string) {
  const pinned = /^[a-f0-9]{40}$/.test(commit ?? '');
  const revision = pinned ? commit! : 'main';
  const tree = `${saasSource}/tree/${revision}`;
  return {
    pinned,
    revision,
    tree,
    hosted: `${tree}/src/hosted`,
    setup: `${saasSource}/blob/${revision}/docs/hosted-source.md`,
    license: `${saasSource}/blob/${revision}/LICENSE`,
    notices: `${saasSource}/blob/${revision}/NOTICE.md`,
    archive: `${saasSource}/archive/${revision}.tar.gz`,
  };
}
