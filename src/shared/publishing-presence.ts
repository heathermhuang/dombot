/** Owner-only, public-field allowlist. Unknown is never equivalent to private. */
export type PresenceSurface<T> =
  | { state: 'known'; value: T; revision: string | null }
  | { state: 'unknown'; reason: string };
export interface DomainPresence {
  domain: string;
  inventory: { status: string; observedAt: number | null; accounts: string[] };
  profile: PresenceSurface<{
    draftSelected: boolean;
    publishedSelected: boolean;
    pendingChanges: boolean;
    publicPrice: { amount: number | string; currency: string } | null;
    publicAction: 'display' | 'email' | 'linked' | null;
    newPublicationBlockers: string[];
    currentActionSuppressed: boolean;
    collections: { title: string; slug: string }[];
    url: string | null;
  }>;
  sales: PresenceSurface<{
    id: string | null;
    draftRevision: string | null;
    publishedRevision: string | null;
    actionable: boolean;
    suppression: string | null;
    mode: string | null;
    price: { amount: string; currency: string } | null;
    pendingChanges: boolean;
    newPublicationBlockers: string[];
    priceSource: 'portfolio' | 'override' | null;
    url: string | null;
  }>;
  shop: PresenceSurface<{
    draftSelected: boolean;
    publishedSelected: boolean;
    url: string | null;
  }>;
}
export interface PresencePage {
  items: DomainPresence[];
  cursor: string | null;
  unknownNames: string[];
  sources: { draft: string | null; published: string | null };
}
