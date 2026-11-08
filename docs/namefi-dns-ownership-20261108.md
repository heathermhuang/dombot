# Namefi DNS ownership repair

Namefi DNS records are publicly readable. The previous hosted adapter read the
zone without checking the configured account's inventory, so callers could
receive an unowned domain's records or an empty zone as a successful account read.

SDK `1.1.0-hosted.4` confirms exact normalized ownership before the DNS lookup.
Missing ownership throws `NotFoundError`; owned empty zones still return `[]`.
Caller cancellation reaches both reads. Each standalone DNS read adds one
inventory request. DNS writes keep their existing guard and reconciliation.

This is the narrow backport of upstream registrar-client
[PR #106](https://github.com/aoxborrow/registrar-client/pull/106), commit
`692668868af3137a839d4baec80a77f160d11e02`. It retains all hosted SDK patches
and does not import the upstream PR's separate registration or DNS-update work.
Engine `2.1.0-hosted.5` packages the corrected SDK and existing hosted features.

Seven installed-artifact tests cover unowned accounts with empty/populated public
DNS, an unrelated owned name, normalized owned empty zones, and cancellation
during either lookup. Five ownership/empty-zone cases fail with hosted.3.
A real Worker fixture also proves that unowned requests stop before DNS, while
owned empty zones succeed. Existing MX/SRV mapping, cross-zone identity checks,
redirect refusal and DNS-write regressions remain in the suite.

## Production release

[PR #191](https://github.com/heathermhuang/dombot/pull/191) is merged and deployed
as application/gateway source `27c6a880d42cac64f0e8ed6d932efa378e49c071`.
All 46 previously admitted portfolios and the qualified future template serve
engine `2.1.0-hosted.5`, source digest
`8c979b270ab2b51c0f78744321e54fd39b26915997647607b9c68596e89145ba`.
See the [machine-readable release receipt](namefi-dns-ownership-release-20261108.json).

After gateway cutover, the connected production MCP read DNS successfully for
an owned Namefi domain and rejected the reserved, unowned `example.com` with
`namefi: domain is not in this account`. No private holding or DNS record is
published here. No registrar setting, DNS record, purchase or payment was changed.

A fresh trusted production QA lease verified zero allocation on open/preview,
one Worker/database pair on a valid synthetic import, two retries using that
same pair, readback and exact engine/source identity. Independent cleanup
confirmed both resources absent, and the temporary password was scrubbed.
Final audit found zero active QA runs or unfinished allocations.

Preservation checks retained all 59 original accounts, 567 workspace identities,
41 platform mappings, credential/account fingerprints for all 46 portfolios,
two published sales and two published profiles, their canonical/legacy routes,
and two active custom hosts. All 14 qualified future-template bindings, private
provisioner code, gateway assets, the cleanup cron and original allocation policy
were retained. All 38 HTTP checks passed and the source offer names the released
revision. Cloudflare-hosted D1 Time Travel bookmarks and protected code/settings
snapshots provide recovery custody; database contents and root keys were not
exported.

Three management uploads exceeded the initial deadline without applying. Each
was reconciled against exact remote code/settings and original admission was
restored before resuming. Remaining immutable assets were staged separately;
a bounded two-minute management upload deadline allowed valid updates taking
over 45 seconds to finish. Runtime-source and preservation guards were retained.
No uncertain deployment write was blindly replayed. A local bundle-path mismatch
was also caught by the packet guard before any production write.

[CI](https://github.com/heathermhuang/dombot/actions/runs/42445096095) and
[CodeQL](https://github.com/heathermhuang/dombot/actions/runs/42445096110) passed.
The hosted suite has 2,957 passing tests with one intentional skip; all 653 offline
SDK tests, 33 Namefi adapter cases, two real Worker fixtures, four security
regressions and four relay checks passed. Root/Worker/hosted typechecks, lint,
formatting, changelog validation, engine integrity, six Worker dry bundles and
web/demo/site builds passed. The separate one-line archive fixture correction
keeps its six-read assertion valid as published dates advance.

Upstream SDK #106 remains open for its maintainer. The hosted backport is released
independently and does not include that PR's additional write capabilities.
