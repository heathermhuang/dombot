-- Operator-owned registry. Provisioning alone never opens a signup slot.
CREATE TABLE platform_workspaces (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  database_id TEXT NOT NULL UNIQUE,
  gateway_key_box TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  qualified_at INTEGER NOT NULL DEFAULT 0,
  signup_enabled INTEGER NOT NULL DEFAULT 0 CHECK(signup_enabled IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX platform_signup_ready ON platform_workspaces(signup_enabled,qualified_at);
