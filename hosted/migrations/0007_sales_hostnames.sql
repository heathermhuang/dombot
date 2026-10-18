CREATE TABLE sales_hostnames (
  hostname TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, listing_id TEXT NOT NULL, domain TEXT NOT NULL,
  epoch INTEGER NOT NULL, status TEXT NOT NULL, challenge_hash TEXT NOT NULL,
  provider_id TEXT, plan TEXT NOT NULL, updated_at INTEGER NOT NULL,
  control_expires_at INTEGER NOT NULL DEFAULT 0, observed_revision TEXT,
  provider_status TEXT, ssl_status TEXT
);
CREATE INDEX sales_hosts_workspace ON sales_hostnames(workspace_id,listing_id);
