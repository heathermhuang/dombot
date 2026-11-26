-- Search material is derived from a matched, eligible published revision.
CREATE TABLE agent_catalog_index (
  domain TEXT PRIMARY KEY REFERENCES public_domain_routes(domain),
  revision TEXT NOT NULL,
  ready INTEGER NOT NULL CHECK(ready IN (0,1)),
  checked_at INTEGER NOT NULL
);
CREATE INDEX agent_catalog_refresh ON agent_catalog_index(checked_at,domain);
CREATE VIRTUAL TABLE agent_catalog_search USING fts5(
  domain UNINDEXED, name, description, categories, tokenize='porter unicode61'
);

CREATE TABLE agent_catalog_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  listing_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('query','price','offer','broker','provider')),
  source TEXT NOT NULL,
  query TEXT,
  receipt TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX agent_catalog_owner_events ON agent_catalog_events(workspace_id,occurred_at DESC);
CREATE INDEX agent_catalog_expiry ON agent_catalog_events(occurred_at);
