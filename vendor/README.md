# Current hosted registrar dependency

The engine pins `@aoxborrow/registrar-client@0.12.0-hosted.2`, based on the
published MIT-licensed 0.12.0 package. The adjacent JSON provenance records the
upstream integrity, cumulative source patch, and built archive hashes.

This rebase includes upstream's Dynadot manual-renewal setting when auto-renew
is disabled, Gandi forwarding updates that preserve HTTPS, and transfer-out
support in the dependency. It corrects Gandi’s last-update timestamp mapping: renewal deadlines remain unknown,
with registry expiry retained for planning. It retains our annualized Dynadot price-only quotes,
owned-domain REST and Name.com renewal fallbacks, bounded retry deadlines,
Gandi path validation, and Cloudflare expression serialization. New Gandi
transfer-out and forwarding paths use the same path guards. The app does not
register new transfer-approval tools as part of this dependency update.

To reproduce, extract the upstream 0.12.0 archive, apply
`registrar-client-0.12.0-hosted.2.patch` with `git apply --unidiff-zero`, set the version to
`0.12.0-hosted.2`, then bundle `src/index.ts` with esbuild for ESM (`dist/index.js`)
and CommonJS (`dist/index.cjs`), using `bundle`, `packages: external`,
`platform: neutral`, `target: es2022`, and source maps. Keep upstream's unchanged
declarations and license; pack with `npm pack --ignore-scripts`.
The archive ships patched source and both rebuilt module formats. Synthetic
transport tests cover renewal settings, pricing, retry budgets and path guards.

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
