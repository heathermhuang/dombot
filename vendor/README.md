# Current hosted registrar dependency

The engine pins `@aoxborrow/registrar-client@0.15.1-hosted.1`, based on upstream
0.15.1 at `4bbc193bf5ff1773e6c6418f26ca38bf72848d70`. The adjacent JSON records
the exact source, archive integrity and cumulative source/test patch hashes.
Upstream now contains the prior hosted Dynadot annualized REST quotes and Name.com
owned-domain fallback. Retained hosted changes cover the overall retry deadline,
jitter, Gandi path validation and renewal-date correction, and Cloudflare literal
serialization. Porkbun unzoned provider date-times are interpreted as UTC.

To reproduce, check out the pinned upstream registrar-client revision, apply
`registrar-client-0.15.1-hosted.1.patch` and the adjacent `tests.patch`, set the root
package and lockfile root version to `0.15.1-hosted.1`, run `npm ci --ignore-scripts`,
`npx vitest run --maxWorkers=1`, then `npm run build` and `npm pack --ignore-scripts`.
The upstream tsup build generates ESM, CommonJS, source maps and matching declarations.
All 586 non-live SDK tests pass. Tests preserve the hosted single-operation budget:
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
