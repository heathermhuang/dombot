# Namefi release — 6 November 2026

Namefi support is deployed to all 44 previously admitted portfolios as engine
`2.1.0-hosted.2` and registrar SDK `1.1.0-hosted.2`. A fresh managed production
import, repeated submission, readback, served UI assets/catalog and independent
cleanup passed after the final private provisioner update.

The owner's Namefi connection is **pending**. An owner-authorized non-expiring API
key was created and live read-only provider checks returned seven personal domains.
The key has not yet been saved into the owner's encrypted DomBot credential store:
native Chrome is unavailable while the Mac is locked. Source, CI, fleet rollout
and synthetic acceptance must not be reported as completed owner connection.

## Released components

- [PR #175](https://github.com/heathermhuang/dombot/pull/175) supplied the Namefi
  adapter, official logo, settings/help, annual domain pricing and honest unknown
  privacy/transfer-lock states. Merge: `8450d0fb9f5b5bdad4b482ce9b9832af3599d5fb`.
- Engine source digest:
  `746b5b5a24a96b74c0c63a625d92fb3bbb00b092103cb62bef3c3c6fd9e5143d`.
- The concurrent changelog/archive gateway release
  `c4b48bac855a83de883e7943e16375bf970a3a3a` was preserved, including code,
  assets and its public source pointer.
- [PR #177](https://github.com/heathermhuang/dombot/pull/177) added private,
  allowlisted qualification outcomes without response bodies or arbitrary values.
- [PR #178](https://github.com/heathermhuang/dombot/pull/178), merge
  `ab8b70652203303afdc9b42e3d68cd31c84c0fb9`, deployed the final private provisioner.
  Only thrown engine-provenance read requests can retry, with a fresh body/proof
  and bounded attempts. Returned HTTP failures and provenance mismatches fail
  immediately. Worker/database writes and bootstrap are never replayed.
- The final future-portfolio template preserves the existing 14 managed non-secret
  bindings. Gateway and provisioner agree on template digest
  `d70e7c3937fa89c60674d97a1c85c82e17f1c7e0bc7f33e8348117b058aa17fe`.

## Evidence and correction history

Initial template preparation omitted managed non-secret bindings. This produced a
boot failure in the controlled disposable portfolio. The exact existing profile
was restored in the future template; the held QA lease was reconciled through
its unchanged eligibility guards and then cleaned. Later diagnostics isolated a
thrown first qualification dispatch; the bounded read retry recovered it. No
admission/provenance checks were relaxed. An intervening management API 503 was
observed separately and is not asserted to be a global provider incident.

The final fresh trial passed at 09:57 UTC; independent cleanup and preservation
checks completed at 09:58 UTC. They established absence of its Worker, database,
account, sessions and mappings, zero setup keys, no active QA leases or unfinished
allocations, and destruction of its temporary password. All 56 original accounts
and 546 original workspace identities were preserved; one real account added
during the release was retained. The original allocation policy and cleanup cron
remain active.

Earlier fleet checks verified all 44 exact engine/source responses, original
credential namespaces, manual/cached holdings and publications. The private
provisioner changes did not change those tenant modules. The final synthetic
portfolio served the exact packaged JS, CSS and SVG bytes and all 13 registrar
entries, including Namefi. This is API/asset evidence; it is not a production
browser screenshot of the owner's completed connection.

[Namefi CI](https://github.com/heathermhuang/dombot/actions/runs/42173807020)
passed 2,852 tests. The final
[provisioner CI](https://github.com/heathermhuang/dombot/actions/runs/42198169056)
passed 269 test files / 2,871 tests, with one intentional skip, plus build,
typecheck, lint, engine integrity, four security regression tests and relay checks.
[CodeQL](https://github.com/heathermhuang/dombot/actions/runs/42198169016) passed.
Earlier 38 HTTP checks passed. Local qualification screenshots and adapter
coverage are in [source qualification](../namefi-qualification/README.md).

No domain purchase, renewal, payment, DNS, auto-renew, publication or messaging
mutation was performed for acceptance. Credentials, private holdings, recovery
exports and raw provider responses remain outside tracked source.

## Upstream contributions

- [registrar-client #106](https://github.com/aoxborrow/registrar-client/pull/106):
  ready for maintainer review; CI passed on Node 20/22/24. Its additional asynchronous
  registration and DNS-update behavior has unit coverage but is not part of the
  hosted SDK deployed here and was not exercised with paid writes.
- [DomBot #268](https://github.com/aoxborrow/dombot/pull/268): companion UI/help/pricing
  integration, CI passed; draft until the SDK is published and its dependency and
  lockfile can be updated. The upstream maintainer owns publication and merging.

See [release-receipt.json](release-receipt.json) for machine-readable scope.
