# Managed SaaS UI polish

The hosted homepage, account pages, and gateway-authenticated workspace now share
clearer typography, forest accents, warm neutral backgrounds, and distinct working
surfaces. Navigation uses compact active states, Sales filters use a segmented
control treatment, and the listings table has a defined surface. Account forms
have bounded widths, clearer fields, and full-width primary submission actions.
The public page includes a keyboard skip link.

The full wordmark, sample-data attribution, inquiry language, legal acceptance,
authentication behavior, and upstream desktop/self-hosted theme are preserved.
No dependencies were added. The matching engine/UI package is
`1.5.2-hosted.11`; source and asset integrity verification passed.

## Validation

- Typecheck, lint, engine integrity, and whitespace checks passed.
- Full suite: 1,574 tests passed, three skipped, and one platform fixture timed
  out at its existing ten-second setup limit. Its isolated rerun with a
  thirty-second hook allowance passed both tests. No test source was changed.
- Four security regressions and four relay checks passed. Relay checks required
  local loopback access outside the filesystem sandbox.
- Web, demo, and site builds passed. Gateway, lander, tenant, proxy scheduler,
  and self-hosted Worker dry-run bundles passed.
- Browser-rendered desktop light/dark workspaces and mobile account and Sales
  layouts were inspected. The mobile homepage, account page, and workspace had
  no document-level horizontal overflow at 390px.
- The final browser review exercised Sales filtering/editor navigation, private
  import validation and deduplication, persisted imports after reload, explicit
  view preservation, theme switching, saved dark preferences, and keyboard menu
  dismissal. Menus and dialogs were checked against the managed theme tokens.
  An interaction limitation in the initial preview pass was not reproduced in
  this final review. No customer data or external email was used.

Screenshots and bundle logs are local artifacts under
`.gstack/saas-ui-polish/`. This document records local verification only;
deployment and production-user verification have not been performed.

## Sales illustration correction

Replaced the old 343x428 dark mobile table crop with a native 2560x1440
capture of the current light-theme Sales interface using synthetic `.example`
listings. The landing section now places its introduction above a full-width
image, with adjacent sample-data attribution and a link to the original image.
The product URL fingerprint changed so immutable caches fetch the new capture.
Focused account/product-image tests, source integrity, site build, typecheck,
lint, and the gateway dry-run bundle were rechecked for this correction.

## Consistent light-theme landing images

Inventory and renewal screenshots now use native light-theme demo captures with
visible demo attribution. Both shared PNGs are 1440x1100; their hosted public URL
fingerprints and both landing implementations' image dimensions were updated.
The source site's old 150% renewals zoom/crop was removed, and hosted image frames
use a white background. All three hosted landing images load at their declared
natural dimensions. Desktop (1280px) and mobile (390px) DOM layout checks found
no horizontal overflow. Focused tests, engine integrity, site build, typecheck,
lint, and gateway bundling passed. No production deployment was performed.


## Final UX review and corrections

Three issues were corrected before release:

1. New hosted sessions without a saved preference opened in dark mode despite
   the light onboarding design. The managed default is now light; explicit saved
   preferences and desktop/self-hosted defaults remain unchanged.
2. Dialogs and menus rendered under the document body missed the managed palette.
   The managed root now supplies matching light/dark tokens, including popovers.
3. Reloading a portfolio containing only private imports opened an empty registrar
   inventory. The initial view now shows those private names; explicit view
   choices survive ordinary page navigation. Three store regressions cover this.

Browser reproduction verified an invalid import is blocked, two unique names
plus a duplicate import privately, both names remain visible after reload, and
an explicit Inventory choice remains selected after visiting Public profile.
The published page and registrar access remain separate actions.

Release evidence is recorded separately from these local checks. The deployment
uses existing configuration, fresh recovery copies, staged pilots, exact engine
and source headers, and post-release account/data/configuration comparisons.
