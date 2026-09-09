# Registrar dependency for the self-hosted release

This private deployment includes the same Name.com adapter as our desktop build.
The registry's released 0.5.0 package does not contain that adapter yet.

- Source: https://github.com/heathermhuang/registrar-client
- Upstream PR: https://github.com/aoxborrow/registrar-client/pull/48
- Source commit: `1e42b0f670ddde38529dc55548ededb66c876b0c`
- Local package version: `0.5.0-namecom.1` (not an npm registry release)
- Artifact SHA-256: `58f65a3b18940c11314db7f82f88eecdf6fb9740755d037c3f4f4b6422fa3328`
- License: MIT, included in the archive

The archive contains the pinned source, built ESM/CJS modules and TypeScript
declarations. It contains no local credentials or environment files. It was
built from a clean git archive of the source commit; only the package version
was changed. The provider's 64 unit tests passed before packaging.

To reproduce, check out that commit in a separate directory, install its
locked dependencies, set package.json version to 0.5.0-namecom.1, then run
`npm run build` and `npm pack --ignore-scripts`. Replace this local artifact
with a published version containing Name.com once upstream releases it.
Do not merge this deployment-specific dependency pin into upstream's draft
DomBot PR before its documented release gate is satisfied.
