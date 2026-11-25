-- A seller opts a reviewed revision into one named partner's feed.
CREATE TABLE agent_referral_optins (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  domain TEXT NOT NULL REFERENCES public_domain_routes(domain),
  listing_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  grant_id TEXT NOT NULL UNIQUE,
  opted_in_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, listing_id, partner_id)
);
CREATE INDEX agent_referrals_partner_feed ON agent_referral_optins(partner_id,domain);

-- Attribution references the original tenant Sales Inbox lead. It stores no buyer data.
CREATE TABLE agent_referral_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  receipt TEXT NOT NULL,
  domain TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,receipt)
);
CREATE INDEX agent_referrals_owner ON agent_referral_receipts(workspace_id,created_at DESC);
CREATE INDEX agent_referrals_expiry ON agent_referral_receipts(created_at);
