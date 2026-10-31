import { z } from 'zod';
import {
  anyPublishedSchema,
  editableSite,
  emptyOwnerSite,
  editableOwnerSiteSchema,
  isOwnerSite,
  selectedSite,
  type AnyDraft,
  type AnyPublished,
  type OwnerSiteDraft,
} from '../shared/owner-site';
import { canonicalDomain } from '../shared/publication';
import {
  prepareChangeSetSchema,
  type ChangeSetRequest,
  type PublicationReceipt,
} from '../shared/publication-change-set';
import { conflict, SalesError } from '../shared/sales-review';
import { reconcileOwnerSite } from '../core/publication/owner-site';
import type { PublicationInputs } from './publication-inputs';
import { PublicationStore } from './publication-store';
import { SalesStore, type SaleObserver } from './sales-store';
import { bindSiteLinks } from './publication-links';
import { canonicalPublicUrl } from '../shared/public-publishing-links';

const manifestSchema = z
  .object({
    id: z.string().uuid(),
    tenant: z.string(),
    request: prepareChangeSetSchema,
    generation: z.number().int(),
    expiresAt: z.number().int(),
    publicRevision: z.string().nullable(),
    nextPublicRevision: z.string().uuid(),
    after: anyPublishedSchema.nullable(),
    afterHash: z.string(),
    nextDraftHash: z.string(),
    salesReviewId: z.string().uuid().nullable(),
    authority: z.string(),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
const digest = async (v: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(v)),
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Remove public references; draft descriptions, excluded sections and other edits survive. */
export function withdrawNames<T extends AnyDraft | AnyPublished>(
  input: T,
  names: Set<string>,
  published: boolean,
): AnyDraft | AnyPublished | null {
  if (!isOwnerSite(input)) {
    const listings = published
      ? input.listings.filter((d) => !names.has(d.domain))
      : input.listings.map((d) =>
          names.has(d.domain) ? { ...d, visibility: 'private' as const } : d,
        );
    if (published && !listings.length) return null;
    return { ...input, listings } as AnyDraft | AnyPublished;
  }
  const ids = new Set(
    input.domainPresentations
      .filter((d) => names.has(d.domain))
      .map((d) => d.id),
  );
  const collections = input.collections.map((c) => ({
    ...c,
    domainIds: c.domainIds.filter((id) => !ids.has(id)),
  }));
  const projects = input.projects.map((c) => ({
    ...c,
    domainIds: c.domainIds.filter((id) => !ids.has(id)),
  }));
  const empty = new Set(
    collections.filter((c) => !c.domainIds.length).map((c) => c.id),
  );
  return {
    ...input,
    domainPresentations: published
      ? input.domainPresentations.filter((d) => !ids.has(d.id))
      : input.domainPresentations,
    collections: published
      ? collections.filter((c) => !empty.has(c.id))
      : collections,
    projects,
    homepage: {
      ...input.homepage,
      collectionIds: input.homepage.collectionIds.filter(
        (id) => !empty.has(id),
      ),
    },
    catalogue: {
      enabled:
        input.catalogue.enabled &&
        input.catalogue.domainIds.some((id) => !ids.has(id)),
      domainIds: input.catalogue.domainIds.filter((id) => !ids.has(id)),
    },
    ...(input.version === 3
      ? {
          salesLinks: input.salesLinks.filter(
            (l) => !ids.has(l.presentationId),
          ),
        }
      : {}),
  } as AnyDraft | AnyPublished;
}

/** Copy only approved domain fields and exact new memberships onto the public baseline. */
export function scopedSite(
  draft: OwnerSiteDraft,
  live: AnyPublished | null,
  request: ChangeSetRequest['operation'] & { kind: 'publish' },
): OwnerSiteDraft {
  if (live && (!isOwnerSite(live) || live.version !== draft.version))
    throw new SalesError(
      'CONVERSION_REQUIRED',
      'Review and publish the explicit site-format conversion first.',
    );
  const baseline: OwnerSiteDraft =
    live && isOwnerSite(live)
      ? editableSite(live)
      : editableOwnerSiteSchema.parse({
          ...emptyOwnerSite(),
          handle: draft.handle,
          profile: { ...emptyOwnerSite().profile, name: draft.profile.name },
          ...(draft.version === 3
            ? { version: 3 as const, salesLinks: [] }
            : {}),
        });
  const names = new Set(request.domains.map(canonicalDomain));
  const chosen = draft.domainPresentations.filter((d) => names.has(d.domain));
  if (chosen.length !== names.size)
    throw new SalesError(
      'MISSING_SELECTION',
      'Save the selected domain details before review.',
    );
  const ids = new Set(chosen.map((d) => d.id));
  const before = new Map(
    baseline.domainPresentations.map((d) => [d.domain, d]),
  );
  for (const d of chosen)
    if (before.has(d.domain) && before.get(d.domain)!.id !== d.id)
      throw conflict('The presentation identity changed.');
  const domainPresentations = [
    ...baseline.domainPresentations.filter((d) => !names.has(d.domain)),
    ...chosen,
  ];
  const collections = [...baseline.collections];
  const collectionIds = [...baseline.homepage.collectionIds];
  for (const id of new Set(request.collectionIds)) {
    const current = collections.find((c) => c.id === id),
      source = draft.collections.find((c) => c.id === id);
    if (!source)
      throw new SalesError(
        'MISSING_COLLECTION',
        'Save the destination collection first.',
      );
    if (current)
      current.domainIds = [...new Set([...current.domainIds, ...ids])];
    else {
      collections.push({ ...source, domainIds: [...ids] });
      collectionIds.push(id);
    }
  }
  const result: OwnerSiteDraft = {
    ...baseline,
    domainPresentations,
    collections,
    homepage: { ...baseline.homepage, collectionIds },
    catalogue: request.catalogue
      ? {
          enabled: true,
          domainIds: [...new Set([...baseline.catalogue.domainIds, ...ids])],
        }
      : baseline.catalogue,
  };
  if (result.version === 3 && draft.version === 3)
    result.salesLinks = [
      ...result.salesLinks.filter((l) => !ids.has(l.presentationId)),
      ...draft.salesLinks.filter((l) => ids.has(l.presentationId)),
    ];
  if (
    !live &&
    chosen.some(
      (d) =>
        d.availability === 'inquiries' &&
        !(
          draft.version === 3 &&
          draft.salesLinks.some((l) => l.presentationId === d.id)
        ),
    )
  )
    result.profile.contactEmail = draft.profile.contactEmail;
  // Reject domain-only edits that have no explicit destination on this surface.
  const selected = selectedSite(result);
  if (
    chosen.some((d) => !selected.domainPresentations.some((p) => p.id === d.id))
  )
    throw new SalesError(
      'MISSING_DESTINATION',
      'Choose a collection or catalogue destination for each new name.',
    );
  return selected;
}

export class PublicationChangeSets {
  constructor(
    readonly publication: PublicationStore,
    readonly sales: SalesStore,
    readonly tenant: string,
    readonly origin: string | undefined,
  ) {}
  async generation(): Promise<number> {
    const r = await this.sales.db
      .prepare(
        "SELECT generation FROM publication_dependencies WHERE id='main'",
      )
      .first<{ generation: number }>();
    if (!r)
      throw new SalesError(
        'MIGRATION_REQUIRED',
        'The publishing migration is required.',
        503,
      );
    return r.generation;
  }
  async authority(value: string): Promise<void> {
    await this.sales.db
      .prepare(
        "INSERT INTO publication_authority(id,fingerprint) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint WHERE fingerprint<>excluded.fingerprint",
      )
      .bind(value)
      .run();
  }
  async get(id: string): Promise<Manifest> {
    const row = await this.sales.db
      .prepare('SELECT sealed FROM publication_change_sets WHERE id=?')
      .bind(id)
      .first<{ sealed: string }>();
    if (!row) throw conflict('Review not found.');
    const manifest = await this.sales.open(row.sealed, manifestSchema);
    if (manifest.tenant !== this.tenant) throw conflict();
    return manifest;
  }
  async receipt(id: string, key: string): Promise<PublicationReceipt | null> {
    const row = await this.sales.db
      .prepare(
        'SELECT receipt FROM publication_change_sets WHERE id=? AND request_key=?',
      )
      .bind(id, key)
      .first<{ receipt: string | null }>();
    return row?.receipt ? JSON.parse(row.receipt) : null;
  }
  async prepare(
    raw: unknown,
    input: PublicationInputs,
    observe: SaleObserver,
    authority: string,
  ): Promise<Manifest> {
    const request = prepareChangeSetSchema.parse(raw);
    if (
      new Set(request.operation.domains.map(canonicalDomain)).size !==
      request.operation.domains.length
    )
      throw new SalesError('DUPLICATES', 'Choose each domain once.');
    const existing = await this.sales.db
      .prepare('SELECT id FROM publication_change_sets WHERE request_key=?')
      .bind(request.requestKey)
      .first<{ id: string }>();
    if (existing) {
      const m = await this.get(existing.id);
      if (!same(m.request, request) || m.authority !== authority)
        throw conflict('This operation key belongs to another review.');
      return m;
    }
    await this.authority(authority);
    const generation = await this.generation();
    const saved = await this.publication.draft(),
      live = await this.publication.published();
    if (saved.revision !== request.draftRevision) throw conflict();
    const operation = request.operation;
    let after: AnyPublished | null = live?.snapshot ?? null,
      nextDraft = saved.draft,
      salesReviewId: string | null = null;
    if (operation.kind === 'withdraw') {
      const names = new Set(operation.domains.map(canonicalDomain));
      const withdrawn = after ? withdrawNames(after, names, true) : null;
      after = withdrawn ? anyPublishedSchema.parse(withdrawn) : null;
      // Last-domain legacy withdrawal unpublishes, rather than manufacturing an empty legacy snapshot.
      if (
        live &&
        !isOwnerSite(live.snapshot) &&
        !live.snapshot.listings.some((d) => !names.has(d.domain))
      )
        after = null;
      nextDraft = withdrawNames(saved.draft, names, false) as AnyDraft;
    } else {
      if (operation.sales.length) {
        const review = await this.sales.prepare(
          operation.sales,
          observe,
          operation.shopListingIds,
        );
        salesReviewId = review.id;
      }
      const committing = salesReviewId
        ? (await this.sales.review(salesReviewId)).items.map((i) => i.after)
        : [];
      if (operation.domains.length || operation.fullPage) {
        if (!isOwnerSite(saved.draft))
          throw new SalesError(
            'SITE_REQUIRED',
            'Prepare an owner-site draft before selecting site destinations.',
          );
        const scopeDraft = structuredClone(saved.draft);
        if (scopeDraft.version === 3)
          for (const link of scopeDraft.salesLinks) {
            const sale = committing.find((s) => s.id === link.listingId);
            if (
              sale &&
              operation.domains.includes(
                scopeDraft.domainPresentations.find(
                  (d) => d.id === link.presentationId,
                )?.domain ?? '',
              )
            )
              link.expectedPublishedRevision = sale.revision;
          }
        const scoped = operation.fullPage
          ? selectedSite(scopeDraft)
          : scopedSite(scopeDraft, after, operation);
        if (
          operation.fullPage &&
          !same(
            [...scoped.domainPresentations.map((d) => d.domain)].sort(),
            [...operation.domains].sort(),
          )
        )
          throw conflict(
            'Review all selected names for a full-page publication.',
          );
        const checks = new Map(
          reconcileOwnerSite(scoped, input.domains, input.accounts).map((r) => [
            r.domain,
            r,
          ]),
        );
        // Only same-surface unchanged fragments may reuse their earlier observation.
        for (const d of scoped.domainPresentations) {
          const prior =
            after && isOwnerSite(after)
              ? after.domainPresentations.find((p) => p.id === d.id)
              : null;
          const newlySelected = operation.domains.includes(d.domain);
          if (
            (newlySelected || !same(d, prior)) &&
            d.ownership === 'current' &&
            checks.get(d.domain)?.ownership !== 'owned'
          )
            throw new SalesError(
              'CONTROL_UNCERTAIN',
              `${d.domain}: refresh registrar control before this new exposure.`,
              409,
            );
        }
        after = await bindSiteLinks(
          this.sales.db,
          scoped,
          Date.now(),
          committing,
          !operation.fullPage && after && isOwnerSite(after)
            ? { baseline: after, approvedDomains: operation.domains }
            : undefined,
        );
        nextDraft = scopeDraft;
      }
      if (operation.shopListingIds.length) {
        const shop = await this.sales.shop();
        if (!shop.published)
          throw new SalesError(
            'SHOP_REQUIRED',
            'Publish shop identity separately before adding exact memberships.',
          );
        for (const id of operation.shopListingIds)
          if (
            !committing.some((s) => s.id === id) &&
            !(
              (await this.sales.get(id)).published &&
              (await observe((await this.sales.get(id)).draft)).available
            )
          )
            throw new SalesError(
              'NOT_PUBLIC',
              'Only explicitly published domain pages can enter a shop.',
            );
      }
    }
    const m: Manifest = {
      id: crypto.randomUUID(),
      tenant: this.tenant,
      request,
      generation,
      expiresAt: Date.now() + 900000,
      publicRevision: live?.revision ?? null,
      nextPublicRevision: crypto.randomUUID(),
      after,
      afterHash: await digest(after),
      nextDraftHash: await digest(nextDraft),
      salesReviewId,
      authority,
    };
    const encoded = JSON.stringify(m);
    if (new TextEncoder().encode(encoded).byteLength > 750000)
      throw new SalesError(
        'BUDGET',
        'This exact operation exceeds the publication payload budget. Split it into smaller reviewed batches.',
      );
    if ((await this.generation()) !== generation) throw conflict();
    await this.sales.atomic([
      ...this.sales.guard(
        "EXISTS(SELECT 1 FROM publication_dependencies WHERE id='main' AND generation=?)",
        [generation],
      ),
      this.sales.db
        .prepare(
          'INSERT INTO publication_change_sets(id,request_key,sealed,expires_at) VALUES(?,?,?,?)',
        )
        .bind(m.id, request.requestKey, await this.sales.seal(m), m.expiresAt),
    ]);
    return m;
  }
  async commit(
    id: string,
    key: string,
    input: PublicationInputs,
    observe: SaleObserver,
    authority: string,
  ): Promise<PublicationReceipt> {
    const done = await this.receipt(id, key);
    if (done) return done;
    const m = await this.get(id);
    if (
      m.request.requestKey !== key ||
      m.authority !== authority ||
      m.expiresAt <= Date.now()
    )
      throw conflict('Review expired or capabilities changed.');
    const generation = await this.generation();
    if (generation !== m.generation)
      throw conflict('A publishing dependency changed. Review again.');
    const saved = await this.publication.draft();
    if (saved.revision !== m.request.draftRevision) throw conflict();
    let nextDraft = saved.draft;
    const operation = m.request.operation;
    const statements = [
      ...this.sales.guard(
        "EXISTS(SELECT 1 FROM publication_dependencies WHERE id='main' AND generation=?)",
        [generation],
      ),
      ...this.sales.guard(
        'EXISTS(SELECT 1 FROM publication_change_sets WHERE id=? AND request_key=? AND consumed_at IS NULL AND expires_at>?)',
        [id, key, Date.now()],
      ),
    ];
    if (m.salesReviewId) {
      const prepared = await this.sales.preparePublication(
        m.salesReviewId,
        observe,
      );
      statements.push(...prepared.statements);
      if (isOwnerSite(nextDraft) && nextDraft.version === 3) {
        nextDraft = structuredClone(nextDraft);
        for (const link of nextDraft.salesLinks) {
          const sale = prepared.receipt.find((r) => r.id === link.listingId);
          if (
            sale &&
            operation.domains.includes(
              nextDraft.domainPresentations.find(
                (d) => d.id === link.presentationId,
              )?.domain ?? '',
            )
          )
            link.expectedPublishedRevision = sale.revision;
        }
      }
    }
    if (operation.kind === 'withdraw')
      nextDraft = withdrawNames(
        nextDraft,
        new Set(operation.domains.map(canonicalDomain)),
        false,
      ) as AnyDraft;
    if (
      (await digest(nextDraft)) !== m.nextDraftHash ||
      (await digest(m.after)) !== m.afterHash
    )
      throw conflict('The exact reviewed result changed.');
    if (
      operation.kind === 'publish' &&
      (operation.domains.length || operation.fullPage) &&
      m.after &&
      isOwnerSite(m.after)
    ) {
      const checks = new Map(
        reconcileOwnerSite(
          editableSite(m.after),
          input.domains,
          input.accounts,
        ).map((r) => [r.domain, r]),
      );
      for (const name of operation.domains)
        if (
          m.after.domainPresentations.find((d) => d.domain === name)
            ?.ownership === 'current' &&
          checks.get(name)?.ownership !== 'owned'
        )
          throw conflict('Domain control changed after review.');
      // Re-read every referenced public Sales dependency, including already published links.
      await bindSiteLinks(
        this.sales.db,
        editableSite(m.after),
        Date.now(),
        m.salesReviewId
          ? (await this.sales.review(m.salesReviewId)).items.map((i) => i.after)
          : [],
        { baseline: m.after, approvedDomains: operation.domains },
      );
    }
    if (operation.kind === 'withdraw') {
      const hashes = await Promise.all(
        operation.domains.map((n) =>
          this.sales.hash('domain', canonicalDomain(n)),
        ),
      );
      const ids = (
        await this.sales.db
          .prepare(
            'SELECT id FROM sale_drafts WHERE domain_hash IN (SELECT value FROM json_each(?))',
          )
          .bind(JSON.stringify(hashes))
          .all<{ id: string }>()
      ).results.map((r) => r.id);
      statements.push(
        this.sales.db
          .prepare(
            'DELETE FROM published_sales WHERE id IN (SELECT value FROM json_each(?))',
          )
          .bind(JSON.stringify(ids)),
        this.sales.db
          .prepare(
            "UPDATE sale_drafts SET operational_revision=?,availability='paused' WHERE id IN (SELECT value FROM json_each(?))",
          )
          .bind(crypto.randomUUID(), JSON.stringify(ids)),
      );
      const shop = await this.sales.shop();
      if (shop.revision)
        statements.push(
          this.sales.db
            .prepare(
              "UPDATE sales_shop SET revision=?,sealed=?,published=? WHERE id='main'",
            )
            .bind(
              crypto.randomUUID(),
              await this.sales.seal({
                ...shop.draft,
                listingIds: shop.draft.listingIds.filter(
                  (id) => !ids.includes(id),
                ),
              }),
              shop.published
                ? JSON.stringify({
                    ...shop.published,
                    listingIds: shop.published.listingIds.filter(
                      (id) => !ids.includes(id),
                    ),
                  })
                : null,
            ),
        );
    } else if (operation.shopListingIds.length) {
      const shop = await this.sales.shop();
      if (!shop.published) throw conflict();
      statements.push(
        this.sales.db
          .prepare(
            "UPDATE sales_shop SET revision=?,published=? WHERE id='main'",
          )
          .bind(
            crypto.randomUUID(),
            JSON.stringify({
              ...shop.published,
              listingIds: [
                ...new Set([
                  ...shop.published.listingIds,
                  ...operation.shopListingIds,
                ]),
              ],
            }),
          ),
      );
    }
    if (
      operation.kind === 'withdraw' ||
      operation.domains.length ||
      operation.fullPage
    ) {
      if (m.after)
        statements.push(
          this.sales.db
            .prepare(
              "INSERT INTO published_portfolios(id,handle,revision,payload) VALUES('main',?,?,?) ON CONFLICT(id) DO UPDATE SET handle=excluded.handle,revision=excluded.revision,payload=excluded.payload",
            )
            .bind(
              m.after.handle,
              m.nextPublicRevision,
              JSON.stringify(m.after),
            ),
        );
      else
        statements.push(
          this.sales.db.prepare(
            "DELETE FROM published_portfolios WHERE id='main'",
          ),
        );
      if (saved.revision && !same(nextDraft, saved.draft))
        statements.push(
          await this.publication.prepareDraft(nextDraft, crypto.randomUUID()),
        );
    }
    const urls: string[] = [];
    if (m.after)
      urls.push(canonicalPublicUrl(this.origin, `/p/${m.after.handle}`));
    if (m.salesReviewId)
      for (const item of (await this.sales.review(m.salesReviewId)).items)
        urls.push(canonicalPublicUrl(this.origin, `/d/${item.after.domain}`));
    const receipt: PublicationReceipt = {
      id,
      requestKey: key,
      committedAt: Date.now(),
      kind: operation.kind,
      domains: operation.domains,
      publicRevision: m.after
        ? operation.kind === 'withdraw' ||
          operation.domains.length ||
          operation.fullPage
          ? m.nextPublicRevision
          : m.publicRevision
        : null,
      urls,
      scope:
        'Tenant public profile, domain pages and explicitly selected shop memberships. External marketplaces, DNS and cached copies are excluded.',
    };
    statements.push(
      this.sales.db
        .prepare(
          'UPDATE publication_change_sets SET consumed_at=?,receipt=? WHERE id=?',
        )
        .bind(receipt.committedAt, JSON.stringify(receipt), id),
    );
    if (statements.length > 800)
      throw new SalesError(
        'BUDGET',
        'This operation exceeds the SQL statement budget. Split and review smaller batches.',
      );
    try {
      await this.sales.atomic(statements);
    } catch (error) {
      const recovered = await this.receipt(id, key);
      if (recovered) return recovered;
      throw error;
    }
    return receipt;
  }
}
