-- Preserve all existing cases and dependent grants, replies and delivery state.
-- A null listing identifies a private unlisted-domain case. Its requested name is sealed.
CREATE TABLE sales_leads_with_unlisted (
  id TEXT PRIMARY KEY, listing_id TEXT REFERENCES sale_drafts(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, email_hash TEXT NOT NULL,
  revision TEXT NOT NULL, verification TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, follow_up_at INTEGER, sealed TEXT NOT NULL
);
INSERT INTO sales_leads_with_unlisted SELECT * FROM sales_leads;
CREATE TABLE sales_messages_with_unlisted (
  id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES sales_leads_with_unlisted(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, direction TEXT NOT NULL,
  created_at INTEGER NOT NULL, sealed TEXT NOT NULL, sequence INTEGER NOT NULL, UNIQUE(lead_id,sequence)
);
INSERT INTO sales_messages_with_unlisted SELECT * FROM sales_messages;
CREATE TABLE sales_tokens_with_unlisted (
  token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, lead_id TEXT NOT NULL REFERENCES sales_leads_with_unlisted(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER, grant_id TEXT
);
INSERT INTO sales_tokens_with_unlisted SELECT * FROM sales_tokens;
CREATE TABLE sales_outbox_with_unlisted (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, lead_id TEXT NOT NULL REFERENCES sales_leads_with_unlisted(id) ON DELETE CASCADE,
  message_id TEXT, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_expires_at INTEGER, claimed_at INTEGER, due_at INTEGER NOT NULL, sealed TEXT NOT NULL,
  provider_receipt TEXT, updated_at INTEGER NOT NULL
);
INSERT INTO sales_outbox_with_unlisted SELECT * FROM sales_outbox;
DROP TABLE sales_outbox;
DROP TABLE sales_tokens;
DROP TABLE sales_messages;
DROP TABLE sales_leads;
ALTER TABLE sales_leads_with_unlisted RENAME TO sales_leads;
ALTER TABLE sales_messages_with_unlisted RENAME TO sales_messages;
ALTER TABLE sales_tokens_with_unlisted RENAME TO sales_tokens;
ALTER TABLE sales_outbox_with_unlisted RENAME TO sales_outbox;
CREATE INDEX sales_inbox ON sales_leads(updated_at DESC,id);
CREATE INDEX sales_listing_inquiries ON sales_leads(listing_id,updated_at DESC);
CREATE INDEX sales_leads_recipient ON sales_leads(email_hash,created_at);
CREATE INDEX sales_pending_retention ON sales_leads(verification,created_at);
CREATE INDEX sales_verified_retention ON sales_leads(verification,updated_at);
CREATE INDEX sales_thread ON sales_messages(lead_id,sequence);
CREATE INDEX sales_outbox_due ON sales_outbox(state,due_at);
