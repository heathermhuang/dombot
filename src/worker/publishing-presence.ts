import { z } from 'zod';
import { canonicalDomain, privateListing } from '../shared/publication';
import {
  isOwnerSite,
  selectedSite,
  editableSite,
  type AnyDraft,
  type AnyPublished,
} from '../shared/owner-site';
import type {
  DomainPresence,
  PresencePage,
  PresenceSurface,
} from '../shared/publishing-presence';
import { reconcilePortfolio } from '../core/publication/reconcile';
import { getImportedDomains } from '../core/services/imported-domains';
import { publishedSaleSchema, saleDraftSchema } from '../shared/sales';
import { PublicationStore } from './publication-store';
import { SalesStore } from './sales-store';
import type { PublicationInputs } from './publication-inputs';

export const presenceQuery = z
  .object({
    q: z.string().max(253).default(''),
    cursor: z
      .string()
      .max(253)
      .default('')
      .refine((v) => {
        try {
          return !v || canonicalDomain(v) === v;
        } catch {
          return false;
        }
      }),
    tld: z
      .string()
      .max(63)
      .regex(/^[a-z0-9-]*$/)
      .default(''),
    account: z.string().max(200).default(''),
    status: z.enum(['', 'owned', 'stale', 'unmatched', 'conflict']).default(''),
    names: z.string().max(26000).optional(),
  })
  .strict();
const unknown = <T>(reason: string): PresenceSurface<T> => ({
  state: 'unknown',
  reason,
});
const known = <T>(value: T, revision: string | null): PresenceSurface<T> => ({
  state: 'known',
  value,
  revision,
});
/** Bounded page reads; no providers, inquiry tables, or whole Sales draft scan. */
export async function publishingPresence(
  publication: PublicationStore,
  sales: SalesStore,
  input: PublicationInputs,
  raw: Record<string, string>,
  base: string,
): Promise<PresencePage> {
  const query = presenceQuery.parse(raw);
  const [saved, live, shop] = await Promise.allSettled([
    publication.draft(),
    publication.published(),
    sales.shop(),
  ]);
  const draft = saved.status === 'fulfilled' ? saved.value : null;
  const published = live.status === 'fulfilled' ? live.value : null;
  const records = (v: AnyDraft | AnyPublished) =>
    isOwnerSite(v) ? v.domainPresentations : v.listings;
  const names = [
    ...new Set([
      ...input.domains.map((d) => canonicalDomain(d.domainName)),
      ...Object.keys(getImportedDomains()).map(canonicalDomain),
      ...(draft ? records(draft.draft).map((d) => d.domain) : []),
      ...(published ? records(published.snapshot).map((d) => d.domain) : []),
    ]),
  ].sort();
  const exact =
    query.names === undefined
      ? null
      : z
          .array(z.string().max(253))
          .max(100)
          .parse(JSON.parse(query.names))
          .map(canonicalDomain);
  const requested = exact ? new Set(exact) : null;
  const reconciled = reconcilePortfolio(
    {
      handle: 'portfolio',
      title: 'Presence',
      intro: '',
      contactEmail: '',
      listings: names.map(privateListing),
    },
    input.domains,
    input.accounts,
  );
  const checks = new Map(reconciled.map((r) => [r.domain, r]));
  const filtered = names.filter(
    (name) =>
      (!requested || requested.has(name)) &&
      name > query.cursor &&
      name.includes(query.q.toLowerCase()) &&
      (!query.tld || name.endsWith('.' + query.tld)) &&
      (!query.account ||
        checks
          .get(name)
          ?.accountLabels.some((a) => a.includes(query.account))) &&
      (!query.status || checks.get(name)?.ownership === query.status),
  );
  const page = filtered.slice(0, 100);
  const hashes = await Promise.all(page.map((n) => sales.hash('domain', n)));
  let rows:
    | {
        id: string;
        domain_hash: string;
        revision: string;
        sealed: string;
        availability: string;
        control_expires_at: number;
        payload: string | null;
        draft_revision: string | null;
      }[]
    | null = null;
  try {
    rows = (
      await sales.db
        .prepare(
          'SELECT d.id,d.domain_hash,d.revision,d.sealed,d.availability,d.control_expires_at,p.payload,p.draft_revision FROM sale_drafts d LEFT JOIN published_sales p ON p.id=d.id WHERE d.domain_hash IN (SELECT value FROM json_each(?))',
        )
        .bind(JSON.stringify(hashes))
        .all<NonNullable<typeof rows>[number]>()
    ).results;
  } catch {
    /* A failed Sales read remains unknown. */
  }
  const byHash = new Map(rows?.map((r) => [r.domain_hash, r]));
  const selectedNames = (value: AnyDraft | AnyPublished) =>
    isOwnerSite(value)
      ? selectedSite(editableSite(value)).domainPresentations.map(
          (d) => d.domain,
        )
      : value.listings
          .filter((d) => d.visibility !== 'private')
          .map((d) => d.domain);
  let draftSelected: string[] | null = null;
  try {
    if (draft) draftSelected = selectedNames(draft.draft);
  } catch {
    /* invalid saved selection */
  }
  const publicNames = new Set(
    published ? selectedNames(published.snapshot) : [],
  );
  const draftNames = new Set(draftSelected ?? []);
  const publicCollections = new Map<
    string,
    { title: string; slug: string }[]
  >();
  if (published && isOwnerSite(published.snapshot)) {
    const domains = new Map(
      published.snapshot.domainPresentations.map((d) => [d.id, d.domain]),
    );
    for (const collection of published.snapshot.collections)
      for (const id of collection.domainIds) {
        const domain = domains.get(id);
        if (domain)
          publicCollections.set(domain, [
            ...(publicCollections.get(domain) ?? []),
            { title: collection.title, slug: collection.slug },
          ]);
      }
  }
  const publicRecords = new Map(
    published ? records(published.snapshot).map((d) => [d.domain, d]) : [],
  );
  const draftRecords = new Map(
    draft ? records(draft.draft).map((d) => [d.domain, d]) : [],
  );
  const publicLinks = new Map(
    published &&
      isOwnerSite(published.snapshot) &&
      published.snapshot.version === 3
      ? published.snapshot.salesLinks.map((l) => [l.presentationId, l])
      : [],
  );
  const items: DomainPresence[] = [];
  for (let i = 0; i < page.length; i++) {
    const domain = page[i],
      check = checks.get(domain),
      row = byHash.get(hashes[i]);
    let sale: DomainPresence['sales'] = unknown(
      'Domain page information is unavailable.',
    );
    if (rows) {
      try {
        const d = row ? await sales.open(row.sealed, saleDraftSchema) : null;
        const p = row?.payload
          ? publishedSaleSchema.parse(JSON.parse(row.payload))
          : null;
        sale = known(
          {
            id: row?.id ?? null,
            draftRevision: row?.revision ?? null,
            publishedRevision: p?.revision ?? null,
            actionable:
              !!p &&
              row?.availability === 'available' &&
              row.control_expires_at > Date.now(),
            suppression: p
              ? row?.availability !== 'available'
                ? row!.availability
                : row.control_expires_at <= Date.now()
                  ? 'Control observation expired'
                  : null
              : null,
            mode: p?.mode ?? null,
            price: p?.publicPrice ?? null,
            pendingChanges: !!row && row.revision !== row.draft_revision,
            newPublicationBlockers:
              check?.ownership === 'owned'
                ? []
                : ['Refresh or verify domain control before new exposure.'],
            priceSource: d?.priceSource?.kind ?? null,
            url: p ? `${base}/d/${domain}` : null,
          },
          row?.revision ?? null,
        );
      } catch {
        /* Per-record corruption cannot masquerade as unpublished. */
      }
    }
    const selected = publicNames.has(domain);
    const publicRecord = publicRecords.get(domain),
      draftRecord = draftRecords.get(domain);
    const publicLink =
      publicRecord && 'id' in publicRecord
        ? publicLinks.get(publicRecord.id)
        : null;
    const linkedSuppressed =
      !!publicLink &&
      (sale.state !== 'known' ||
        !sale.value.actionable ||
        sale.value.publishedRevision !== publicLink.publishedRevision ||
        sale.value.id !== publicLink.listingId);
    const profile: DomainPresence['profile'] =
      live.status === 'fulfilled' && draftSelected
        ? known(
            {
              draftSelected: draftNames.has(domain),
              publishedSelected: selected,
              pendingChanges:
                draftNames.has(domain) !== selected ||
                JSON.stringify(draftRecord) !== JSON.stringify(publicRecord),
              publicPrice: linkedSuppressed
                ? null
                : publicLink
                  ? publicLink.publicPrice
                  : publicRecord?.askingPrice
                    ? {
                        amount: publicRecord.askingPrice,
                        currency: publicRecord.currency,
                      }
                    : null,
              publicAction: !selected
                ? null
                : publicLink
                  ? 'linked'
                  : publicRecord &&
                      ('availability' in publicRecord
                        ? publicRecord.availability === 'inquiries'
                        : publicRecord.visibility === 'inquiry')
                    ? 'email'
                    : 'display',
              newPublicationBlockers:
                check?.ownership === 'owned' ||
                (draftRecord &&
                  'ownership' in draftRecord &&
                  draftRecord.ownership === 'historical')
                  ? []
                  : [
                      'Refresh registrar control before a new public membership.',
                    ],
              currentActionSuppressed: linkedSuppressed,
              collections: publicCollections.get(domain) ?? [],
              url: selected ? `${base}/p/${published!.snapshot.handle}` : null,
            },
            published?.revision ?? null,
          )
        : unknown('Profile information is unavailable.');
    items.push({
      domain,
      inventory: {
        status: check?.ownership ?? 'unmatched',
        observedAt: check?.lastSyncedAt ?? null,
        accounts: check?.accountLabels ?? [],
      },
      profile,
      sales: sale,
      shop:
        shop.status === 'fulfilled' && rows
          ? known(
              {
                draftSelected:
                  !!row && shop.value.draft.listingIds.includes(row.id),
                publishedSelected:
                  !!row && !!shop.value.published?.listingIds.includes(row.id),
                url:
                  row && shop.value.published?.listingIds.includes(row.id)
                    ? `${base}/shop/${shop.value.published.handle}`
                    : null,
              },
              shop.value.revision,
            )
          : unknown('Shop information is unavailable.'),
    });
  }
  return {
    items,
    cursor: filtered.length > 100 ? page[99] : null,
    unknownNames: exact?.filter((n) => !names.includes(n)) ?? [],
    sources: {
      draft: draft?.revision ?? null,
      published: published?.revision ?? null,
    },
  };
}
