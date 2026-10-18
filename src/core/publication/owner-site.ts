import type { Domain, RegistrarMeta } from '../../shared/ipc';
import { privateListing } from '../../shared/publication';
import {
  selectedSite,
  type OwnerSiteDraft,
  type PublishedOwnerSite,
} from '../../shared/owner-site';
import { reconcilePortfolio } from './reconcile';

export function reconcileOwnerSite(
  draft: OwnerSiteDraft,
  domains: Domain[],
  accounts: RegistrarMeta[],
  now = Date.now(),
) {
  return reconcilePortfolio(
    {
      handle: draft.handle,
      title: draft.profile.name,
      intro: '',
      contactEmail: '',
      listings: draft.domainPresentations.map((d) => privateListing(d.domain)),
    },
    domains,
    accounts,
    now,
  );
}
export function ownerSiteSnapshot(
  draft: OwnerSiteDraft,
  review: ReturnType<typeof reconcileOwnerSite>,
  now = Date.now(),
): PublishedOwnerSite {
  const selected = selectedSite(draft);
  const ownership = new Map(review.map((d) => [d.domain, d.ownership]));
  for (const d of selected.domainPresentations)
    if (d.ownership === 'current' && ownership.get(d.domain) !== 'owned')
      throw new Error(
        `${d.domain}: sync or resolve ownership, remove this reference, or explicitly mark it Previously owned.`,
      );
  return { ...selected, publishedAt: now };
}
