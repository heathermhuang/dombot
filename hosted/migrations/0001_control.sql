PRAGMA foreign_keys = ON;
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);
CREATE TABLE invitations (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER
);
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
 password_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
