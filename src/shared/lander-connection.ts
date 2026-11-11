import { z } from 'zod';
import { saleDomainSchema, publishedSaleSchema } from './hosted-sales';

// SalesStore hashes are 32-byte HMACs encoded as unpadded base64url.
export const landerManifestDigestSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

// Provider-complete objects remain encrypted in the tenant. Only the exact diff
// and public projection cross the owner boundary.
export const dnsRecordSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.string().max(16),
    name: z.string().max(253),
    content: z.string().max(65536),
    ttl: z.number().int().positive(),
    proxied: z.boolean().optional(),
  })
  .passthrough();
export type NativeDnsRecord = z.infer<typeof dnsRecordSchema>;
export const dnsChangeSchema = z
  .object({
    before: dnsRecordSchema.nullable(),
    after: dnsRecordSchema.omit({ id: true }).passthrough().nullable(),
  })
  .strict();
export type DnsChange = z.infer<typeof dnsChangeSchema>;
export const dnsSnapshotSchema = z
  .object({
    provider: z.enum(['cloudflare', 'dynadot']),
    accountId: z.string().max(128),
    providerAccountId: z.string().max(100),
    zoneId: z.string().regex(/^[a-f0-9]{32}$/),
    domain: saleDomainSchema,
    observedAt: z.number().int(),
    nameservers: z.array(z.string()).min(1),
    records: z.array(dnsRecordSchema),
    dnssec: z.record(z.string(), z.unknown()),
    settings: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DnsSnapshot = z.infer<typeof dnsSnapshotSchema>;
export const landerSelectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('domains'),
      domains: z.array(saleDomainSchema).min(1).max(20000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('listings'),
      ids: z.array(z.string().uuid()).min(1).max(20000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('matching-listings'),
      q: z.string().max(253),
      mode: z.string().max(20),
      state: z.string().max(30),
    })
    .strict(),
]);
export type LanderSelection = z.infer<typeof landerSelectionSchema>;
export const hostingPlanSchema = z
  .object({
    hostname: saleDomainSchema,
    epoch: z.number().int().positive(),
    challenge: z.string().min(20).max(100),
    records: z
      .array(
        z
          .object({
            type: z.literal('TXT'),
            name: z.string().max(253),
            value: z.string().max(2048),
          })
          .strict(),
      )
      .max(10),
    target: saleDomainSchema,
  })
  .strict();
export type LanderHostingPlan = z.infer<typeof hostingPlanSchema>;
export const landerPlanSchema = z
  .object({
    domain: saleDomainSchema,
    listing: z.string().uuid(),
    revision: z.string().uuid(),
    operationalRevision: z.string().uuid(),
    publicationReview: z.string().uuid().nullable(),
    publication: publishedSaleSchema,
    snapshot: dnsSnapshotSchema,
    changes: z.array(dnsChangeSchema).max(24),
    hosts: z.array(hostingPlanSchema).length(2),
    expiresAt: z.number().int(),
  })
  .strict();
export type LanderPlan = z.infer<typeof landerPlanSchema>;
export interface LanderReviewItem {
  ordinal: number;
  domain: string;
  state: string;
  reason: string | null;
  publication?: z.infer<typeof publishedSaleSchema>;
  publishes?: boolean;
  changes?: DnsChange[];
  hosts?: {
    hostname: string;
    epoch: number;
    receipt?: Record<string, unknown> | null;
  }[];
}
export interface LanderJobView {
  id: string;
  state: string;
  digest: string | null;
  total: number;
  counts: { state: string; count: number }[];
  expiresAt: number;
  items: LanderReviewItem[];
  cursor: number | null;
}
// Sorting recursively makes provider field order irrelevant without dropping
// metadata. Never use an A/AAAA answer as a service routing configuration.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
