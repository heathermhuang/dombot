# alternative.domains deployment

Current self-hosted release: **1.2.0-namecom.2**, deployed on 2026-09-09.
Source branch: `codex/alternative-domains-release`, based on multi-account
commit `206b3af489762d5101ab1d713d3c23b8751014f1`.

- Production URL: https://alternative.domains
- Additional URL: https://dombot.measurable.workers.dev
- Worker: `dombot`
- Worker version ID: `7bba544a-ce3a-489b-a0d2-aae49497c83e`
- Account: `63a7fe52c985c63bb9e69ce47efdc569`
- D1: `dombot`, ID `0b7e15ac-97e8-4bf5-ab66-b4b847f2c729`
- Migration: `0001_docs.sql`, applied remotely
- Schedule: `0 * * * *`, subject to the app's sync settings
- Authentication: built-in password; secrets stored as Worker bindings
- Preview URLs: disabled

## Name.com desktop import correction

The first hosted release used the published registrar library 0.5.0, which
lacked Name.com. Our installed desktop build already included Name.com, so its
valid account metadata was rejected by the hosted import validator. Validation
happens before any namespace replacement.

This release includes the pinned Name.com adapter used by our desktop build,
plus its credential help, logo, and renewal quote routing. See
[vendor/README.md](../vendor/README.md) for source, artifact hash, license, and
reproduction instructions. This is a deployment-specific prerelease, not an
upstream npm release or a merge of upstream's draft integration PR.

Verification:

- New import regression failed with the original metadata error before the fix.
- TypeScript, lint, all 359 app tests (one skipped), web build, Worker dry run passed.
- All 347 registrar-library tests passed, including 64 Name.com tests.
- An isolated local Worker/D1 imported the reported desktop account metadata
  with synthetic credentials and portfolio cache. Read/export comparisons
  preserved all incoming records, and all five persisted D1 documents used
  encrypted envelopes.
- Production browser login and Settings verified Name.com is present.
- No production import was performed during verification. The user can retry
  the original desktop export after refreshing the hosted app.

The deployment preserved the production D1 database and secrets.

## Credentials

The initially generated password and encryption root key are saved locally in
`.wrangler/deployment/secrets.json`, ignored by Git and readable only by its
owner. Back up both in a password manager. The file is a creation-time backup;
subsequent password rotations may make its password stale. Do not rotate the
encryption root key directly after storing data.

To choose a new login password, run `npx wrangler secret put DOMBOT_PASSWORD`
from this repository. To generate one, run `npm run web:rotate-password`.
Password rotation signs out existing sessions without changing encrypted data.

## Domain routing

Cloudflare zone: `e692d7f87e93b565f85445f4abbfcf36`.
Nameservers: `camilo.ns.cloudflare.com`, `june.ns.cloudflare.com`.

The user approved replacing the previous website's apex record. The old
proxied A record (`alternative.domains` → `205.196.209.80`, TTL Auto) was
removed, and the Worker custom domain was attached. The `ftp`, `ssh`, and
`www` records were preserved.

- Domain mapping: `d113b0767e6a3f7d2b63667995951e907606040e`
- Certificate ID: `083286eb-8c8b-4e1a-9329-e67003da2dd9`

HTTPS, login, database reads, logout, and unauthenticated-request rejection
were verified on the custom domain after cutover.
