# Namefi upstream production release, 10 November 2026

Domains.Domains now serves engine `2.2.1-hosted.1`, SDK `1.2.1-hosted.1`
and application/gateway source `f0b4556c1f0589da9629b4761f84152e933d9562` to all
48 originally admitted portfolios and the qualified future template.
The complete upstream app 2.2.1 and SDK 1.2.1 are included; former draft
[app #268](https://github.com/aoxborrow/dombot/pull/268) and
[SDK #106](https://github.com/aoxborrow/registrar-client/pull/106) are merged.
[Hosted source PR #209](https://github.com/heathermhuang/dombot/pull/209)
retains the hosted transport, date recovery, notification and access safeguards.

## Released behavior and production checks

The new Namefi provider uses upstream registration and record-ID DNS reconciliation.
Upstream #110 deliberately removes inventory reads before public DNS, DNS writes
and auto-renew. Live production MCP reads succeeded for an owned Namefi domain
and for a public, unowned DNS zone. No private domain name or DNS record is
published here. No registrar setting, DNS record, purchase or payment was changed.
Registration and write behavior retain offline coverage and existing paid-operation
authority; these read checks do not claim live registration acceptance.

The full app release also includes independent marketplace keys/proxies, linked
account switching, per-account sync progress and honest Namefi privacy/lock status.
Managed Dynadot routing remains the default, saved credential linking requires
fresh identity, and connection forms request only public proxy metadata. Backup
format 15 protects independent market routing; supported older backups still import.

The controlled canary passed before the serial fleet rollout. Every original
portfolio served the exact engine/source: 43 through its existing private status
route and 5 through the existing public release route plus exact management
code/settings checks. No additional secret custody was acquired.

A fresh trusted production QA lease proved zero allocation on open/preview,
one Worker/database pair on a valid synthetic import, two retries reusing that
pair, readback and exact engine/source identity. Independent cleanup confirmed
both resources absent, setup erased and the temporary password scrubbed. Final
active QA and unfinished allocation counts are zero.

## Preservation and recovery

All 62 original users, 584 workspace identities, 43 platform mappings,
credential/account/settings/publication fingerprints, 28 Sales publications,
2 profiles, canonical/legacy routes and 2 active custom hosts were preserved.
Notification preferences and renewal decisions were fingerprinted separately.
All 16 qualified future-template bindings, gateway/provisioner schedules,
assets and original allocation policy were retained. The source offer identifies
the deployed application revision. All 68 public HTTP checks passed.

Recovery includes 50 protected code/settings snapshots and
49 Cloudflare-hosted database bookmarks. No database contents or root keys
were exported. A malformed recovery-download response and expired CLI login were
resolved before code activation. Interrupted uploads were reconciled against
exact original code/settings before retrying, with admission/maintenance restored.
Immutable assets were staged separately; activation stayed serial. An isolated
upload transport was used after repeated socket resets; no uncertain write was
blindly replayed. Protected operational evidence stays in the ignored
`.wrangler/namefi-upstream-release-20261110` directory in the primary workspace; temporary asset tokens are scrubbed from that durable copy.

CI passed 3,243 app tests with one intentional skip, SDK qualification passed
695 offline tests, both CodeQL analyses and all required type/lint/security/relay/
bundle checks passed. The exact packaged UI passed desktop/mobile qualification.
After format-15 exports, rollback must retain a compatible backup reader.
These are operator release checks and do not claim independent customer adoption.

[Machine-readable receipt](namefi-upstream-sync-release-20261110.json) ·
[Source qualification](namefi-upstream-sync-20261110.md)
