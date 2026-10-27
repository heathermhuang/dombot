-- Sanitized operational diagnostics only; no provider messages or credentials.
CREATE TABLE sync_monitor_control (id INTEGER PRIMARY KEY CHECK(id=1), lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, completed_at INTEGER);
INSERT INTO sync_monitor_control(id) VALUES(1);
CREATE TABLE sync_monitor_checks (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), revision TEXT, seq INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, error_since INTEGER, error_alerted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sync_monitor_events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), account_id TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, diagnostic TEXT NOT NULL, UNIQUE(workspace_id,seq));
CREATE INDEX sync_monitor_events_time ON sync_monitor_events(at);
CREATE TABLE sync_monitor_accounts (workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, seq INTEGER NOT NULL, fingerprint TEXT, incident_id TEXT, failures INTEGER NOT NULL DEFAULT 0, last_good_at INTEGER, PRIMARY KEY(workspace_id,account_id));
CREATE TABLE sync_monitor_alerts (id TEXT PRIMARY KEY, workspace_id TEXT, at INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('failure','recovery','gap','unavailable','available','test')), diagnostic TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','uncertain')), message_id TEXT, attempted_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER);
CREATE INDEX sync_monitor_alerts_pending ON sync_monitor_alerts(status,at);
