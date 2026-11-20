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
  const verifying = kind === 'verification';
  const event = verifying
    ? 'Confirm your inquiry'
    : kind === 'buyer-reply'
      ? 'New reply'
      : c?.latest
        ? 'New message about your domain'
        : 'New domain inquiry';
  const subject = c
    ? `${verifying ? 'Confirm your inquiry' : kind === 'buyer-reply' ? 'Reply' : c.latest ? 'New message' : 'New inquiry'} · ${c.snapshot.domain}`
    : mail.subject;
  const details: [string, string][] = [];
  if (c) {
    details.push(['Name', c.name], ['Email', c.email]);
    if (c.offer) details.push(['Offer', salePriceLabel(c.offer)]);
    if (c.snapshot.publicPrice)
      details.push(['Published price', salePriceLabel(c.snapshot.publicPrice)]);
    details.push([
      'Received',
      new Date(c.receivedAt).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }) + ' UTC',
    ]);
    if (c.snapshot.destination)
      details.push(
        ['Provider', c.snapshot.destination.provider],
        ['Provider link', c.snapshot.destination.url],
      );
  }
  const inquiry = c && {
    label: 'Original inquiry',
    body: c.message || 'An offer was submitted without a message.',
  };
  const latest = c?.latest && {
    label: c.latest.direction === 'reply' ? 'Latest reply' : 'Latest message',
    body: c.latest.body,
  };
  const note = verifying
    ? 'Any offer remains subject to agreement.'
    : options.replyByEmail
      ? 'Reply to this email to continue. Your reply is shared in the conversation. The reply address expires in 7 days. Send text only and keep the address private.'
      : 'Keep this private conversation link to yourself.';
  return renderEmail({
    subject,
    preheader: verifying
      ? 'Confirm your email to continue this inquiry.'
      : 'Your domain conversation has an update.',
    heading: event,
    intro: c?.snapshot.domain,
    lead: verifying ? undefined : latest || inquiry || undefined,
    details,
    sections: inquiry && (verifying || latest) ? [inquiry] : [],
    note,
    action: {
      label: verifying ? 'Confirm email address' : 'View conversation',
      url: mail.url,
    },
    reference: mail.reference,
    reason: verifying
      ? 'You submitted a domain inquiry using this email address.'
      : 'You are a participant in this domain conversation.',
  });
}
