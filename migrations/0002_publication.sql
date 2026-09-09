-- One owner per DomBot instance. Drafts are encrypted using the instance key.
-- Public reads query ONLY the explicit projection in published_portfolios.
CREATE TABLE IF NOT EXISTS portfolio_drafts (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  revision TEXT NOT NULL,
  sealed TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS published_portfolios (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  handle TEXT NOT NULL UNIQUE,
  revision TEXT NOT NULL,
  payload TEXT NOT NULL
);
