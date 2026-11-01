-- Preserve pending identities while allowing a marketplace to be the first connection.
CREATE TABLE pending_workspaces_with_markets (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 created_at INTEGER NOT NULL,
 requested_at INTEGER,
 activated_at INTEGER,
 reason TEXT CHECK(reason IN ('registrar','market','import'))
);
INSERT INTO pending_workspaces_with_markets SELECT workspace_id,created_at,requested_at,activated_at,reason FROM pending_workspaces;
DROP TABLE pending_workspaces;
ALTER TABLE pending_workspaces_with_markets RENAME TO pending_workspaces;
