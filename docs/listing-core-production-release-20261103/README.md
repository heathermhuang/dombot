# Listing/core production release · 3 November 2026

The approved #138–#142 stack was merged in dependency order and released. Release follow-up #143 added a controlled transition gate, serving-engine metadata on the existing admin snapshot boundary, per-account future inquiry origins and backfill consistency with current reader eligibility.

## Released artifacts

- Application source: `15bc7dbd028ac64161f76a2058e246f05d1e8bb1`.
- Tenant engine/UI: `1.5.2-hosted.41`.
- Engine source digest: `85e446bd12e518a55cfc5f99b66b2440617de2d3cfec583b457511c15a40745b`.
- Future template: `0875c0ad06e5c550e5cc595d8b7529fa673af11484582801d1b79b48d0287fd9`.
- Existing production gateway, 43 admitted tenant Workers (8 legacy / 35 platform), provisioner and public lander edge updated. Retired, disabled and closing resources were not recreated or enrolled in the rollout.

The merged source tree matched the checked candidate. Main CI and Security analysis passed at the released application source, including the test and Worker/build jobs. Deployment used existing Cloudflare operator authentication; the repository's main-push self-hosted workflow had no deployment secrets and did not deploy intermediate commits.

## Execution and recovery

Protected SQL exports and recovery bookmarks were captured for the control database and all 43 admitted tenant databases. Existing code, binding and publication snapshots were retained. Operator recovery/verification material is in the ignored, owner-only `.wrangler/listing-core-release-20261103` directory in the primary checkout; it is not part of this public report.

Control migration `0022_public_domain_directory.sql` and tenant migration `0009_sales_lifecycle.sql` are confirmed. No old root key, gateway key, database identity, coordinator namespace or unrelated binding was replaced. Existing feature gates were retained. No schedule/alarm reset, registrar/DNS change, provider listing write, real inquiry/message or purchase was initiated by this release.

Gateway transition mode preserved unmapped legacy reads while new allocation was temporarily paused. Each tenant was rolled with a drain check, exact uploaded-code verification, unrelated-binding comparison, restored admission and a serving-coordinator header check. The canary's initial drain check assumed an unavailable expiry column; it stopped before code upload, original code/admission were verified and restored, and the check was corrected to require zero lease rows before resuming.

Runtime qualification used existing anonymous published-only reader paths and actual coordinator version/source headers. No fleet-wide key file or new operator probe endpoint was created. Earlier probe proposals were rejected by automatic approval review and were not executed; existing paths supplied the required evidence without changing admin roles.

## Production verification

- All **43/43** admitted tenants reported `.41` and the expected source digest, before and after directory-only cutover.
- All **43/43** published-only backfill checkpoints completed. **Two** eligible publications were indexed, both active; **zero conflicts** were found. Private inventory/drafts were not used as migration destinations.
- Both canonical pages returned **200**, current Sales revisions, matching canonical metadata, `no-store`, `noindex` and no application cookies.
- Eligible legacy links returned **308**, preserving query parameters.
- Both existing Sales payloads and both published profile payloads/revisions matched their pre-release snapshots. Both profile routes returned **200**.
- Both already-active custom hosts passed root and provider-path checks against the serving `.41` tenant. Host activation and DNS were unchanged.
- Production `/source` points to the exact released source.
- Current legacy schedule sets were read; no schedule mutation was issued. Existing coordinator namespace identities and configuration were preserved.
- `PUBLIC_DOMAIN_DIRECTORY_READY=true`; transition fallback ended. Original new allocation was restored with `ON_DEMAND_ENABLED=true`, and gateway/provisioner template hashes agree.

The production browser confirmed the canonical working.io page and its legacy redirect. Its pre-existing content explicitly labels its prices as controlled qualification data. No CAPTCHA was solved and no form was submitted. See [production browser evidence](working-io-production.jpg).

## Remaining holds and evidence limits

One pre-existing unfinished allocation (approximately eight hours old when identified during preflight) has an existing Worker/database pair but no registry entry. Its resources and opaque setup identity were left untouched; it remains a separate recovery hold. The release did not recreate the pair, rotate its keys or claim it as qualified capacity.

These are operator deployment/runtime checks and controlled-page observations. They do not establish independent customer acceptance, real marketplace checkout availability, paid settlement, transfer/payout completion or conversion uplift. The earlier synthetic owner/buyer qualification remains at `../listing-browser-qualification-20261103/README.md`.

After any new schema-5 / backup-12 / exact-money-v2 writes, do not install an older incompatible runtime as a blind rollback. Use the retained recovery points and a compatible recovery/revert plan.

## Subsequent recovery · 3 November 2026

The separate unfinished-allocation hold above was resolved under new explicit user
authorization. Its original Worker/database/setup identity and keys were preserved;
native `.41` qualification, normal admission, owner API/import-preview and gateway
checks passed. See [the recovery receipt](../allocation-recovery-20261103/README.md)
for the repair source, preservation evidence and remaining owner-browser limit.
