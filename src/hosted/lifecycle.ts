import type { SessionUser } from './accounts';

/** A public request never allocates a Worker, key, database or workspace identity. */
export async function requestAccess(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'INSERT INTO signup_requests(email,created_at) SELECT ?1,?2 WHERE (SELECT count(*) FROM signup_requests)<100 ON CONFLICT(email) DO UPDATE SET created_at=signup_requests.created_at RETURNING email',
    )
    .bind(email, Date.now())
    .first();
  return Boolean(row);
}

/** Suspend before returning; gateway checks the row for every browser/MCP request.
 * Physical deletion is an operator job after retention, never a reusable slot. */
export async function closeWorkspace(
  db: D1Database,
  user: SessionUser,
  credentialHash: string,
): Promise<boolean> {
  const now = Date.now();
  const results = await db.batch([
    db
      .prepare(
        'UPDATE workspaces SET enabled=0 WHERE id=?1 AND enabled=1 AND EXISTS(SELECT 1 FROM users WHERE id=?2 AND workspace_id=?1 AND password_hash=?3) RETURNING id',
      )
      .bind(user.workspace_id, user.id, credentialHash),
    db
      .prepare(
        'INSERT OR IGNORE INTO closure_requests(workspace_id,user_id,requested_at,purge_after) SELECT w.id,?2,?3,?4 FROM workspaces w JOIN users u ON u.workspace_id=w.id WHERE w.id=?1 AND w.enabled=0 AND u.id=?2 AND u.password_hash=?5',
      )
      .bind(
        user.workspace_id,
        user.id,
        now,
        now + 30 * 86400_000,
        credentialHash,
      ),
    db
      .prepare(
        'DELETE FROM sessions WHERE user_id=?1 AND EXISTS(SELECT 1 FROM closure_requests WHERE user_id=?1)',
      )
      .bind(user.id),
    db
      .prepare(
        'DELETE FROM password_resets WHERE user_id=?1 AND EXISTS(SELECT 1 FROM closure_requests WHERE user_id=?1)',
      )
      .bind(user.id),
  ]);
  return results[0].results.length === 1;
}
