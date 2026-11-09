import { z } from 'zod';
import {
  publishedSaleSchema,
  saleMoneySchema,
  salePriceLabel,
} from './hosted-sales';
import { renderEmail } from './email-layout';

/** Only public terms and conversation content; never owner notes or portfolio data. */
export const salesEmailContextSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: z.string().email().max(254),
    message: z.string().max(4000),
    offer: saleMoneySchema.nullable(),
    snapshot: publishedSaleSchema,
    receivedAt: z.number().int().nonnegative(),
    latest: z
      .object({
        body: z.string().max(4000),
        direction: z.enum(['reply', 'buyer']),
        createdAt: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SalesEmailContext = z.infer<typeof salesEmailContextSchema>;

export function renderSalesEmail(
  mail: {
    subject: string;
    url: string;
    reference: string;
    context?: SalesEmailContext;
  },
  kind: string,
  options: { replyByEmail?: boolean } = {},
) {
  const c = mail.context;
  const heading =
    kind === 'verification'
      ? 'Confirm your inquiry'
      : kind === 'buyer-reply'
        ? 'Your conversation has an update'
        : c?.latest
          ? 'A new message about your domain'
          : 'A confirmed inquiry';
  const subject = c
    ? `${kind === 'verification' ? 'Confirm your inquiry' : kind === 'buyer-reply' ? 'Reply' : c.latest ? 'New message' : 'New inquiry'} · ${c.snapshot.domain}`
    : mail.subject;
  const details = c
    ? [
        ['Domain', c.snapshot.domain],
        ['Name', c.name],
        ['Email', c.email],
        ['Offer', c.offer ? salePriceLabel(c.offer) : 'No offer submitted'],
        ['Published price', salePriceLabel(c.snapshot.publicPrice)],
        [
          'Received',
          new Date(c.receivedAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
          }) + ' UTC',
        ],
        ...(c.snapshot.destination
          ? [
              ['Provider', c.snapshot.destination.provider],
              ['Provider link', c.snapshot.destination.url],
            ]
          : []),
      ]
    : [];
  const blocks = c
    ? [
        {
          label: 'Original inquiry',
          body: c.message || 'An offer was submitted without a message.',
        },
        ...(c.latest
          ? [
              {
                label:
                  c.latest.direction === 'reply' ? 'Reply' : 'Latest message',
                body: c.latest.body,
              },
            ]
          : []),
      ]
    : [];
  const action =
    kind === 'verification' ? 'Confirm email address' : 'View conversation';
  const note =
    kind === 'verification'
      ? 'Confirm your email address to continue this conversation. This does not accept an offer or create a purchase contract.'
      : options.replyByEmail
        ? 'Reply to this email to continue. Your new reply text is saved to this conversation and sent to the other participant. This private reply address expires in seven days. Do not forward it. Send text without attachments; inline signature images are omitted.'
        : 'Keep this email for the inquiry details. The conversation link gives access only to this inquiry; do not forward it.';
  return renderEmail({
    subject,
    preheader:
      kind === 'verification'
        ? 'Confirm your email to continue this inquiry.'
        : 'Your domain conversation has an update.',
    heading: c?.snapshot.domain ?? heading,
    intro: heading,
    details: details as [string, string][],
    sections: blocks,
    note,
    action: { label: action, url: mail.url },
    reference: mail.reference,
    reason:
      kind === 'verification'
        ? 'You submitted a domain inquiry using this email address.'
        : 'You are a participant in this domain conversation.',
  });
}
