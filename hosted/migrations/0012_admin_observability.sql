-- Metrics only: never domain names, credentials, provider messages or tokens.
CREATE TABLE admin_snapshots (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 observed_at INTEGER,
 snapshot TEXT,
 attempted_at INTEGER NOT NULL,
 unavailable INTEGER NOT NULL DEFAULT 0 CHECK(unavailable IN (0,1))
);
CREATE TABLE admin_audit (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('view','refresh')),
 created_at INTEGER NOT NULL
);
CREATE INDEX admin_audit_created ON admin_audit(created_at);
