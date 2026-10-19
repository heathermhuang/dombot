import { z } from 'zod';
import { createHmac, createHash } from 'node:crypto';
import { newReplyAddress, relayDisplayName } from './sales-relay-address';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { workspaceSchema, workspaceService, gatewayKey } from './workspaces';
import {
  renderSalesEmail,
  salesEmailContextSchema,
} from '../shared/sales-email';

const leasedSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            kind: z.enum(['verification', 'seller-alert', 'buyer-reply']),
            leadId: z.string().uuid(),
            lease: z.string().uuid(),
            attempts: z.number(),
            mail: z
              .object({
                recipient: z.string().email().nullable(),
                subject: z.string().max(200),
                url: z.string().url(),
                reference: z.string().uuid(),
                context: salesEmailContextSchema.optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export const salesRecipientHash = (env: HostedEnv, email: string) =>
  createHmac('sha256', env.AUTH_PEPPER)
    .update(`sales-recipient:v1:${email.toLowerCase()}`)
    .digest('hex');
export async function salesRecipient(
  env: HostedEnv,
  workspace: string,
  email: string,
) {
  const verified = await env.CONTROL_DB.prepare(
    'SELECT verified_at FROM sales_verified_recipients WHERE workspace_id=? AND email_hash=?',
  )
    .bind(workspace, salesRecipientHash(env, email))
    .first();
  const [local, domain] = email.split('@');
  return { address: `${local.slice(0, 2)}…@${domain}`, verified: !!verified };
}
export async function salesInternal(
  env: HostedEnv,
  workspace: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const configured = workspaceSchema
    .parse(JSON.parse(env.WORKSPACES))
    .find((w) => w.id === workspace);
  if (!configured) throw new Error('Unknown sales workspace');
  const r = new Request(
    new URL(`/sales-internal/${path}`, env.CANONICAL_ORIGIN),
    {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    },
  );
  r.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(gatewayKey(env, workspace), workspace, null, r, {
      purpose: 'sales-notifications',
    }),
  );
  return workspaceService(env, configured.binding).fetch(r);
}
export function salesMailReady(env: HostedEnv): boolean {
  return (
    env.SALES_MAIL_ENABLED === 'true' &&
    env.SALES_MAIL_DELIVERY_VERIFIED === 'true' &&
    !!env.SALES_EMAIL &&
    env.SALES_EMAIL_FROM === 'sales@mail.domains.domains' &&
    Number(env.SALES_MAIL_DAILY_LIMIT) > 0 &&
    Number(env.SALES_MAIL_MONTHLY_LIMIT) > 0
  );
}
async function reserveBudget(
  env: HostedEnv,
  workspace: string,
): Promise<boolean> {
  const now = new Date().toISOString(),
    day = Number(env.SALES_MAIL_DAILY_LIMIT),
    month = Number(env.SALES_MAIL_MONTHLY_LIMIT);
  const buckets = [
    {
      id: `global:day:${now.slice(0, 10)}`,
      limit: day,
      expires: Date.now() + 2 * 86400_000,
    },
    {
      id: `global:month:${now.slice(0, 7)}`,
      limit: month,
      expires: Date.now() + 32 * 86400_000,
    },
    {
      id: `${workspace}:day:${now.slice(0, 10)}`,
      limit: Math.min(day, 30),
      expires: Date.now() + 2 * 86400_000,
    },
  ];
  const r = await env.CONTROL_DB.batch(
    buckets.map((b) =>
      env.CONTROL_DB.prepare(
        'INSERT INTO sales_email_budgets(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',
      ).bind(b.id, b.expires),
    ),
  );
  return r.every(
    (result, i) =>
      Number((result.results[0] as { count: number }).count) <=
      buckets[i].limit,
  );
}
export async function drainSalesWorkspace(
  env: HostedEnv,
  workspace: string,
): Promise<void> {
  if (!salesMailReady(env)) return;
  const owner = await env.CONTROL_DB.prepare(
    'SELECT u.email FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(workspace)
    .first<{ email: string }>();
  if (!owner) return;
  if (!(await salesRecipient(env, workspace, owner.email)).verified) return;
  const due = await salesInternal(env, workspace, 'due');
  if (!due.ok) return;
  const dueAt = ((await due.json()) as { dueAt: number | null }).dueAt;
  if (dueAt === null || dueAt > Date.now()) return;
  const response = await salesInternal(env, workspace, 'lease', {});
  if (!response.ok) return;
  const batch = leasedSchema.parse(await response.json());
  for (const item of batch.items) {
    // Recheck suspension before each send; closure never enrolls another recipient.
    if (
      !(await env.CONTROL_DB.prepare(
        'SELECT id FROM workspaces WHERE id=? AND enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=workspaces.id)',
      )
        .bind(workspace)
        .first())
    )
      return;
    let state: 'accepted' | 'retryable' | 'unknown' | 'suppressed' | 'failed' =
        'unknown',
      receipt: string | null = null;
    const attempt = `${workspace}:${item.id}:${item.lease}`;
    const base = `${env.CANONICAL_ORIGIN}/w/${workspace}/`;
    if (!item.mail.url.startsWith(base)) {
      state = 'suppressed';
    } else if (!(await reserveBudget(env, workspace))) {
      state = 'retryable';
    } else {
      let replyAddress: ReturnType<typeof newReplyAddress> = null;
      try {
        replyAddress =
          item.mail.context && item.kind !== 'verification'
            ? newReplyAddress(env, workspace)
            : null;
      } catch {
        await salesInternal(env, workspace, 'ack', {
          id: item.id,
          lease: item.lease,
          state: 'retryable',
          receipt: null,
          retryAfter: 3600_000,
        });
        continue;
      }
      const grant = await env.CONTROL_DB.prepare(
        "INSERT INTO sales_delivery_receipts(attempt_key,workspace_id,outbox_id,state,created_at,updated_at) VALUES(?,?,?,'sending',?,?) ON CONFLICT DO NOTHING RETURNING attempt_key",
      )
        .bind(attempt, workspace, item.id, Date.now(), Date.now())
        .first();
      if (!grant) continue; // Preserve an ambiguous attempt for reconciliation.
      const claim = await salesInternal(env, workspace, 'claim', {
        id: item.id,
        lease: item.lease,
        ...(replyAddress
          ? {
              emailRelay: {
                tokenHash: createHash('sha256')
                  .update(replyAddress.raw)
                  .digest('base64url'),
                purpose:
                  item.kind === 'seller-alert' ? 'email-owner' : 'email-buyer',
                participant:
                  item.kind === 'seller-alert'
                    ? owner.email
                    : item.mail.context!.email,
                expiresAt: Date.now() + 7 * 86400_000,
              },
            }
          : {}),
      });
      if (!claim.ok || !((await claim.json()) as { ok: boolean }).ok) {
        await env.CONTROL_DB.prepare(
          "UPDATE sales_delivery_receipts SET state='suppressed',updated_at=? WHERE attempt_key=?",
        )
          .bind(Date.now(), attempt)
          .run();
        continue;
      }
      try {
        const content = renderSalesEmail(item.mail, item.kind, {
          replyByEmail: !!replyAddress,
        });
        const result = await env.SALES_EMAIL!.send({
          from: { email: env.SALES_EMAIL_FROM!, name: 'domains.domains' },
          to: item.kind === 'seller-alert' ? owner.email : item.mail.recipient!,
          ...(replyAddress
            ? {
                replyTo: {
                  email: replyAddress.address,
                  name:
                    item.kind === 'seller-alert'
                      ? relayDisplayName(item.mail.context!.name)
                      : 'Domain conversation · domains.domains',
                },
                headers: { 'X-Auto-Response-Suppress': 'All' },
              }
            : item.mail.context && item.kind === 'seller-alert'
              ? {
                  replyTo: item.mail.context.email,
                }
              : {}),
          ...content,
        });
        state = 'accepted';
        receipt = result.messageId;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : null;
        const temporary = ['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED'];
        const rejected = [
          'E_VALIDATION_ERROR',
          'E_FIELD_MISSING',
          'E_TOO_MANY_RECIPIENTS',
          'E_TOO_MANY_ATTACHMENTS',
          'E_SENDER_NOT_VERIFIED',
          'E_RECIPIENT_NOT_ALLOWED',
          'E_SENDER_DOMAIN_NOT_AVAILABLE',
          'E_CONTENT_TOO_LARGE',
          'E_HEADER_NOT_ALLOWED',
          'E_HEADER_USE_API_FIELD',
          'E_HEADER_VALUE_INVALID',
          'E_HEADER_VALUE_TOO_LONG',
          'E_HEADER_NAME_INVALID',
          'E_HEADERS_TOO_LARGE',
          'E_HEADERS_TOO_MANY',
        ];
        if (typeof code === 'string' && temporary.includes(code)) {
          state = 'retryable';
          receipt = code;
        } else if (code === 'E_RECIPIENT_SUPPRESSED') {
          state = 'suppressed';
          receipt = code;
        } else if (typeof code === 'string' && rejected.includes(code)) {
          state = 'failed';
          receipt = code;
        } else state = 'unknown';
      }
      await env.CONTROL_DB.prepare(
        'UPDATE sales_delivery_receipts SET state=?,provider_receipt=?,updated_at=? WHERE attempt_key=?',
      )
        .bind(state, receipt, Date.now(), attempt)
        .run();
    }
    await salesInternal(env, workspace, 'ack', {
      id: item.id,
      lease: item.lease,
      state,
      receipt,
      retryAfter: state === 'retryable' ? 3600_000 : 60_000,
    });
  }
}
/** Deterministic bounded scan: due checkpoints first; no model or full audit. */
export async function drainSales(env: HostedEnv): Promise<void> {
  if (!salesMailReady(env)) return;
  const workspaces = workspaceSchema.parse(JSON.parse(env.WORKSPACES));
  let failed = false;
  for (const w of workspaces.slice(0, 32)) {
    try {
      const checkpoint = await env.CONTROL_DB.prepare(
        'SELECT next_check_at FROM sales_dispatch_checkpoints WHERE workspace_id=?',
      )
        .bind(w.id)
        .first<{ next_check_at: number }>();
      if (checkpoint && checkpoint.next_check_at > Date.now()) continue;
      await drainSalesWorkspace(env, w.id);
      await env.CONTROL_DB.prepare(
        'INSERT INTO sales_dispatch_checkpoints(workspace_id,next_check_at,updated_at) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET next_check_at=excluded.next_check_at,updated_at=excluded.updated_at',
      )
        .bind(
          w.id,
          Math.floor(Date.now() / 120_000) * 120_000 + 120_000,
          Date.now(),
        )
        .run();
    } catch {
      failed = true;
    }
  }
  if (failed) throw Error('Some inquiry dispatchers need attention.');
}
