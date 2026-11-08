# Namefi DNS ownership guard

The current dependency is `@aoxborrow/registrar-client@1.1.0-hosted.4`.
Start from hosted.3 below, apply `registrar-client-1.1.0-hosted.4.namefi-ownership.patch`,
set the root package and lockfile version to `1.1.0-hosted.4`, build and pack.
The adjacent JSON records archive and patch integrity. For the SDK test suite,
retain the hosted.1 safety tests and apply the hosted.4 test patch, which adds
Namefi to the exhaustive nameserver-fetch metadata matrix.

DNS reads confirm ownership through the complete account inventory before
querying the public DNS endpoint. Unowned domains throw `NotFoundError`, even
when public records exist; owned empty zones return `[]`. Each standalone DNS
read uses one inventory request and one DNS request. Existing DNS writes keep
their ownership check and reconciliation behavior. Installed-artifact tests cover
ownership, normalization, cancellation and MX/SRV mapping; a real Worker fixture
also verifies rejection before the public DNS lookup. This backports the fix in
[upstream SDK PR #106](https://github.com/aoxborrow/registrar-client/pull/106)
without adding its separate registration or DNS-update changes.

# Worker-compatible Namefi requests

The previous dependency is `@aoxborrow/registrar-client@1.1.0-hosted.3`.
Start from hosted.2 below, apply `registrar-client-1.1.0-hosted.3.worker-redirect.patch`,
set the version to `1.1.0-hosted.3`, then build and pack. The adjacent JSON pins
archive and patch integrity. Workers rejects Fetch redirect mode `error` before
sending; `manual` is supported and all non-success responses still fail without
forwarding the key to a redirect destination. `src/worker/namefi-runtime.test.ts`
constructs real Worker Requests and tests both authentication and redirect refusal.

# Namefi registrar extension

The previous dependency is `@aoxborrow/registrar-client@1.1.0-hosted.2`.
Start from the hosted.1 source below, apply
`registrar-client-1.1.0-hosted.2.namefi.patch`, set the package version to
`1.1.0-hosted.2`, then use the upstream tsup build and `npm pack --ignore-scripts`.
The adjacent JSON pins archive and patch integrity. Namefi contract regressions
live in `src/core/services/namefi.test.ts` and run against the packaged dependency.
The official square logo comes from
https://namefi.io/assets/brand-kit/namefi-compact-square.svg (normalized viewBox
and equivalent clip path for the existing monochrome icon renderer).

# Current hosted registrar dependency

The engine pins `@aoxborrow/registrar-client@1.1.0-hosted.1`, based on upstream
1.1.0 at `a6235ca054a35029e0c017abf48b6f97dbe247a4`. The adjacent JSON records
the exact source, archive integrity and cumulative source/test patch hashes.
Upstream now contains the prior hosted Dynadot annualized REST quotes and Name.com
owned-domain fallback. Retained hosted changes cover the overall retry deadline,
jitter, Gandi path validation and renewal-date correction, and Cloudflare literal
serialization. Porkbun unzoned provider date-times are interpreted as UTC.

To reproduce, check out the pinned upstream registrar-client revision, apply
`registrar-client-1.1.0-hosted.1.patch` and the adjacent `tests.patch`, set the root
package and lockfile root version to `1.1.0-hosted.1`, run `npm ci --ignore-scripts`,
`npx vitest run --maxWorkers=1`, then `npm run build` and `npm pack --ignore-scripts`.
The upstream tsup build generates ESM, CommonJS, source maps and matching declarations.
All 652 non-live SDK tests pass. Typecheck and the ESM/CommonJS build pass. Tests preserve the hosted single-operation budget:
a 60-second provider delay cannot fit inside a 30-second operation deadline.

## Historical 0.5.0 artifact

The following record describes a retained earlier release, not the current dependency.

# Registrar dependency for the self-hosted release

This deployment includes the same Name.com adapter as our desktop build,
plus a transport-error privacy fix. The registry's released 0.5.0 package
does not contain the Name.com adapter yet.

- Source: https://github.com/heathermhuang/registrar-client
- Upstream PR: https://github.com/aoxborrow/registrar-client/pull/48
- Source commit: `1e42b0f670ddde38529dc55548ededb66c876b0c`
- Local package version: `0.5.0-namecom.2` (not an npm registry release)
- Artifact SHA-256: `3e013814ee18c22075ec8d69455a7c77c0bca80f34e7bcbfe4963e17079fd07a`
- License: MIT, included in the archive
- Additional patch: `registrar-client-http-errors.patch`

The archive contains pinned source, built ESM/CJS modules and TypeScript
declarations. It contains no local credentials or environment files.
The privacy patch strips query parameters, URL credentials, upstream error
bodies and parser/network excerpts from errors without changing the actual
requests, typed error statuses or retry behavior. All 353 library tests pass,
including six new transport privacy regressions; typecheck, lint and build pass.

To reproduce, check out the source commit in a separate directory, install its
locked dependencies, apply `registrar-client-http-errors.patch` with `git apply`,
set package.json version to 0.5.0-namecom.2, then run `npm run build` and
`npm pack --ignore-scripts`.

Replace the local artifact with a published version containing both fixes once
available. Keep this deployment-specific dependency out of upstream's draft
DomBot PR until its documented release gate is satisfied.
