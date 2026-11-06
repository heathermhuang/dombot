# Namefi Worker redirect compatibility

The first owner connection attempt on 6 November 2026 failed before saving the
account with `namefi: network request failed`. Node provider read checks had
passed, but the installed Worker runtime rejects Fetch redirect mode `error`
while constructing the outgoing Request. No provider request is sent in that mode.

SDK `1.1.0-hosted.3` uses `manual`. The existing HTTP client rejects every non-2xx
response, including redirects, and never follows the Location header. The key
therefore stays at the configured Namefi API origin. Engine `2.1.0-hosted.3`
contains this SDK correction; it does not add new provider write capabilities.

`src/worker/namefi-runtime.test.ts` bundles the installed SDK into a real Worker
runtime and constructs real Requests with synthetic credentials. Authentication
fails with hosted.2 and passes with hosted.3. A 302 fails with exactly one call to
the configured API origin. The existing 26 adapter contract tests remain in place.
A public-document probe separately reproduced `manual` → HTTP 200 and `error` →
runtime TypeError, without a private API key.

[Cloudflare's Request reference](https://developers.cloudflare.com/workers/runtime-apis/request/)
documents the supported modes. The same fix is included in
[upstream SDK PR #106](https://github.com/aoxborrow/registrar-client/pull/106).

Source/regression checks establish the fix. Final deployment and owner connection
acceptance are tracked in the release receipt after live verification.

## Completed verification

Status: DONE. The corrected engine is deployed across all 44 portfolios. The
owner connection synced seven domains and persisted after browser refresh; the
credential, account and inventory have AES-GCM envelopes. Fresh managed production
import/retry/readback and independent cleanup passed. See the
[final release evidence](namefi-release-20261106/README.md).
