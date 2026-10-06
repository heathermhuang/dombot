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

## 101domain adapter (2026-10-06)

The current app pins `aoxborrow-registrar-client-0.7.0-101domain.2.tgz`, built
from registrar-client 0.7.0 plus the 101domain adapter at source commit
`38963dc`. The historical Name.com archive above is no longer the active dependency.

- SHA-256: `d18834019499a2a11540e08c80cf00907516eb6adc2d1aef3f4ae55dc1d991dc`
- Source: `https://github.com/heathermhuang/registrar-client`, branch `codex/101domain-support`
- API schema: 101domain Client API 1.1.0
- License: MIT, included in the archive
- Validation: 439 library tests, typecheck, ESLint, Prettier, ESM/CJS/types builds

To reproduce, check out source commit `38963dc`, install locked dependencies,
run `npm run build`, temporarily set package version to `0.7.0-101domain.2`,
and run `npm pack --ignore-scripts`. Restore the source package version afterward.
The archive contains no account credentials or environment files. Replace the pin
with an upstream release containing the adapter when available.
