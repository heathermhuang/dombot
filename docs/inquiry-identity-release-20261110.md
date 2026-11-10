# Inquiry contact identity production release, 10 November 2026

Domains.Domains serves engine `2.2.1-hosted.2` and application source `2bba39243b34220dd98c80ffefd54c52d859befa` to all 48 original admitted portfolios and the qualified future template. [Implementation PR #211](https://github.com/heathermhuang/dombot/pull/211) adds optional professional profile, organization, website and inquiry-role fields using “I’m inquiring” wording, encrypted original request context and the private seller identity panel.

The gateway-only policy follow-up [PR #212](https://github.com/heathermhuang/dombot/pull/212) serves gateway source `33a6ec08351a58429be30d37340d41d10f676502` and policy version `2026-11-10.1`, without changing the tenant engine.

The canonical gateway and custom-host edge capture IP, reported user agent/language, submission time and approximate location before internal hops, carrying bounded values in signed admission. The owner panel separates self-reported identity from email confirmation and prepares contact-details replies for review without sending automatically. Collection notices and retention/deletion/backup behavior are documented in [the feature notes](inquiry-identity-20261110.md). Older inquiries cannot be backfilled. Backup format 16 and Sales version 4 require a compatible rollback reader once new records exist.

## Verification

CI passed 3,251 tests with one intentional skip, four security and four relay checks, required bundles, type/lint and both CodeQL analyses. Local native Worker/D1 fixtures exercised full form intake, original signed metadata, encryption, owner-only projection, public/email exclusion, retries, deletion and restore. The actual form and seller components passed desktop/tablet/mobile and dark-form browser checks. Native owner Chrome opened an existing production inquiry and displayed the new identity panel, email status and explicit absence of historical metadata. No private contact content is published here.

Every original portfolio passed exact code/settings and serving engine/source checks; 41 configured coordinators passed health/policy checks. The future template retained all 16 bindings. Trusted production import, two retries/readback and independent cleanup passed on the final template. All 68 public HTTP checks passed, including 28 listing pages, 2 profiles and 2 active custom hosts. New live inquiry submission and external contact identity were not tested; no contact was messaged.

## Preservation and recovery

Original users, workspace identities, credential/settings fingerprints, publication/routing state, notification choices and original inquiry/message payloads were preserved. The original allocation policy and schedules were restored, with zero active QA runs or unfinished allocations. A script-only compatibility bridge kept form assets available during the staged rollout and was replaced by the final source. Interrupted uploads and old coordinator observations were reconciled against exact original/target state before further action; unknown writes were never blindly replayed.

Recovery custody contains 51 protected code/settings snapshots and 49 Cloudflare-hosted bookmarks; no database contents or root keys were exported. Protected operational receipts are retained under the primary workspace’s ignored `.wrangler/inquiry-identity-release-20261110` directory, with temporary asset tokens scrubbed from the durable copy.

[Machine-readable receipt](inquiry-identity-release-20261110.json).
