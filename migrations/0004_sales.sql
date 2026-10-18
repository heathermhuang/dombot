-- Additive: no existing portfolio is changed or published.
CREATE TABLE sale_drafts (
  id TEXT PRIMARY KEY, domain_hash TEXT NOT NULL UNIQUE, revision TEXT NOT NULL,
  operational_revision TEXT NOT NULL, availability TEXT NOT NULL DEFAULT 'paused',
  control_expires_at INTEGER NOT NULL DEFAULT 0, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'inquiry', uses_portfolio INTEGER NOT NULL DEFAULT 0, source_price_hash TEXT
);
CREATE TABLE sale_destinations (id TEXT PRIMARY KEY, revision TEXT NOT NULL, sealed TEXT NOT NULL);
CREATE TABLE published_sales (
  id TEXT PRIMARY KEY REFERENCES sale_drafts(id) ON DELETE CASCADE,
  domain TEXT NOT NULL UNIQUE, revision TEXT NOT NULL, draft_revision TEXT NOT NULL, payload TEXT NOT NULL,
  previous_payload TEXT, published_at INTEGER NOT NULL
);
CREATE TABLE sales_reviews (id TEXT PRIMARY KEY, sealed TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, receipt TEXT);
CREATE TABLE sales_review_items (review_id TEXT NOT NULL REFERENCES sales_reviews(id) ON DELETE CASCADE, listing_id TEXT NOT NULL, PRIMARY KEY(review_id,listing_id));
CREATE TABLE sales_shop (id TEXT PRIMARY KEY CHECK(id='main'), revision TEXT NOT NULL, sealed TEXT NOT NULL, published TEXT);
CREATE TABLE sales_shop_reviews (id TEXT PRIMARY KEY, revision TEXT NOT NULL, sealed TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE TABLE sales_jobs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, sealed TEXT NOT NULL, shop_revision TEXT, cursor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE sales_job_items (job_id TEXT NOT NULL REFERENCES sales_jobs(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, listing_id TEXT NOT NULL, expected_revision TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', result TEXT, PRIMARY KEY(job_id,ordinal));
CREATE INDEX sales_job_pending ON sales_job_items(job_id,state,ordinal);
CREATE TABLE sales_events (id TEXT PRIMARY KEY, listing_id TEXT, lead_id TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL, sealed TEXT NOT NULL, reconciled_at INTEGER, provenance TEXT NOT NULL DEFAULT 'runtime');
CREATE INDEX sales_events_time ON sales_events(created_at);
-- A failed CAS must abort the ENTIRE batch, including earlier writes.
CREATE TABLE sales_cas_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE sales_host_bindings (hostname TEXT PRIMARY KEY, listing_id TEXT NOT NULL, epoch INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0);
