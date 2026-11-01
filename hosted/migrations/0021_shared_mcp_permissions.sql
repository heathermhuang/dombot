-- Existing connections retain their original read-only authority.
ALTER TABLE mcp_authorizations ADD COLUMN scope TEXT NOT NULL DEFAULT 'portfolio:read' CHECK(scope IN ('portfolio:read','domains:write','portfolio:read domains:write'));
ALTER TABLE mcp_grants ADD COLUMN scope TEXT NOT NULL DEFAULT 'portfolio:read' CHECK(scope IN ('portfolio:read','domains:write','portfolio:read domains:write'));
