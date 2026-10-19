CREATE TABLE sales_control_leases (
  listing_id TEXT PRIMARY KEY REFERENCES sale_drafts(id) ON DELETE CASCADE,
  domain_hash TEXT NOT NULL,
  proof_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  review_after INTEGER NOT NULL DEFAULT 0,
  observed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
