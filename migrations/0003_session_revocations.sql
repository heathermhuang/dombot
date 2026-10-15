-- Hashes only: a database reader cannot replay a signed password session.
CREATE TABLE IF NOT EXISTS session_revocations (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_revocations_expiry ON session_revocations(expires_at);
