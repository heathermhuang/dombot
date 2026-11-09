import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey } from './keys';
import { NotificationStore } from './notification-store';
import {
  notificationDefaults,
  type RenewalNoticeRow,
} from '../shared/notification-policy';
const fixture = vi.hoisted(() => ({
  rows: [] as RenewalNoticeRow[],
  decisions: {} as Record<string, 'expire' | 'handled'>,
}));
vi.mock('../core/services/renewal-notifications', () => ({
  renewalNotificationRows: () => fixture.rows,
  renewalDecisions: () => fixture.decisions,
}));
let mf: Miniflare, db: D1Database, store: NotificationStore;
const now = Date.parse('2026-11-09T09:00:00Z'),
  prefs = { ...notificationDefaults, renewalReminders: true };
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch(){return new Response("ok")} }',
      d1Databases: { DB: 'notifications' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  await db.exec(
    'CREATE TABLE docs(ns TEXT,key TEXT,value TEXT);' +
      readFileSync('migrations/0011_notifications.sql', 'utf8').replace(
        /\n/g,
        ' ',
      ),
  );
  const root = new Uint8Array(32).fill(8);
  store = new NotificationStore(
    db,
    await aesGcmCipher(await deriveEncryptionKey(root)),
    root,
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await mf?.dispose();
});
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  fixture.decisions = {};
  fixture.rows = [
    {
      domain: 'sample.example',
      account: 'Sample',
      date: '2026-11-30',
      autoRenew: false,
      stale: false,
      imported: false,
      observedAt: now,
      price: null,
      failure: null,
    },
  ];
  await db.batch(
    ['notification_events', 'notification_outbox', 'docs'].map((name) =>
      db.prepare(`DELETE FROM ${name}`),
    ),
  );
});
describe('durable portfolio email lifecycle', () => {
  it('atomically deduplicates concurrent preparation and send claims', async () => {
    await Promise.all([
      store.prepare(prefs, null, now),
      store.prepare(prefs, null, now),
    ]);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM notification_outbox')
        .first<{ n: number }>())!.n,
    ).toBe(1);
    const item = (await store.lease(now))!;
    const claims = await Promise.all([
      store.claim(item.id, item.lease, prefs, now),
      store.claim(item.id, item.lease, prefs, now),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      await store.ack(item.id, item.lease, 'accepted', 'provider-receipt', now),
    ).toBe(true);
    expect(
      await store.ack(
        item.id,
        item.lease,
        'accepted',
        'provider-receipt',
        now + 120_000,
      ),
    ).toBe(true);
    expect(await store.prepare(prefs, null, now)).toBeNull();
  });
  it('rejects stale content after a renewal decision and rebuilds only unsent work', async () => {
    await store.prepare(prefs, null, now);
    const item = (await store.lease(now))!;
    fixture.decisions = { 'sample.example|2026-11-30': 'expire' };
    await db
      .prepare(
        "INSERT INTO docs(ns,key,value) VALUES('renewal-decisions','choice','{}')",
      )
      .run();
    expect(await store.claim(item.id, item.lease, prefs, now)).toBe(false);
    expect(await store.prepare(prefs, null, now)).toBeNull();
    fixture.decisions = {};
    await db.prepare("DELETE FROM docs WHERE ns='renewal-decisions'").run();
    expect(await store.prepare(prefs, null, now)).not.toBeNull();
  });
  it('reclaims only an unclaimed expired lease; a claimed expiry stays unknown', async () => {
    await store.prepare(prefs, null, now);
    const first = (await store.lease(now))!;
    const retry = (await store.lease(now + 61_000))!;
    expect(retry.id).toBe(first.id);
    expect(retry.lease).not.toBe(first.lease);
    expect(await store.claim(retry.id, retry.lease, prefs, now + 61_000)).toBe(
      true,
    );
    expect(await store.lease(now + 122_000)).toBeNull();
    expect(await store.prepare(prefs, null, now + 122_000)).toBeNull();
    expect((await store.health()).some((r) => r.state === 'unknown')).toBe(
      true,
    );
    // A late provider acceptance receipt reconciles the original claim without sending again.
    expect(
      await store.ack(
        retry.id,
        retry.lease,
        'accepted',
        'late-receipt',
        now + 122_000,
      ),
    ).toBe(true);
  });
  it('keeps full counts while bounding a 1,000-name email to twenty rows', async () => {
    fixture.rows = Array.from({ length: 1000 }, (_, i) => ({
      ...fixture.rows[0],
      domain: `name${i}.example`,
    }));
    await store.prepare(prefs, null, now);
    const item = (await store.lease(now))!;
    expect(item.mail.count).toBe(1000);
    expect(item.mail.rows).toHaveLength(20);
  });
  it('does not treat missing decrypted decisions as an empty healthy portfolio', async () => {
    await db
      .prepare(
        "INSERT INTO docs(ns,key,value) VALUES('renewal-decisions','unreadable','{}')",
      )
      .run();
    await expect(store.prepare(prefs, null, now)).rejects.toThrow(
      'could not be read completely',
    );
  });
  it('keeps quota deferral separate from five actual provider attempts', async () => {
    await store.prepare(prefs, null, now);
    let at = now;
    for (let i = 0; i < 6; i++) {
      const item = (await store.lease(at))!;
      expect(
        await store.ack(item.id, item.lease, 'retryable', 'quota', at),
      ).toBe(true);
      at += 3600_001;
    }
    for (let i = 0; i < 5; i++) {
      const item = (await store.lease(at))!;
      expect(await store.claim(item.id, item.lease, prefs, at)).toBe(true);
      expect(await store.ack(item.id, item.lease, 'retryable', null, at)).toBe(
        true,
      );
      at += 3600_001;
    }
    expect(await store.lease(at)).toBeNull();
    expect((await store.health()).some((s) => s.state === 'failed')).toBe(true);
  });
});
