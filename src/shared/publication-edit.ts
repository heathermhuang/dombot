import {
  canonicalDomain,
  type PortfolioDraft,
  type PortfolioListing,
  type PublicationState,
  type PublishedPortfolio,
} from './publication';

export function editableDraft(state: PublicationState): PortfolioDraft {
  return {
    ...state.draft,
    listings: state.review.map((item) => ({
      domain: item.domain,
      collection: item.collection,
      description: item.description,
      visibility: item.visibility,
      askingPrice: item.askingPrice,
      currency: item.currency,
    })),
  };
}

/** Explicit selection changes private names to showcase, preserving every edit. */
export function includeDomains(
  draft: PortfolioDraft,
  names: string[],
): PortfolioDraft {
  const selected = new Set(names.map(canonicalDomain));
  const known = new Set(draft.listings.map((item) => item.domain));
  if ([...selected].some((name) => !known.has(name))) {
    throw new Error(
      'Some selected names are no longer in the inventory. Reload and select them again.',
    );
  }
  return {
    ...draft,
    listings: draft.listings.map((item) =>
      selected.has(item.domain) && item.visibility === 'private'
        ? { ...item, visibility: 'showcase' }
        : item,
    ),
  };
}

function publicFields(item: PortfolioListing) {
  return {
    domain: item.domain,
    collection: item.collection,
    description: item.description,
    visibility: item.visibility,
    askingPrice: item.visibility === 'inquiry' ? item.askingPrice : null,
    currency: item.currency,
  };
}

export function publicationChanges(
  draft: PortfolioDraft,
  live: PublishedPortfolio | null,
) {
  const selected = draft.listings.filter(
    (item) => item.visibility !== 'private',
  );
  const before = new Map(
    live?.listings.map((item) => [item.domain, item]) ?? [],
  );
  const after = new Map(selected.map((item) => [item.domain, item]));
  const added = selected.filter((item) => !before.has(item.domain));
  const removed = (live?.listings ?? []).filter(
    (item) => !after.has(item.domain),
  );
  const edited = selected.filter(
    (item) =>
      before.has(item.domain) &&
      JSON.stringify(publicFields(item)) !==
        JSON.stringify(publicFields(before.get(item.domain)!)),
  );
  const fields = ['title', 'intro', 'contactEmail', 'handle'] as const;
  const page = fields.filter((field) => live && draft[field] !== live[field]);
  return {
    added,
    removed,
    edited,
    page,
    count: added.length + removed.length + edited.length + page.length,
  };
}

/** Private preview uses the same public projection, without claiming ownership. */
export function previewSnapshot(draft: PortfolioDraft): PublishedPortfolio {
  return {
    handle: draft.handle,
    title: draft.title,
    intro: draft.intro,
    contactEmail: draft.contactEmail,
    publishedAt: Date.now(),
    listings: draft.listings
      .filter((item) => item.visibility !== 'private')
      .map((item) => ({
        ...publicFields(item),
        visibility: item.visibility as 'showcase' | 'inquiry' | 'historical',
      })),
  };
}
