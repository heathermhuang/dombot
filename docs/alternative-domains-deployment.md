# alternative.domains deployment

Current self-hosted release: **1.2.0-namecom.3**, deployed on 2026-09-09.
Source branch: `codex/alternative-domains-release`, based on multi-account
commit `206b3af489762d5101ab1d713d3c23b8751014f1`.

- Production URL: https://alternative.domains
- Additional URL: https://dombot.measurable.workers.dev
- Worker: `dombot`
- Worker version ID: `73e01f3c-583d-488c-ab2b-f1c18f5ba9e8`
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

## Registrar connection investigation (2026-09-09)

Using the same imported credentials and registrar-client User-Agent, read-only
requests from the desktop network returned Name.com HTTP 200 and
Namecheap HTTP 200 with XML ApiResponse status OK. The hosted connection tests
returned Name.com HTTP 403 and Namecheap HTTP 500 with a generic HTML runtime
error. Changing keys is not a demonstrated remedy for these network-dependent
failures. Namecheap requires an allowlisted IPv4 address for the calling server:
https://www.namecheap.com/support/api/global-parameters/

The app's existing cached portfolio remains available. Keep the deployment on
Cloudflare Workers and D1, as requested; do not assume an external server or
silently add a relay. A Cloudflare-native path is Workers VPC through Gateway
with dedicated egress, but dedicated egress is an Enterprise add-on rather than
a standard Workers feature. Provider access must be verified before claiming
that path fixes either registrar. References:
https://developers.cloudflare.com/changelog/post/2026-06-05-gateway-egress/
https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/dedicated-egress-ips/

No relay, registrar allowlist changes, credential rotations, security-setting
changes, or paid upgrades were performed. Name.com's exact rejection rule has
not been established and may require provider support. Its 403 is not proof
that it has the same IPv4 allowlist requirement as Namecheap.

A transport privacy patch removes query strings, URL user information, upstream
error bodies, parser excerpts and nested network error details from surfaced
HTTP errors while retaining typed statuses and retry behavior. Cached errors
from prior builds are sanitized when returned in portfolio and account metadata.
The original Namecheap key was included in the error URL shown to the user;
rotation is recommended, with the replacement entered into both apps.

The privacy correction is deployed as 1.2.0-namecom.3. Verification passed:
360 app tests (one skipped), all 353 registrar-library tests, typecheck, lint,
web build, Worker dry run, production cached-error and live connection-error
redaction, and browser verification of hosted connection guidance. Existing
portfolio counts and credentials were preserved. The two provider connection
failures remain unresolved pending an approved connection path/provider access.

## Subsequent proxy tests and Name.com recovery

Name.com was subsequently verified working directly from the production Worker
after an account configuration correction. It no longer needs a proxy.

The user's existing IPRoyal ISP proxies were tested with read-only requests.
One refused proxy authentication (407). The other listed Namecheap domains
successfully from both the desktop network and an isolated Cloudflare Worker.
Native Workers CONNECT/startTls failed for the tunnel; a pinned tunnelfetch
1.13.0 prototype with certificate verification enabled succeeded. A wrong-host
certificate was rejected. The expiry control was blocked at the proxy and is
inconclusive. The client's authors disclose that its JavaScript TLS stack has
not had an external audit, so this is functional test evidence, not production
qualification. No production proxy transport was installed or activated.

The temporary test Worker was removed. Detailed results, proxy endpoints and
prototype source are retained privately under .wrangler/deployment; they are
ignored by Git. Preserve Name.com's direct connection when integrating a proxy
for Namecheap. Do not assume the native Worker fetch API accepts a proxy option.
