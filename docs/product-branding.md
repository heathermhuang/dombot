# Product branding and upstream sync

Use **Domains.Domains** when naming the hosted service in AI responses, MCP
metadata/descriptions, settings, dialogs, imports, warnings and generated files.
The existing lowercase `domains.domains` wordmark and actual URLs remain valid.

`src/shared/product-brand.ts` holds the product name, download prefix and suggested
MCP client alias (`domains-domains`). A client alias is local to the client;
existing connections continue to work and do not need to be removed or reauthorized.
New downloads use `Domains.Domains-*` names. Import detection reads the contents,
so both old and newly named backups/CSVs remain compatible.

Keep `dombot-data` and sealed-backup format markers, storage keys, namespaces,
cryptographic derivation labels, protocol headers, tool names, repository/package
names and executable paths unchanged. Keep original DomBot credits, legal notices,
upstream release titles and historical changelog entries as provenance. The
original upstream website and desktop build keep their own identity.

## After an upstream merge

1. Merge the released tag as described in [Upstream sync](upstream-sync.md).
2. Run `npx vitest run scripts/product-branding.test.mjs`. It scans actual string
   literals and JSX text, ignoring comments and technical identifiers. New upstream
   service copy using the old name fails the check. Review each new occurrence;
   do not add broad exceptions to hide product copy.
3. Resolve copy conflicts while keeping upstream behavior and schema contracts.
   Existing exceptions are limited to original-project credits/history and known
   stable identifiers. Run the full tests, rebuild/install the pinned engine/UI
   and verify its integrity before release.
4. Release the engine to existing accounts and the future template, and release
   gateway changes through the normal qualified rollout. Then refresh MCP clients
   so cached tool descriptions and initialization instructions are fetched again.

Branding adds small text/import changes across shared UI files, so a merge that
rewrites those paragraphs can still require manual resolution. It introduces no
schema migration or protocol fork. The regression check also catches old branding
that Git merges cleanly into newly added screens; it cannot certify text served
from an external client configuration or third-party provider.
