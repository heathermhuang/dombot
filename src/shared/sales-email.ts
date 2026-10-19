import { z } from 'zod';
import { publishedSaleSchema, saleMoneySchema, salePriceLabel } from './sales';
import { salesEscape as e } from './render-sales-lander';

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
  const text = [
    heading,
    c?.snapshot.domain,
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    '',
    ...blocks.flatMap((b) => [b.label, b.body, '']),
    note,
    '',
    `${action}: ${mail.url}`,
    '',
    `Reference: ${mail.reference}`,
    'domains.domains',
  ]
    .filter((v) => v !== undefined)
    .join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;background:#f7f8f4;color:#172e25;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="max-width:600px;width:100%;margin:auto;border-collapse:collapse"><tr><td style="padding:0 0 24px;font-size:22px;font-weight:700">domains.domains</td></tr><tr><td style="background:white;border:1px solid #cbd6cd;padding:28px"><p style="font-size:13px;color:#54675c;margin:0 0 8px">${e(heading)}</p><h1 style="font-size:28px;line-height:1.2;margin:0 0 24px;overflow-wrap:anywhere">${e(c?.snapshot.domain ?? heading)}</h1><table role="presentation" style="width:100%;border-collapse:collapse">${details.map(([k, v]) => `<tr><td style="vertical-align:top;padding:7px 16px 7px 0;color:#54675c;font-size:13px">${e(k)}</td><td style="padding:7px 0;overflow-wrap:anywhere;font-size:14px">${e(v)}</td></tr>`).join('')}</table>${blocks.map((b) => `<h2 style="font-size:16px;margin:24px 0 8px">${e(b.label)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6">${e(b.body)}</div>`).join('')}<p style="line-height:1.6;margin:24px 0">${e(note)}</p><a href="${e(mail.url)}" style="display:inline-block;background:#234f3d;color:white;padding:12px 20px;text-decoration:none;border-radius:4px">${e(action)}</a></td></tr><tr><td style="padding:20px 0;color:#54675c;font-size:12px;line-height:1.6">Reference: ${e(mail.reference)}<br>domains.domains · <a href="https://domains.domains/privacy" style="color:#234f3d">Privacy</a></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
