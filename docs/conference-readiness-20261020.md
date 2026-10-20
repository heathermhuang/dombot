# Conference readiness fixes

Baseline: 416534d3831b03201493dd928af4991b63bcf2cf. Authorized scope: repair the eight UI/UX audit findings through release and evidence. Preserve customer state, private ingress, keys and the existing design system.

## Plan

1. Authentication: bounded configurable conference/NAT limits with Retry-After and branded retry states; atomically reserve shared email budgets before identity lookup so exhausted capacity is reported without account enumeration; retain proof and show a corrective Terms error. Preserve single-use, session binding, passkey and CSRF controls.
2. Editing: retain manual sales drafts and their original revisions across in-app navigation; warn on document exit. No automatic publication or silent conflict overwrite. Cover listing and Shop.
3. Inventory: on publication-metadata failure, render private inventory with a retry notice. Keep public-site editing separate.
4. Shop: search and cursor pagination with selections retained across pages; final review resolves all selected/removed IDs to domain names and prevents publishing an unreadable review.
5. Copy/accessibility: align setup text with email-first sign-in and retain practical mobile controls.
6. Verification: targeted real D1/auth tests, draft-session tests and browser reproductions, then required typecheck/lint/test/security/build and pinned-engine verification. Repack engine/UI together.
7. Release: reviewed PR, green CI, merge; capture live config/backups/fingerprints, controlled pilot before remaining tenants, gateway deployment, public and controlled private verification. Separate live delivery/device/customer evidence from code checks.

Assumption pending attendance input: 100 attendees in ten minutes. No unbounded sends, paid plan upgrade, automatic capacity provisioning or registrar mutation is authorized by this implementation. Keep a hard email allowance; only increase live values after provider/usage checks. Current live configured pool is ten slots; ready public slots require a fresh eligibility query. This fixes defects but does not invent unlimited customer capacity.

## Acceptance

- A legitimate shared-NAT burst fits the configured allowance; per-address throttling remains and produces a recoverable screen with retry timing.
- Exhausted global mail allowance never leaves a user waiting on a challenge that cannot be sent.
- A valid new-user proof with unchecked Terms stays correctable without another email.
- Edited listing/Shop text survives internal navigation with original save revision intact; refresh/close warns while any buffer is dirty.
- Failed publication metadata does not replace private holdings.
- A 101st listing is reachable and selections persist; review names domains and additions/removals.
- Public setup no longer instructs password creation.

## Results

Implemented F1–F8. Local verification: typecheck and lint passed; 119 test files,
1,350 tests passed and one existing skip; four separate security regressions passed.
Gateway, lander, tenant and original Worker dry-run bundles passed; web, demo and
site builds passed. Pinned engine 1.5.0-hosted.17 verified against source and assets.
Browser fixture using actual components confirmed retained listing text after
HashRouter navigation, selection of the 101st listing, named cross-page review,
and private inventory during a failed publication-metadata request.

Live preflight on 20 October found one unused qualified public slot. This release
will not provision additional workspaces. Proposed live auth daily limit: 200;
monthly limit stays 300, preserving the existing monthly envelope. This supports
a burst, not unlimited ongoing signups, and does not reserve the provider-wide
included allowance. User attendance/budget clarification remains pending.

Release and production verification are pending; this document is not a deploy receipt.
