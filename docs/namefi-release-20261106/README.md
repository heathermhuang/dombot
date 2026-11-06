# Namefi release — 6 November 2026

Namefi support is deployed to all 44 previously admitted portfolios as engine
`2.1.0-hosted.3` and registrar SDK `1.1.0-hosted.3`. The owner connection passed
in native Chrome: seven personal domains synced, the filtered table and connection
persisted after refresh, and the API credential, account and inventory were
independently confirmed as AES-GCM envelopes in the database. No private key,
account identifier or domain holding is included in this report.

The final fresh managed production import, two retries, readback, exact served
UI assets/catalog and independent cleanup passed. The original allocation policy
and cleanup cron are restored. See [release-receipt.json](release-receipt.json)
for machine-readable scope.

## Released components

- [PR #175](https://github.com/heathermhuang/dombot/pull/175) introduced Namefi
  inventory, details, nameserver reads, annual domain pricing, DNS and auto-renew,
  the official logo, Settings/help and honest unknown privacy/transfer-lock states.
  Its initial engine was `2.1.0-hosted.2`, source merge
  `8450d0fb9f5b5bdad4b482ce9b9832af3599d5fb`.
- [PR #180](https://github.com/heathermhuang/dombot/pull/180) corrected a runtime
  compatibility bug found during owner acceptance. Workers rejects Fetch redirect
  mode `error` before sending. The SDK now uses `manual`; all non-2xx responses,
  including redirects, still fail without forwarding the key. A real Worker
  regression fails with the old SDK and passes with the correction.
- The final engine/gateway release is `bc035a7b294268ac30750db2e7ed719b4b01a254`, engine source digest
  `9a35dfaf72cf94028183ab6ca2ed4d13da4457390371f55615e8051d95780f45`. It includes the concurrent changelog/archive release
  `c4b48bac855a83de883e7943e16375bf970a3a3a`; existing gateway assets were preserved.
- [PR #177](https://github.com/heathermhuang/dombot/pull/177) added private,
  allowlisted qualification outcomes. [PR #178](https://github.com/heathermhuang/dombot/pull/178)
  bounded retries of thrown engine-provenance reads with fresh bodies and proofs.
  Returned HTTP failures and wrong provenance still fail immediately. Database,
  Worker creation and bootstrap writes are not replayed. The private provisioner
  remains at `ab8b70652203303afdc9b42e3d68cd31c84c0fb9`.
- Gateway and provisioner agree on the final future-template digest
  `becb6066a2da37729923633e2613e9884fd6eac2937d6a2ee69b6d78eaa7e612`, preserving all 14 managed non-secret bindings.

## Evidence and correction history

The initial template preparation omitted managed bindings and produced a boot
failure in a disposable QA portfolio. The exact profile was restored; the held
lease was reconciled through its unchanged guards and cleaned. Later diagnostics
isolated a thrown first dispatch and the bounded read retry recovered it. The
first actual owner connection then exposed the unsupported redirect mode, fixed
in PR #180. Node-only mocks had not exercised that runtime restriction. No
admission or provenance checks were relaxed. Observed management API transport
failures were reconciled against exact code/settings before any upload retry;
each temporary admission hold was restored.

The final trial passed at `2026-11-06T10:50:58.680Z`; independent cleanup completed at
`2026-11-06T10:51:50.641Z`. Its Worker, database, account, sessions and mappings are absent,
setup keys are zero, and its temporary password was destroyed. All 56 original
accounts and 546 original workspace identities were preserved. One real account
added during the task was retained. All 44 original portfolios serve the exact
final engine/source with preserved bindings; the owner's eight prior registrar
account counts remained intact when the new account was added.

The final synthetic portfolio served the exact packaged JS, CSS and SVG bytes
and all 13 registrar entries. The owner browser verified seven rows, actual
expiry dates, annual quotes and nameservers, with privacy and lock correctly
shown as not reported. Private browser evidence and encrypted-store checks remain
in protected operator custody. Screenshots containing real holdings are not
published. No domain purchase, renewal, payment, DNS, auto-renew, publication or
messaging mutation was performed for acceptance.

[Final CI](https://github.com/heathermhuang/dombot/actions/runs/42202139578)
passed all required checks; the local suite passed 270 files / 2,872 tests with
one intentional skip. [CodeQL](https://github.com/heathermhuang/dombot/actions/runs/42202139628)
passed. The runtime regression and the 26 adapter contracts passed. Earlier
38 HTTP checks passed; final health and gateway-source observations were healthy.
The [initial report](https://github.com/heathermhuang/dombot/blob/36d5438319e42e4c9fb2b0d3d00a5f058431401c/docs/namefi-release-20261106/README.md)
retains the earlier rollout/qualification scope. See also
[source qualification](../namefi-qualification/README.md) and the
[redirect investigation](../namefi-worker-redirect.md).

## Upstream contributions

- [registrar-client #106](https://github.com/aoxborrow/registrar-client/pull/106)
  is ready for maintainer review, including the Worker redirect correction;
  CI passed on Node 20/22/24. Additional asynchronous registration and DNS-update
  behavior in that PR has unit coverage but is not in the hosted SDK deployed
  here and was not exercised with paid writes.
- [DomBot #268](https://github.com/aoxborrow/dombot/pull/268) supplies the companion
  UI/help/pricing integration. CI passed; it remains draft until the upstream SDK
  is published and its dependency/lockfile can be updated. The maintainer owns
  publication and merging.
