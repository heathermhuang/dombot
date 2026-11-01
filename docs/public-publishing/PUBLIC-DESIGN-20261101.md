# Public page polish · 1 November 2026

Public profiles, collection/catalogue views, legacy portfolio pages and domain
inquiry pages now share Archivo, the full domains.domains wordmark and a consistent
forest/neutral surface system. Profile context sits alongside the introduction on
wide screens; domain rows distinguish descriptions, reviewed terms and actions.
The inquiry form has a clear price/heading hierarchy and bounded fields. Mobile
layouts retain the complete content and controls; dark mode follows the same
hierarchy. Keyboard skip links target the main content, and reduced motion is
respected.

The existing renderers still decide selection, term availability, canonical URLs,
private preview actions, form revisions, validation and provider handoffs. No
publication, authentication, inquiry or feature-flag contract changed. The compact
Turnstile sizing and resize invalidation behavior is retained. The compatible
engine/UI artifact is pinned as `1.5.2-hosted.31`.

## Verification

- Five public page types at 320, 390, 768 and 1280 pixels in both themes: 40
  observed states without horizontal overflow, one primary heading/main landmark,
  and visible form controls at least 46 pixels high.
- Existing owner-site disclosure, exact preview-price, legacy portfolio and Sales
  language/form regression tests pass. The full local suite passed 1,891 tests
  with one pre-existing skip; affected tests were repeated after the final
  preview-branding adjustment.
- Type/lint, security regression and fixed-source relay checks pass. The web,
  demo/site and repository Worker build matrix were exercised as dry runs.
- The final pinned artifact integrity check passes. Required CI/CodeQL on the
  actual PR head remains the release gate; runtime/source/UI pairing and live
  preservation checks are recorded separately at deployment.

Screenshots and operator qualification receipts are retained with the task rather
than placed in the public repository. Broader v3/combined-writing enablement and
pilot acceptance remain independent of this visual release.
