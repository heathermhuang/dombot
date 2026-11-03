# Public domain listing URLs

Hosted individual public listings use `/<canonical-domain>`, for example `/working.io`, and inquiry/provider handoffs use `/working.io/inquiries` and `/working.io/provider`. Eligible legacy `/w/<workspace>/d/<domain>` links permanently redirect with HTTP 308. Workspace IDs remain internal identities. Self-hosted `/d/<domain>` links remain supported.

The public edge canonicalizes case, IDNs and trailing dots; checks anonymous admission, known control loss, withdrawal and current tenant eligibility; and strips caller account authority before forwarding. A directory row is a locator, never publication authority. Conflicts remain held. No private inventory hydration, credentials or provider API reads enter canonical lookup.

PR #138 introduced the URL contract with a provisional capped fleet resolver. The listing/core integration replaces it with authoritative reservations and generation/revision fencing, selected-tenant reads, reviewed ownership transfer and bounded resumable published-only backfill. Read `public-domain-directory.md` for the migration, writer coverage and release gates. Do not deploy the earlier fleet resolver as the final architecture.

Sharing actions, shops, profiles, previews, presence inspection and publication receipts use the same helper. Marketplace sync/import only prepares private data. An owner approves public terms, provider destination and each optional surface through the existing review/commit workflow. A provider identity URL does not create or verify checkout, and a connected marketplace does not verify domain control.

The lifecycle phase bounds market price claims by field-specific successful observations and discount expiry, suppresses unsafe selling paths, and retains a neutral approved handoff where appropriate. Hosted request/event counters remain distinct from provider measurements and completed-sale evidence. See `listing-core-lifecycle.md`. Existing indexing policy is unchanged.
