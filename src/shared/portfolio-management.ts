import type {
  PortfolioDraft,
  PortfolioListing,
  ReconciledListing,
} from './publication';

export type PortfolioScope = 'listed' | 'private' | 'history' | 'all';
export type OwnershipFilter = 'all' | 'owned' | 'attention' | 'blocking';
export const collectionTokens = (value: string) =>
  value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
export const isCurrent = (item: PortfolioListing) =>
  item.visibility === 'showcase' || item.visibility === 'inquiry';
export function filterPortfolio(
  items: PortfolioListing[],
  review: ReconciledListing[],
  options: {
    scope: PortfolioScope;
    ownership: OwnershipFilter;
    query: string;
    collection: string;
    sort: string;
  },
) {
  const checks = new Map(review.map((item) => [item.domain, item.ownership]));
  return items
    .filter((item) => {
      const problem =
        item.visibility !== 'historical' && checks.get(item.domain) !== 'owned';
      return (
        (options.scope === 'all' ||
          (options.scope === 'listed'
            ? isCurrent(item)
            : options.scope === 'history'
              ? item.visibility === 'historical'
              : item.visibility === 'private')) &&
        (options.ownership === 'all' ||
          (options.ownership === 'owned'
            ? checks.get(item.domain) === 'owned'
            : options.ownership === 'blocking'
              ? isCurrent(item) && problem
              : problem)) &&
        (!options.collection ||
          collectionTokens(item.collection).includes(options.collection)) &&
        `${item.domain} ${item.collection} ${item.description}`
          .toLowerCase()
          .includes(options.query.trim().toLowerCase())
      );
    })
    .sort((a, b) => {
      if (options.sort === 'price') {
        if (a.askingPrice === null && b.askingPrice !== null) return 1;
        if (b.askingPrice === null && a.askingPrice !== null) return -1;
        if (a.askingPrice !== null && b.askingPrice !== null) {
          const currency = a.currency.localeCompare(b.currency);
          if (currency) return currency;
        }
        const price = (b.askingPrice ?? 0) - (a.askingPrice ?? 0);
        if (price) return price;
      }
      return (
        a.domain.localeCompare(b.domain) * (options.sort === 'za' ? -1 : 1)
      );
    });
}
export type BulkPortfolioEdit =
  | { kind: 'include' }
  | { kind: 'inquiries'; value: 'showcase' | 'inquiry' }
  | { kind: 'visibility'; value: PortfolioListing['visibility'] }
  | { kind: 'collection'; mode: 'add' | 'remove' | 'replace'; value: string };
/** Every bulk command is one immutable edit and one autosave, never per-row writes. */
export function editPortfolioSelection(
  draft: PortfolioDraft,
  names: Set<string>,
  edit: BulkPortfolioEdit,
): PortfolioDraft {
  const selected = draft.listings.filter((item) => names.has(item.domain));
  if (selected.length !== names.size)
    throw new Error(
      'Some selected names are no longer available. Select them again.',
    );
  if (edit.kind === 'inquiries' && !selected.every(isCurrent))
    throw new Error(
      'Inquiry changes apply only to current listings. Add private names separately.',
    );
  if (
    edit.kind === 'visibility' &&
    (edit.value === 'inquiry' || edit.value === 'showcase') &&
    selected.some((item) => item.visibility === 'historical')
  )
    throw new Error(
      'Historical names cannot be changed into current listings in bulk. Review them individually.',
    );
  if (
    edit.kind === 'visibility' &&
    edit.value === 'historical' &&
    selected.some((item) => item.visibility !== 'private')
  )
    throw new Error('Only unlisted names can be added to history.');
  const tokens = edit.kind === 'collection' ? collectionTokens(edit.value) : [];
  if (edit.kind === 'collection' && tokens.length === 0)
    throw new Error('Enter a collection name.');
  const result = draft.listings.map((item) => {
    if (!names.has(item.domain)) return item;
    if (edit.kind === 'include')
      return item.visibility === 'private'
        ? { ...item, visibility: 'showcase' as const }
        : item;
    if (edit.kind === 'visibility' || edit.kind === 'inquiries')
      return { ...item, visibility: edit.value };
    const existing = collectionTokens(item.collection);
    const lower = new Set(tokens.map((v) => v.toLowerCase()));
    const combined =
      edit.mode === 'replace'
        ? tokens
        : edit.mode === 'remove'
          ? existing.filter((v) => !lower.has(v.toLowerCase()))
          : [...existing, ...tokens];
    const unique = new Map<string, string>();
    for (const token of combined)
      if (!unique.has(token.toLowerCase()))
        unique.set(token.toLowerCase(), token);
    const collection = [...unique.values()].join('; ');
    if (collection.length > 200)
      throw new Error(
        `The collections for ${item.domain} are too long. Use shorter names.`,
      );
    return { ...item, collection };
  });
  return { ...draft, listings: result };
}
