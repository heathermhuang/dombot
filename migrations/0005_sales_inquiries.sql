CREATE TABLE sales_leads (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES sale_drafts(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, email_hash TEXT NOT NULL,
  revision TEXT NOT NULL, verification TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, follow_up_at INTEGER, sealed TEXT NOT NULL
);
CREATE INDEX sales_inbox ON sales_leads(updated_at DESC,id);
CREATE INDEX sales_listing_inquiries ON sales_leads(listing_id,updated_at DESC);
CREATE INDEX sales_leads_recipient ON sales_leads(email_hash,created_at);
CREATE INDEX sales_pending_retention ON sales_leads(verification,created_at);
CREATE INDEX sales_verified_retention ON sales_leads(verification,updated_at);
CREATE TABLE sales_messages (
  id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, direction TEXT NOT NULL,
  created_at INTEGER NOT NULL, sealed TEXT NOT NULL, sequence INTEGER NOT NULL, UNIQUE(lead_id,sequence)
);
CREATE INDEX sales_thread ON sales_messages(lead_id,sequence);
CREATE TABLE sales_tokens (
  token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, lead_id TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER, grant_id TEXT
);
CREATE TABLE sales_outbox (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, lead_id TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  message_id TEXT, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_expires_at INTEGER, claimed_at INTEGER, due_at INTEGER NOT NULL, sealed TEXT NOT NULL,
  provider_receipt TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX sales_outbox_due ON sales_outbox(state,due_at);
CREATE TABLE sales_abuse (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE sales_suppression (email_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, sealed TEXT NOT NULL);
