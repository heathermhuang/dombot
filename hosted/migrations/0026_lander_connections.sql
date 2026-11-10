-- Only scheduling metadata in control. No credentials, zone snapshots or terms.
CREATE TABLE lander_workspaces (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  due_at INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lander_workspace_due ON lander_workspaces(due_at,lease_until);
ALTER TABLE sales_hostnames ADD COLUMN connection_key TEXT;
ALTER TABLE sales_hostnames ADD COLUMN connection_route_id TEXT;
ALTER TABLE sales_hostnames ADD COLUMN connection_intent TEXT;
ALTER TABLE sales_hostnames ADD COLUMN connection_receipt TEXT;
