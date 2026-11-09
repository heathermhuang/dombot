import { aesGcmCipher, type Cipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret, salesIndexer } from './keys';
import {
  renewalNotificationRows,
  renewalDecisions,
} from '../core/services/renewal-notifications';
import {
  localDay,
  renewalCandidates,
  selectRenewalNotice,
  type NotificationPreferences,
} from '../shared/notification-policy';

import {
  notificationEnvelopeSchema,
  type NotificationEnvelope,
} from '../shared/notification-email';

export class NotificationStore {
  constructor(
    readonly db: D1Database,
    readonly cipher: Cipher,
    readonly root: Uint8Array,
  ) {}
  static async from(env: Pick<Env, 'DB' | 'DOMBOT_SECRET'>) {
    const root = parseRootSecret(env.DOMBOT_SECRET);
    return new NotificationStore(
      env.DB,
      await aesGcmCipher(await deriveEncryptionKey(root)),
      root,
    );
  }
  private signer?: ReturnType<typeof salesIndexer>;
  private hash(value: string) {
    this.signer ??= salesIndexer(this.root, 'portfolio-notification');
    return this.signer.then((sign) => sign(value));
  }
  private async fingerprint(prefs: NotificationPreferences) {
    return this.hash(
      JSON.stringify([
        localDay(Date.now(), prefs.timeZone),
        prefs,
        renewalNotificationRows()
          .map((r) => JSON.stringify(r))
          .sort(),
        Object.entries(renewalDecisions()).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ]),
    );
  }
  async prepare(
    prefs: NotificationPreferences,
    lastWeeklyAt: number | null,
    now = Date.now(),
  ) {
    await this.db
      .prepare(
        "UPDATE notification_outbox SET sealed='' WHERE updated_at<? AND state IN ('accepted','failed','suppressed') AND sealed!=''",
      )
      .bind(now - 30 * 86400_000)
      .run();
    const rawDecisions = await this.db
      .prepare("SELECT count(*) AS n FROM docs WHERE ns='renewal-decisions'")
      .first<{ n: number }>();
    if ((rawDecisions?.n ?? 0) !== Object.keys(renewalDecisions()).length)
      throw Error('Renewal decisions could not be read completely.');
    const fingerprint = await this.fingerprint(prefs);
    // Obsolete known-unsent envelopes can be rebuilt; claimed/unknown attempts cannot.
    const old = await this.db
      .prepare(
        "SELECT id FROM notification_outbox WHERE state IN ('queued','retryable') AND fingerprint!=?",
      )
      .bind(fingerprint)
      .all<{ id: string }>();
    for (const { id } of old.results)
      await this.db.batch([
        this.db
          .prepare(
            "DELETE FROM notification_events WHERE envelope_id=? AND state='pending' AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND state IN ('queued','retryable'))",
          )
          .bind(id, id),
        this.db
          .prepare(
            "UPDATE notification_outbox SET state='suppressed',updated_at=? WHERE id=? AND state IN ('queued','retryable')",
          )
          .bind(now, id),
      ]);
    const rows = renewalNotificationRows(now),
      candidates = renewalCandidates(rows, now, prefs.timeZone);
    const recorded = await this.db
      .prepare('SELECT event_hash FROM notification_events')
      .all<{ event_hash: string }>();
    const seen = new Set(recorded.results.map((r) => r.event_hash));
    const sent = new Set<string>();
    if (seen.size) {
      const indexed = await Promise.all(
        candidates.map(
          async (item) => [item.key, await this.hash(item.key)] as const,
        ),
      );
      for (const [key, hash] of indexed) if (seen.has(hash)) sent.add(key);
    }
    const notice = selectRenewalNotice(
      candidates,
      sent,
      renewalDecisions(),
      prefs,
      now,
      lastWeeklyAt,
    );
    if (!notice || !notice.items.length) return null;
    // Overviews get their own weekly identity, even if all stages were already notified.
    const keys =
      notice.kind === 'overview'
        ? [`overview:${Math.floor(now / (86400_000 * 7))}`, ...notice.keys]
        : notice.keys;
    const hashes = await Promise.all(keys.map((k) => this.hash(k)));
    if (hashes.some((h) => seen.has(h))) return null;
    const id = crypto.randomUUID();
    const envelope: NotificationEnvelope = {
      kind: notice.kind,
      at: now,
      count: notice.items.length,
      attentionCount: notice.items.filter((i) => i.urgent).length,
      rows: notice.items
        .slice(0, 20)
        .map((c) => ({ ...c.row, attention: c.urgent })),
    };
    try {
      await this.db.batch([
        this.db
          .prepare(
            'INSERT INTO notification_outbox(id,kind,fingerprint,sealed,due_at,updated_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            id,
            notice.kind,
            fingerprint,
            await this.cipher.seal(JSON.stringify(envelope)),
            now,
            now,
          ),
        this.db
          .prepare(
            'INSERT INTO notification_events(event_hash,envelope_id,created_at) SELECT value,?,? FROM json_each(?)',
          )
          .bind(id, now, JSON.stringify(hashes)),
      ]);
    } catch (e) {
      if (String(e).includes('UNIQUE')) return null;
      throw e;
    }
    return id;
  }
  async lease(now = Date.now()) {
    await this.db
      .prepare(
        "UPDATE notification_outbox SET state=CASE WHEN claimed_at IS NULL THEN 'retryable' ELSE 'unknown' END WHERE state='leased' AND lease_expires_at<=?",
      )
      .bind(now)
      .run();
    const lease = crypto.randomUUID();
    const row = await this.db
      .prepare(
        "UPDATE notification_outbox SET state='leased',lease_token=?,lease_expires_at=?,claimed_at=NULL,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM notification_outbox WHERE state IN ('queued','retryable') AND due_at<=? ORDER BY due_at,id LIMIT 1) AND state IN ('queued','retryable') RETURNING id,sealed,kind",
      )
      .bind(lease, now + 60_000, now, now)
      .first<{ id: string; sealed: string; kind: string }>();
    if (!row) return null;
    return {
      id: row.id,
      lease,
      mail: notificationEnvelopeSchema.parse(
        JSON.parse(await this.cipher.open(row.sealed)),
      ),
    };
  }
  async claim(
    id: string,
    lease: string,
    prefs: NotificationPreferences,
    now = Date.now(),
  ) {
    const fingerprint = await this.fingerprint(prefs);
    const row = await this.db
      .prepare(
        "UPDATE notification_outbox SET claimed_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_token=? AND lease_expires_at>? AND claimed_at IS NULL AND fingerprint=? RETURNING id",
      )
      .bind(now, now, id, lease, now, fingerprint)
      .first();
    if (row) return true;
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM notification_events WHERE envelope_id=? AND state='pending' AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND claimed_at IS NULL AND fingerprint!=?)",
        )
        .bind(id, id, fingerprint),
      this.db
        .prepare(
          "UPDATE notification_outbox SET state='suppressed',updated_at=? WHERE id=? AND claimed_at IS NULL AND fingerprint!=?",
        )
        .bind(now, id, fingerprint),
    ]);
    return false;
  }
  async ack(
    id: string,
    lease: string,
    state: 'accepted' | 'retryable' | 'unknown' | 'suppressed' | 'failed',
    receipt: string | null,
    now = Date.now(),
  ) {
    const quota = state === 'retryable' && receipt === 'quota' ? 1 : 0;
    const result = await this.db
      .prepare(
        "UPDATE notification_outbox SET state=CASE WHEN ?='retryable' AND ?=0 AND attempts>=5 THEN 'failed' ELSE ? END,attempts=CASE WHEN ?=1 THEN MAX(attempts-1,0) ELSE attempts END,provider_receipt=?,due_at=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('leased','unknown') AND (?=0 OR claimed_at IS NULL) AND (? NOT IN ('accepted','unknown') OR claimed_at IS NOT NULL) RETURNING state",
      )
      .bind(
        state,
        quota,
        state,
        quota,
        receipt,
        now + 3600_000,
        now,
        id,
        lease,
        quota,
        state,
      )
      .first<{ state: string }>();
    if (!result)
      return Boolean(
        await this.db
          .prepare(
            'SELECT id FROM notification_outbox WHERE id=? AND lease_token=? AND state=? AND provider_receipt IS ?',
          )
          .bind(id, lease, state, receipt)
          .first(),
      );
    if (state === 'suppressed')
      await this.db
        .prepare(
          'DELETE FROM notification_events WHERE envelope_id=? AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND claimed_at IS NULL)',
        )
        .bind(id, id)
        .run();
    await this.db
      .prepare('UPDATE notification_events SET state=? WHERE envelope_id=?')
      .bind(result.state === 'retryable' ? 'pending' : result.state, id)
      .run();
    return true;
  }
  async health() {
    return (
      await this.db
        .prepare(
          'SELECT state,count(*) AS count FROM notification_outbox GROUP BY state',
        )
        .all<{ state: string; count: number }>()
    ).results;
  }

  async forgetNames(names: string[]) {
    const removed = new Set(names);
    let cursor = '';
    for (;;) {
      const batch = await this.db
        .prepare(
          "SELECT id,sealed,claimed_at FROM notification_outbox WHERE id>? AND sealed!='' ORDER BY id LIMIT 100",
        )
        .bind(cursor)
        .all<{ id: string; sealed: string; claimed_at: number | null }>();
      if (!batch.results.length) break;
      for (const row of batch.results) {
        const mail = notificationEnvelopeSchema.parse(
          JSON.parse(await this.cipher.open(row.sealed)),
        );
        if (!mail.rows.some((r) => removed.has(r.domain))) continue;
        await this.db.batch([
          this.db
            .prepare(
              "DELETE FROM notification_events WHERE envelope_id=? AND state='pending' AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND claimed_at IS NULL)",
            )
            .bind(row.id, row.id),
          this.db
            .prepare(
              "UPDATE notification_outbox SET sealed='',state=CASE WHEN claimed_at IS NULL THEN 'suppressed' ELSE state END WHERE id=?",
            )
            .bind(row.id),
        ]);
      }
      cursor = batch.results[batch.results.length - 1].id;
    }
  }

  /** Private restore is a baseline, never permission to replay an old email. */
  async baselineAfterRestore() {
    const now = Date.now();
    await this.db
      .prepare(
        "UPDATE notification_outbox SET state='suppressed',updated_at=? WHERE state IN ('queued','retryable') OR (state='leased' AND claimed_at IS NULL)",
      )
      .bind(now)
      .run();
    const rows = renewalNotificationRows(now);
    const hashes = await Promise.all(
      rows.flatMap((row) =>
        ['review', 'soon'].map((stage) =>
          this.hash(row.domain + '|' + row.date + '|' + stage),
        ),
      ),
    );
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO notification_events(event_hash,envelope_id,state,created_at) SELECT value,'restore-baseline','accepted',? FROM json_each(?)",
      )
      .bind(now, JSON.stringify(hashes))
      .run();
  }
}

export async function notificationSchemaReady(
  db: D1Database,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('notification_outbox','notification_events')",
    )
    .first<{ n: number }>();
  return row?.n === 2;
}
