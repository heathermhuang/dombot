import { z } from 'zod';
import {
  inquirySchema,
  publishedSaleSchema,
  conversationStatusSchema,
  saleMoneySchema,
  messageSchema,
  type SaleInquiry,
  type PublishedSale,
  type DeliveryState,
} from '../shared/sales';
import { conflict, SalesError } from '../shared/sales-review';
import { saleOutcomeSchema, SALE_RETENTION } from '../shared/sales-events';
import { SalesStore } from './sales-store';
import { sha256, toBase64Url, fromBase64Url } from './keys';
import { salesEmailContextSchema } from '../shared/sales-email';

export const leadPayloadSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: z.string().email().max(254),
    message: z.string().max(4000),
    offer: saleMoneySchema.nullable(),
    snapshot: publishedSaleSchema,
  })
  .strict();
export const bodySchema = z
  .object({
    body: z.string().min(1).max(4000),
    recipient: z.string().email().nullable(),
  })
  .strict();
const mailSchema = z
  .object({
    recipient: z.string().email().nullable(),
    subject: z.string().max(200),
    url: z.string().url(),
    reference: z.string().uuid(),
  })
  .strict();
export type SalesMail = z.infer<typeof mailSchema>;
export const tokenHash = async (s: string) => toBase64Url(await sha256(s));
const token = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
type LeadRow = {
  id: string;
  listing_id: string;
  revision: string;
  verification: string;
  status: string;
  created_at: number;
  updated_at: number;
  follow_up_at: number | null;
  sealed: string;
};
export class SalesInquiryStore {
  constructor(
    readonly sales: SalesStore,
    readonly publicBase: string,
  ) {}
  get db() {
    return this.sales.db;
  }
  async suppressed(email: string): Promise<boolean> {
    return !!(await this.db
      .prepare(
        'SELECT 1 FROM sales_suppression WHERE email_hash=? AND expires_at>?',
      )
      .bind(await this.sales.hash('suppression-email', email), Date.now())
      .first());
  }
  async reserve(
    bucket: string,
    limit: number,
    duration: number,
  ): Promise<void> {
    const now = Date.now(),
      time = Math.floor(now / duration);
    const hash = await this.sales.hash('abuse', `${bucket}:${time}`);
    const r = await this.db
      .prepare(
        'INSERT INTO sales_abuse(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',
      )
      .bind(hash, (time + 1) * duration)
      .first<{ count: number }>();
    if (!r || r.count > limit)
      throw new SalesError(
        'RATE_LIMIT',
        'Please wait before trying again. Your message is still here.',
        429,
      );
  }
  async receipt(
    input: SaleInquiry,
    listing: string,
  ): Promise<{ id: string; status: 'verification-pending' } | null> {
    const request = await this.sales.hash(
      'request',
      `${listing}:${input.idempotencyKey}`,
    );
    const r = await this.db
      .prepare('SELECT id,payload_hash FROM sales_leads WHERE request_hash=?')
      .bind(request)
      .first<{ id: string; payload_hash: string }>();
    if (!r) return null;
    if (r.payload_hash !== (await this.payloadHash(input)))
      throw conflict(
        'This request key was already used for different content.',
      );
    return { id: r.id, status: 'verification-pending' };
  }
  payloadHash(v: SaleInquiry) {
    return this.sales.hash(
      'payload',
      JSON.stringify([v.observedRevision, v.name, v.email, v.offer, v.message]),
    );
  }
  async outbox(
    id: string,
    lead: string,
    kind: string,
    mail: SalesMail,
    message: string | null = null,
  ): Promise<D1PreparedStatement> {
    return this.db
      .prepare(
        'INSERT INTO sales_outbox(id,dedupe_key,lead_id,message_id,kind,due_at,sealed,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        id,
        lead,
        message,
        kind,
        Date.now(),
        await this.sales.seal(mailSchema.parse(mail)),
        Date.now(),
      );
  }
  tokenWrite(
    raw: string,
    purpose: 'verify' | 'thread',
    lead: string,
    days: number,
  ): Promise<D1PreparedStatement> {
    return tokenHash(raw).then((hash) =>
      this.db
        .prepare(
          'INSERT INTO sales_tokens(token_hash,purpose,lead_id,expires_at) VALUES(?,?,?,?)',
        )
        .bind(hash, purpose, lead, Date.now() + days * 86400_000),
    );
  }
  async intake(
    value: SaleInquiry,
    snapshot: PublishedSale,
  ): Promise<{ id: string; status: 'verification-pending' }> {
    const input = inquirySchema.parse(value),
      previous = await this.receipt(input, snapshot.id);
    if (previous) return previous;
    if (snapshot.revision !== input.observedRevision)
      throw new SalesError(
        'PUBLIC_REVISION_CHANGED',
        'The public terms changed. Review the latest price before sending.',
        409,
      );
    if (input.offer) {
      const currency =
        snapshot.publicPrice?.currency ??
        snapshot.publicMinimumOffer?.currency ??
        'USD';
      if (
        snapshot.mode !== 'offer' ||
        (currency && input.offer.currency !== currency)
      )
        throw new SalesError(
          'OFFER_INVALID',
          'Check the offer currency and sale mode.',
        );
      if (
        snapshot.publicMinimumOffer &&
        BigInt(input.offer.amount) < BigInt(snapshot.publicMinimumOffer.amount)
      )
        throw new SalesError(
          'OFFER_BELOW_MINIMUM',
          'This offer is below the public minimum. You can still ask a question.',
        );
    } else if (!snapshot.allowQuestions && snapshot.mode !== 'inquiry')
      throw new SalesError(
        'QUESTIONS_DISABLED',
        'Questions are currently unavailable for this listing.',
      );
    await this.reserve(`recipient:${input.email}`, 10, 86400_000);
    await this.reserve('workspace-intake', 100, 86400_000);
    const emailHash = await this.sales.hash('email', input.email);
    if (
      await this.db
        .prepare(
          'SELECT 1 FROM sales_suppression WHERE email_hash=? AND expires_at>?',
        )
        .bind(
          await this.sales.hash('suppression-email', input.email),
          Date.now(),
        )
        .first()
    )
      throw new SalesError(
        'SUPPRESSED',
        'Email sending is unavailable for this address.',
        503,
      );
    const id = crypto.randomUUID(),
      raw = token(),
      now = Date.now();
    const mail = await this.outbox(crypto.randomUUID(), id, 'verification', {
      recipient: input.email,
      subject: 'Confirm your domain inquiry',
      url: `${this.publicBase}/i/${raw}`,
      reference: id,
    });
    try {
      await this.sales.atomic([
        ...this.sales.guard(
          "EXISTS(SELECT 1 FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.id=? AND p.revision=? AND d.availability='available' AND d.control_expires_at>?)",
          [snapshot.id, input.observedRevision, now],
        ),
        this.db
          .prepare(
            "INSERT INTO sales_leads(id,listing_id,request_hash,payload_hash,email_hash,revision,verification,created_at,updated_at,sealed) VALUES(?,?,?,?,?,?,'pending',?,?,?)",
          )
          .bind(
            id,
            snapshot.id,
            await this.sales.hash(
              'request',
              `${snapshot.id}:${input.idempotencyKey}`,
            ),
            await this.payloadHash(input),
            emailHash,
            crypto.randomUUID(),
            now,
            now,
            await this.sales.seal({
              name: input.name,
              email: input.email,
              message: input.message,
              offer: input.offer,
              snapshot,
            }),
          ),
        await this.tokenWrite(raw, 'verify', id, 1),
        mail,
      ]);
    } catch (e) {
      const raced = await this.receipt(input, snapshot.id);
      if (raced) return raced;
      throw e;
    }
    return { id, status: 'verification-pending' };
  }
  async token(raw: string, purpose: 'verify' | 'thread', allowExpired = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    return this.db
      .prepare(
        `SELECT t.*,l.verification,l.status FROM sales_tokens t JOIN sales_leads l ON l.id=t.lead_id WHERE t.token_hash=? AND t.purpose=? ${allowExpired ? '' : 'AND t.revoked_at IS NULL AND t.expires_at>?'} LIMIT 1`,
      )
      .bind(
        ...(allowExpired
          ? [await tokenHash(raw), purpose]
          : [await tokenHash(raw), purpose, Date.now()]),
      )
      .first<{
        lead_id: string;
        consumed_at: number | null;
        revoked_at: number | null;
        expires_at: number;
        verification: string;
        status: string;
      }>();
  }
  async confirm(raw: string): Promise<void> {
    const grant = await this.token(raw, 'verify');
    if (!grant || grant.status === 'spam')
      throw new SalesError(
        'LINK_EXPIRED',
        'This confirmation link expired or was revoked.',
        403,
      );
    if (grant.consumed_at) return;
    const marker = crypto.randomUUID(),
      now = Date.now();
    try {
      await this.sales.atomic([
        ...this.sales.guard(
          "EXISTS(SELECT 1 FROM sales_tokens WHERE token_hash=? AND purpose='verify' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?)",
          [await tokenHash(raw), now],
        ),
        this.db
          .prepare(
            'UPDATE sales_tokens SET consumed_at=?,grant_id=? WHERE token_hash=?',
          )
          .bind(now, marker, await tokenHash(raw)),
        this.db
          .prepare(
            "UPDATE sales_leads SET verification='verified',revision=?,updated_at=? WHERE id=?",
          )
          .bind(crypto.randomUUID(), now, grant.lead_id),
        await this.outbox(grant.lead_id, grant.lead_id, 'seller-alert', {
          recipient: null,
          subject: 'A domain inquiry is confirmed',
          url: `${this.publicBase}/#/sales/inbox/${grant.lead_id}`,
          reference: grant.lead_id,
        }),
      ]);
    } catch (e) {
      if (!(await this.token(raw, 'verify'))?.consumed_at) throw e;
    }
  }
  async lead(id: string) {
    const row = await this.db
      .prepare('SELECT * FROM sales_leads WHERE id=?')
      .bind(id)
      .first<LeadRow>();
    if (!row) throw new SalesError('MISSING', 'Inquiry not found.', 404);
    return {
      ...row,
      payload: await this.sales.open(row.sealed, leadPayloadSchema),
    };
  }
  async list(cursor = '', status = '', verification = '') {
    let position: [number, string] = [Number.MAX_SAFE_INTEGER, ''];
    if (cursor) {
      try {
        position = z
          .tuple([z.number().int().nonnegative(), z.string().uuid()])
          .parse(JSON.parse(new TextDecoder().decode(fromBase64Url(cursor))));
      } catch {
        throw new SalesError('CURSOR_INVALID', 'Invalid inbox cursor.');
      }
    }
    const rows = await this.db
      .prepare(
        "SELECT id FROM sales_leads WHERE (updated_at<? OR (updated_at=? AND id>?)) AND (?='' OR status=?) AND (?='' OR verification=?) ORDER BY updated_at DESC,id LIMIT 101",
      )
      .bind(
        position[0],
        position[0],
        position[1],
        status,
        status,
        verification,
        verification,
      )
      .all<{ id: string }>();
    const page = await Promise.all(
      rows.results.slice(0, 100).map(async (r) => {
        const l = await this.lead(r.id);
        return {
          id: l.id,
          domain: l.payload.snapshot.domain,
          name: l.payload.name,
          offer: l.payload.offer,
          revision: l.revision,
          verification: l.verification,
          status: l.status,
          updatedAt: l.updated_at,
          followUpAt: l.follow_up_at,
        };
      }),
    );
    return {
      items: page,
      cursor:
        rows.results.length > 100
          ? toBase64Url(
              new TextEncoder().encode(
                JSON.stringify([page.at(-1)!.updatedAt, page.at(-1)!.id]),
              ),
            )
          : null,
    };
  }
  async thread(id: string, buyer = false, cursor = '') {
    const l = await this.lead(id);
    let before = 0;
    if (cursor) {
      try {
        const position = await this.sales.open(
          cursor.replaceAll('-', '+').replaceAll('_', '/'),
          z
            .object({
              lead: z.string().uuid(),
              buyer: z.boolean(),
              before: z.number().int().positive(),
            })
            .strict(),
        );
        if (position.lead !== id || position.buyer !== buyer)
          throw new Error('scope');
        before = position.before;
      } catch {
        throw new SalesError(
          'CURSOR_INVALID',
          'This message cursor is invalid or expired.',
        );
      }
    }
    const rows = await this.db
      .prepare(
        `SELECT id,direction,created_at,sealed,sequence FROM sales_messages WHERE lead_id=? AND (?=0 OR sequence<?) ${buyer ? "AND direction!='private-note'" : ''} ORDER BY sequence DESC LIMIT 101`,
      )
      .bind(id, before, before)
      .all<{
        id: string;
        direction: string;
        created_at: number;
        sealed: string;
        sequence: number;
      }>();
    const messages = await Promise.all(
      rows.results
        .slice(0, 100)
        .reverse()
        .map(async (r) => ({
          id: r.id,
          direction: r.direction,
          createdAt: r.created_at,
          body: (await this.sales.open(r.sealed, bodySchema)).body,
        })),
    );
    const common = {
      id,
      original: {
        name: l.payload.name,
        message: l.payload.message,
        offer: l.payload.offer,
        snapshot: l.payload.snapshot,
      },
      messages,
      cursor:
        rows.results.length > 100
          ? (
              await this.sales.seal({
                lead: id,
                buyer,
                before: rows.results[99].sequence,
              })
            )
              .replaceAll('+', '-')
              .replaceAll('/', '_')
          : null,
    };
    if (buyer) return common;
    const deliveries = await this.db
      .prepare(
        'SELECT id,message_id,kind,state,attempts,updated_at FROM sales_outbox WHERE lead_id=? ORDER BY updated_at DESC LIMIT 100',
      )
      .bind(id)
      .all();
    const events = await this.db
      .prepare(
        "SELECT id,sealed,created_at FROM sales_events WHERE lead_id=? AND kind='outcome' ORDER BY created_at,id LIMIT 100",
      )
      .bind(id)
      .all<{ id: string; sealed: string; created_at: number }>();
    const outcomes = await Promise.all(
      events.results.map(async (r) => ({
        id: r.id,
        createdAt: r.created_at,
        ...(await this.sales.open(r.sealed, saleOutcomeSchema)),
      })),
    );
    return {
      ...common,
      email: l.payload.email,
      revision: l.revision,
      verification: l.verification,
      status: l.status,
      followUpAt: l.follow_up_at,
      deliveries: deliveries.results,
      outcomes,
    };
  }
  async message(
    id: string,
    value: z.infer<typeof messageSchema>,
    buyer = false,
  ): Promise<{ id: string }> {
    const input = messageSchema.parse(value),
      l = await this.lead(id);
    const direction = buyer ? 'buyer' : input.direction;
    if (direction === 'reply' && (await this.suppressed(l.payload.email)))
      throw new SalesError('BLOCKED', 'This recipient is blocked.', 403);
    const hash = await this.sales.hash(
      'message-request',
      `${id}:${input.idempotencyKey}`,
    );
    const digest = await this.sales.hash(
      'message-payload',
      JSON.stringify([direction, input.body]),
    );
    const old = await this.db
      .prepare(
        'SELECT id,payload_hash FROM sales_messages WHERE request_hash=?',
      )
      .bind(hash)
      .first<{ id: string; payload_hash: string }>();
    if (old) {
      if (old.payload_hash !== digest) throw conflict();
      return { id: old.id };
    }
    if (l.revision !== input.revision) throw conflict();
    if (
      direction !== 'private-note' &&
      (l.verification !== 'verified' || l.status === 'spam')
    )
      throw new SalesError(
        'NOT_VERIFIED',
        'Only verified, unblocked inquiries can receive replies.',
        403,
      );
    const message = crypto.randomUUID(),
      raw = token(),
      now = Date.now();
    const statements = [
      ...this.sales.guard(
        'EXISTS(SELECT 1 FROM sales_leads WHERE id=? AND revision=?)',
        [id, input.revision],
      ),
      this.db
        .prepare(
          'INSERT INTO sales_messages(id,lead_id,request_hash,payload_hash,direction,created_at,sealed,sequence) SELECT ?,?,?,?,?,?,?,COALESCE(MAX(sequence),0)+1 FROM sales_messages WHERE lead_id=?',
        )
        .bind(
          message,
          id,
          hash,
          digest,
          direction,
          now,
          await this.sales.seal({
            body: input.body,
            recipient: direction === 'reply' ? l.payload.email : null,
          }),
          id,
        ),
      this.db
        .prepare('UPDATE sales_leads SET revision=?,updated_at=? WHERE id=?')
        .bind(crypto.randomUUID(), now, id),
    ];
    if (direction === 'reply')
      statements.push(
        this.db
          .prepare(
            "UPDATE sales_tokens SET revoked_at=? WHERE lead_id=? AND purpose='thread' AND revoked_at IS NULL",
          )
          .bind(now, id),
        await this.tokenWrite(raw, 'thread', id, 7),
        await this.outbox(
          message,
          id,
          'buyer-reply',
          {
            recipient: l.payload.email,
            subject: 'A reply to your domain inquiry',
            url: `${this.publicBase}/t/${raw}`,
            reference: id,
          },
          message,
        ),
      );
    if (direction === 'buyer')
      statements.push(
        await this.outbox(
          message,
          id,
          'seller-alert',
          {
            recipient: null,
            subject: 'New message about a domain',
            url: `${this.publicBase}/#/sales/inbox/${id}`,
            reference: id,
          },
          message,
        ),
      );
    await this.sales.atomic(statements);
    return { id: message };
  }
  async update(
    id: string,
    revision: string,
    status: z.infer<typeof conversationStatusSchema>,
    followUpAt: number | null,
    outcome?: z.infer<typeof saleOutcomeSchema>,
  ): Promise<void> {
    status = conversationStatusSchema.parse(status);
    const l = await this.lead(id),
      statements = [
        ...this.sales.guard(
          'EXISTS(SELECT 1 FROM sales_leads WHERE id=? AND revision=?)',
          [id, revision],
        ),
      ];
    statements.push(
      this.db
        .prepare(
          'UPDATE sales_leads SET status=?,follow_up_at=?,revision=?,updated_at=? WHERE id=?',
        )
        .bind(status, followUpAt, crypto.randomUUID(), Date.now(), id),
    );
    if (status === 'spam')
      statements.push(
        this.db
          .prepare(
            'INSERT INTO sales_suppression(email_hash,expires_at,sealed) VALUES(?,?,?) ON CONFLICT(email_hash) DO UPDATE SET expires_at=excluded.expires_at,sealed=excluded.sealed',
          )
          .bind(
            await this.sales.hash('suppression-email', l.payload.email),
            Date.now() + SALE_RETENTION.suppressionMs,
            await this.sales.seal({ email: l.payload.email }),
          ),
        this.db
          .prepare('UPDATE sales_tokens SET revoked_at=? WHERE lead_id=?')
          .bind(Date.now(), id),
        this.db
          .prepare(
            "UPDATE sales_outbox SET state='suppressed',updated_at=? WHERE lead_id=? AND (state IN ('queued','retryable') OR (state='leased' AND claimed_at IS NULL))",
          )
          .bind(Date.now(), id),
      );
    if (status !== 'spam' && l.status === 'spam')
      statements.push(
        this.db
          .prepare('DELETE FROM sales_suppression WHERE email_hash=?')
          .bind(await this.sales.hash('suppression-email', l.payload.email)),
      );
    if (outcome) {
      outcome = saleOutcomeSchema.parse(outcome);
      statements.push(
        this.db
          .prepare(
            'INSERT INTO sales_events(id,listing_id,lead_id,kind,created_at,sealed) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            l.listing_id,
            id,
            'outcome',
            Date.now(),
            await this.sales.seal(outcome),
          ),
      );
      if (
        ['payment-reported', 'transfer-reported', 'completed'].includes(
          outcome.state,
        )
      )
        statements.push(
          this.db
            .prepare(
              "UPDATE sale_drafts SET availability='sold',operational_revision=? WHERE id=?",
            )
            .bind(crypto.randomUUID(), l.listing_id),
        );
    }
    await this.sales.atomic(statements);
  }
  async resend(raw: string, purpose: 'thread' | 'verify'): Promise<void> {
    const old = await this.token(raw, purpose, true);
    if (
      !old ||
      old.revoked_at ||
      old.status === 'spam' ||
      old.expires_at < Date.now() - 30 * 86400_000
    )
      return;
    if (purpose === 'verify' && old.verification !== 'pending') return;
    await this.reserve(`resend-hour:${old.lead_id}`, 3, 3600_000);
    await this.reserve(`resend-day:${old.lead_id}`, 5, 86400_000);
    const l = await this.lead(old.lead_id),
      next = token();
    await this.sales.atomic([
      ...this.sales.guard(
        'EXISTS(SELECT 1 FROM sales_tokens WHERE token_hash=? AND revoked_at IS NULL)',
        [await tokenHash(raw)],
      ),
      this.db
        .prepare(
          'UPDATE sales_tokens SET revoked_at=? WHERE lead_id=? AND purpose=?',
        )
        .bind(Date.now(), l.id, purpose),
      this.obsoleteLinkMail(l.id, purpose),
      await this.tokenWrite(next, purpose, l.id, purpose === 'thread' ? 7 : 1),
      await this.outbox(
        crypto.randomUUID(),
        l.id,
        purpose === 'thread' ? 'buyer-reply' : 'verification',
        {
          recipient: l.payload.email,
          subject:
            purpose === 'thread'
              ? 'Your inquiry conversation link'
              : 'Confirm your domain inquiry',
          url: `${this.publicBase}/${purpose === 'thread' ? 't' : 'i'}/${next}`,
          reference: l.id,
        },
      ),
    ]);
  }
  private obsoleteLinkMail(lead: string, purpose: 'verify' | 'thread') {
    return this.db
      .prepare(
        "UPDATE sales_outbox SET state='suppressed',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE lead_id=? AND kind=? AND (state IN ('queued','retryable') OR (state='leased' AND claimed_at IS NULL))",
      )
      .bind(
        Date.now(),
        lead,
        purpose === 'thread' ? 'buyer-reply' : 'verification',
      );
  }
  async freshLink(id: string): Promise<void> {
    const l = await this.lead(id),
      purpose = l.verification === 'verified' ? 'thread' : 'verify';
    if (l.status === 'spam')
      throw new SalesError('BLOCKED', 'This inquiry is blocked.', 403);
    if (await this.suppressed(l.payload.email))
      throw new SalesError(
        'BLOCKED',
        'This recipient is blocked. Reopen the spam conversation to unblock it.',
        403,
      );
    await this.reserve(`resend-hour:${id}`, 3, 3600_000);
    await this.reserve(`resend-day:${id}`, 5, 86400_000);
    await this.reserve(`recipient:${l.payload.email}`, 10, 86400_000);
    const raw = token();
    await this.sales.atomic([
      ...this.sales.guard(
        'EXISTS(SELECT 1 FROM sales_leads WHERE id=? AND revision=?)',
        [id, l.revision],
      ),
      this.db
        .prepare(
          'UPDATE sales_tokens SET revoked_at=? WHERE lead_id=? AND purpose=?',
        )
        .bind(Date.now(), id, purpose),
      this.obsoleteLinkMail(id, purpose),
      await this.tokenWrite(raw, purpose, id, purpose === 'thread' ? 7 : 1),
      await this.outbox(
        crypto.randomUUID(),
        id,
        purpose === 'thread' ? 'buyer-reply' : 'verification',
        {
          recipient: l.payload.email,
          subject:
            purpose === 'thread'
              ? 'Your inquiry conversation link'
              : 'Confirm your domain inquiry',
          url: `${this.publicBase}/${purpose === 'thread' ? 't' : 'i'}/${raw}`,
          reference: id,
        },
      ),
    ]);
  }
  async lease(limit = 10) {
    const now = Date.now();
    // An expired lease may have reached the provider: never automatically resend.
    await this.db
      .prepare(
        "UPDATE sales_outbox SET state='unknown',lease_token=NULL,updated_at=? WHERE state='leased' AND lease_expires_at<=?",
      )
      .bind(now, now)
      .run();
    const lease = crypto.randomUUID();
    const r = await this.db
      .prepare(
        "UPDATE sales_outbox SET state='leased',lease_token=?,lease_expires_at=?,claimed_at=NULL,attempts=attempts+1,updated_at=? WHERE id IN (SELECT id FROM sales_outbox WHERE state IN ('queued','retryable') AND due_at<=? ORDER BY due_at,id LIMIT ?) AND state IN ('queued','retryable') RETURNING id,kind,sealed,attempts,lead_id,message_id",
      )
      .bind(lease, now + 60_000, now, now, Math.min(limit, 10))
      .all<{
        id: string;
        kind: string;
        sealed: string;
        attempts: number;
        lead_id: string;
        message_id: string | null;
      }>();
    const items = await Promise.all(
      r.results.map(async (r) => ({
        id: r.id,
        kind: r.kind,
        leadId: r.lead_id,
        lease,
        attempts: r.attempts,
        mail: {
          ...(await this.sales.open(r.sealed, mailSchema)),
          context: await this.emailContext(r.lead_id, r.message_id),
        },
      })),
    );
    const allowed = [];
    for (const item of items) {
      if (item.mail.recipient && (await this.suppressed(item.mail.recipient)))
        await this.ack(item.id, item.lease, 'suppressed', null);
      else allowed.push(item);
    }
    return allowed;
  }
  async emailContext(id: string, messageId: string | null) {
    const lead = await this.lead(id);
    const latest = messageId
      ? await this.db
          .prepare(
            "SELECT direction,created_at,sealed FROM sales_messages WHERE id=? AND lead_id=? AND direction IN ('reply','buyer')",
          )
          .bind(messageId, id)
          .first<{ direction: string; created_at: number; sealed: string }>()
      : null;
    return salesEmailContextSchema.parse({
      ...lead.payload,
      receivedAt: lead.created_at,
      latest: latest
        ? {
            direction: latest.direction,
            createdAt: latest.created_at,
            body: (await this.sales.open(latest.sealed, bodySchema)).body,
          }
        : null,
    });
  }
  /** A cached lease is not permission to send. Claim once at the send boundary. */
  async claim(id: string, lease: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT sealed FROM sales_outbox WHERE id=? AND state='leased' AND lease_token=? AND lease_expires_at>? AND claimed_at IS NULL",
      )
      .bind(id, lease, Date.now())
      .first<{ sealed: string }>();
    if (!row) return false;
    const mail = await this.sales.open(row.sealed, mailSchema);
    const recipientHash = mail.recipient
      ? await this.sales.hash('suppression-email', mail.recipient)
      : '';
    const now = Date.now();
    const granted = await this.db
      .prepare(
        "UPDATE sales_outbox SET claimed_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_token=? AND lease_expires_at>? AND claimed_at IS NULL AND EXISTS(SELECT 1 FROM sales_leads l WHERE l.id=sales_outbox.lead_id AND l.status!='spam' AND ((sales_outbox.kind='verification' AND l.verification IN ('pending','expired')) OR (sales_outbox.kind IN ('seller-alert','buyer-reply') AND l.verification='verified'))) AND NOT EXISTS(SELECT 1 FROM sales_suppression WHERE email_hash=? AND expires_at>?) RETURNING id",
      )
      .bind(now, now, id, lease, now, recipientHash, now)
      .first();
    return !!granted;
  }
  async ack(
    id: string,
    lease: string,
    state: DeliveryState,
    receipt: string | null,
    retryAfter = 60_000,
  ): Promise<void> {
    if (
      !['accepted', 'retryable', 'unknown', 'failed', 'suppressed'].includes(
        state,
      )
    )
      throw new SalesError(
        'DELIVERY_INVALID',
        'Invalid delivery acknowledgement.',
      );
    const r = await this.db
      .prepare(
        "UPDATE sales_outbox SET state=CASE WHEN ?='retryable' AND attempts>=5 THEN 'failed' ELSE ? END,lease_token=NULL,lease_expires_at=NULL,provider_receipt=?,due_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_token=? AND lease_expires_at>? RETURNING id",
      )
      .bind(
        state,
        state,
        receipt,
        Date.now() + Math.max(60_000, retryAfter),
        Date.now(),
        id,
        lease,
        Date.now(),
      )
      .first();
    if (!r)
      throw conflict(
        'This delivery lease expired or belongs to another worker.',
      );
  }
  async remove(id: string, revision: string): Promise<void> {
    await this.sales.atomic([
      ...this.sales.guard(
        'EXISTS(SELECT 1 FROM sales_leads WHERE id=? AND revision=?)',
        [id, revision],
      ),
      this.db.prepare('DELETE FROM sales_leads WHERE id=?').bind(id),
      this.db.prepare('DELETE FROM sales_events WHERE lead_id=?').bind(id),
    ]);
  }
  async cleanup(): Promise<void> {
    const now = Date.now();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE sales_outbox SET state='unknown',lease_token=NULL,updated_at=? WHERE state='leased' AND lease_expires_at<=?",
        )
        .bind(now, now),
      this.db
        .prepare(
          "DELETE FROM sales_events WHERE lead_id IN (SELECT id FROM sales_leads WHERE (verification='pending' AND created_at<?) OR (verification IN ('verified','expired','blocked') AND updated_at<?))",
        )
        .bind(
          now - SALE_RETENTION.pendingMs,
          now - SALE_RETENTION.conversationMs,
        ),
      this.db
        .prepare(
          "DELETE FROM sales_leads WHERE verification='pending' AND created_at<?",
        )
        .bind(now - SALE_RETENTION.pendingMs),
      this.db
        .prepare(
          "DELETE FROM sales_leads WHERE verification IN ('verified','expired','blocked') AND updated_at<?",
        )
        .bind(now - SALE_RETENTION.conversationMs),
      this.db.prepare('DELETE FROM sales_abuse WHERE expires_at<?').bind(now),
      this.db
        .prepare('DELETE FROM sales_suppression WHERE expires_at<?')
        .bind(now),
      this.db
        .prepare('DELETE FROM sales_tokens WHERE expires_at<?')
        .bind(now - 30 * 86400_000),
      this.db
        .prepare(
          "DELETE FROM sales_jobs WHERE status='finished' AND updated_at<?",
        )
        .bind(now - 90 * 86400_000),
      this.db
        .prepare(
          'DELETE FROM sales_reviews WHERE expires_at<? AND consumed_at IS NULL',
        )
        .bind(now),
    ]);
  }
}
