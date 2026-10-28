-- One authority per hostname across portfolio sites and individual sales pages.
CREATE TABLE public_hostname_claims (
 hostname TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('sales','portfolio')),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 owner_key TEXT NOT NULL,
 provider_id TEXT,
 held INTEGER NOT NULL CHECK(held IN (0,1)),
 updated_at INTEGER NOT NULL
);
INSERT INTO public_hostname_claims(hostname,kind,workspace_id,owner_key,provider_id,held,updated_at)
 SELECT hostname,'sales',workspace_id,workspace_id||':'||listing_id||':'||epoch,provider_id,1,updated_at
 FROM sales_hostnames WHERE status NOT IN ('detached','pending-proof');

-- Unverified plans do not reserve a public hostname or provision certificates.
CREATE TABLE portfolio_domain_plans (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 revision TEXT NOT NULL,
 hostname TEXT NOT NULL,
 challenge TEXT NOT NULL,
 plan TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE portfolio_hostnames (
 hostname TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 epoch INTEGER NOT NULL CHECK(epoch>0),
 owner_key TEXT NOT NULL,
 plan_revision TEXT NOT NULL,
 challenge TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending-certificate','pending-routing','checking','active','blocked','needs-review','detaching','detached')),
 provider_id TEXT,
 route_id TEXT,
 operation TEXT,
 check_generation INTEGER NOT NULL DEFAULT 0,
 probe_hash TEXT,
 verification_url TEXT,
 provider_records TEXT NOT NULL DEFAULT '[]',
 last_error TEXT,
 control_expires_at INTEGER NOT NULL DEFAULT 0,
 next_check_at INTEGER NOT NULL DEFAULT 0,
 observed_revision TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX portfolio_one_hostname ON portfolio_hostnames(workspace_id)
 WHERE status != 'detached';
CREATE INDEX portfolio_hosts_due ON portfolio_hostnames(next_check_at,status);
