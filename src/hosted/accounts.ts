import { opaqueToken, passwordHash, tokenHash, verifyPassword } from './crypto';

export interface SessionUser {
  id: string;
  email: string;
  workspace_id: string;
  label: string;
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
  ): Promise<SessionUser> {
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
    return (await this.user(id))!;
  }
  async login(email: string, password: string): Promise<SessionUser | null> {
    const row = await this.db
      .prepare(
        'SELECT u.id,u.password_hash FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.email=?1 AND w.enabled=1',
      )
      .bind(email)
      .first<{ id: string; password_hash: string }>();
    // Still perform the expensive operation for an unknown address.
    const record =
      row?.password_hash ?? `scrypt-v1:${'0'.repeat(64)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(password, record, this.pepper);
    return valid && row ? this.user(row.id) : null;
  }
  async user(id: string): Promise<SessionUser | null> {
    return this.db
      .prepare(
        'SELECT u.id,u.email,u.workspace_id,w.label FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?1 AND w.enabled=1',
      )
      .bind(id)
      .first<SessionUser>();
  }
  async newSession(user: SessionUser): Promise<string> {
    const token = opaqueToken();
    await this.db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?1,?2,?3)',
      )
      .bind(await tokenHash(token), user.id, Date.now() + 7 * 86400_000)
      .run();
    return token;
  }
  async session(token: string | undefined): Promise<SessionUser | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db
      .prepare(
        'SELECT u.id,u.email,u.workspace_id,w.label FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token_hash=?1 AND s.expires_at>?2 AND w.enabled=1',
      )
      .bind(await tokenHash(token), Date.now())
      .first<SessionUser>();
  }
  async logout(token: string | undefined): Promise<void> {
    if (token)
      await this.db
        .prepare('DELETE FROM sessions WHERE token_hash=?1')
        .bind(await tokenHash(token))
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
    if (!(await this.login(user.email, oldPassword))) return false;
    await this.db.batch([
      this.db
        .prepare('UPDATE users SET password_hash=?1 WHERE id=?2')
        .bind(await passwordHash(nextPassword, this.pepper), user.id),
      this.db.prepare('DELETE FROM sessions WHERE user_id=?1').bind(user.id),
    ]);
    return true;
  }
}
