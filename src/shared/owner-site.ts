import { z } from 'zod';
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
export type OwnerSiteDraft = z.infer<typeof ownerSiteDraftSchema>;
export type DomainPresentation = OwnerSiteDraft['domainPresentations'][number];
export const isOwnerSite = (
  v: PortfolioDraft | OwnerSiteDraft | PublishedPortfolio | PublishedOwnerSite,
): v is OwnerSiteDraft | PublishedOwnerSite =>
  'version' in v && v.version === 2;
export const anyDraftSchema = z.union([ownerSiteDraftSchema, draftSchema]);
export type AnyDraft = z.infer<typeof anyDraftSchema>;

/** Resolve only explicitly selected sections. Draft-only references never expand disclosure. */
export function selectedSite(draft: OwnerSiteDraft): OwnerSiteDraft {
  const clean = ownerSiteDraftSchema.parse(draft);
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
    if (d.availability === 'inquiries' && !clean.profile.contactEmail)
      throw new Error(
        `${d.domain}: add a public contact email before accepting inquiries.`,
      );
  }
  return {
    version: 2,
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
export type PublishedOwnerSite = z.infer<typeof publishedOwnerSiteSchema>;
export const anyPublishedSchema = z.union([
  publishedOwnerSiteSchema,
  publishedSchema,
]);
export type AnyPublished = z.infer<typeof anyPublishedSchema>;
export const emptyOwnerSite = (): OwnerSiteDraft => ({
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
export function convertOwnerSite(input: AnyDraft): OwnerSiteDraft {
  if (isOwnerSite(input)) return ownerSiteDraftSchema.parse(input);
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
