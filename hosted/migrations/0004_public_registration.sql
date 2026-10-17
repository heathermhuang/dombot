CREATE TABLE signup_proofs (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE legal_acceptances (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE TABLE email_budgets (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
