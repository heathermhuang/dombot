import { changelogEntries } from './changelog-entries';
import type { ChangelogSnapshot } from './changelog-feed';
import { escapeHtml as e, page } from './views';

const historyDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatHistoryDate = (date: string) =>
  historyDate.format(new Date(`${date}T00:00:00Z`));

const layers = [
  { id: 'all', label: 'All updates' },
  { id: 'core', label: 'Core app' },
  { id: 'saas', label: 'SaaS layer' },
] as const;

export function changelogPage(
  layer?: string,
  snapshot?: ChangelogSnapshot,
): string {
  const selected = layer === 'core' || layer === 'saas' ? layer : 'all';
  const entries = (snapshot?.entries ?? changelogEntries).filter(
    (entry) => selected === 'all' || entry.layer === selected,
  );
  const oldest = entries.at(-1);
  return page(
    'Changelog',
    `<style>
.changelog{max-width:900px;margin:36px auto 64px}.changelog h1{font-size:clamp(38px,6vw,60px);margin:16px 0 20px}.changelog-intro{max-width:680px}.changelog-intro p{max-width:none}.changelog .lead{font-size:20px}.changelog-filters{display:flex;flex-wrap:wrap;gap:8px;margin:32px 0 12px}.changelog-filters a{display:inline-flex;align-items:center;min-height:44px;padding:8px 18px;border:1px solid var(--line);border-radius:24px;font-size:14px;font-weight:600}.changelog-filters a[aria-current="page"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}.changelog-count{font-size:13px;margin:12px 0 32px}.changelog-entry{display:grid;grid-template-columns:150px minmax(0,1fr);gap:32px;border-top:1px solid var(--line);padding:32px 0}.changelog-meta{display:flex;flex-direction:column;align-items:flex-start;gap:10px;font-size:13px;color:var(--muted)}.changelog-layer{border:1px solid var(--line);border-radius:5px;padding:2px 8px;color:var(--ink);font-weight:600}.changelog-entry h2{font-size:24px;line-height:1.3;margin:0 0 10px;scroll-margin-top:24px}.changelog-entry h2 a{color:var(--ink)}.changelog-status{font-size:13px;margin:0 0 16px}.changelog-entry ul{padding-left:20px;margin:0;max-width:65ch}.changelog-entry li{margin:8px 0;color:var(--muted)}.changelog-links{display:flex;flex-wrap:wrap;gap:4px 20px;margin-top:16px}.changelog-links a{display:inline-flex;align-items:center;min-height:44px;font-size:13px;text-decoration:underline;text-underline-offset:3px}.changelog-archive{border-top:1px solid var(--line);padding-top:24px;font-size:14px}
@media(max-width:600px){.changelog{margin-top:20px}.changelog-entry{grid-template-columns:1fr;gap:16px;padding:28px 0}.changelog-meta{flex-direction:row;align-items:center;flex-wrap:wrap;gap:12px}.changelog-filters a{padding:8px 14px}.changelog-entry h2{font-size:22px}}
</style><section class="changelog" aria-labelledby="changelog-title"><div class="changelog-intro"><span class="eyebrow">Product updates</span><h1 id="changelog-title">Changelog</h1><p class="lead">The complete story of the core app and our hosted service.</p><p><strong>Core app</strong> covers upstream DomBot updates. <strong>SaaS layer</strong> covers domains.domains improvements. Published releases, source history and verified deployments are labelled separately.</p>${
      snapshot
        ? `<p class="note" role="status">${
            snapshot.stale
              ? 'Update feeds are temporarily unavailable. Showing saved updates; newer changes may be missing.'
              : 'Feeds checked ' +
                e(
                  new Date(snapshot.checkedAt!)
                    .toISOString()
                    .replace('T', ' ')
                    .replace(/\.\d+Z$/, ' UTC'),
                ) +
                '. Refreshes every five minutes.'
          }</p>`
        : ''
    }</div><nav class="changelog-filters" aria-label="Filter updates">${layers.map(({ id, label }) => `<a href="/changelog${id === 'all' ? '' : `?layer=${id}`}"${selected === id ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav><p class="changelog-count">${entries.length} ${selected === 'all' ? 'updates' : selected === 'core' ? 'core app updates' : 'SaaS layer updates'} · Dates shown in UTC${oldest ? ` · From ${e(formatHistoryDate(oldest.date))} · <a href="/changelog${selected === 'all' ? '' : `?layer=${selected}`}#${e(oldest.id)}">Jump to the beginning</a>` : ''}</p>${entries
      .map((entry) => {
        const date = formatHistoryDate(entry.date);
        return `<article class="changelog-entry" aria-labelledby="${e(entry.id)}"><div class="changelog-meta"><time datetime="${e(entry.date)}">${e(date)}</time><span class="changelog-layer">${entry.layer === 'core' ? 'Core app' : 'SaaS layer'}</span></div><div><h2 id="${e(entry.id)}"><a href="/changelog#${e(entry.id)}">${e(entry.title)}</a></h2><p class="changelog-status">${e(entry.status)}</p><ul>${entry.changes.map((change) => `<li>${e(change)}</li>`).join('')}</ul><div class="changelog-links">${entry.links.map((link) => `<a href="${e(link.url)}">${e(link.label)}</a>`).join('')}</div></div></article>`;
      })
      .join(
        '',
      )}<p class="changelog-archive">Full published-release and recorded source history, newest first. Browse the <a href="https://github.com/aoxborrow/dombot/releases">upstream release history</a> and <a href="https://github.com/heathermhuang/dombot/commits/main/">SaaS source history</a> for individual discussions and implementation details.</p></section>`,
  );
}
