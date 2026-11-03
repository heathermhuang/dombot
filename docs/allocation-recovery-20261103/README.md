# Interrupted allocation recovery · 3 November 2026

The user authorized recovery of the pre-existing unfinished allocation identified
by the listing/core release. Its existing Worker, D1 database, owner/workspace,
coordinator namespace, private setup journal and encryption/gateway keys were
preserved. The allocation is now qualified and admitted on engine/UI
`1.5.2-hosted.41`, source digest
`85e446bd12e518a55cfc5f99b66b2440617de2d3cfec583b457511c15a40745b`.

## Cause and repair

The original `.35` Worker and database existed and the original schema bootstrap
receipt was complete, but control registry admission had not committed. The exact
cause of that earlier interruption is not established. The later template release
made a normal retry correctly stop with `Setup identity or artifact changed`.
Fresh inspection found no portfolio/credentials/publication records or active root
request leases. Initialization records were retained.

[PR #145](https://github.com/heathermhuang/dombot/pull/145), merge
`9b5d2c56ec2430c7ac2be4932f2282cc3818da62`, added a disabled-by-default private
recovery RPC pinned to one reviewed plan. The production provisioner was built
from that merged source; its original setup namespace and unrelated bindings were
inherited. Ordinary provisioning still refuses a changed template.

Protected control/tenant SQL exports were captured before repair. Only additive
tenant migration `0009_sales_lifecycle.sql` was missing and applied. The existing
Worker was upgraded using the released `.41` provisioning module, inherited
secrets/database/coordinator, the directory service binding, and its own inquiry
origin. Existing feature gates were preserved. No replacement resources were
created. Recovery replayed the original bootstrap receipt, checked current native
provenance and strict empty/alarm-free maintenance using the original private setup
key, and passed its receipt through the existing `activateWorkspace` implementation.
The gateway key was sealed for the normal registry in memory; no clear key file or
owner browser session was created.

## Observed verification

- Current native engine/source and signed owner `getAppInfo`: passed.
- Read-only `previewDomainImport` with one reserved `.invalid` name: passed; no
  import was applied and no registrar was contacted.
- Original workspace/database/coordinator and inherited secret bindings: matched.
- Maintenance: empty; no alarm. The original setup journal was not written/reset.
- Normal registry admission and encrypted gateway-key round trip: passed.
- Public gateway routing reached the native `.41` runtime for an unpublished path;
  its expected 404 carried the correct native version/source headers.
- Unauthenticated owner API: 401. No anonymous access was added.
- All 38 pre-existing platform registry rows, including encrypted key envelopes,
  database identities and qualification data, matched the pre-repair snapshot.
- Existing controlled production page at `/working.io`: 200.
- Recovery plan binding removed, retained recovery schema removed from live assets,
  unrelated provisioner configuration restored, and private recovery RPC refused
  with `Recovery plan is not authorized`. The first immediate disable probe did not
  yet observe that expected refusal; a subsequent read after configuration
  propagation did. Admission was not repeated.

Verification completed at **18:02 SGT, 3 November 2026**. Protected operator custody
is `.wrangler/allocation-recovery-20261103` in the primary checkout. It contains
identity manifests, before/after configuration, recovery exports and qualification
receipts; it is excluded from this public report.

## Checks and evidence limits

At the repair source, 235 test files passed: 2,544 tests passed and one skipped.
Root/worker/hosted typechecks, focused lint and the provisioner dry-run bundle
passed. [CI](https://github.com/heathermhuang/dombot/actions/runs/41614898619)
and [Security analysis](https://github.com/heathermhuang/dombot/actions/runs/41614898630)
passed before merge/deployment.

The setup/bootstrap/admission/native-owner-read/import-preview/gateway path was
verified operationally. The available browser belongs to another account; the
owner-browser visit remains unverified pending the owner's existing sign-in. No
owner credentials, session, passkey, real inventory import, publication, inquiry,
message, purchase or provider write was fabricated. These receipts do not establish
independent customer use or payment/transfer outcomes.
