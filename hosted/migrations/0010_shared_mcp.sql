CREATE TABLE mcp_clients (
 id TEXT PRIMARY KEY,
 metadata TEXT NOT NULL,
 secret_hash TEXT,
 created_at INTEGER NOT NULL
);
CREATE TABLE mcp_authorizations (
 id TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
 redirect_uri TEXT NOT NULL,
 resource TEXT NOT NULL,
 state TEXT,
 challenge TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 session_hash TEXT,
 csrf_hash TEXT,
 code_hash TEXT UNIQUE,
 code_expires_at INTEGER,
 consumed_at INTEGER,
 consumption_id TEXT UNIQUE
);
CREATE INDEX mcp_authorizations_expiry ON mcp_authorizations(expires_at);
CREATE TABLE mcp_grants (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 resource TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE INDEX mcp_grants_user ON mcp_grants(user_id);
CREATE INDEX mcp_grants_client ON mcp_grants(client_id);
