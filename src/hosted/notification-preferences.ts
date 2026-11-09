import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Accounts, type SessionUser } from './accounts';
const readSession = (r: Request) =>
  r.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) =>
      s.startsWith(
        (new URL(r.url).protocol === 'https:'
          ? '__Host-dd_session'
          : 'dd_session') + '=',
      ),
    )
    ?.split('=')[1];
import { opaqueToken, tokenHash } from './crypto';
import {
  notificationDefaults,
  notificationPreferencesSchema,
  type NotificationPreferences,
} from '../shared/notification-policy';
import { salesRecipientHash, salesRecipient } from './sales-notifications';
import { page } from './views';

export interface SavedNotificationPreferences {
  workspace_id: string;
  email_hash: string;
  revision: string;
  preferences: string;
  next_check_at: number;
  last_weekly_at: number | null;
  weekly_claimed_at: number | null;
  weekly_envelope_id: string | null;
}
export async function getNotificationPreferences(
  env: HostedEnv,
  workspace: string,
) {
  return env.CONTROL_DB.prepare(
    'SELECT * FROM notification_preferences WHERE workspace_id=?',
  )
    .bind(workspace)
    .first<SavedNotificationPreferences>();
}
/** Pause before restore starts, including an outcome that later becomes uncertain. */
export async function pausePortfolioMailForRestore(
  env: HostedEnv,
  workspace: string,
) {
  if (env.NOTIFICATION_POLICY_ENABLED !== 'true') return;
  await env.CONTROL_DB.prepare(
    "UPDATE notification_preferences SET preferences=json_set(preferences,'$.renewalReminders',json('false'),'$.weeklyOverview',json('false')),revision=?,next_check_at=0,updated_at=? WHERE workspace_id=?",
  )
    .bind(crypto.randomUUID(), Date.now(), workspace)
    .run();
}
export async function ownerInquiryEmails(env: HostedEnv, workspace: string) {
  if (env.NOTIFICATION_POLICY_ENABLED !== 'true') return true;
  const saved = await getNotificationPreferences(env, workspace);
  return saved
    ? notificationPreferencesSchema.parse(JSON.parse(saved.preferences))
        .inquiryEmails
    : true;
}
export async function saveNotificationPreferences(
  env: HostedEnv,
  user: SessionUser,
  preferences: NotificationPreferences,
  revision: string | null,
) {
  const hash = salesRecipientHash(env, user.email),
    nextRevision = crypto.randomUUID();
  if (revision === null) {
    return env.CONTROL_DB.prepare(
      'INSERT INTO notification_preferences(workspace_id,email_hash,revision,preferences,updated_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING revision',
    )
      .bind(
        user.workspace_id,
        hash,
        nextRevision,
        JSON.stringify(preferences),
        Date.now(),
      )
      .first();
  }
  return env.CONTROL_DB.prepare(
    'UPDATE notification_preferences SET preferences=?,email_hash=?,revision=?,next_check_at=0,updated_at=? WHERE workspace_id=? AND revision=? RETURNING revision',
  )
    .bind(
      JSON.stringify(preferences),
      hash,
      nextRevision,
      Date.now(),
      user.workspace_id,
      revision,
    )
    .first();
}
export async function notificationUnsubscribeUrl(
  env: HostedEnv,
  workspace: string,
  hash: string,
) {
  const raw = opaqueToken();
  await env.CONTROL_DB.prepare(
    'INSERT INTO notification_unsubscribe(token_hash,workspace_id,email_hash,expires_at) VALUES(?,?,?,?)',
  )
    .bind(await tokenHash(raw), workspace, hash, Date.now() + 90 * 86400_000)
    .run();
  return `${env.CANONICAL_ORIGIN}/email/unsubscribe/${raw}`;
}
export function notificationPreferenceRoutes() {
  const app = new Hono<{ Bindings: HostedEnv }>();
  app.get('/account/notifications', async (c) => {
    if (c.env.NOTIFICATION_POLICY_ENABLED !== 'true')
      return c.json({ error: 'Notification settings are not enabled.' }, 404);
    const user = await new Accounts(
      c.env.CONTROL_DB,
      c.env.AUTH_PEPPER,
    ).session(readSession(c.req.raw));
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const saved = await getNotificationPreferences(c.env, user.workspace_id);
    const deliveries = (
      await c.env.CONTROL_DB.prepare(
        'SELECT state,count(*) AS count FROM notification_attempts WHERE workspace_id=? GROUP BY state',
      )
        .bind(user.workspace_id)
        .all()
    ).results;
    const security = (
      await c.env.CONTROL_DB.prepare(
        'SELECT state,count(*) AS count FROM notification_security_outbox WHERE user_id=? GROUP BY state',
      )
        .bind(user.id)
        .all()
    ).results;
    return c.json({
      preferences: saved
        ? notificationPreferencesSchema.parse(JSON.parse(saved.preferences))
        : notificationDefaults,
      revision: saved?.revision ?? null,
      verified: (await salesRecipient(c.env, user.workspace_id, user.email))
        .verified,
      deliveryEnabled: c.env.NOTIFICATION_MAIL_ENABLED === 'true',
      deliveries: [...deliveries, ...security],
    });
  });
  app.patch(
    '/account/notifications',
    bodyLimit({ maxSize: 4096 }),
    async (c) => {
      if (c.env.NOTIFICATION_POLICY_ENABLED !== 'true')
        return c.json({ error: 'Notification settings are not enabled.' }, 404);
      if (c.req.header('origin') !== new URL(c.req.url).origin)
        return c.json({ error: 'Bad origin' }, 403);
      const accounts = new Accounts(c.env.CONTROL_DB, c.env.AUTH_PEPPER);
      const user = await accounts.session(readSession(c.req.raw));
      if (!user) return c.json({ error: 'Sign in first.' }, 401);
      if (!(await accounts.rateLimit(`notification-settings:${user.id}`, 30)))
        return c.json({ error: 'Please try again later.' }, 429);
      const parsed = z
        .object({
          preferences: notificationPreferencesSchema,
          revision: z.string().uuid().nullable(),
        })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json(
          { error: 'Check the notification settings and timezone.' },
          400,
        );
      const { preferences, revision } = parsed.data;
      if (
        (preferences.renewalReminders || preferences.weeklyOverview) &&
        !(await salesRecipient(c.env, user.workspace_id, user.email)).verified
      )
        return c.json(
          {
            error:
              'Verify your account email using an email sign-in before enabling reminders.',
          },
          409,
        );
      if (
        !(await saveNotificationPreferences(c.env, user, preferences, revision))
      )
        return c.json(
          { error: 'Settings changed in another tab. Reload before saving.' },
          409,
        );
      const saved = await getNotificationPreferences(c.env, user.workspace_id);
      return c.json({ preferences, revision: saved!.revision });
    },
  );
  app.get('/email/unsubscribe/:token', async (c) =>
    c.html(
      page(
        'Email preferences',
        '<h1>Stop portfolio emails</h1><p>This stops renewal reminders and weekly overviews. Inquiry replies, requested sign-in emails and security messages are separate.</p><form method="post"><button type="submit">Stop portfolio emails</button></form>',
      ),
    ),
  );
  app.post(
    '/email/unsubscribe/:token',
    bodyLimit({ maxSize: 4096 }),
    async (c) => {
      const raw = c.req.param('token');
      if (!/^[a-f0-9]{64}$/.test(raw))
        return c.text('This preference link is invalid.', 400);
      const grant = await c.env.CONTROL_DB.prepare(
        'SELECT workspace_id,email_hash FROM notification_unsubscribe WHERE token_hash=? AND expires_at>?',
      )
        .bind(await tokenHash(raw), Date.now())
        .first<{ workspace_id: string; email_hash: string }>();
      if (!grant)
        return c.html(
          page(
            'Email preferences',
            '<h1>This preference link expired</h1><p>Sign in to change your notification settings.</p>',
          ),
          410,
        );
      const saved = await getNotificationPreferences(c.env, grant.workspace_id);
      if (saved && saved.email_hash === grant.email_hash) {
        const preferences = notificationPreferencesSchema.parse(
          JSON.parse(saved.preferences),
        );
        preferences.renewalReminders = false;
        preferences.weeklyOverview = false;
        await c.env.CONTROL_DB.prepare(
          'UPDATE notification_preferences SET preferences=?,revision=?,next_check_at=0,updated_at=? WHERE workspace_id=? AND email_hash=?',
        )
          .bind(
            JSON.stringify(preferences),
            crypto.randomUUID(),
            Date.now(),
            grant.workspace_id,
            grant.email_hash,
          )
          .run();
      }
      return c.html(
        page(
          'Email preferences',
          '<h1>Portfolio emails stopped</h1><p>You can turn them on again in Settings → Notifications.</p>',
        ),
      );
    },
  );
  return app;
}
