# Upstream 2.2.0 and registrar creation-date release

Domains.Domains serves engine **2.2.0-hosted.1**, registrar-client
**1.1.1-hosted.1**, and gateway source
`7ca96b750557049c722f3039098b7ae2bb56e9e0` across all **47 original admitted
portfolios** and the qualified future template. [Hosted PR #199](https://github.com/heathermhuang/dombot/pull/199)
merged after CI and security passed. The complete upstream v2.2.0 tag
`1f6796840e0128664cf2a8bfa53702374a2edf7a` is retained in merge ancestry.

The SDK contains upstream 1.1.1 plus the retained hosted retry/deadline,
unknown-write, provider/date and Namefi ownership patches. Current main's
notification work and Park.io repairs are included. Existing notification
settings, recipient choices, budgets and schedules were preserved.

## Creation-date behavior

Impossible registrar creation dates become unknown with `createdDateIssue`,
or retain a valid known date. The generic parser, expiry and renewal dates
are unchanged; no year is inferred from expiry. Successful inventory sync
reconciles creation in actual detail records without promoting quote-only
entries into detail hits. Nameservers, controls, quote age and account
boundaries retain their contracts. Imported user facts remain separate.

Production MCP qualification passed cached portfolio reads, forced detail
refresh, fresh Namecheap inventory sync and a full owned-portfolio scan.
No future creation dates remained exposed. The invalid provider value stays
unknown with reason `future`; an authoritative creation date is not invented.
Expiry stayed unchanged. Private domain names and account records are omitted.
The shared upstream fix is [PR #276](https://github.com/aoxborrow/dombot/pull/276).

## Qualification and preservation

- CI: 298 files, 3,210 passing tests and one intentional skip; all typechecks,
  lint, engine integrity, four security regressions, four relay checks,
  six Worker dry bundles and web/demo/site builds passed. SDK: 653 offline
  tests, typecheck and ESM/CommonJS/declaration builds passed.
- Eleven packaged desktop/mobile Chrome scenarios passed on the combined UI.
  Two local fixture files exceeded their original deadlines under parallel
  load, then passed in isolation without changing thresholds. Clean CI passed
  the complete suite.
- Canary, owner live MCP and every original portfolio served the exact engine
  source digest. Sixty-one users, 578 original workspace identities, 42 platform
  mappings and encrypted credential/account fingerprints for all 47 original
  portfolios were preserved. Twenty-eight Sales publications, two profiles,
  canonical/legacy routes and two active custom hosts passed preservation checks.
- The exact 16 live future-template bindings, provisioner and gateway schedules,
  allocation policy, original notification preferences and renewal choices were
  preserved. Existing compatible schemas were reused on all 48 databases.
- One interrupted upload was confirmed unapplied; original admission was restored
  before the verified retry. No uncertain write was blindly repeated.
- Fresh trusted managed import: open/preview allocated nothing; one valid save
  created one Worker/database pair; two retries reused it; readback passed.
  Independent Worker/database absence, erased setup and scrubbed temporary
  credentials passed. Active QA and unfinished allocation counts are zero.

Recovery custody includes 49 protected code/settings snapshots and 48
Cloudflare-hosted D1 bookmarks. No database contents or root keys were exported.
The notification-compatible storage/backup floor is retained. No registrar,
DNS, marketplace or payment mutation was used for qualification.

See the [machine-readable receipt](creation-date-release-20261109.json).
Private operational evidence stays in the ignored `.wrangler/creation-date-release`
directory. These operator checks do not claim independent customer adoption.
