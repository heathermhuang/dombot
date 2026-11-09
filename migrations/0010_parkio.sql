-- Private connector state; all identity, session and inventory payloads are encrypted.
CREATE TABLE IF NOT EXISTS parkio_sources (
 id TEXT PRIMARY KEY, revision TEXT NOT NULL, epoch INTEGER NOT NULL,
 record_count INTEGER NOT NULL DEFAULT 0, credential_revision TEXT, generation TEXT,
 previous_generation TEXT, pending_generation TEXT, sealed TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parkio_credentials (
 source_id TEXT NOT NULL, revision TEXT NOT NULL, created_at INTEGER NOT NULL,
 sealed TEXT NOT NULL, PRIMARY KEY(source_id,revision)
);
CREATE TABLE IF NOT EXISTS parkio_chunks (
 source_id TEXT NOT NULL, generation TEXT NOT NULL, chunk_index INTEGER NOT NULL,
 created_at INTEGER NOT NULL, sealed TEXT NOT NULL,
 PRIMARY KEY(source_id,generation,chunk_index)
);
CREATE INDEX IF NOT EXISTS parkio_chunks_age ON parkio_chunks(created_at);
CREATE INDEX IF NOT EXISTS parkio_credentials_age ON parkio_credentials(created_at);
