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
    'sync_monitor_deliveries',
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
  send.mockReset().mockResolvedValue({ messageId: 'synthetic-accepted' });
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
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: SYNC_ALERT_RECIPIENT });
    fetch.mockResolvedValueOnce(Response.json({ unchanged: true }));
    await monitorDynadotSync(env);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) n FROM sync_monitor_events')
          .first<{ n: number }>()
      )?.n,
    ).toBe(3);
    await ingestSyncEvent(env, workspace, a);
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(1);
    await ingestSyncEvent(env, workspace, event(4));
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(1);
    await ingestSyncEvent(env, workspace, event(5, false, 'tls'));
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(1);
    await db
      .prepare('UPDATE sync_monitor_deliveries SET at=?')
      .bind(Date.now() - 31 * 60_000)
      .run();
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('records missing diagnostics, recovery and retention gaps without health emails', async () => {
    fetch.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await monitorDynadotSync(env);
    expect(send).not.toHaveBeenCalled();
    await monitorDynadotSync(env);
    expect(send).not.toHaveBeenCalled();
    await monitorDynadotSync(env);
    expect(send).not.toHaveBeenCalled();
    const failure = await db
      .prepare(
        "SELECT diagnostic FROM sync_monitor_alerts WHERE kind='unavailable'",
      )
      .first<{ diagnostic: string }>();
    expect(JSON.parse(failure!.diagnostic)).toMatchObject({
      code: 'observation_http_error',
      phase: 'response',
      httpStatus: 503,
    });
    expect(failure!.diagnostic).not.toContain('unavailable');
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
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('claims sends once concurrently, keeps ambiguous delivery, retries at most three times', async () => {
    await ingestSyncEvent(env, workspace, event(1));
    send.mockRejectedValue(new Error('transport timeout'));
    await Promise.all([deliverSyncAlerts(env), deliverSyncAlerts(env)]);
    expect(send).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      await db
        .prepare('UPDATE sync_monitor_alerts SET attempted_at=?')
        .bind(Date.now() - 31 * 60_000)
        .run();
      await db
        .prepare('UPDATE sync_monitor_deliveries SET at=?')
        .bind(Date.now() - 31 * 60_000)
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
  it('records one digest receipt for all included failures', async () => {
    for (let seq = 1; seq <= 12; seq++)
      await ingestSyncEvent(env, workspace, {
        ...event(seq),
        accountId: 'account-' + seq,
      });
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain('30 minutes');
    const receipts = (
      await db
        .prepare(
          "SELECT message_id FROM sync_monitor_alerts WHERE status='sent'",
        )
        .all<{ message_id: string }>()
    ).results;
    expect(receipts).toHaveLength(12);
    expect(new Set(receipts.map((r) => r.message_id))).toEqual(
      new Set(['synthetic-accepted']),
    );
  });
  it('keeps a fleet monitoring outage and recovery dashboard-only instead of flooding email', async () => {
    for (let i = 0; i < 39; i++) {
      await db
        .prepare(
          "INSERT INTO sync_monitor_alerts(id,workspace_id,at,kind,diagnostic) VALUES(?,?,?,'unavailable',?)",
        )
        .bind(
          'outage-' + i,
          workspace,
          Date.now(),
          JSON.stringify({ code: 'diagnostics_unavailable' }),
        )
        .run();
      await db
        .prepare(
          "INSERT INTO sync_monitor_alerts(id,workspace_id,at,kind,diagnostic) VALUES(?,?,?,'available',?)",
        )
        .bind(
          'restored-' + i,
          workspace,
          Date.now(),
          JSON.stringify({ checkedAt: Date.now() }),
        )
        .run();
    }
    await deliverSyncAlerts(env);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) n FROM sync_monitor_alerts')
          .first<{ n: number }>()
      )?.n,
    ).toBe(78);
  });
  it('groups a burst of actual Dynadot failures into one email and enforces a rolling 30-minute cooldown', async () => {
    for (let seq = 1; seq <= 12; seq++)
      await ingestSyncEvent(env, workspace, {
        ...event(seq),
        accountId: 'account-' + seq,
      });
    await Promise.all([deliverSyncAlerts(env), deliverSyncAlerts(env)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM sync_monitor_alerts WHERE status='sent'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(12);
    await ingestSyncEvent(env, workspace, {
      ...event(13),
      accountId: 'account-13',
    });
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(1);
    await db
      .prepare('UPDATE sync_monitor_deliveries SET at=?')
      .bind(Date.now() - 31 * 60_000)
      .run();
    await deliverSyncAlerts(env);
    expect(send).toHaveBeenCalledTimes(2);
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

it('retains a brief first probe failure even when retry and later checks succeed', async () => {
  fetch
    .mockResolvedValueOnce(
      new Response('private upstream payload', { status: 503 }),
    )
    .mockResolvedValueOnce(Response.json({ diagnostics: null }));
  await monitorDynadotSync(env);
  const row = await db
    .prepare(
      'SELECT errors,probe_json,last_failure_json FROM sync_monitor_checks WHERE workspace_id=?',
    )
    .bind(workspace)
    .first<{ errors: number; probe_json: string; last_failure_json: string }>();
  expect(row?.errors).toBe(0);
  expect(JSON.parse(row!.probe_json)).toMatchObject({ attempts: 2 });
  expect(JSON.parse(row!.last_failure_json)).toMatchObject({
    code: 'observation_http_error',
    httpStatus: 503,
  });
  fetch.mockResolvedValueOnce(Response.json({ diagnostics: null }));
  await monitorDynadotSync(env);
  const next = await db
    .prepare(
      'SELECT last_failure_json FROM sync_monitor_checks WHERE workspace_id=?',
    )
    .bind(workspace)
    .first<{ last_failure_json: string }>();
  expect(next?.last_failure_json).toBe(row?.last_failure_json);
  expect(JSON.stringify(next)).not.toContain('private upstream payload');
  expect(send).not.toHaveBeenCalled();
});
