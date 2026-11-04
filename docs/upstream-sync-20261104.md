# Full upstream 2.0.0 integration

The coordinated release merges all upstream history through
`ccb918deed20f8d01009970064027fcb021bac97` and retains the three weekly-review
fixes from PRs #153–#155. The final candidate is `2.0.0-hosted.1`; do not deploy
intermediate `1.5.2-hosted.42`–`.44` artifacts. Its pinned SDK is upstream 0.15.1
with documented hosted patches and matching rebuilt declarations.

The parity inventory covers 91 core API methods and 73 MCP tools. Upstream adds
ownership-verification TXT actions, marketplace identifiers, GoDaddy optional API
settings and privacy-consent context, normalized nameservers, exact currency
formatting and responsive action menus. Existing storage schema 5 and hosted
backup format 12 already preserve these fields; no new control migration is needed.

Review corrected the first-registrar structured-failure response, retained the
Dynadot 401 activation guidance independently of error wording, and added the new
market refresh method to the shared provider budget. Verification writes keep
fresh authentication and write-scoped MCP grants. Existing identities, encrypted
credentials, egress policies, publications and automatic QA cleanup remain intact.

Verification uses real local Worker runtimes and an actual renderer/core fixture
with 19 synthetic holdings, no production credentials and blocked external provider
requests. It demonstrates five past-expiry records, 13 upcoming renewals, USD 138
upcoming estimates and USD 288 annual estimates; legacy Gandi dates do not create
false payment deadlines. Quote coverage and 390px layout were checked in-browser.
The SDK's 586 non-live tests pass. Required exact-candidate CI and production
acceptance remain distinct release gates, recorded in the coordinated release receipt.

The authorized rollout follows `weekly-review-coordinated-release.md`, with fresh
private roster, account/credential/publication fingerprints, encrypted D1 recovery
exports and code/settings snapshots. No registrar or marketplace mutation is an
acceptance action, and all existing accounts must be preserved.
