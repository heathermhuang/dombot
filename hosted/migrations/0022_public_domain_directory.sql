-- Locator only. Tenant published eligibility remains authoritative.
CREATE TABLE public_domain_routes (
 domain TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 listing_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation>0),
 revision TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','active','hold','tombstone')),
 updated_at INTEGER NOT NULL
);
CREATE TABLE public_domain_route_conflicts (
 domain TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 listing_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 observed_at INTEGER NOT NULL,
 PRIMARY KEY(domain,workspace_id,listing_id)
);
CREATE TABLE public_domain_route_backfill (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 cursor TEXT NOT NULL DEFAULT '',
 completed_at INTEGER
);
CREATE TABLE public_domain_route_transfers (
 id TEXT PRIMARY KEY,
 domain TEXT NOT NULL,
 generation INTEGER NOT NULL,
 workspace_id TEXT NOT NULL,
 listing_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 control_proof TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 committed_at INTEGER
);
