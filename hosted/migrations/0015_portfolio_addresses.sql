-- Public handles are separate from immutable account IDs and private inventory.
-- Keep claims after closure: an old public identity must not be reassigned.
CREATE TABLE portfolio_addresses (
 handle TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
 created_at INTEGER NOT NULL
);
