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

Source qualification, CI and production deployment are separate. Production
status and preservation evidence will be recorded after rollout and managed
import qualification, with no live registrar mutation.
