import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import {
  deliverSyncAlerts,
  ingestSyncEvent,
  monitorDynadotSync,
  SYNC_ALERT_RECIPIENT,
} from './sync-monitor';
import type { SyncEvent } from '../shared/sync-monitor';
let mf: Miniflare, db: D1Database, env: HostedEnv;
const workspace = '11111111-1111-4111-8111-111111111111';
const send = vi.fn(async (message: EmailMessageBuilder) => {
  void message;
  return { messageId: 'synthetic-accepted' };
});
const fetch = vi.fn();
const event = (
  seq: number,
  ok = false,
  code: SyncEvent['code'] = 'queue_timeout',
): SyncEvent => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  seq,
  accountId: 'dynadot',
  trigger: 'scheduled',
  at: Date.now() + seq,
  startedAt: Date.now() - 2000,
  durationMs: 2000,
  ok,
  lastGoodAt: ok ? Date.now() : null,
  domains: 3,
  route: 'managed',
  code: ok ? 'none' : code,
  httpStatus: null,
  engine: '1.5.2-hosted.14',
  source: 'a'.repeat(64),
});
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { CONTROL_DB: 'monitor-test' },
    }),
  );
  db = (await mf.getD1Database('CONTROL_DB')) as unknown as D1Database;
  for (const file of readdirSync('hosted/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--[^\n]*/g, '')
        .replace(/\n/g, ' '),
    );
  await db
    .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
    .bind(workspace, 'Synthetic monitor')
    .run();
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(
      'admin',
      SYNC_ALERT_RECIPIENT,
      workspace,
      'synthetic-unused',
      Date.now(),
    )
    .run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  for (const table of [
    'sync_monitor_alerts',
    'sync_monitor_events',
    'sync_monitor_accounts',
    'sync_monitor_checks',
  ])
    await db.prepare('DELETE FROM ' + table).run();
  await db
    .prepare(
      'UPDATE sync_monitor_control SET lease_until=0,lease=NULL,completed_at=NULL',
    )
    .run();
  send.mockClear();
  fetch.mockReset();
  env = {
    CONTROL_DB: db,
    SYNC_MONITOR_ENABLED: 'true',
    AUTH_PEPPER: 'synthetic',
    EMAIL: { send },
    EMAIL_FROM: 'accounts@mail.domains.domains',
    EMAIL_DELIVERY_VERIFIED: 'true',
    ADMIN_USER_IDS: '["admin"]',
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Synthetic' },
    ]),
    GATEWAY_KEYS: JSON.stringify({
      [workspace]: 'synthetic-monitor-key-'.repeat(3),
    }),
    WORKSPACE_0: { fetch },
  } as unknown as HostedEnv;
});
describe('production Dynadot collector and email outbox', () => {
  it('retains failure followed by recovery before polling; quiet on unchanged/repeated cause', async () => {
    const a = event(1),
      b = event(2),
      c = event(3, true);
    fetch.mockResolvedValueOnce(
      Response.json({
        diagnostics: {
          revision: crypto.randomUUID(),
          seq: 3,
          prunedThrough: 0,
          events: [a, b, c],
        },
      }),
    );
    await monitorDynadotSync(env);
    expect(
      (
        await db
          .prepare('SELECT kind FROM sync_monitor_alerts ORDER BY at')
          .all<{ kind: string }>()
      ).results.map((r) => r.kind),
    ).toEqual(['failure', 'recovery']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ to: SYNC_ALERT_RECIPIENT });
    fetch.mockResolvedValueOnce(Response.json({ unchanged: true }));
    await monitorDynadotSync(env);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) n FROM sync_monitor_events')
          .first<{ n: number }>()
      )?.n,
    ).toBe(3);
    await ingestSyncEvent(env, workspace, a);
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(2);
    await ingestSyncEvent(env, workspace, event(4));
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(3);
    await ingestSyncEvent(env, workspace, event(5, false, 'tls'));
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('alerts on missing diagnostics and recovery, and surfaces retention gaps', async () => {
    fetch.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await monitorDynadotSync(env);
    expect(send).not.toHaveBeenCalled();
    await monitorDynadotSync(env);
    expect(send).toHaveBeenCalledTimes(1);
    await monitorDynadotSync(env);
    expect(send).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(
      Response.json({
        diagnostics: {
          revision: crypto.randomUUID(),
          seq: 5,
          prunedThrough: 4,
          events: [event(5)],
        },
      }),
    );
    await monitorDynadotSync(env);
    expect(
      (
        await db
          .prepare('SELECT kind FROM sync_monitor_alerts ORDER BY kind')
          .all<{ kind: string }>()
      ).results.map((r) => r.kind),
    ).toEqual(['available', 'failure', 'gap', 'unavailable']);
  });
  it('claims sends once concurrently, keeps ambiguous delivery, retries at most three times', async () => {
    await ingestSyncEvent(env, workspace, event(1));
    send.mockRejectedValue(new Error('transport timeout'));
    await Promise.all([deliverSyncAlerts(env), deliverSyncAlerts(env)]);
    expect(send).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      await db
        .prepare('UPDATE sync_monitor_alerts SET attempted_at=?')
        .bind(Date.now() - 11 * 60_000)
        .run();
      await deliverSyncAlerts(env);
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect(
      await db
        .prepare('SELECT status,attempts FROM sync_monitor_alerts')
        .first(),
    ).toMatchObject({ status: 'uncertain', attempts: 3 });
    send.mockResolvedValue({ messageId: 'synthetic-accepted' });
  });
  it('refuses delivery to a non-admin and respects the monitor switch and active lease', async () => {
    await ingestSyncEvent(env, workspace, event(1));
    env.ADMIN_USER_IDS = '[]';
    await expect(deliverSyncAlerts(env)).rejects.toThrow('administrator');
    expect(send).not.toHaveBeenCalled();
    env.SYNC_MONITOR_ENABLED = 'false';
    await monitorDynadotSync(env);
    expect(fetch).not.toHaveBeenCalled();
    env.SYNC_MONITOR_ENABLED = 'true';
    await db
      .prepare('UPDATE sync_monitor_control SET lease_until=?')
      .bind(Date.now() + 100000)
      .run();
    await monitorDynadotSync(env);
    expect(fetch).not.toHaveBeenCalled();
  });
});
