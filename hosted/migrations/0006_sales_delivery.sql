CREATE TABLE sales_email_budgets (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE sales_delivery_receipts (
  attempt_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, outbox_id TEXT NOT NULL,
  state TEXT NOT NULL, provider_receipt TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE sales_dispatch_checkpoints (workspace_id TEXT PRIMARY KEY, next_check_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE sales_verified_recipients (workspace_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, verified_at INTEGER NOT NULL);
