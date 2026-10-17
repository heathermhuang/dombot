CREATE TABLE signup_requests (
 email TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL
);
CREATE TABLE closure_requests (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 requested_at INTEGER NOT NULL,
 purge_after INTEGER NOT NULL
);
