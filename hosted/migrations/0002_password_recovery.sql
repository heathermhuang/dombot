CREATE TABLE password_resets (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 consumption_id TEXT UNIQUE,
 operator_case TEXT NOT NULL
);
CREATE INDEX password_resets_user ON password_resets(user_id);

CREATE UNIQUE INDEX invitations_email ON invitations(email);
