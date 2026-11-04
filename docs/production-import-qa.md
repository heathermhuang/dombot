# Managed production import tests

Use `npm run test:production-import -- --production --config PRIVATE_JSON` for
production import qualification. The default run creates a fresh ordinary-role
operator QA account, checks open/preview allocation, saves one reserved `.invalid`
domain, checks readback/retries, then **always removes its account and resources**.
A test error, interrupt, failed assertion or lost start receipt still enters cleanup.
A cleanup or preservation failure makes the command fail, including when the test
itself passed. Do not seed an ad hoc production account for future import tests.

## Operator configuration

Keep this file and pepper custody outside Git, with owner-only permissions:

```json
{
  "accountId": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "gateway": "domains-staging",
  "provisioner": "domains-portfolio-provisioner",
  "origin": "https://domains.domains",
  "authPepperFile": "/protected/path/to/existing-gateway-custody.json",
  "receiptsDir": "/protected/path/to/production-import-qa"
}
```

The existing custody JSON supplies `pepper`; it is used locally to create a normal
password hash and is never sent to the provisioner. The runner uses the existing
Wrangler login or `CLOUDFLARE_API_TOKEN`, checks live gateway/provisioner/control/
namespace/template configuration, and signs in through the normal production
password endpoint. These are operator-seeded QA identities, not public signup,
legal-acceptance or mailbox-delivery qualification. No real holdings, credentials,
publications, inquiries, registrar operations or payments belong in these accounts.

Receipts and temporary QA credentials are written in directories 0700/files 0600.
The normal run scrubs its password file in `finally`. Passwords, session tokens,
provider keys and customer records must never be copied to PRs or stdout.

## Browser-driven tests and recovery

For a browser test, acquire a managed lease first:

```sh
npm run test:production-import -- --production --config PRIVATE_JSON --mode prepare
# Use only the returned credentials file and ordinary production sign-in.
# Complete browser actions, then finish in the test's finally/always step:
npm run test:production-import -- --production --config PRIVATE_JSON --mode cleanup --run-id RUN_UUID
```

A lease defaults to 15 minutes (allowed: 60–1,800 seconds). `--mode prepare` prints
the credential-file path, run ID and expiry, not the password. It does not allocate
a Worker/database. Browser or external test drivers must call cleanup in their
finally/always step. If the process is killed or disappears, the QA setup object’s expiry alarm
cleans the lease. A deterministic provisioner cron runs every two minutes as a
backup, including a crash after enrollment but before alarm arming. It does not use
a model. Status is available with `--mode status --run-id RUN_UUID`.

The remote run record owns recovery, so `--mode cleanup` does not need the QA
password or the original test process. It resumes provider deletion checkpoints,
checks actual absence after unknown responses, and clears only the corresponding
setup object's storage/alarm. It never force-deletes a Worker. Unknown create
outcomes are given a settling window before absence can be considered confirmed.

## Safety boundaries

- The runner generates fresh account/workspace/run identities. Enrollment and its
  trusted `production_import_qa_runs` marker commit atomically. A partial unique
  index allows only one outstanding run, including failed or held cleanup.
- Cleanup accepts a registered run ID, never arbitrary account/resource IDs or a
  broad name prefix. It validates the immutable marker digest, original credential
  fingerprint, owner, label, namespace/account, setup journal and template/module.
- Database names/IDs, Worker bindings and existing registry mappings must agree.
  Another portfolio's database mapping cannot be adopted. Provider/API failures
  are unknown, never absence.
- Unexpected connected credentials, real domain data, public claims, changed
  identities or other references stop cleanup with an explicit hold. A held run
  blocks further tests; inspect protected receipts rather than weakening guards.
- The account is disabled and sessions revoked before drain/inspection/deletion.
  Setup cleanup shares the provisioning queue. The known stale dispatch-checkpoint
  race is guarded only for registered QA identities whose cleanup has started;
  real account scheduling is unchanged.
- Only the exact QA account, registry/pending/control metadata, Worker/database,
  coordinator and setup object are removed. Disabled non-reusable identities and
  deletion receipts remain. The shared setup namespace and all real account
  mappings/credential fingerprints are preserved and checked by the runner.
- The expiry reaper selects at most one due run per invocation, uses bounded
  retries/backoff, and marks unreconciled failures as holds. It never reclaims
  customers or historical unregistered QA accounts.

## Deployment and qualification

Apply control migration `0023_production_import_qa.sql` before deploying the updated
provisioner. Retain the live control DB, dispatch namespace, setup namespace,
secrets, renderer assets, future template and feature flags. Add the provisioner's
`*/2 * * * *` cron. QA expiry alarms and the backup cron share the same guarded cleanup. No tenant
engine or gateway rollout is required.

Unit/integration tests cover atomic enrollment/caps, wrong-marker/account/resource
rejection, real-data/claim holds, lost-delete reconciliation, pre-allocation
cleanup, unchanged real accounts, stale scheduling, expiry selection and bounded
failure. The finally wrapper is tested on success, test failure, lost start receipt,
cleanup failure and preservation failure. For live qualification, run success and
`--inject-failure after-import` (expected nonzero test result with completed cleanup),
then prepare a short lease, submit synthetic data and let the expiry alarm recover it
without an explicit finish call. Record both test and cleanup results; a failed
test with successful cleanup is not a passing test.
