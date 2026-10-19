import { z } from 'zod';
import { Accounts } from './accounts';
import { workspaceSchema } from './workspaces';
import {
  salesInternal,
  salesMailReady,
  salesRecipient,
  drainSalesWorkspace,
} from './sales-notifications';
import { parseRelayEmail, RelayInputError } from '../../hosted/email';
import { relayMessageSchema } from '../shared/sales-relay';
import { relaySettings } from './sales-relay-address';

/** Gmail may use its base mailbox as the SMTP envelope for a plus-address From.
 * This permits that transport discrepancy only; the exact From still has to
 * match the original private grant. Other providers and dot aliases stay exact. */
function gmailBaseMailbox(address: string): string | null {
  return (
    /^([^+@]+)(?:\+[^@]+)?@gmail\.com$/i.exec(address)?.[1].toLowerCase() ??
    null
  );
}

/** Alias possession authorizes message posting only; headers are never identity proofs. */
export async function receiveSalesReply(
  message: ForwardableEmailMessage,
  env: HostedEnv,
  ctx: ExecutionContext,
) {
  if (!salesMailReady(env) || env.SALES_RELAY_ENABLED !== 'true') {
    message.setReject(
      'Conversation replies are temporarily unavailable. Use the conversation link.',
    );
    return;
  }
  const workspaces = workspaceSchema.parse(JSON.parse(env.WORKSPACES));
  const [local, domain, extra] = message.to.toLowerCase().split('@');
  const detail = local?.match(
    /^([a-z0-9_-]{1,5})\+([a-f0-9]{8})\.([a-f0-9]{48})$/,
  );
  const candidates = detail
    ? workspaces.filter((w) => w.id.slice(0, 8) === detail[2])
    : [];
  if (extra || candidates.length !== 1 || !detail) {
    message.setReject('Conversation reply address unavailable.');
    return;
  }
  const workspace = candidates[0].id,
    settings = relaySettings(env, workspace);
  if (!settings || detail[1] !== settings.local || domain !== settings.domain) {
    message.setReject('Conversation reply address unavailable.');
    return;
  }
  const envelope = z.string().email().max(254).safeParse(message.from);
  if (
    !envelope.success ||
    message.rawSize <= 0 ||
    message.rawSize > 256 * 1024
  ) {
    message.setReject('Send a text reply under 256 KiB.');
    return;
  }
  const owner = await env.CONTROL_DB.prepare(
    'SELECT u.email FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(workspace)
    .first<{ email: string }>();
  if (!owner || !(await salesRecipient(env, workspace, owner.email)).verified) {
    message.setReject('Conversation reply address unavailable.');
    return;
  }
  const admission = {
    token: detail[3],
    from: envelope.data.toLowerCase(),
    ownerEmail: owner.email,
  };
  let parsed: Awaited<ReturnType<typeof parseRelayEmail>> | undefined;
  let checked = await salesInternal(env, workspace, 'relay-check', admission);
  // A transient failure or rate limit is authoritative. Only retry a denied
  // participant check for a narrowly equivalent Gmail transport identity.
  if (checked.status === 403 && gmailBaseMailbox(admission.from)) {
    try {
      parsed = await parseRelayEmail(message);
      if (
        parsed.from !== admission.from &&
        gmailBaseMailbox(parsed.from) === gmailBaseMailbox(admission.from)
      ) {
        admission.from = parsed.from;
        checked = await salesInternal(env, workspace, 'relay-check', admission);
      }
    } catch (error) {
      if (!(error instanceof RelayInputError)) throw error;
      message.setReject(error.message);
      return;
    }
  }
  if (!checked.ok) {
    if (checked.status >= 500)
      throw Error('Reply storage temporarily unavailable');
    message.setReject(
      'Reply address expired, blocked or rate-limited. Open the conversation link.',
    );
    return;
  }
  if (
    !(await new Accounts(env.CONTROL_DB, env.AUTH_PEPPER).rateLimit(
      `sales-relay:${workspace}`,
      40,
    ))
  ) {
    message.setReject(
      'Reply limit reached. Use the conversation link or retry later.',
    );
    return;
  }
  try {
    parsed ??= await parseRelayEmail(message);
    if (parsed.from !== admission.from)
      throw new RelayInputError(
        'From must match the address that received this private reply address.',
      );
    const input = relayMessageSchema.safeParse({ ...admission, ...parsed });
    if (!input.success)
      throw new RelayInputError(
        'Reply must contain a valid Message-ID and 1–4000 characters of text.',
      );
    const saved = await salesInternal(
      env,
      workspace,
      'relay-message',
      input.data,
    );
    if (!saved.ok) {
      if (saved.status >= 500)
        throw Error('Reply storage temporarily unavailable');
      throw new RelayInputError(
        'Reply address expired or this message changed. Open the conversation link.',
      );
    }
  } catch (e) {
    if (e instanceof RelayInputError) {
      message.setReject(e.message);
      return;
    }
    throw e;
  }
  // Logging and the opposite participant's intent are durable before SMTP acceptance.
  ctx.waitUntil(drainSalesWorkspace(env, workspace).catch(() => {}));
}
