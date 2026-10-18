ALTER TABLE sessions ADD COLUMN authenticated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'legacy';
CREATE TABLE email_signins (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 code_hash TEXT NOT NULL,
 email TEXT NOT NULL,
 user_id TEXT,
 credential_hash TEXT,
 intent TEXT NOT NULL CHECK(intent IN ('login','reauth')),
 session_hash TEXT,
 next_path TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 consumption_id TEXT UNIQUE,
 consumed_at INTEGER
);
CREATE INDEX email_signins_email ON email_signins(email,intent);
CREATE TABLE passkeys (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 public_key TEXT NOT NULL,
 counter INTEGER NOT NULL,
 transports TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER,
 revision TEXT NOT NULL
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TABLE webauthn_challenges (
 id TEXT PRIMARY KEY,
 challenge TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('register','login','reauth')),
 user_id TEXT,
 session_hash TEXT,
 credential_hash TEXT,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 consumption_id TEXT UNIQUE
);
