import { z } from 'zod';

const webAddress = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Enter a full http:// or https:// address without sign-in details.');

export const inquiryRoleLabels = {
  individual: 'For myself',
  organization: 'On behalf of an organization',
  representative: 'On behalf of a client',
} as const;
export const buyerDetailsSchema = z
  .object({
    profileUrl: webAddress.optional(),
    company: z.string().trim().max(150).optional(),
    companyWebsite: webAddress.optional(),
    inquiryRole: z
      .enum(['', 'individual', 'organization', 'representative'])
      .optional(),
  })
  .strict();
export type BuyerDetails = z.infer<typeof buyerDetailsSchema>;

export const inquiryRequestSchema = z
  .object({
    receivedAt: z.number().int().nonnegative(),
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(1024).nullable(),
    language: z.string().max(256).nullable(),
    country: z.string().max(100).nullable(),
    region: z.string().max(100).nullable(),
    city: z.string().max(100).nullable(),
    timezone: z.string().max(100).nullable(),
  })
  .strict();
export type InquiryRequest = z.infer<typeof inquiryRequestSchema>;

/** Called only at the external request boundary, before internal service hops. */
export function captureInquiryRequest(request: Request): InquiryRequest {
  const cf = Reflect.get(request, 'cf') as Record<string, unknown> | undefined;
  const bounded = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : null;
  return inquiryRequestSchema.parse({
    receivedAt: Date.now(),
    ipAddress: bounded(request.headers.get('cf-connecting-ip'), 64),
    userAgent: bounded(request.headers.get('user-agent'), 1024),
    language: bounded(request.headers.get('accept-language'), 256),
    country: bounded(cf?.country, 100),
    region: bounded(cf?.region, 100),
    city: bounded(cf?.city, 100),
    timezone: bounded(cf?.timezone, 100),
  });
}

/** Browser strings are client-reported context, never identity verification. */
export function inquiryBrowser(userAgent: string | null): string {
  if (!userAgent) return 'Not available';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Other browser';
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} · ${os}`;
}
