# Complete engine source snapshots

Engine `2.2.2-hosted.2` corrects the embedded source snapshot without changing the application feature set or deployed renderer styling.

The previous packer listed SDK 1.2.1 source files explicitly even after the application moved to SDK 1.3.0. The archived package manifest therefore referenced an SDK archive missing from its own source directory. The full repository contained the correct SDK and runtime bundle; the private embedded snapshot was incomplete.

The packer now selects the SDK archive from the actual pinned dependency, checks its provenance and source/test patch hashes, and includes those exact files. The compiled Worker uses the same package manifest as its source snapshot, omitting the engine's recursive dependency on its own previously installed version.

The regression test reads the real installed artifact's source package and confirms its current local SDK archive, matching provenance and patches are present and integrity-correct. It failed with the missing 1.3.0 archive before the fix. The existing executable/export/SVG integrity controls still pass.

Qualification uses a separate extracted source directory with its own `npm ci --ignore-scripts` install, followed by `npm run engine:pack`. That independent Worker rebuild must match the reviewed Worker/source hashes, and the independent renderer build must succeed. Browser minification and style-scanning context are not asserted to be byte-reproducible across checkout layouts. The actual deployed UI remains the matched pinned artifact and is qualified separately.

The SDK runtime version, application source, notification rules, authentication and DNS policies are unchanged. Production activation is separate from source qualification and must use the normal preservation and canary procedure.
