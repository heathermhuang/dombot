import { z } from 'zod';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
import { salesRecipient, salesRecipientHash } from './sales-notifications';
import {
  notificationPreferencesSchema,
  nextDailySlot,
} from '../shared/notification-policy';
import {
  notificationEnvelopeSchema,
  renderRenewalEmail,
} from '../shared/notification-email';
import {
  getNotificationPreferences,
  notificationUnsubscribeUrl,
} from './notification-preferences';

/** Persist work for the scheduler, which owns send leases and retry checkpoints. */
export async function wakeNotificationWorkspace(
  env: HostedEnv,
  workspace: string,
) {
  await env.CONTROL_DB.prepare(
    'UPDATE notification_preferences SET next_check_at=0,wake_generation=wake_generation+1 WHERE workspace_id=?',
  )
    .bind(workspace)
    .run();
}

export async function notificationInternal(
  env: HostedEnv,
  workspace: string,
  path: string,
  body: unknown,
) {
  const configured = await workspaceFor(env, workspace);
  if (!configured) throw Error('Portfolio notification route unavailable.');
  const request = new Request(
    `https://workspace.internal/notifications/internal/${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      request,
      { purpose: 'portfolio-notifications' },
    ),
  );
  const response = await workspaceService(env, configured.binding).fetch(
    request,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error('Portfolio notification service unavailable.');
  }
  return response;
}

/** Reserve new optional mail atomically under existing shared ceilings, with explicit headroom. */
export async function reserveNotificationEmail(env: HostedEnv) {
  const limit = (s: string | undefined) =>
    s && /^[1-9]\d*$/.test(s) ? Number(s) : 0;
  const daily = limit(env.NOTIFICATION_MAIL_DAILY_LIMIT),
    monthly = limit(env.NOTIFICATION_MAIL_MONTHLY_LIMIT),
    headroom = limit(env.NOTIFICATION_MAIL_HEADROOM);
  const total = limit(env.EMAIL_CAMPAIGN_LIMIT),
    sharedDaily = limit(env.EMAIL_CAMPAIGN_DAILY_LIMIT),
    campaign = env.EMAIL_CAMPAIGN_ID;
  if (
    !daily ||
    !monthly ||
    !headroom ||
    !total ||
    !sharedDaily ||
    !campaign ||
    !/^[a-z0-9-]{1,64}$/.test(campaign) ||
    [daily, monthly, headroom, total, sharedDaily].some(
      (v) => !Number.isSafeInteger(v) || v > 100_000,
    ) ||
    headroom >= Math.min(total, sharedDaily)
  )
    return false;
  const now = new Date(),
    day = now.toISOString().slice(0, 10),
    month = day.slice(0, 7);
  const buckets = [
    {
      key: `notifications:day:${day}`,
      max: daily,
      expires: Date.now() + 2 * 86400_000,
    },
    {
      key: `notifications:month:${month}`,
      max: monthly,
      expires: Date.now() + 32 * 86400_000,
    },
    {
      key: `campaign:${campaign}`,
      max: total - headroom,
      expires: 253402300799000,
    },
    {
      key: `campaign-day:${campaign}:${day}`,
      max: sharedDaily - headroom,
      expires: Date.now() + 2 * 86400_000,
    },
  ];
  try {
    await env.CONTROL_DB.batch(
      buckets.flatMap((b) => [
        env.CONTROL_DB.prepare(
          "INSERT INTO notification_cas_guard(id,ok) SELECT 'budget',CASE WHEN COALESCE((SELECT count FROM email_budgets WHERE bucket=?),0)<? THEN 1 ELSE 0 END ON CONFLICT(id) DO UPDATE SET ok=excluded.ok",
        ).bind(b.key, b.max),
        env.CONTROL_DB.prepare(
          'INSERT INTO email_budgets(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1',
        ).bind(b.key, b.expires),
      ]),
    );
    return true;
  } catch (error) {
    if (String(error).includes('CHECK constraint')) return false;
    throw error;
  }
}
export function notificationFailure(
  error: unknown,
): 'unknown' | 'retryable' | 'suppressed' | 'failed' {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'E_RECIPIENT_SUPPRESSED') return 'suppressed';
  if (code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED')
    return 'retryable';
  if (
    typeof code === 'string' &&
    [
      'E_VALIDATION_ERROR',
      'E_FIELD_MISSING',
      'E_SENDER_NOT_VERIFIED',
      'E_RECIPIENT_NOT_ALLOWED',
      'E_SENDER_DOMAIN_NOT_AVAILABLE',
      'E_HEADER_NOT_ALLOWED',
      'E_HEADER_USE_API_FIELD',
      'E_HEADER_VALUE_INVALID',
      'E_CONTENT_TOO_LARGE',
    ].includes(code)
  )
    return 'failed';
  return 'unknown';
}
export async function drainNotificationWorkspace(
  env: HostedEnv,
  workspace: string,
) {
  if (
    env.NOTIFICATION_POLICY_ENABLED !== 'true' ||
    env.NOTIFICATION_MAIL_ENABLED !== 'true' ||
    env.EMAIL_DELIVERY_VERIFIED !== 'true' ||
    !env.EMAIL ||
    env.EMAIL_FROM !== 'accounts@mail.domains.domains'
  )
    return;
  const saved = await getNotificationPreferences(env, workspace);
  if (!saved) return;
  const prefs = notificationPreferencesSchema.parse(
    JSON.parse(saved.preferences),
  );
  if (!prefs.renewalReminders && !prefs.weeklyOverview) return;
  const owner = await env.CONTROL_DB.prepare(
    'SELECT u.email FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(workspace)
    .first<{ email: string }>();
  if (
    !owner ||
    salesRecipientHash(env, owner.email) !== saved.email_hash ||
    !(await salesRecipient(env, workspace, owner.email)).verified
  )
    return;
  // Recover an accepted provider receipt by replaying only its acknowledgement.
  const accepted = await env.CONTROL_DB.prepare(
    "SELECT * FROM notification_attempts WHERE workspace_id=? AND state='accepted' ORDER BY created_at LIMIT 5",
  )
    .bind(workspace)
    .all<{
      attempt_id: string;
      envelope_id: string;
      lease_token: string;
      provider_receipt: string;
    }>();
  for (const attempt of accepted.results) {
    const ack = await notificationInternal(env, workspace, 'ack', {
      id: attempt.envelope_id,
      lease: attempt.lease_token,
      state: 'accepted',
      receipt: attempt.provider_receipt,
    });
    if (((await ack.json()) as { ok: boolean }).ok)
      await env.CONTROL_DB.prepare(
        "UPDATE notification_attempts SET state='acknowledged',updated_at=? WHERE attempt_id=? AND state='accepted'",
      )
        .bind(Date.now(), attempt.attempt_id)
        .run();
  }
  const weeklyInFlight = saved.weekly_envelope_id
    ? await env.CONTROL_DB.prepare(
        "SELECT 1 FROM notification_attempts WHERE workspace_id=? AND envelope_id=? AND state IN ('sending','unknown','accepted','acknowledged') LIMIT 1",
      )
        .bind(workspace, saved.weekly_envelope_id)
        .first()
    : null;
  const prepared = await notificationInternal(env, workspace, 'prepare', {
    preferences: prefs,
    lastWeeklyAt:
      Math.max(
        saved.last_weekly_at ?? 0,
        weeklyInFlight ? (saved.weekly_claimed_at ?? 0) : 0,
      ) || null,
  });
  await prepared.body?.cancel();
  const leased = await notificationInternal(env, workspace, 'lease', {});
  const { item } = z
    .object({
      item: z
        .object({
          id: z.string().uuid(),
          lease: z.string().uuid(),
          mail: notificationEnvelopeSchema,
        })
        .nullable(),
    })
    .parse(await leased.json());
  if (!item) return;
  const latest = await getNotificationPreferences(env, workspace);
  const active = await env.CONTROL_DB.prepare(
    'SELECT id FROM workspaces WHERE id=? AND enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests WHERE workspace_id=?)',
  )
    .bind(workspace, workspace)
    .first();
  if (!active || latest?.revision !== saved.revision) {
    await notificationInternal(env, workspace, 'ack', {
      id: item.id,
      lease: item.lease,
      state: 'suppressed',
      receipt: null,
    });
    return;
  }
  if (!(await reserveNotificationEmail(env))) {
    await notificationInternal(env, workspace, 'ack', {
      id: item.id,
      lease: item.lease,
      state: 'retryable',
      receipt: 'quota',
    });
    return { nextAt: Date.now() + 3600_000 };
  }
  const attemptId = crypto.randomUUID();
  const attempt = env.CONTROL_DB.prepare(
    "INSERT INTO notification_attempts(attempt_id,workspace_id,envelope_id,lease_token,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,'sending',?,?)",
  ).bind(
    attemptId,
    workspace,
    item.id,
    item.lease,
    item.mail.kind,
    Date.now(),
    Date.now(),
  );
  try {
    const guard = env.CONTROL_DB.prepare(
      "INSERT INTO notification_cas_guard(id,ok) SELECT 'admission',CASE WHEN EXISTS(SELECT 1 FROM notification_preferences p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=? AND p.revision=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests WHERE workspace_id=p.workspace_id)) THEN 1 ELSE 0 END ON CONFLICT(id) DO UPDATE SET ok=excluded.ok",
    ).bind(workspace, saved.revision);
    if (item.mail.kind === 'urgent')
      await env.CONTROL_DB.batch([guard, attempt]);
    else
      await env.CONTROL_DB.batch([
        guard,
        env.CONTROL_DB.prepare(
          "INSERT INTO notification_cas_guard(id,ok) SELECT 'weekly',CASE WHEN EXISTS(SELECT 1 FROM notification_preferences p WHERE p.workspace_id=? AND (p.weekly_envelope_id=? OR p.weekly_claimed_at IS NULL OR p.weekly_claimed_at<? OR (p.weekly_envelope_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notification_attempts a WHERE a.workspace_id=p.workspace_id AND a.envelope_id=p.weekly_envelope_id AND a.state IN ('sending','unknown','accepted','acknowledged'))))) THEN 1 ELSE 0 END ON CONFLICT(id) DO UPDATE SET ok=excluded.ok",
        ).bind(workspace, item.id, Date.now() - 6 * 86400_000),
        env.CONTROL_DB.prepare(
          'UPDATE notification_preferences SET weekly_claimed_at=?,weekly_envelope_id=? WHERE workspace_id=?',
        ).bind(Date.now(), item.id, workspace),
        attempt,
      ]);
  } catch (error) {
    if (!String(error).includes('CHECK constraint')) throw error;
    await notificationInternal(env, workspace, 'ack', {
      id: item.id,
      lease: item.lease,
      state: 'suppressed',
      receipt: null,
    });
    return;
  }
  const claim = await notificationInternal(env, workspace, 'claim', {
    id: item.id,
    lease: item.lease,
    preferences: prefs,
  });
  if (!((await claim.json()) as { ok: boolean }).ok) {
    await env.CONTROL_DB.prepare(
      "UPDATE notification_attempts SET state='suppressed',updated_at=? WHERE attempt_id=?",
    )
      .bind(Date.now(), attemptId)
      .run();
    return;
  }
  const unsubscribe = await notificationUnsubscribeUrl(
    env,
    workspace,
    saved.email_hash,
  );
  const content = renderRenewalEmail(
    item.mail,
    env.CANONICAL_ORIGIN!,
    workspace,
    unsubscribe,
    item.id,
  );
  let state: 'accepted' | 'retryable' | 'unknown' | 'failed' | 'suppressed' =
      'unknown',
    receipt: string | null = null;
  try {
    const result = await env.EMAIL.send({
      from: { email: env.EMAIL_FROM, name: 'domains.domains' },
      to: owner.email,
      ...content,
      headers: {
        'List-Unsubscribe': `<${unsubscribe}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Notification-ID': attemptId,
        'X-Auto-Response-Suppress': 'All',
      },
    });
    state = 'accepted';
    receipt = result.messageId;
  } catch (error) {
    state = notificationFailure(error);
  }
  await env.CONTROL_DB.prepare(
    'UPDATE notification_attempts SET state=?,provider_receipt=?,updated_at=? WHERE attempt_id=?',
  )
    .bind(state, receipt, Date.now(), attemptId)
    .run();
  if (state === 'accepted' && item.mail.kind !== 'urgent')
    await env.CONTROL_DB.prepare(
      'UPDATE notification_preferences SET last_weekly_at=? WHERE workspace_id=?',
    )
      .bind(Date.now(), workspace)
      .run();
  const ack = await notificationInternal(env, workspace, 'ack', {
    id: item.id,
    lease: item.lease,
    state,
    receipt,
  });
  if (state === 'accepted' && ((await ack.json()) as { ok: boolean }).ok)
    await env.CONTROL_DB.prepare(
      "UPDATE notification_attempts SET state='acknowledged' WHERE attempt_id=?",
    )
      .bind(attemptId)
      .run();
  return state === 'retryable' ? { nextAt: Date.now() + 3600_000 } : undefined;
}

export async function drainNotifications(env: HostedEnv) {
  if (
    env.NOTIFICATION_POLICY_ENABLED !== 'true' ||
    env.NOTIFICATION_MAIL_ENABLED !== 'true'
  )
    return;
  const now = Date.now(),
    token = crypto.randomUUID();
  await env.CONTROL_DB.prepare(
    "UPDATE notification_attempts SET state='unknown',updated_at=? WHERE state='sending' AND updated_at<?",
  )
    .bind(now, now - 300_000)
    .run();
  const work = await env.CONTROL_DB.prepare(
    "UPDATE notification_preferences SET lease_token=?,lease_until=? WHERE workspace_id IN (SELECT workspace_id FROM notification_preferences WHERE next_check_at<=? AND lease_until<=? AND (json_extract(preferences,'$.renewalReminders')=1 OR json_extract(preferences,'$.weeklyOverview')=1) ORDER BY next_check_at,workspace_id LIMIT 10) AND lease_until<=? RETURNING workspace_id,preferences,revision,wake_generation",
  )
    .bind(token, now + 120_000, now, now, now)
    .all<{
      workspace_id: string;
      preferences: string;
      revision: string;
      wake_generation: number;
    }>();
  let failed = false;
  for (const row of work.results) {
    const prefs = notificationPreferencesSchema.parse(
      JSON.parse(row.preferences),
    );
    // Recover cached work even if a source wake was lost. This does not poll registrars.
    let nextAt = Math.min(
      nextDailySlot(Date.now(), prefs.timeZone),
      Date.now() + 15 * 60_000,
    );
    try {
      const result = await drainNotificationWorkspace(env, row.workspace_id);
      if (result?.nextAt) nextAt = result.nextAt;
      else {
        // A wake during tenant backoff can return no due item. Keep its known retry.
        const retry = await env.CONTROL_DB.prepare(
          "SELECT MIN(updated_at+?) AS next_at FROM notification_attempts WHERE workspace_id=? AND state='retryable' AND updated_at>?",
        )
          .bind(3600_000, row.workspace_id, Date.now() - 3600_000)
          .first<{ next_at: number | null }>();
        if (typeof retry?.next_at === 'number')
          nextAt = Math.min(nextAt, retry.next_at);
      }
    } catch {
      failed = true;
      nextAt = Date.now() + 600_000;
    } finally {
      await env.CONTROL_DB.prepare(
        'UPDATE notification_preferences SET next_check_at=CASE WHEN revision=? AND wake_generation=? THEN ? ELSE next_check_at END,lease_until=0 WHERE workspace_id=? AND lease_token=?',
      )
        .bind(
          row.revision,
          row.wake_generation,
          nextAt,
          row.workspace_id,
          token,
        )
        .run();
    }
  }
  if (failed) throw Error('Some portfolio notifications need attention.');
}
