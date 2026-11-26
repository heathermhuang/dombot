-- Hosted checkout authority, shared across workspaces. No buyer contact data.
CREATE TABLE checkout_reservations (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL REFERENCES public_domain_routes(domain),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  seller_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  listing_revision TEXT NOT NULL,
  listing_generation INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  approval_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session TEXT,
  state TEXT NOT NULL CHECK(state IN ('held','creating','open','canceling','paid','transferred','released')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  payment_reference TEXT,
  transfer_reference TEXT,
  refund_reference TEXT,
  release_reference TEXT,
  UNIQUE(provider, provider_session)
);
CREATE UNIQUE INDEX checkout_active_domain
  ON checkout_reservations(domain) WHERE state!='released';

CREATE TABLE checkout_observations (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES checkout_reservations(id),
  observation TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (provider, event_id)
);

-- An authoritative event contradicting an earlier release requires review
-- before this canonical domain can enter checkout again.
CREATE TABLE checkout_domain_holds (
  domain TEXT PRIMARY KEY REFERENCES public_domain_routes(domain),
  reservation_id TEXT NOT NULL REFERENCES checkout_reservations(id),
  observed_at INTEGER NOT NULL
);
