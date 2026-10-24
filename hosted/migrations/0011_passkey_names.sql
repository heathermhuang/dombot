/* Display metadata only; existing credentials, counters and sessions are unchanged. */
ALTER TABLE passkeys ADD COLUMN name TEXT NOT NULL DEFAULT '' CHECK(length(name) <= 80);
