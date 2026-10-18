import {
  convertOwnerSite,
  isOwnerSite,
  selectedSite,
  type AnyPublished,
  type OwnerSiteDraft,
} from './owner-site';
type Disclosure = { label: string; value: string };
/** Every approved field has a readable place in the publication review. Stable
 * section keys distinguish edits from reordering and allow duplicate titles. */
export function siteDisclosures(
  draft: OwnerSiteDraft,
): Map<string, Disclosure> {
  const site = selectedSite({
    version: draft.version,
    handle: draft.handle,
    profile: draft.profile,
    domainPresentations: draft.domainPresentations,
    collections: draft.collections,
    projects: draft.projects,
    homepage: draft.homepage,
    catalogue: draft.catalogue,
  });
  const p = site.profile;
  const rows = new Map<string, Disclosure>();
  const add = (key: string, label: string, value: string) =>
    rows.set(key, { label, value });
  for (const [label, value] of [
    ['Site address', site.handle],
    ['Name', p.name],
    ['Headline', p.headline],
    ['Introduction', p.intro],
    ['Investment interests', p.interests.join('\n')],
    ['Conversations welcome', p.opportunities.join('\n')],
    ['Public contact email', p.contactEmail],
    ['Profile links', p.links.map((v) => `${v.label}: ${v.url}`).join('\n')],
    ['Catalogue', site.catalogue.enabled ? 'Enabled' : 'Off'],
    [
      'Collection order',
      site.collections.map((c) => `${c.title} (/c/${c.slug})`).join('\n'),
    ],
    [
      'Project order',
      site.projects.map((p) => `${p.title} (${p.url})`).join('\n'),
    ],
  ])
    add(label, label, value);
  const names = new Map(site.domainPresentations.map((d) => [d.id, d.domain]));
  for (const c of site.collections)
    add(
      `collection:${c.id}`,
      `Collection: ${c.title}`,
      `${c.title}\nLink: /p/${site.handle}/c/${c.slug}\n${c.intro}\n${c.domainIds.map((id) => names.get(id)).join('\n')}`,
    );
  for (const p of site.projects)
    add(
      `project:${p.id}`,
      `Project: ${p.title}`,
      `${p.title}\n${p.description}\n${p.url}\n${p.domainIds.map((id) => names.get(id)).join('\n')}`,
    );
  if (site.catalogue.enabled)
    add(
      'Catalogue selection',
      'Catalogue selection',
      site.catalogue.domainIds.map((id) => names.get(id)).join('\n'),
    );
  for (const d of site.domainPresentations)
    add(
      `Domain: ${d.domain}`,
      `Domain: ${d.domain}`,
      `${d.ownership === 'historical' ? 'Previously owned' : d.availability === 'inquiries' ? 'Open to inquiries' : 'Not for sale'}\n${d.description}${d.askingPrice !== null ? `\n${d.currency} ${d.askingPrice}` : ''}`,
    );
  return rows;
}
export function siteChanges(
  draft: OwnerSiteDraft,
  published: AnyPublished | null,
) {
  const before = published
    ? siteDisclosures(
        isOwnerSite(published)
          ? published
          : convertOwnerSite({
              handle: published.handle,
              title: published.title,
              intro: published.intro,
              contactEmail: published.contactEmail,
              listings: published.listings,
            }),
      )
    : new Map<string, Disclosure>();
  if (published)
    before.set('Site presentation', {
      label: 'Site presentation',
      value: isOwnerSite(published)
        ? 'Owner profile with curated collections and projects'
        : 'Legacy domain list',
    });
  const after = siteDisclosures(draft);
  after.set('Site presentation', {
    label: 'Site presentation',
    value: 'Owner profile with curated collections and projects',
  });
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(
      (key) => (before.get(key)?.value ?? '') !== (after.get(key)?.value ?? ''),
    )
    .map((key) => ({
      key,
      label: after.get(key)?.label ?? before.get(key)!.label,
      before: before.get(key)?.value ?? '',
      after: after.get(key)?.value ?? '',
    }));
}
