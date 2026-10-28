import {
  readWorkspace,
  ObservationFailure,
  type ProbeReport,
} from './workspace-observation';
import { z } from 'zod';
import {
  syncDiagnosticsSchema,
  SYNC_RETENTION_MS,
  type SyncEvent,
} from '../shared/sync-monitor';
import { escapeHtml } from './views';

export const SYNC_ALERT_RECIPIENT = 'heathermhuang@gmail.com';
const MAX_USERS = 25;
const responseSchema = z.union([
  z.object({ unchanged: z.literal(true) }),
  z.object({ diagnostics: syncDiagnosticsSchema.nullable() }),
]);
type Check = {
  workspace_id: string;
  revision: string | null;
  seq: number;
  errors: number;
  error_since: number | null;
  error_alerted: number;
};
type Account = {
  seq: number;
  fingerprint: string | null;
  incident_id: string | null;
  failures: number;
};
export type SyncAlert = {
  id: string;
  workspace_id: string | null;
  at: number;
  kind: string;
  diagnostic: string;
  status: string;
  message_id: string | null;
  sent_at: number | null;
};
const diagnostic = (event: SyncEvent) => JSON.stringify(event);
const insertAlert = (
  env: HostedEnv,
  id: string,
  workspace: string,
  kind: string,
  value: unknown,
  at: number,
) =>
  env.CONTROL_DB.prepare(
    'INSERT OR IGNORE INTO sync_monitor_alerts(id,workspace_id,at,kind,diagnostic) VALUES(?,?,?,?,?)',
  ).bind(id, workspace, at, kind, JSON.stringify(value));

export async function ingestSyncEvent(
  env: HostedEnv,
  workspace: string,
  event: SyncEvent,
): Promise<void> {
  const current = await env.CONTROL_DB.prepare(
    'SELECT seq,fingerprint,incident_id,failures FROM sync_monitor_accounts WHERE workspace_id=? AND account_id=?',
  )
    .bind(workspace, event.accountId)
    .first<Account>();
  if (current && current.seq >= event.seq) return;
  const fingerprint = event.ok
    ? null
    : [event.code, event.httpStatus, event.route].join(':');
  // Older collectors appended build identity. Keep that evidence on the
  // event, but compare only the failure cause so deployments do not reopen it.
  const previousFingerprint = current?.fingerprint
    ?.split(':')
    .slice(0, 3)
    .join(':');
  const failure =
    !event.ok && (!previousFingerprint || previousFingerprint !== fingerprint);
  const recovery = event.ok && Boolean(current?.fingerprint);
  const statements = [
    env.CONTROL_DB.prepare(
      'INSERT OR IGNORE INTO sync_monitor_events(id,workspace_id,account_id,seq,at,ok,diagnostic) VALUES(?,?,?,?,?,?,?)',
    ).bind(
      event.id,
      workspace,
      event.accountId,
      event.seq,
      event.at,
      event.ok ? 1 : 0,
      diagnostic(event),
    ),
    env.CONTROL_DB.prepare(
      'INSERT INTO sync_monitor_accounts(workspace_id,account_id,seq,fingerprint,incident_id,failures,last_good_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,account_id) DO UPDATE SET seq=excluded.seq,fingerprint=excluded.fingerprint,incident_id=excluded.incident_id,failures=excluded.failures,last_good_at=excluded.last_good_at',
    ).bind(
      workspace,
      event.accountId,
      event.seq,
      fingerprint,
      event.ok ? null : failure ? event.id : (current?.incident_id ?? event.id),
      event.ok ? 0 : (current?.failures ?? 0) + 1,
      event.lastGoodAt,
    ),
  ];
  if (failure || recovery)
    statements.push(
      insertAlert(
        env,
        event.id + (failure ? ':failure' : ':recovery'),
        workspace,
        failure ? 'failure' : 'recovery',
        {
          ...event,
          incidentId: failure ? event.id : current?.incident_id,
          failures: event.ok ? current?.failures : (current?.failures ?? 0) + 1,
        },
        event.at,
      ),
    );
  await env.CONTROL_DB.batch(statements);
}

async function observe(env: HostedEnv, row: Check): Promise<void> {
  const now = Date.now();
  let probe: ProbeReport | undefined;
  try {
    const observed = await readWorkspace(
      env,
      row.workspace_id,
      'sync-monitor',
      (value) => responseSchema.parse(value),
      { revision: row.revision ?? undefined },
    );
    probe = observed.probe;
    const result = observed.value;
    let seq = row.seq,
      revision = row.revision;
    if ('diagnostics' in result && result.diagnostics) {
      const snapshot = result.diagnostics;
      if (snapshot.seq < seq) throw Error('Diagnostic sequence reset');
      if (snapshot.prunedThrough > seq) {
        await insertAlert(
          env,
          `${row.workspace_id}:gap:${snapshot.prunedThrough}`,
          row.workspace_id,
          'gap',
          { from: seq + 1, through: snapshot.prunedThrough },
          now,
        ).run();
        seq = snapshot.prunedThrough;
      }
      const fresh = snapshot.events.filter((e) => e.seq > seq).slice(0, 50);
      for (const event of fresh) {
        await ingestSyncEvent(env, row.workspace_id, event);
        seq = event.seq;
      }
      revision = seq === snapshot.seq ? snapshot.revision : null;
    } else if ('diagnostics' in result && !result.diagnostics && seq > 0)
      throw Error('Diagnostics missing');
    const updates = [
      env.CONTROL_DB.prepare(
        'INSERT INTO sync_monitor_checks(workspace_id,revision,seq,checked_at,probe_json,last_failure_json) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision,seq=excluded.seq,checked_at=excluded.checked_at,errors=0,error_since=NULL,error_alerted=0,probe_json=excluded.probe_json,last_failure_json=COALESCE(excluded.last_failure_json,sync_monitor_checks.last_failure_json)',
      ).bind(
        row.workspace_id,
        revision,
        seq,
        Date.now(),
        JSON.stringify(probe),
        probe.failure ? JSON.stringify(probe.failure) : null,
      ),
    ];
    if (row.error_alerted)
      updates.push(
        insertAlert(
          env,
          `${row.workspace_id}:available:${row.error_since}`,
          row.workspace_id,
          'available',
          { checkedAt: now },
          now,
        ),
      );
    await env.CONTROL_DB.batch(updates);
  } catch (error) {
    const errors = row.errors + 1,
      since = row.error_since ?? now;
    const failedProbe =
      error instanceof ObservationFailure
        ? error.probe
        : {
            at: now,
            durationMs: Date.now() - now,
            attempts: probe?.attempts ?? 0,
            backend: probe?.backend ?? 'unknown',
            readMs: probe?.readMs ?? null,
            failure: {
              observedAt: now,
              durationMs: Date.now() - now,
              attempt: probe?.attempts ?? 0,
              phase: 'persistence',
              code: 'diagnostic_persistence',
              httpStatus: null,
            },
          };
    const detail = { ...failedProbe.failure, since, probe: failedProbe };
    const updates = [
      env.CONTROL_DB.prepare(
        'INSERT INTO sync_monitor_checks(workspace_id,checked_at,errors,error_since,error_alerted,probe_json,last_failure_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET checked_at=excluded.checked_at,errors=excluded.errors,error_since=excluded.error_since,error_alerted=excluded.error_alerted,probe_json=excluded.probe_json,last_failure_json=excluded.last_failure_json',
      ).bind(
        row.workspace_id,
        Date.now(),
        errors,
        since,
        errors >= 2 ? 1 : 0,
        JSON.stringify(failedProbe),
        JSON.stringify(failedProbe.failure),
      ),
    ];
    if (errors >= 2)
      updates.push(
        insertAlert(
          env,
          `${row.workspace_id}:unavailable:${since}`,
          row.workspace_id,
          'unavailable',
          detail,
          now,
        ),
      );
    await env.CONTROL_DB.batch(updates);
    if (errors > 2)
      await env.CONTROL_DB.prepare(
        "UPDATE sync_monitor_alerts SET diagnostic=? WHERE id=? AND kind='unavailable'",
      )
        .bind(
          JSON.stringify(detail),
          `${row.workspace_id}:unavailable:${since}`,
        )
        .run();
  }
}

// Health probes, retention gaps and recovery stay visible in the dashboard.
// Email is reserved for actual Dynadot sync failures and explicit test sends.
export function isEmailAlert(kind: string): boolean {
  return kind === 'failure' || kind === 'test';
}
const EMAIL_COOLDOWN_MS = 30 * 60_000;

export async function deliverSyncAlerts(env: HostedEnv): Promise<void> {
  const now = Date.now();
  await env.CONTROL_DB.prepare(
    "UPDATE sync_monitor_alerts SET status='uncertain' WHERE kind IN ('failure','test') AND status='sending' AND attempted_at<?",
  )
    .bind(now - EMAIL_COOLDOWN_MS)
    .run();
  const rows = (
    await env.CONTROL_DB.prepare(
      "SELECT * FROM sync_monitor_alerts WHERE kind IN ('failure','test') AND (status='pending' OR (status='uncertain' AND attempts<3 AND attempted_at<?)) ORDER BY at,id LIMIT 50",
    )
      .bind(now - EMAIL_COOLDOWN_MS)
      .all<SyncAlert>()
  ).results;
  if (!rows.length) return;
  if (
    !env.EMAIL ||
    env.EMAIL_DELIVERY_VERIFIED !== 'true' ||
    env.EMAIL_FROM !== 'accounts@mail.domains.domains'
  )
    throw Error('Sync alert email unavailable');
  const allowed = await env.CONTROL_DB.prepare(
    'SELECT u.id FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE lower(u.email)=? AND w.enabled=1',
  )
    .bind(SYNC_ALERT_RECIPIENT)
    .first<{ id: string }>();
  const admins: unknown = JSON.parse(env.ADMIN_USER_IDS ?? '[]');
  if (!allowed || !Array.isArray(admins) || !admins.includes(allowed.id))
    throw Error('Sync alert recipient is not the enabled administrator');

  // One atomic fleet-wide reservation, including concurrent collectors and
  // ambiguous sends. A burst across many portfolios still sends one message.
  const batchId = 'email-batch:' + crypto.randomUUID();
  const slot = await env.CONTROL_DB.prepare(
    "INSERT INTO sync_monitor_deliveries(alert_id,attempt,at) SELECT ?,1,? WHERE NOT EXISTS(SELECT 1 FROM sync_monitor_deliveries WHERE alert_id LIKE 'email-batch:%' AND at>?) RETURNING alert_id",
  )
    .bind(batchId, now, now - EMAIL_COOLDOWN_MS)
    .first();
  if (!slot) return;
  const claimed: SyncAlert[] = [];
  for (const alert of rows) {
    const claim = await env.CONTROL_DB.prepare(
      "UPDATE sync_monitor_alerts SET status='sending',attempted_at=?,attempts=attempts+1 WHERE id=? AND kind IN ('failure','test') AND (status='pending' OR (status='uncertain' AND attempts<3 AND attempted_at<?)) RETURNING attempts",
    )
      .bind(now, alert.id, now - EMAIL_COOLDOWN_MS)
      .first<{ attempts: number }>();
    if (!claim) continue;
    await env.CONTROL_DB.prepare(
      'INSERT INTO sync_monitor_deliveries(alert_id,attempt,at) VALUES(?,?,?)',
    )
      .bind(alert.id, claim.attempts, now)
      .run();
    claimed.push(alert);
  }
  if (!claimed.length) return;
  const test = claimed.every((alert) => alert.kind === 'test');
  const title = test
    ? 'Dynadot monitoring test'
    : `Dynadot sync failures (${claimed.length})`;
  const text = `${title}\n\n${claimed.map((alert) => `Time: ${new Date(alert.at).toISOString()}\nAlert ID: ${alert.id}\nSanitized diagnostics: ${alert.diagnostic}`).join('\n\n')}\n\nReview: https://domains.domains/admin/sync-monitor\n\nNew failures are grouped into at most one email every 30 minutes. Monitoring availability, recovery and retention-gap notices stay in the dashboard.`;
  let result: EmailSendResult;
  try {
    result = await env.EMAIL.send({
      from: { email: env.EMAIL_FROM, name: 'domains.domains system alerts' },
      to: SYNC_ALERT_RECIPIENT,
      subject: `[domains.domains] ${title}`,
      text,
      html: `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      headers: { 'X-DomBot-Alert-ID': batchId },
    });
  } catch {
    await env.CONTROL_DB.batch(
      claimed.map((alert) =>
        env.CONTROL_DB.prepare(
          "UPDATE sync_monitor_alerts SET status='uncertain' WHERE id=? AND status='sending'",
        ).bind(alert.id),
      ),
    );
    return;
  }
  // Persist the shared provider receipt atomically for the whole digest.
  await env.CONTROL_DB.batch(
    claimed.map((alert) =>
      env.CONTROL_DB.prepare(
        "UPDATE sync_monitor_alerts SET status='sent',sent_at=?,message_id=? WHERE id=? AND status='sending'",
      ).bind(Date.now(), result.messageId, alert.id),
    ),
  );
}

export async function monitorDynadotSync(env: HostedEnv): Promise<void> {
  if (env.SYNC_MONITOR_ENABLED !== 'true') return;
  const now = Date.now(),
    lease = crypto.randomUUID();
  const claim = await env.CONTROL_DB.prepare(
    'UPDATE sync_monitor_control SET lease=?,lease_until=? WHERE id=1 AND lease_until<? RETURNING id',
  )
    .bind(lease, now + 180_000, now)
    .first();
  if (!claim) return;
  try {
    const rows = (
      await env.CONTROL_DB.prepare(
        'SELECT u.workspace_id,c.revision,COALESCE(c.seq,0) seq,COALESCE(c.errors,0) errors,c.error_since,COALESCE(c.error_alerted,0) error_alerted FROM users u JOIN workspaces w ON w.id=u.workspace_id LEFT JOIN sync_monitor_checks c ON c.workspace_id=u.workspace_id WHERE w.enabled=1 GROUP BY u.workspace_id ORDER BY COALESCE(c.checked_at,0),u.workspace_id LIMIT ?',
      )
        .bind(MAX_USERS)
        .all<Check>()
    ).results;
    // Stop starting work before the next cron; leave older checkpoints first
    // in line next time. A slow fleet cannot create overlapping collectors.
    for (let i = 0; i < rows.length && Date.now() - now < 90_000; i += 4)
      await Promise.all(rows.slice(i, i + 4).map((row) => observe(env, row)));
    await deliverSyncAlerts(env);
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        'DELETE FROM sync_monitor_deliveries WHERE at<?',
      ).bind(now - SYNC_RETENTION_MS),
      env.CONTROL_DB.prepare('DELETE FROM sync_monitor_events WHERE at<?').bind(
        now - SYNC_RETENTION_MS,
      ),
      env.CONTROL_DB.prepare(
        "DELETE FROM sync_monitor_alerts WHERE at<? AND (status='sent' OR kind NOT IN ('failure','test'))",
      ).bind(now - SYNC_RETENTION_MS),
      env.CONTROL_DB.prepare(
        'UPDATE sync_monitor_control SET completed_at=? WHERE id=1 AND lease=?',
      ).bind(Date.now(), lease),
    ]);
  } finally {
    await env.CONTROL_DB.prepare(
      'UPDATE sync_monitor_control SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?',
    )
      .bind(lease)
      .run();
  }
}
