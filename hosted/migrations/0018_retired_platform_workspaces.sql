-- Permanent custody for explicitly authorized, exact-manifest reserve retirement.
-- Keep the workspace identity disabled; remove its active platform registry entry
-- only after copying that original encrypted mapping into this operator audit.
CREATE TABLE IF NOT EXISTS retired_platform_workspaces (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  database_id TEXT NOT NULL,
  dispatch_namespace TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  registry_json TEXT NOT NULL,
  retired_at INTEGER NOT NULL,
  worker_deleted_at INTEGER,
  database_deleted_at INTEGER
);
