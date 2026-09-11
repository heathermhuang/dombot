import type { PortfolioListing, PublicListing } from './publication';
export function pageMembership(
  item: PortfolioListing,
  live: PublicListing | undefined,
  edited = false,
) {
  if (item.visibility === 'private') return live ? 'removing' : 'absent';
  if (!live) return 'adding';
  return edited ? 'editing' : 'live';
}
export const pageMembershipLabel = {
  absent: 'Not on page',
  adding: 'Draft · ready to add',
  removing: 'Live · removal pending',
  editing: 'Live · edits pending',
  live: 'Live',
};

export function matchesPageScope(
  item: PortfolioListing,
  live: PublicListing | undefined,
  scope: string,
): boolean {
  if (scope === 'listed') return item.visibility !== 'private' || !!live;
  if (scope === 'private') return item.visibility === 'private' && !live;
  return true;
}
