-- An immutable portfolio identity is cheap control metadata, not a deployed tenant.
-- Keep this marker after activation so a rollback never allocates its identity again.
CREATE TABLE pending_workspaces (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  created_at INTEGER NOT NULL,
  requested_at INTEGER,
  activated_at INTEGER,
  reason TEXT CHECK(reason IN ('registrar','import'))
);
