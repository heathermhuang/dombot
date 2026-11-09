CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
  fingerprint TEXT NOT NULL, sealed TEXT NOT NULL, due_at INTEGER NOT NULL,
  lease_token TEXT, lease_expires_at INTEGER, claimed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, provider_receipt TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX notification_outbox_due ON notification_outbox(state,due_at);
CREATE TABLE notification_events (
  event_hash TEXT PRIMARY KEY, envelope_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
CREATE INDEX notification_events_envelope ON notification_events(envelope_id);
