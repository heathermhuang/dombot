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
import { Hono } from 'hono';
import gateway from './gateway';
import { readFileSync, readdirSync } from 'node:fs';
import {
  notificationPreferenceRoutes,
  notificationUnsubscribeUrl,
  pausePortfolioMailForRestore,
} from './notification-preferences';
import {
  reserveNotificationEmail,
  drainNotificationWorkspace,
  drainNotifications,
} from './notification-dispatch';
import { notificationDefaults } from '../shared/notification-policy';
import { tokenHash, passwordHash } from './crypto';
import { salesRecipientHash } from './sales-notifications';
import { Accounts } from './accounts';
import { Passkeys } from './passkeys';
import { issueRecovery } from './registration';
import { drainSecurityNotifications } from './notification-security';
let mf: Miniflare, db: D1Database, env: HostedEnv;
const workspace = '11111111-1111-4111-8111-111111111111',
  user = '22222222-2222-4222-8222-222222222222';
const session = 'aa'.repeat(32),
  email = 'owner@example.com',
  origin = 'https://domains.domains';
const app = notificationPreferenceRoutes();
const request = (
  path: string,
  method = 'GET',
  body?: unknown,
  foreign = false,
) =>
  app.fetch(
    new Request(origin + path, {
      method,
      headers: {
        cookie: '__Host-dd_session=' + session,
        Origin: foreign ? 'https://foreign.example' : origin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'notification-settings' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of readdirSync('hosted/migrations').sort())
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
});
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  for (const t of [
    'notification_preferences',
    'notification_attempts',
    'notification_unsubscribe',
    'notification_security_outbox',
    'sessions',
    'password_resets',
    'sales_verified_recipients',
    'rate_limits',
    'email_budgets',
    'users',
    'workspaces',
  ])
    await db.prepare(`DELETE FROM ${t}`).run();
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: 'synthetic-notification-pepper'.repeat(2),
    NOTIFICATION_POLICY_ENABLED: 'true',
    CANONICAL_ORIGIN: origin,
    GATEWAY_KEYS: '{}',
    WORKSPACES: '[]',
    EMAIL_CAMPAIGN_ID: 'test',
    EMAIL_CAMPAIGN_LIMIT: '1000',
    EMAIL_CAMPAIGN_DAILY_LIMIT: '100',
    NOTIFICATION_MAIL_DAILY_LIMIT: '10',
    NOTIFICATION_MAIL_MONTHLY_LIMIT: '100',
    NOTIFICATION_MAIL_HEADROOM: '20',
  } as HostedEnv;
  await db
    .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
    .bind(workspace, 'Sample')
    .run();
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(
      user,
      email,
      workspace,
      await passwordHash('correct-password-for-test', env.AUTH_PEPPER),
      Date.now(),
    )
    .run();
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) VALUES(?,?,?,?,'email')",
    )
    .bind(await tokenHash(session), user, Date.now() + 600_000, Date.now())
    .run();
});
describe('hosted notification preferences and admission', () => {
  it('does not apply notification body limits to unrelated gateway uploads', async () => {
    const parent = new Hono<{ Bindings: HostedEnv }>();
    parent.route('/', notificationPreferenceRoutes());
    parent.post('/upload', async (c) =>
      c.text(String((await c.req.text()).length)),
    );
    const response = await parent.fetch(
      new Request(origin + '/upload', {
        method: 'POST',
        body: 'x'.repeat(50_000),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('50000');
  });
  it('does not enroll on read, rejects CSRF/stale revisions, and requires real recipient proof', async () => {
    const before = await request('/account/notifications');
    expect(before.status).toBe(200);
    expect(
      ((await before.json()) as { revision: unknown }).revision,
    ).toBeNull();
    const body = {
      preferences: { ...notificationDefaults, renewalReminders: true },
      revision: null,
    };
    expect(
      (await request('/account/notifications', 'PATCH', body, true)).status,
    ).toBe(403);
    expect(
      (await request('/account/notifications', 'PATCH', body)).status,
    ).toBe(409);
    await db
      .prepare(
        'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
      )
      .bind(workspace, salesRecipientHash(env, email), Date.now())
      .run();
    expect(
      (await request('/account/notifications', 'PATCH', body)).status,
    ).toBe(200);
    expect(
      (await request('/account/notifications', 'PATCH', body)).status,
    ).toBe(409);
  });
  it('scanner GET cannot unsubscribe; scoped POST disables only portfolio mail', async () => {
    const prefs = {
      ...notificationDefaults,
      renewalReminders: true,
      weeklyOverview: true,
    };
    await db
      .prepare(
        'INSERT INTO notification_preferences(workspace_id,email_hash,revision,preferences,updated_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        workspace,
        salesRecipientHash(env, email),
        crypto.randomUUID(),
        JSON.stringify(prefs),
        Date.now(),
      )
      .run();
    const url = await notificationUnsubscribeUrl(
      env,
      workspace,
      salesRecipientHash(env, email),
    );
    await app.fetch(new Request(url), env);
    let saved = await db
      .prepare('SELECT preferences FROM notification_preferences')
      .first<{ preferences: string }>();
    expect(JSON.parse(saved!.preferences).renewalReminders).toBe(true);
    expect(
      (
        await app.fetch(
          new Request(url, {
            method: 'POST',
            body: 'List-Unsubscribe=One-Click',
          }),
          env,
        )
      ).status,
    ).toBe(200);
    saved = await db
      .prepare('SELECT preferences FROM notification_preferences')
      .first<{ preferences: string }>();
    expect(JSON.parse(saved!.preferences)).toEqual({
      ...prefs,
      renewalReminders: false,
      weeklyOverview: false,
    });
  });
  it('pauses optional delivery before a restore without disabling conversations or changing timezone', async () => {
    const prefs = {
      ...notificationDefaults,
      renewalReminders: true,
      weeklyOverview: true,
      timeZone: 'Asia/Singapore',
    };
    await db
      .prepare(
        'INSERT INTO notification_preferences(workspace_id,email_hash,revision,preferences,updated_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        workspace,
        salesRecipientHash(env, email),
        crypto.randomUUID(),
        JSON.stringify(prefs),
        Date.now(),
      )
      .run();
    await pausePortfolioMailForRestore(env, workspace);
    const saved = await db
      .prepare('SELECT preferences FROM notification_preferences')
      .first<{ preferences: string }>();
    expect(JSON.parse(saved!.preferences)).toEqual({
      ...prefs,
      renewalReminders: false,
      weeklyOverview: false,
    });
  });
  it('atomically limits optional sends while protecting shared headroom', async () => {
    const admitted = await Promise.all(
      Array.from({ length: 20 }, () => reserveNotificationEmail(env)),
    );
    expect(admitted.filter(Boolean)).toHaveLength(10);
    expect(
      (await db
        .prepare("SELECT count FROM email_budgets WHERE bucket='campaign:test'")
        .first<{ count: number }>())!.count,
    ).toBe(10);
    await db
      .prepare(
        "UPDATE email_budgets SET count=80 WHERE bucket LIKE 'campaign-day:%'",
      )
      .run();
    const before = await db
      .prepare("SELECT count FROM email_budgets WHERE bucket='campaign:test'")
      .first<{ count: number }>();
    expect(await reserveNotificationEmail(env)).toBe(false);
    expect(
      await db
        .prepare("SELECT count FROM email_budgets WHERE bucket='campaign:test'")
        .first(),
    ).toEqual(before);
  });
  it('admits only one concurrent routine envelope while an earlier send is in flight', async () => {
    env.NOTIFICATION_MAIL_ENABLED = 'true';
    env.EMAIL_DELIVERY_VERIFIED = 'true';
    env.EMAIL_FROM = 'accounts@mail.domains.domains';
    const preferences = { ...notificationDefaults, renewalReminders: true };
    await db
      .prepare(
        'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
      )
      .bind(workspace, salesRecipientHash(env, email), Date.now())
      .run();
    await db
      .prepare(
        'INSERT INTO notification_preferences(workspace_id,email_hash,revision,preferences,updated_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        workspace,
        salesRecipientHash(env, email),
        crypto.randomUUID(),
        JSON.stringify(preferences),
        Date.now(),
      )
      .run();
    env.WORKSPACES = JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Sample' },
    ]);
    env.GATEWAY_KEYS = JSON.stringify({
      [workspace]: 'synthetic-notification-proof'.repeat(3),
    });
    env.WORKSPACE_0 = {
      fetch: async (r: Request) => {
        if (new URL(r.url).pathname.endsWith('/lease'))
          return Response.json({
            item: {
              id: crypto.randomUUID(),
              lease: crypto.randomUUID(),
              mail: {
                kind: 'weekly',
                count: 1,
                at: Date.now(),
                rows: [
                  {
                    domain: 'sample.example',
                    date: '2026-12-01',
                    autoRenew: false,
                    stale: false,
                    imported: false,
                    observedAt: Date.now(),
                    price: null,
                    account: 'Sample',
                    failure: null,
                  },
                ],
              },
            },
          });
        return Response.json({ ok: true });
      },
    } as Fetcher;
    let release: (() => void) | undefined,
      started: (() => void) | undefined,
      sends = 0;
    const firstStarted = new Promise<void>((r) => {
      started = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    env.EMAIL = {
      send: async () => {
        sends++;
        started!();
        await hold;
        return { messageId: 'synthetic-message' };
      },
    } as SendEmail;
    const first = drainNotificationWorkspace(env, workspace);
    await firstStarted;
    await drainNotificationWorkspace(env, workspace);
    release!();
    await first;
    expect(sends).toBe(1);
  });
  it('commits one security intent only when the password change commits', async () => {
    const accounts = new Accounts(db, env.AUTH_PEPPER, true),
      u = (await accounts.user(user))!;
    expect(
      await accounts.changePassword(
        u,
        'wrong-password',
        'new-password-for-test',
      ),
    ).toBe(false);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM notification_security_outbox')
        .first<{ n: number }>())!.n,
    ).toBe(0);
    expect(
      await accounts.changePassword(
        u,
        'correct-password-for-test',
        'new-password-for-test',
      ),
    ).toBe(true);
    expect(
      (await db.prepare('SELECT kind FROM notification_security_outbox').all())
        .results,
    ).toEqual([{ kind: 'password-changed' }]);
  });
  it('records one password-reset notice on single-use recovery, never on replay', async () => {
    const accounts = new Accounts(db, env.AUTH_PEPPER, true);
    const code = (await issueRecovery(db, email))!;
    expect(
      await accounts.recoverPassword(code, 'new-password-after-recovery'),
    ).toBe(true);
    expect(
      await accounts.recoverPassword(code, 'another-password-after-recovery'),
    ).toBe(false);
    expect(
      (await db.prepare('SELECT kind FROM notification_security_outbox').all())
        .results,
    ).toEqual([{ kind: 'password-reset' }]);
  });
  it('does not emit a passkey removal notice for another user or a repeated removal', async () => {
    env.NOTIFICATION_SECURITY_ENABLED = 'true';
    await db.prepare("UPDATE sessions SET auth_method='passkey'").run();
    await db
      .prepare(
        'INSERT INTO passkeys(id,user_id,public_key,counter,transports,created_at,revision) VALUES(?,?,?,0,?,?,?)',
      )
      .bind('test-key', user, 'synthetic-only', '[]', Date.now(), 'revision')
      .run();
    const current = (await new Accounts(db, env.AUTH_PEPPER).session(session))!;
    const keys = new Passkeys(env);
    expect(await keys.remove(current, 'foreign-key', session)).toBe(false);
    expect(await keys.remove(current, 'test-key', session)).toBe(true);
    expect(await keys.remove(current, 'test-key', session)).toBe(false);
    expect(
      (await db.prepare('SELECT kind FROM notification_security_outbox').all())
        .results,
    ).toEqual([{ kind: 'passkey-removed' }]);
  });
  it('claims security mail once and never retries a transport-ambiguous send', async () => {
    env.NOTIFICATION_SECURITY_ENABLED = 'true';
    env.EMAIL_DELIVERY_VERIFIED = 'true';
    env.EMAIL_FROM = 'accounts@mail.domains.domains';
    await db
      .prepare(
        'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
      )
      .bind(workspace, salesRecipientHash(env, email), Date.now())
      .run();
    await db
      .prepare(
        "INSERT INTO notification_security_outbox(id,user_id,kind,created_at,due_at) VALUES(?,?,'password-changed',?,0)",
      )
      .bind(crypto.randomUUID(), user, Date.now())
      .run();
    let sends = 0;
    env.EMAIL = {
      send: async () => {
        sends++;
        throw Error('Synthetic connection lost after send');
      },
    } as SendEmail;
    await Promise.all([
      drainSecurityNotifications(env),
      drainSecurityNotifications(env),
    ]);
    await drainSecurityNotifications(env);
    expect(sends).toBe(1);
    expect(
      (await db
        .prepare('SELECT state FROM notification_security_outbox')
        .first<{ state: string }>())!.state,
    ).toBe('unknown');
  });
});

it('persists a late import wake and lets the scheduler retain a provider retry checkpoint', async () => {
  const now = Date.now(),
    laterDailyCheck = now + 23 * 3600_000,
    clock = vi.spyOn(Date, 'now').mockReturnValue(now),
    NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(
        input: ConstructorParameters<typeof NativeRequest>[0],
        init?: RequestInit,
      ) {
        super(input, { ...init, duplex: 'half' } as RequestInit);
      }
    },
  );
  try {
    env.NOTIFICATION_MAIL_ENABLED = 'true';
    env.EMAIL_DELIVERY_VERIFIED = 'true';
    env.EMAIL_FROM = 'accounts@mail.domains.domains';
    env.WORKSPACES = JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Sample' },
    ]);
    env.GATEWAY_KEYS = JSON.stringify({
      [workspace]: 'synthetic-notification-proof'.repeat(3),
    });
    const preferences = { ...notificationDefaults, renewalReminders: true };
    await db
      .prepare(
        'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
      )
      .bind(workspace, salesRecipientHash(env, email), now)
      .run();
    await db
      .prepare(
        'INSERT INTO notification_preferences(workspace_id,email_hash,revision,preferences,next_check_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        workspace,
        salesRecipientHash(env, email),
        crypto.randomUUID(),
        JSON.stringify(preferences),
        laterDailyCheck,
        now,
      )
      .run();
    const id = crypto.randomUUID();
    let dueAt = now;
    const send = vi.fn(async () => {
      throw Object.assign(new Error('Synthetic rate limit'), {
        code: 'E_RATE_LIMIT_EXCEEDED',
      });
    });
    env.EMAIL = { send } as unknown as SendEmail;
    env.WORKSPACE_0 = {
      fetch: async (r: Request) => {
        if (new URL(r.url).pathname.endsWith('/ack')) {
          const ack = (await r.json()) as { state: string };
          if (ack.state === 'retryable') dueAt = Date.now() + 3600_000;
        }
        if (new URL(r.url).pathname.endsWith('/lease')) {
          if (Date.now() < dueAt) return Response.json({ item: null });
          return Response.json({
            item: {
              id,
              lease: crypto.randomUUID(),
              mail: {
                kind: 'urgent',
                count: 1,
                at: now,
                rows: [
                  {
                    domain: 'sample.example',
                    date: new Date(now + 86400_000).toISOString().slice(0, 10),
                    account: 'Imported',
                    autoRenew: null,
                    stale: false,
                    imported: true,
                    observedAt: null,
                    price: null,
                    failure: null,
                  },
                ],
              },
            },
          });
        }
        return Response.json({ ok: true, result: { counts: { new: 1 } } });
      },
    } as Fetcher;
    const importOnce = async () => {
      const pending: Promise<unknown>[] = [];
      const response = await gateway.fetch(
        new Request(origin + '/w/' + workspace + '/api/importDomains', {
          method: 'POST',
          headers: {
            Cookie: '__Host-dd_session=' + session,
            Origin: origin,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            args: [
              [{ domainName: 'sample.example' }],
              { importId: crypto.randomUUID() },
            ],
          }),
        }),
        env,
        {
          waitUntil: (p: Promise<unknown>) => pending.push(p),
          passThroughOnException: () => {},
        } as unknown as ExecutionContext,
      );
      expect(response.status).toBe(200);
      await response.body?.cancel();
      await Promise.all(pending);
    };
    await importOnce();
    const wake = await db
      .prepare(
        'SELECT next_check_at,wake_generation FROM notification_preferences WHERE workspace_id=?',
      )
      .bind(workspace)
      .first();
    expect(wake).toEqual({ next_check_at: 0, wake_generation: 1 });
    expect(send).not.toHaveBeenCalled();
    await drainNotifications(env);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await db
        .prepare(
          'SELECT next_check_at FROM notification_preferences WHERE workspace_id=?',
        )
        .bind(workspace)
        .first(),
    ).toEqual({ next_check_at: now + 3600_000 });
    expect(
      await db
        .prepare('SELECT state FROM notification_attempts WHERE workspace_id=?')
        .bind(workspace)
        .first(),
    ).toEqual({ state: 'retryable' });
    // A new mutation while the tenant outbox is backing off must not lose its due time.
    clock.mockReturnValue(now + 5 * 60_000);
    await importOnce();
    for (const minutes of [5, 20, 35, 50]) {
      clock.mockReturnValue(now + minutes * 60_000);
      await drainNotifications(env);
      const checkpoint = await db
        .prepare(
          'SELECT next_check_at FROM notification_preferences WHERE workspace_id=?',
        )
        .bind(workspace)
        .first<{ next_check_at: number }>();
      expect(checkpoint!.next_check_at).toBeLessThanOrEqual(now + 3600_000);
      expect(send).toHaveBeenCalledTimes(1);
    }
    clock.mockReturnValue(now + 3600_000);
    await drainNotifications(env);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      await db
        .prepare(
          'SELECT next_check_at FROM notification_preferences WHERE workspace_id=?',
        )
        .bind(workspace)
        .first(),
    ).toEqual({ next_check_at: now + 2 * 3600_000 });
  } finally {
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});
