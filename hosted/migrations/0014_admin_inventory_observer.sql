-- Bounded per-workspace probe metadata, including brief recovered failures.
ALTER TABLE sync_monitor_checks ADD COLUMN probe_json TEXT;
ALTER TABLE sync_monitor_checks ADD COLUMN last_failure_json TEXT;
-- Record whose inventory the existing administrator inspected; never searches or domains.
ALTER TABLE admin_audit ADD COLUMN target_user_id TEXT;
