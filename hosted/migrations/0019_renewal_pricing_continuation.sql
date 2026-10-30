-- Continuation checkpoints only. Provider jobs and prices remain encrypted in
-- their original customer databases; no names, prices or credentials here.
CREATE TABLE IF NOT EXISTS renewal_pricing_checks (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  inventory_at INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'pending',
  remaining INTEGER,
  failed INTEGER,
  blocked INTEGER
);
