import { Accounts, AccountError, type VerifiedUser } from './accounts';
import { opaqueToken, passwordHash, tokenHash } from './crypto';
import { legalReady, legalVersion } from './legal';
import { workspaceSchema } from './workspaces';

export function registrationIds(env: HostedEnv): string[] {
  const configured = workspaceSchema.parse(JSON.parse(env.WORKSPACES));
  const ids = (env.PUBLIC_SIGNUP_IDS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    ids.length > 10 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !configured.some((w) => w.id === id))
  )
    return [];
  return ids;
}
export function emailReady(env: HostedEnv): boolean {
  return Boolean(
    env.EMAIL &&
    env.EMAIL_FROM === 'accounts@mail.domains.domains' &&
    env.EMAIL_DELIVERY_VERIFIED === 'true' &&
    env.CANONICAL_ORIGIN === 'https://domains.domains',
  );
}
export function registrationReady(env: HostedEnv): boolean {
  return (
    env.PUBLIC_REGISTRATION_ENABLED === 'true' &&
    emailReady(env) &&
    legalReady(env) &&
    registrationIds(env).length > 0
  );
}
const eligible = `w.enabled=1 AND NOT EXISTS(SELECT 1 FROM users u WHERE u.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM invitations i WHERE i.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM closure_requests r WHERE r.workspace_id=w.id)`;
export class Registration {
  constructor(
    private readonly db: D1Database,
    private readonly pepper: string,
    private readonly ids: string[],
  ) {}
  private slots() {
    return this.ids.map(() => '?').join(',');
  }
  async hasCapacity(): Promise<boolean> {
    if (!this.ids.length) return false;
    return Boolean(
      await this.db
        .prepare(
          `SELECT w.id FROM workspaces w WHERE w.id IN (${this.slots()}) AND ${eligible} LIMIT 1`,
        )
        .bind(...this.ids)
        .first(),
    );
  }
  async issue(email: string): Promise<string | null> {
    if (!(await this.hasCapacity())) return null;
    if (
      await this.db
        .prepare('SELECT id FROM users WHERE email=?1')
        .bind(email)
        .first()
    )
      return null;
    const code = opaqueToken();
    const row = await this.db
      .prepare(
        'INSERT INTO signup_proofs(token_hash,email,expires_at) SELECT ?1,?2,?3 WHERE (SELECT count(*) FROM signup_proofs)<500 ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,consumed_at=NULL RETURNING email',
      )
      .bind(await tokenHash(code), email, Date.now() + 20 * 60_000)
      .first();
    return row ? code : null;
  }
  async emailFor(code: string): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(code)) return null;
    const row = await this.db
      .prepare(
        'SELECT email FROM signup_proofs WHERE token_hash=?1 AND consumed_at IS NULL AND expires_at>?2',
      )
      .bind(await tokenHash(code), Date.now())
      .first<{ email: string }>();
    return row?.email ?? null;
  }
  async claim(code: string, password: string): Promise<VerifiedUser> {
    if (!this.ids.length || !(await this.emailFor(code)))
      throw new AccountError(
        'This verification link is invalid, expired, or already used.',
      );
    const id = crypto.randomUUID(),
      encoded = await passwordHash(password, this.pepper),
      hash = await tokenHash(code),
      now = Date.now();
    try {
      // D1 batch is transactional. Unique email and account constraints serialize
      // simultaneous claims. A consumed proof can never allocate a second slot.
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO users(id,email,workspace_id,password_hash,created_at) SELECT ?1,p.email,w.id,?2,?3 FROM signup_proofs p CROSS JOIN workspaces w WHERE p.token_hash=?4 AND p.consumed_at IS NULL AND p.expires_at>?3 AND w.id IN (${this.ids.map((_, i) => `?${i + 5}`).join(',')}) AND ${eligible} ORDER BY w.id LIMIT 1 RETURNING id`,
          )
          .bind(id, encoded, now, hash, ...this.ids),
        this.db
          .prepare(
            'UPDATE signup_proofs SET consumed_at=?1 WHERE token_hash=?2 AND EXISTS(SELECT 1 FROM users WHERE id=?3)',
          )
          .bind(now, hash, id),
        this.db
          .prepare(
            'INSERT INTO legal_acceptances(user_id,terms_version,privacy_version,accepted_at) SELECT id,?2,?2,?3 FROM users WHERE id=?1',
          )
          .bind(id, legalVersion, now),
      ]);
      if (!results[0].results.length)
        throw new AccountError(
          'No account was created. The link may have expired or capacity may be full.',
        );
    } catch {
      throw new AccountError(
        'No account was created. The link may have been used or capacity may be full.',
      );
    }
    const user = await new Accounts(this.db, this.pepper).user(id);
    if (!user) throw new AccountError('Account is unavailable.');
    return { ...user, credentialHash: encoded };
  }
}

/** Fixed sender/content, shared durable quota; no input is used as an email header. */
export async function sendAccountEmail(
  env: HostedEnv,
  email: string,
  code: string,
  kind: 'signup' | 'recovery',
): Promise<boolean> {
  const url = new URL(
    kind === 'signup' ? '/signup/verify' : '/recover',
    env.CANONICAL_ORIGIN,
  );
  url.searchParams.set('code', code);
  return sendAuthEmail(env, email, {
    subject:
      kind === 'signup'
        ? 'Verify your email for domains.domains'
        : 'Reset your domains.domains password',
    text: `${kind === 'signup' ? 'Verify your email to start using hosted DomBot' : 'Set a new password for your domains.domains sign-in'}:\n\n${url.href}\n\nThis link expires in ${kind === 'signup' ? 20 : 15} minutes and can be used once. If you did not request this, ignore this email. Your account has not been changed.\n\ndomains.domains`,
  });
}

/** Reserve the shared transactional quota before every auth email. */
export async function sendAuthEmail(
  env: HostedEnv,
  email: string,
  content: { subject: string; text: string; html?: string },
): Promise<boolean> {
  if (!emailReady(env)) return false;
  const now = new Date();
  const buckets = [
    {
      key: `day:${now.toISOString().slice(0, 10)}`,
      limit: 30,
      expires: Date.now() + 2 * 86400_000,
    },
    {
      key: `month:${now.toISOString().slice(0, 7)}`,
      limit: 300,
      expires: Date.now() + 32 * 86400_000,
    },
  ];
  // Reserve both quotas before sending. Failed sends remain charged to prevent
  // provider-error retry storms; no paid-overage auto-upgrade is performed.
  const limits = await env.CONTROL_DB.batch(
    buckets.map((b) =>
      env.CONTROL_DB.prepare(
        'INSERT INTO email_budgets(bucket,count,expires_at) VALUES(?1,1,?2) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',
      ).bind(b.key, b.expires),
    ),
  );
  if (
    limits.some(
      (r, i) =>
        Number((r.results[0] as { count: number }).count) > buckets[i].limit,
    )
  )
    return false;
  try {
    await env.EMAIL!.send({
      from: { email: env.EMAIL_FROM!, name: 'domains.domains' },
      to: email,
      ...content,
    });
    return true;
  } catch {
    return false;
  }
}

export async function issueRecovery(
  db: D1Database,
  email: string,
): Promise<string | null> {
  const code = opaqueToken();
  const row = await db
    .prepare(
      "INSERT INTO password_resets(token_hash,user_id,expires_at,operator_case) SELECT ?1,u.id,?2,'self-service-email-proof' FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.email=?3 AND w.enabled=1 ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,consumed_at=NULL,consumption_id=NULL,operator_case=excluded.operator_case RETURNING user_id",
    )
    .bind(await tokenHash(code), Date.now() + 15 * 60_000, email)
    .first();
  return row ? code : null;
}
