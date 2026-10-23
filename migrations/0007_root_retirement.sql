-- Root retirement is independent of encrypted documents and password changes.
CREATE TABLE IF NOT EXISTS retired_roots (
  root_id TEXT PRIMARY KEY,
  next_root_id TEXT NOT NULL,
  retired_at INTEGER NOT NULL,
  export_started_at INTEGER
);
CREATE TABLE IF NOT EXISTS root_request_leases (
  request_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS root_request_leases_root ON root_request_leases(root_id);
