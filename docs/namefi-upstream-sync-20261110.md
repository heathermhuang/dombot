# Namefi upstream synchronization, 10 November 2026

The candidate merges the complete upstream app `v2.2.1`, revision
`a688173c7e5099cec99d2f2721f040ef48f25fa7`, into hosted main at
`cb9ac2f88d50291e16ea9eeae48b0015ca765407`. It packages engine
`2.2.1-hosted.1` and SDK `1.2.1-hosted.1`.

Upstream [SDK #106](https://github.com/aoxborrow/registrar-client/pull/106)
merged as `d5fbd5835dafee4c878f8ff05209b9bcc825497d` on 9 November UTC.
The former draft [app #268](https://github.com/aoxborrow/dombot/pull/268)
merged as `353564c59f022a9a094bb87f5ba34592b85d2a8e` after the maintainer
updated its dependency to the published SDK 1.2.1. Its draft dependency gate is
satisfied; there is no remaining draft to update.

## Resulting behavior

The SDK now uses upstream's Namefi provider rather than a custom hosted copy.
Upstream [#110](https://github.com/aoxborrow/registrar-client/pull/110)
deliberately removes inventory lookup before public DNS reads, DNS writes and
auto-renew. Public DNS takes one request; empty zones still return `[]`.
Namefi's API enforces batch-write ownership. Exact owned details still use the
account inventory. Requests retain cancellation, redirect refusal, credential
redaction and unknown-write outcomes without replay.

DNS changes reconcile edits by ID, add records, then delete stale IDs, preserving
unchanged and managed/SOA/NS records. Registration uses saved profile contacts
and reports accepted, unfinished orders as pending. The hosted paid-operation
scope/approval boundary remains authoritative; no live purchase or registrar
mutation was used for this qualification.

The app merge also includes independent marketplace keys/proxies, switching
between linked and independent keys, account-specific sync progress and honest
Namefi privacy/lock status in UI, MCP and CSV. Both independent and linked
Dynadot marketplace accounts retain managed egress defaults and customer overrides.
The shared proxy control retains the hosted public egress display. Connection
forms fetch only public proxy metadata; switching a saved marketplace account's
linked credentials requires fresh authentication.

Backup format 15 prevents older hosted builds silently ignoring independent
marketplace routing. Supported v14 and older formats remain importable. The
round-trip test retains account identities, keys and the chosen proxy. No new
namespace or control migration is introduced. A rollback after format-15 writes
must retain this compatible backup reader.

## Preservation and verification

The cumulative SDK patch retains request deadlines/retry budgets, Gandi path
validation, Cloudflare expression escaping and provider date safety. Upstream
Namefi code is unchanged by the hosted patch. Archive integrity and source/test
patch hashes are recorded in `vendor/registrar-client-1.2.1-hosted.1.json`.

The app merge retains managed proxy policy, scoped OAuth/MCP admission,
independent quote ages, registry date recovery, notifications and opt-in choices,
Park.io, account isolation and explicit public-page eligibility. The upstream
parity inventory exactly matches all 92 released core API methods and retains
all 74 released MCP tools, routes and settings sections.

- SDK: 695 offline tests, typecheck and ESM/CJS/declarations pass.
- App: 301 files and 3,243 tests pass, with one intentional skip. The final
  renderer-only proxy-metadata correction is additionally covered by affected
  checks and packaged browser verification; PR CI is the final full-suite gate.
- Root/Worker/hosted typechecks, lint, formatting, installed engine/source/archive
  integrity, four security checks, four relay checks, six Worker dry bundles and
  web/demo/site builds pass.
- Real local Worker Namefi and hosted authentication fixtures pass. DNS reads
  use the public endpoint directly without inventory; redirect refusal still
  prevents forwarding the key.
- Packaged desktop/mobile selection, export and synthetic save scenarios pass.
  Synthetic Namefi/market connection forms are checked without submitting any
  registrar credentials or making provider writes.

This report qualifies source and the packaged candidate. It does not claim a
production canary, tenant fleet/template/provisioner/gateway rollout, production
import/cleanup, live provider write acceptance or a new independent-user result.
Historical production receipts remain unchanged. The primary dirty checkout was
preserved throughout; all work used an isolated temporary clone.

## Managed production completion

The qualified source is now deployed and verified across all 48 original admitted
portfolios, the future template and gateway. See the separate
[production release record](namefi-upstream-sync-release-20261110.md) and
[machine receipt](namefi-upstream-sync-release-20261110.json) for runtime,
preservation, import/retry/cleanup and recovery evidence.
