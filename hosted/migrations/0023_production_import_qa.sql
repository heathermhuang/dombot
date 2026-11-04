-- Only operator-created QA runs are eligible for automatic cleanup.
CREATE TABLE production_import_qa_runs (
 run_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
 user_id TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL UNIQUE,
 label TEXT NOT NULL,
 credential_sha256 TEXT NOT NULL,
 template_sha256 TEXT NOT NULL,
 module_sha256 TEXT NOT NULL,
 bootstrap_sha256 TEXT NOT NULL,
 engine TEXT NOT NULL,
 engine_source TEXT NOT NULL,
 source_commit TEXT NOT NULL,
 account_id TEXT NOT NULL,
 dispatch_namespace TEXT NOT NULL,
 domain TEXT NOT NULL UNIQUE,
 manifest_sha256 TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','cleaning','retry','blocked','complete')),
 cleanup_started_at INTEGER,
 cleanup_trigger TEXT CHECK(cleanup_trigger IN ('finish','expiry')),
 database_id TEXT,
 coordinator_id TEXT,
 worker_delete_attempted_at INTEGER,
 database_delete_attempted_at INTEGER,
 worker_absent INTEGER NOT NULL DEFAULT 0,
 database_absent INTEGER NOT NULL DEFAULT 0,
 setup_erased INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_cleanup_at INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 completed_at INTEGER
);
-- A failed/held run blocks another run until reconciled. No growing QA pool.
CREATE UNIQUE INDEX production_import_qa_one_open ON production_import_qa_runs((1)) WHERE state<>'complete';
CREATE INDEX production_import_qa_expiry ON production_import_qa_runs(state,expires_at,next_cleanup_at);
-- A scheduler pass selected before cleanup must not recreate this QA-only lease.
CREATE TRIGGER production_import_qa_no_stale_dispatch BEFORE INSERT ON sales_dispatch_checkpoints
WHEN EXISTS(SELECT 1 FROM production_import_qa_runs q WHERE q.workspace_id=NEW.workspace_id AND q.cleanup_started_at IS NOT NULL)
BEGIN SELECT RAISE(IGNORE); END;
