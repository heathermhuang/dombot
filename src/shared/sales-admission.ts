import { z } from 'zod';

export const salesAdmissionSchema = z.discriminatedUnion('purpose', [
  z
    .object({
      purpose: z.literal('sales-owner'),
      recipientVerified: z.boolean(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal('sales-public'),
      host: z.string().max(253),
      listing: z.string().uuid().nullable(),
      epoch: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ purpose: z.literal('sales-notifications') }).strict(),
  z.object({ purpose: z.literal('sales-hostnames') }).strict(),
]);
export type SalesAdmission = z.infer<typeof salesAdmissionSchema>;
export function salesPublicPath(path: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD')
    return (
      /^\/d\/[a-z0-9.-]+$/.test(path) ||
      /^\/(?:i|t)\/[A-Za-z0-9_-]{43}$/.test(path) ||
      /^\/shop\/[a-z0-9-]{1,40}(?:\/export)?$/.test(path)
    );
  return (
    method === 'POST' &&
    (/^\/d\/[a-z0-9.-]+\/inquiries$/.test(path) ||
      /^\/i\/[A-Za-z0-9_-]{43}\/confirm$/.test(path) ||
      /^\/t\/[A-Za-z0-9_-]{43}\/(?:messages|resend)$/.test(path))
  );
}
