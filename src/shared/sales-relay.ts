import { z } from 'zod';

export const emailRelayGrantSchema = z
  .object({
    tokenHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    purpose: z.enum(['email-owner', 'email-buyer']),
    participant: z.string().email().max(254),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type EmailRelayGrant = z.infer<typeof emailRelayGrantSchema>;
export const relayAdmissionSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{48}$/),
    from: z.string().email().max(254),
    ownerEmail: z.string().email().max(254),
  })
  .strict();
export const relayMessageSchema = relayAdmissionSchema.extend({
  messageId: z
    .string()
    .min(3)
    .max(998)
    .regex(/^<[^<>\s]+@[^<>\s]+>$/),
  body: z.string().trim().min(1).max(4000),
});
export type RelayMessage = z.infer<typeof relayMessageSchema>;

/** Do not carry routine quoted bearer credentials into the opposite participant's mail. */
export function redactRelaySecrets(text: string): string {
  return text
    .replace(
      /\b[a-z0-9_-]{1,16}\+[a-f0-9]{8}\.[a-f0-9]{48}@[a-z0-9.-]+/gi,
      '[private reply address]',
    )
    .replace(
      /https?:\/\/[^\s<>]+\/(?:i|t)\/[A-Za-z0-9_-]{43}(?:[?#][^\s<>]*)?/g,
      '[private conversation link]',
    );
}
