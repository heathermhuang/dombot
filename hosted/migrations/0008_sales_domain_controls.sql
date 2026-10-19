CREATE TABLE sales_domain_controls (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  last_loss_epoch INTEGER NOT NULL DEFAULT 0,
  tenant_ack_epoch INTEGER NOT NULL DEFAULT 0,
  revision TEXT NOT NULL,
  proof TEXT NOT NULL,
  status TEXT NOT NULL,
  observed_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL DEFAULT 0,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,listing_id)
);
CREATE INDEX sales_domain_controls_due ON sales_domain_controls(status,next_check_at);
CREATE INDEX sales_domain_controls_domain ON sales_domain_controls(workspace_id,domain,status);
ALTER TABLE sales_hostnames ADD COLUMN next_check_at INTEGER NOT NULL DEFAULT 0;
