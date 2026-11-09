CREATE TABLE notification_preferences (
  workspace_id TEXT PRIMARY KEY REFERENCES users(workspace_id) ON DELETE CASCADE, email_hash TEXT NOT NULL, revision TEXT NOT NULL,
  preferences TEXT NOT NULL, next_check_at INTEGER NOT NULL DEFAULT 0,
  last_weekly_at INTEGER, weekly_claimed_at INTEGER, weekly_envelope_id TEXT, wake_generation INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notification_preferences_due ON notification_preferences(next_check_at,lease_until);
CREATE TABLE notification_attempts (
  attempt_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES notification_preferences(workspace_id) ON DELETE CASCADE, envelope_id TEXT NOT NULL,
  lease_token TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
  provider_receipt TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id,envelope_id,lease_token)
);
CREATE INDEX notification_attempts_health ON notification_attempts(workspace_id,state,updated_at);
CREATE INDEX notification_attempts_pending ON notification_attempts(state,updated_at);
CREATE TABLE notification_unsubscribe (
  token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES notification_preferences(workspace_id) ON DELETE CASCADE, email_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE notification_cas_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE notification_security_outbox (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, due_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
  provider_receipt TEXT
);
