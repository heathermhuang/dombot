# Current hosted registrar dependency

The hosted engine pins `@aoxborrow/registrar-client@0.9.2-hosted.4` from the local
archive. This is a reviewed MIT-licensed fork of the registry's 0.9.2 release,
not an upstream-published version. `registrar-client-0.9.2-hosted.4.json` records
upstream integrity, the patch series and archive hashes. Source and unchanged public types
are included; `HOSTED-PATCH.md` in the archive records the ESM/CJS build commands.

The hosted.4 patch adds a narrow read-only fallback for owned `.in` names rejected
by Core per-name pricing: use the exact account-owned renewal quote, never a generic
TLD estimate. The package preserves HTTP error privacy, authentication/rate-limit
failures, sandbox routing and all paid-operation behavior.

The earlier patch requests Dynadot's required two-year `.ai` price-only renewal quote,
normalizes its fee to an annual estimate, and preserves transient/rate-limit
errors so the hosted job respects cooldowns. Paid register/renew operations are
unchanged. `src/core/services/dynadot-pricing.test.ts` exercises the installed
provider's actual request shape and proves price_check=1 remains present.
The engine source archive includes this dependency, provenance and patch so its
standalone build lock remains usable.

The second patch, `registrar-client-path-literals.patch`, validates Gandi DNS
domain names using IDNA, rejects path separators and dot/empty components before
transport, and encodes path components. Cloudflare forwarding host names are
serialized as single quoted expression literals. Local transport fixtures cover
read/write paths, Unicode names, ESM/CommonJS exports and quote/backslash input;
they do not contact registrar APIs or create live redirect rules.

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
