-- Additive and private. External write intents are retained for reconciliation.
CREATE TABLE lander_jobs (
  id TEXT PRIMARY KEY, selection_hash TEXT NOT NULL, state TEXT NOT NULL,
  total INTEGER NOT NULL, digest TEXT, expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lander_items (
  job_id TEXT NOT NULL REFERENCES lander_jobs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, domain_hash TEXT NOT NULL, listing_id TEXT,
  state TEXT NOT NULL, sealed TEXT NOT NULL, digest TEXT,
  generation TEXT NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0, reason TEXT,
  PRIMARY KEY(job_id,ordinal)
);
CREATE INDEX lander_due ON lander_items(state,due_at,lease_until);
CREATE TABLE lander_domain_locks (
  domain_hash TEXT PRIMARY KEY, job_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  generation TEXT NOT NULL
);
CREATE TABLE lander_recovery_archive (
  id TEXT PRIMARY KEY, sealed TEXT NOT NULL, restored_at INTEGER NOT NULL
);
