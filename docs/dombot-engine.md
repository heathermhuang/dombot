# Pinned DomBot engine for the managed SaaS

The managed tenant wrapper consumes `@domains-domains/dombot-engine` as a pinned
file dependency. Engine source is maintained in this repository, with reviewed
host patches on the recorded upstream revision. SaaS deployment consumes the
bundled package rather than importing that source directly.

The package contains a Worker entry, its matching web assets, a small typed
fetch/scheduled/MCP-admission contract, source, license and source build lock.
`hosted/dombot-engine.lock.json` records provenance and integrity. The installed
package's `web` directory is the tenant asset source. The original self-hosted
Worker and desktop source/build flows remain available.

Use `npm ci --ignore-scripts` to install the exact engine artifact, then
`npm run engine:verify`. CI and the test pre-hook verify source/build-lock agreement,
archive/npm integrity, installed package exports/types, manifest, Worker and web
assets. A direct SaaS import of an engine internal is rejected. Engine requests
report `X-DomBot-Engine` and `X-DomBot-Engine-Source` headers.

To update the maintained engine:

1. Change the engine package version in `scripts/dombot-engine.mjs` and the file
   dependency in `package.json` for a new reviewed release. Record the exact upstream
   revision when incorporating upstream changes.
2. Make the source change, then run `npm run engine:pack`. This builds the renderer,
   bundles the Worker and writes the archive/provenance lock.
3. Install the exact new file dependency with npm and review `package-lock.json`.
4. Run `npm run engine:verify`, typecheck, lint, all tests, the separate security
   regressions and required Worker/UI dry-run builds. Review the artifact and lock.
5. Roll out the engine/UI pair with the coordinator binding, live configuration,
   data-preservation fingerprints and staged tenant sequence in the launch audit.

The embedded source excludes the recursive engine dependency and includes a build
manifest/lock. From its `source` directory, run `npm ci --ignore-scripts` then
`npm run engine:pack` to rebuild. The repository remains the source-maintenance
location; this package is not published to npm. Do not conflate a package rebuild,
green tests or a local UI check with deployment or fresh provider qualification.
