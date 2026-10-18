import { opaqueToken, passwordHash, tokenHash, verifyPassword } from './crypto';

export interface SessionUser {
  id: string;
  email: string;
  workspace_id: string;
  label: string;
  authenticated_at?: number;
  auth_method?: string;
}
export interface VerifiedUser extends SessionUser {
  credentialHash: string;
  authMethod?: string;
}
export class AccountError extends Error {}
export class Accounts {
  constructor(
    private readonly db: D1Database,
    private readonly pepper: string,
  ) {}

  async claimInvite(
    email: string,
    password: string,
    code: string,
  ): Promise<VerifiedUser> {
    const hash = await tokenHash(code);
    const invite = await this.db
      .prepare(
        'SELECT i.workspace_id FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?1 AND i.email=?2 AND i.consumed_at IS NULL AND i.expires_at>?3 AND w.enabled=1',
      )
      .bind(hash, email, Date.now())
      .first<{ workspace_id: string }>();
    if (!invite)
      throw new AccountError(
        'This invitation is invalid, expired, or already used.',
      );
    const id = crypto.randomUUID();
    const encoded = await passwordHash(password, this.pepper);
    // The unique workspace and email constraints plus this transaction prevent
    // duplicate accounts or two claimants taking the same reserved workspace.
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            'INSERT INTO users(id,email,workspace_id,password_hash,created_at) SELECT ?1,?2,i.workspace_id,?3,?4 FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?5 AND i.email=?2 AND i.consumed_at IS NULL AND i.expires_at>?4 AND w.enabled=1 RETURNING id',
          )
          .bind(id, email, encoded, Date.now(), hash),
        this.db
          .prepare(
            'UPDATE invitations SET consumed_at=?1 WHERE token_hash=?2 AND EXISTS(SELECT 1 FROM users WHERE id=?3)',
          )
          .bind(Date.now(), hash, id),
      ]);
      if (!results[0].results.length)
        throw new AccountError('The invitation has already been claimed.');
    } catch {
      throw new AccountError(
        'Could not claim this invitation. It may already be in use.',
      );
    }
    const user = await this.user(id);
    if (!user) throw new AccountError('Account is unavailable');
    return { ...user, credentialHash: encoded };
  }
  async login(email: string, password: string): Promise<VerifiedUser | null> {
    const row = await this.db
      .prepare(
        'SELECT u.id,u.password_hash FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.email=?1 AND w.enabled=1',
      )
      .bind(email)
      .first<{ id: string; password_hash: string }>();
    // Still perform the expensive operation for an unknown address.
    const record = row?.password_hash.startsWith('scrypt-v1:')
      ? row.password_hash
      : `scrypt-v1:${'0'.repeat(64)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(password, record, this.pepper);
    const user = valid && row ? await this.user(row.id) : null;
    return user && row ? { ...user, credentialHash: row.password_hash } : null;
  }
  async user(id: string): Promise<SessionUser | null> {
    return this.db
      .prepare(
        'SELECT u.id,u.email,u.workspace_id,w.label FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?1 AND w.enabled=1',
      )
      .bind(id)
      .first<SessionUser>();
  }
  async newSession(user: VerifiedUser): Promise<string | null> {
    const token = opaqueToken();
    const result = await this.db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) SELECT ?1,u.id,?3,?5,?6 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?2 AND u.password_hash=?4 AND w.enabled=1 RETURNING user_id',
      )
      .bind(
        await tokenHash(token),
        user.id,
        Date.now() + 7 * 86400_000,
        user.credentialHash,
        Date.now(),
        user.authMethod ?? 'password',
      )
      .all();
    return result.results.length === 1 ? token : null;
  }
  async session(token: string | undefined): Promise<SessionUser | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db
      .prepare(
        'SELECT u.id,u.email,u.workspace_id,w.label,s.authenticated_at,s.auth_method FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token_hash=?1 AND s.expires_at>?2 AND w.enabled=1',
      )
      .bind(await tokenHash(token), Date.now())
      .first<SessionUser>();
  }
  async logout(token: string | undefined): Promise<void> {
    if (token && /^[a-f0-9]{64}$/.test(token))
      await this.db
        .prepare('DELETE FROM sessions WHERE token_hash=?1')
        .bind(await tokenHash(token))
        .run();
  }
  async logoutAll(user: SessionUser): Promise<void> {
    await this.db
      .prepare('DELETE FROM sessions WHERE user_id=?1')
      .bind(user.id)
      .run();
  }
  async rateLimit(key: string, limit: number): Promise<boolean> {
    const bucket = `${await tokenHash(key)}:${Math.floor(Date.now() / 600_000)}`;
    const row = await this.db
      .prepare(
        'INSERT INTO rate_limits(key,count,expires_at) VALUES(?1,1,?2) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
      )
      .bind(bucket, Date.now() + 600_000)
      .first<{ count: number }>();
    return !!row && row.count <= limit;
  }
  async changePassword(
    user: SessionUser,
    oldPassword: string,
    nextPassword: string,
  ): Promise<boolean> {
    const verified = await this.login(user.email, oldPassword);
    if (!verified) return false;
    const encoded = await passwordHash(nextPassword, this.pepper);
    const results = await this.db.batch([
      this.db
        .prepare(
          'UPDATE users SET password_hash=?1 WHERE id=?2 AND password_hash=?3 AND workspace_id IN (SELECT id FROM workspaces WHERE enabled=1) RETURNING id',
        )
        .bind(encoded, user.id, verified.credentialHash),
      this.db
        .prepare(
          'DELETE FROM sessions WHERE user_id=?1 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND password_hash=?2)',
        )
        .bind(user.id, encoded),
      this.db
        .prepare(
          'DELETE FROM password_resets WHERE user_id=?1 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND password_hash=?2)',
        )
        .bind(user.id, encoded),
    ]);
    return results[0].results.length === 1;
  }

  /** Operator-issued proof is consumed atomically with password/session changes. */
  async recoverPassword(code: string, nextPassword: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(code)) return false;
    const hash = await tokenHash(code);
    const now = Date.now();
    const eligible = await this.db
      .prepare(
        'SELECT r.user_id FROM password_resets r JOIN users u ON u.id=r.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE r.token_hash=?1 AND r.expires_at>?2 AND r.consumed_at IS NULL AND w.enabled=1',
      )
      .bind(hash, now)
      .first();
    if (!eligible) return false;
    const encoded = await passwordHash(nextPassword, this.pepper);
    const consumption = opaqueToken();
    const committedAt = Date.now();
    const result = await this.db.batch([
      this.db
        .prepare(
          'UPDATE password_resets SET consumed_at=?1,consumption_id=?2 WHERE token_hash=?3 AND consumed_at IS NULL AND expires_at>?1 AND user_id IN (SELECT u.id FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.enabled=1) RETURNING user_id',
        )
        .bind(committedAt, consumption, hash),
      this.db
        .prepare(
          'UPDATE users SET password_hash=?1 WHERE id IN (SELECT user_id FROM password_resets WHERE consumption_id=?2)',
        )
        .bind(encoded, consumption),
      this.db
        .prepare(
          'DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM password_resets WHERE consumption_id=?1)',
        )
        .bind(consumption),
    ]);
    return result[0].results.length === 1;
  }
}
