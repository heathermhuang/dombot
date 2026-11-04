# Production import QA cleanup · 4 November 2026

The user explicitly authorized deletion of the controlled production QA account and
its resources after the [production import qualification](../import-production-qualification-20261104/README.md).
The exact identity was matched against the creation receipt, credential fingerprint,
Worker/database/coordinator bindings, original registry row and synthetic-only data.
Cleanup manifest digest: `4a46c98b4729077c6b2570f3e32cda7bbb60d372168f814fbcec79812fe34c22`.

## Confirmed result

| Production QA component | Remaining |
|---|---:|
| User/login account rows | 0 |
| Sessions | 0 |
| Active platform registry rows | 0 |
| Pending setup rows | 0 |
| Worker | 0 |
| Tenant D1 database | 0 |
| Worker coordinator namespace | 0 |
| Private setup-journal keys | 0 |
| Setup-object alarm | None |

The account was disabled and its exact registry entry archived before removing
active mappings and the user. The Worker and database were deleted without force;
provider content/database reads then returned 404, and exact-name D1 inventory
contained no match. The Worker-owned coordinator namespace also returned absence;
the shared provisioner namespace remained present.

The shared provisioner's **one QA setup object** was cleared with native
`storage.deleteAll()`, including its alarm. A second private check found it already
empty. The temporary private retirement RPC was gated by an exact plan digest,
original setup identity and a deletion ledger requiring both provider deletions,
a disabled workspace and no user/active/pending mapping. Eight local native-storage
checks covered disabled/default rejection, wrong plans, active accounts, changed
identity, complete storage/alarm erasure, another object's preservation and an
idempotent recheck. The provisioner's exact original code and settings were then
restored, and the temporary capability was removed.

A test-only scheduler checkpoint written by a pass that started before account
removal was reconciled. A later check confirmed that it remained absent. QA-only
rate-limit metadata was removed; shared protection counters were preserved.

The old QA password login returned **401** and the old workspace returned **404**.
The obsolete plaintext password was removed from both protected custody copies.
The existing controlled production page `/working.io` still returned **200**.

## Preservation and retained audit

All **55 real users** retained their workspace identity and credential fingerprint.
All **531 pre-existing workspace identities** and **39 platform rows**, including
their encrypted key mappings, matched the pre-cleanup snapshot. Gateway configuration
was unchanged. The provisioner's original module hash and complete configuration
matched after restoration; future provisioning/template bindings were preserved.

Only a disabled, non-reusable workspace identity and completed deletion audit remain
in control storage. They cannot authenticate, route, allocate or become signup
capacity. No active QA account, tenant resource or stored setup key remains.

The historical qualification screenshots and receipts remain valid as records of
the test. Protected manifests, provider receipts and an encrypted pre-deletion tenant
snapshot are retained in `.wrangler/production-import-cleanup-20261104` in the primary
checkout (directories 0700/files 0600). No encryption root was exported. These audit
files are outside public source and are not live production resources.

See [sanitized machine-readable results](summary.json). This update changes release
documentation only; the application gateway remains on source `b7d9be21`.
