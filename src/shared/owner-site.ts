import { z } from 'zod';
import { saleMoneySchema, saleModeSchema } from './sales';
import {
  draftSchema,
  publishedSchema,
  type PortfolioDraft,
  type PublishedPortfolio,
  canonicalDomain,
} from './publication';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const ids = z
  .array(id)
  .max(20_000)
  .refine((v) => new Set(v).size === v.length, 'Remove duplicate selections.');
export const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (
      [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
    )
      return false;
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Use a complete HTTPS link without credentials or spaces.');
const presentationSchema = z
  .object({
    id,
    domain: z
      .string()
      .max(253)
      .refine((v) => {
        try {
          return canonicalDomain(v) === v;
        } catch {
          return false;
        }
      }, 'Use a canonical domain name.'),
    ownership: z.enum(['current', 'historical']),
    availability: z.enum(['not-for-sale', 'inquiries']),
    description: z.string().trim().max(400),
    askingPrice: z.number().finite().positive().max(1e12).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
const collectionSchema = z
  .object({
    id,
    slug: id,
    title: z.string().trim().max(100),
    intro: z.string().trim().max(600),
    domainIds: ids,
  })
  .strict();
const projectSchema = z
  .object({
    id,
    title: z.string().trim().max(100),
    description: z.string().trim().max(600),
    url: z.union([z.literal(''), httpsUrl]),
    domainIds: ids,
  })
  .strict();
const shape = z
  .object({
    version: z.literal(2),
    handle: draftSchema.innerType().shape.handle,
    profile: z
      .object({
        name: z.string().trim().min(1).max(100),
        headline: z.string().trim().max(160),
        intro: z.string().trim().max(600),
        interests: z.array(z.string().trim().min(1).max(100)).max(20),
        opportunities: z.array(z.string().trim().min(1).max(100)).max(20),
        contactEmail: draftSchema.innerType().shape.contactEmail,
        links: z
          .array(
            z
              .object({
                label: z.string().trim().min(1).max(80),
                url: httpsUrl,
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),
    domainPresentations: z.array(presentationSchema).max(20_000),
    collections: z.array(collectionSchema).max(50),
    projects: z.array(projectSchema).max(50),
    homepage: z.object({ collectionIds: ids, projectIds: ids }).strict(),
    catalogue: z.object({ enabled: z.boolean(), domainIds: ids }).strict(),
  })
  .strict();
function uniqueRecords(value: z.infer<typeof shape>, ctx: z.RefinementCtx) {
  for (const key of ['domainPresentations', 'collections', 'projects'] as const)
    if (new Set(value[key].map((v) => v.id)).size !== value[key].length)
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'IDs must be unique.',
      });
  if (
    new Set(value.domainPresentations.map((v) => v.domain)).size !==
    value.domainPresentations.length
  )
    ctx.addIssue({
      code: 'custom',
      path: ['domainPresentations'],
      message: 'Each domain must appear only once.',
    });
  if (
    new Set(value.collections.map((v) => v.slug)).size !==
    value.collections.length
  )
    ctx.addIssue({
      code: 'custom',
      path: ['collections'],
      message: 'Collection links must be unique.',
    });
  if (
    value.collections.reduce((n, c) => n + c.domainIds.length, 0) +
      value.projects.reduce((n, p) => n + p.domainIds.length, 0) >
    20_000
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Select at most 20,000 memberships.',
    });
}
export const ownerSiteDraftSchema = shape.superRefine(uniqueRecords);
export type OwnerSiteV2Draft = z.infer<typeof ownerSiteDraftSchema>;
const draftLink = z
  .object({
    presentationId: id,
    listingId: z.string().uuid(),
    expectedPublishedRevision: z.string().uuid(),
  })
  .strict();
const publicLink = z
  .object({
    presentationId: id,
    listingId: z.string().uuid(),
    publishedRevision: z.string().uuid(),
    mode: saleModeSchema,
    publicPrice: saleMoneySchema.nullable(),
    publicMinimumOffer: saleMoneySchema.nullable(),
  })
  .strict();
function linkIdentity(
  value:
    | OwnerSiteV2Draft
    | {
        domainPresentations: OwnerSiteV2Draft['domainPresentations'];
        salesLinks: { presentationId: string }[];
      },
  ctx: z.RefinementCtx,
) {
  if (!('salesLinks' in value)) return;
  const links = value.salesLinks;
  if (new Set(links.map((l) => l.presentationId)).size !== links.length)
    ctx.addIssue({
      code: 'custom',
      message: 'Link each presentation only once.',
    });
  const presentations = new Map(
    value.domainPresentations.map((d) => [d.id, d]),
  );
  for (const l of links) {
    const d = presentations.get(l.presentationId);
    if (
      !d ||
      d.ownership !== 'current' ||
      d.availability !== 'inquiries' ||
      d.askingPrice !== null
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Sales links require a selected current inquiry domain with no independent price.',
      });
  }
}
const v3Shape = shape
  .extend({ version: z.literal(3), salesLinks: z.array(draftLink).max(20000) })
  .strict();
export const ownerSiteV3DraftSchema = v3Shape.superRefine((value, ctx) => {
  uniqueRecords({ ...value, version: 2 }, ctx);
  linkIdentity(value, ctx);
  const selected = new Set([
    ...(value.catalogue.enabled ? value.catalogue.domainIds : []),
    ...value.collections
      .filter((c) => value.homepage.collectionIds.includes(c.id))
      .flatMap((c) => c.domainIds),
    ...value.projects
      .filter((p) => value.homepage.projectIds.includes(p.id))
      .flatMap((p) => p.domainIds),
  ]);
  if (value.salesLinks.some((l) => !selected.has(l.presentationId)))
    ctx.addIssue({
      code: 'custom',
      message: 'Sales links require an explicitly selected current domain.',
    });
});
export const editableOwnerSiteSchema = z.union([
  ownerSiteDraftSchema,
  ownerSiteV3DraftSchema,
]);
export type OwnerSiteV3Draft = z.infer<typeof ownerSiteV3DraftSchema>;
export type OwnerSiteDraft = OwnerSiteV2Draft | OwnerSiteV3Draft;
export type DomainPresentation = OwnerSiteDraft['domainPresentations'][number];
export const isOwnerSite = (
  v: PortfolioDraft | OwnerSiteDraft | PublishedPortfolio | PublishedOwnerSite,
): v is OwnerSiteDraft | PublishedOwnerSite =>
  'version' in v && (v.version === 2 || v.version === 3);
export const anyDraftSchema = z.union([
  ownerSiteDraftSchema,
  ownerSiteV3DraftSchema,
  draftSchema,
]);
export type AnyDraft = z.infer<typeof anyDraftSchema>;

/** Resolve only explicitly selected sections. Draft-only references never expand disclosure. */
export function selectedSite(draft: OwnerSiteV2Draft): OwnerSiteV2Draft;
export function selectedSite(draft: OwnerSiteV3Draft): OwnerSiteV3Draft;
export function selectedSite(draft: OwnerSiteDraft): OwnerSiteDraft;
export function selectedSite(draft: OwnerSiteDraft): OwnerSiteDraft {
  const clean = editableOwnerSiteSchema.parse(draft);
  const pick = <T extends { id: string }>(
    records: T[],
    selected: string[],
    label: string,
  ) => {
    const byId = new Map(records.map((v) => [v.id, v]));
    return selected.map((key) => {
      const record = byId.get(key);
      if (!record) throw new Error(`Resolve missing ${label}: ${key}.`);
      return record;
    });
  };
  const collections = pick(
    clean.collections,
    clean.homepage.collectionIds,
    'collection',
  );
  const projects = pick(clean.projects, clean.homepage.projectIds, 'project');
  for (const p of projects)
    if (!p.title || !httpsUrl.safeParse(p.url).success)
      throw new Error(
        `Complete the title and HTTPS link for selected project “${p.title || 'Untitled'}”, or remove it from your site.`,
      );
  for (const c of collections)
    if (!c.title || !c.domainIds.length)
      throw new Error(
        `Add domains to collection “${c.title}” or remove it from your site.`,
      );
  const selected = [
    ...new Set([
      ...collections.flatMap((v) => v.domainIds),
      ...projects.flatMap((v) => v.domainIds),
      ...(clean.catalogue.enabled ? clean.catalogue.domainIds : []),
    ]),
  ];
  const domainPresentations = pick(
    clean.domainPresentations,
    selected,
    'domain',
  );
  for (const d of domainPresentations) {
    if (d.ownership === 'historical' && d.availability === 'inquiries')
      throw new Error(
        `${d.domain}: previously owned names cannot accept inquiries.`,
      );
    if (
      d.availability === 'inquiries' &&
      !clean.profile.contactEmail &&
      !(
        clean.version === 3 &&
        clean.salesLinks.some((l) => l.presentationId === d.id)
      )
    )
      throw new Error(
        `${d.domain}: add a public contact email before accepting inquiries.`,
      );
  }
  const result = {
    version: clean.version,
    ...(clean.version === 3 ? { salesLinks: clean.salesLinks } : {}),
    handle: clean.handle,
    profile: {
      name: clean.profile.name,
      headline: clean.profile.headline,
      intro: clean.profile.intro,
      interests: clean.profile.interests,
      opportunities: clean.profile.opportunities,
      contactEmail: clean.profile.contactEmail,
      links: clean.profile.links.map((v) => ({ label: v.label, url: v.url })),
    },
    collections: collections.map((v) => ({
      id: v.id,
      slug: v.slug,
      title: v.title,
      intro: v.intro,
      domainIds: v.domainIds,
    })),
    projects: projects.map((v) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      url: v.url,
      domainIds: v.domainIds,
    })),
    homepage: {
      collectionIds: clean.homepage.collectionIds,
      projectIds: clean.homepage.projectIds,
    },
    catalogue: {
      enabled: clean.catalogue.enabled,
      domainIds: clean.catalogue.enabled ? clean.catalogue.domainIds : [],
    },
    domainPresentations: domainPresentations.map((v) => ({
      id: v.id,
      domain: v.domain,
      ownership: v.ownership,
      availability: v.availability,
      description: v.description,
      askingPrice:
        v.availability === 'inquiries' && v.ownership === 'current'
          ? v.askingPrice
          : null,
      currency: v.currency,
    })),
  };
  if (
    clean.version === 3 &&
    clean.salesLinks.some((l) => !selected.includes(l.presentationId))
  )
    throw new Error('Sales links must refer to explicitly selected domains.');
  return editableOwnerSiteSchema.parse(result);
}
export const publishedOwnerSiteSchema = shape
  .extend({ publishedAt: z.number().int().positive() })
  .strict()
  .superRefine((value, ctx) => {
    uniqueRecords(value, ctx);
    try {
      const content = {
        version: value.version,
        handle: value.handle,
        profile: value.profile,
        domainPresentations: value.domainPresentations,
        collections: value.collections,
        projects: value.projects,
        homepage: value.homepage,
        catalogue: value.catalogue,
      };
      const selected = selectedSite(content);
      if (
        value.domainPresentations.length !==
          selected.domainPresentations.length ||
        value.collections.length !== selected.collections.length ||
        value.projects.length !== selected.projects.length ||
        (!value.catalogue.enabled && value.catalogue.domainIds.length) ||
        value.domainPresentations.some(
          (d) => d.availability !== 'inquiries' && d.askingPrice !== null,
        )
      )
        throw new Error('Unselected or invalid public content.');
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof Error ? error.message : 'Invalid public site.',
      });
    }
  });
export type PublishedOwnerSiteV2 = z.infer<typeof publishedOwnerSiteSchema>;
export const publishedOwnerSiteV3Schema = shape
  .extend({
    version: z.literal(3),
    salesLinks: z.array(publicLink).max(20000),
    publishedAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    uniqueRecords({ ...value, version: 2 }, ctx);
    linkIdentity(value, ctx);
    try {
      const { publishedAt: _publishedAt, ...content } = value;
      void _publishedAt;
      const selected = selectedSite({
        ...content,
        salesLinks: value.salesLinks.map((l) => ({
          presentationId: l.presentationId,
          listingId: l.listingId,
          expectedPublishedRevision: l.publishedRevision,
        })),
      });
      if (
        selected.domainPresentations.length !==
          value.domainPresentations.length ||
        selected.collections.length !== value.collections.length ||
        selected.projects.length !== value.projects.length ||
        (!value.catalogue.enabled && value.catalogue.domainIds.length) ||
        value.domainPresentations.some(
          (d) => d.availability !== 'inquiries' && d.askingPrice !== null,
        )
      )
        throw new Error('Unselected public content.');
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof Error ? error.message : 'Invalid public site.',
      });
    }
  });
export type PublishedOwnerSiteV3 = z.infer<typeof publishedOwnerSiteV3Schema>;
export type PublishedOwnerSite = PublishedOwnerSiteV2 | PublishedOwnerSiteV3;
export function editableSite(
  site: OwnerSiteDraft | PublishedOwnerSite,
): OwnerSiteDraft {
  const { publishedAt: _publishedAt, ...content } =
    'publishedAt' in site ? site : { ...site, publishedAt: undefined };
  void _publishedAt;
  return editableOwnerSiteSchema.parse(
    site.version === 3 && 'publishedAt' in site
      ? {
          ...content,
          salesLinks: site.salesLinks.map((l) => ({
            presentationId: l.presentationId,
            listingId: l.listingId,
            expectedPublishedRevision: l.publishedRevision,
          })),
        }
      : content,
  );
}
export function convertOwnerSiteV3(input: AnyDraft): OwnerSiteV3Draft {
  if (isOwnerSite(input) && input.version === 3)
    return ownerSiteV3DraftSchema.parse(input);
  return ownerSiteV3DraftSchema.parse({
    ...convertOwnerSite(input),
    version: 3,
    salesLinks: [],
  });
}
export const anyPublishedSchema = z.union([
  publishedOwnerSiteSchema,
  publishedOwnerSiteV3Schema,
  publishedSchema,
]);
export type AnyPublished = z.infer<typeof anyPublishedSchema>;
export const emptyOwnerSite = (): OwnerSiteV2Draft => ({
  version: 2,
  handle: 'portfolio',
  profile: {
    name: 'My site',
    headline: '',
    intro: '',
    interests: [],
    opportunities: [],
    contactEmail: '',
    links: [],
  },
  domainPresentations: [],
  collections: [],
  projects: [],
  homepage: { collectionIds: [], projectIds: [] },
  catalogue: { enabled: false, domainIds: [] },
});

/** Deterministic conversion is a draft operation, never a publication. */
export function convertOwnerSite(input: AnyDraft): OwnerSiteV2Draft {
  if (isOwnerSite(input)) {
    if (input.version === 3) throw new Error('Use the compatible v3 editor.');
    return ownerSiteDraftSchema.parse(input);
  }
  const draft = draftSchema.parse(input);
  const result = emptyOwnerSite();
  result.handle = draft.handle;
  result.profile = {
    ...result.profile,
    name: draft.title,
    intro: draft.intro,
    contactEmail: draft.contactEmail,
  };
  result.domainPresentations = draft.listings.map((v, i) => ({
    id: `domain-${i + 1}`,
    domain: v.domain,
    ownership: v.visibility === 'historical' ? 'historical' : 'current',
    availability: v.visibility === 'inquiry' ? 'inquiries' : 'not-for-sale',
    description: v.description,
    askingPrice: v.askingPrice,
    currency: v.currency,
  }));
  const groups = new Map<string, string[]>();
  draft.listings.forEach((v, i) => {
    if (v.visibility === 'private') return;
    for (const title of new Set(
      v.collection
        .split(';')
        .map((v) => v.trim())
        .filter(Boolean),
    ))
      groups.set(title, [...(groups.get(title) ?? []), `domain-${i + 1}`]);
  });
  result.collections = [...groups].map(([title, domainIds], i) => ({
    id: `collection-${i + 1}`,
    slug: `collection-${i + 1}`,
    title,
    intro: '',
    domainIds,
  }));
  result.homepage.collectionIds = result.collections.map((v) => v.id);
  result.catalogue = {
    enabled: true,
    domainIds: draft.listings.flatMap((v, i) =>
      v.visibility === 'private' ? [] : [`domain-${i + 1}`],
    ),
  };
  return ownerSiteDraftSchema.parse(result);
}

export function previewOwnerSite(draft: OwnerSiteDraft): PublishedOwnerSite {
  const selected = selectedSite(draft);
  return selected.version === 2
    ? { ...selected, publishedAt: 1 }
    : {
        ...selected,
        publishedAt: 1,
        salesLinks: selected.salesLinks.map((l) => ({
          presentationId: l.presentationId,
          listingId: l.listingId,
          publishedRevision: l.expectedPublishedRevision,
          mode: 'inquiry' as const,
          publicPrice: null,
          publicMinimumOffer: null,
        })),
      };
}
