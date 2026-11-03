# Import submission qualification · 3 November 2026

Opening Import now opens a gateway-served editor. File selection, CSV/text parsing,
column matching and preview run locally before setup. Only Save domains submits
normalized, nonempty rows to the owner import API. The gateway validates the first
submission before requesting allocation, then forwards that same request through
normal admission and the tenant import path. Existing accounts use their current
import API and retain their resources/identity.

## Executed checks

- Opening Import, the former `POST /start` button and invalid preview: no setup
  request, zero synthetic Workers and zero synthetic databases.
- File and pasted CSV parsing, metadata matching and valid preview: zero allocation.
- Empty, malformed, invalid-name/date/money/price input, unauthenticated,
  foreign-owner and cross-origin submission: rejected before provisioning.
- Valid browser Save domains: one pair, normal qualification/admission, then an
  imported domain displayed in the normal `.41` tenant application with its
  registrar, expiration date and renewal price. See [browser evidence](saved-domain.jpg).
- Simulated lost upload receipt: one pair retained; retry reconciled it, kept the
  same owner/workspace/database/key, completed import and readback. Another import
  retry reported unchanged and allocated no additional pair.
- Full suite: 236 files passed, 2,561 tests passed and one skipped. Root/worker/hosted
  typechecks, the browser-entry typecheck, lint and gateway dry-run build passed.

Repeat with `node scripts/import-allocation-qualification.mjs --check`. Browser mode
without `--check` serves a synthetic session on loopback. It uses the actual gateway,
provisioning function, bootstrap, coordinator and pinned tenant engine; provider
create/upload receipts are simulated locally. All external provider access is
blocked. The Node fixture invokes Worker's native HTMLRewriter for the gateway's
unchanged head-prepend hook. A local Miniflare origin/routing mismatch encountered
while preparing the fixture was corrected without weakening product checks.

These are local controlled integration/browser receipts. They do not claim a real
customer import, registrar ownership, external provider operation or independent
adoption. Production deployment/source and preservation receipts are recorded by
the release owner after this candidate passes CI; they remain distinct from local
provider simulation.
