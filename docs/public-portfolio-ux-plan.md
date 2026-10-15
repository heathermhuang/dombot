# Public portfolio UX implementation

Base: hosted release c49a291 (verified 12 September 2026).

1. Repair explicit Add domains / Manage listings transitions, visible filter state,
   and verification recovery without weakening publication ownership checks.
2. Prioritize readable domain names and visible selection/actions at desktop and
   mobile sizes; preserve optional registrar tools.
3. Preserve publication ordering in draft reconstruction, use the shared renderer
   for interactive previews with disabled contact, and support corrective review.
4. Expose publication receipts and live sharing, explicit inquiry intent, contact
   fallback, compact visitor discovery, and actionable field validation.

Verification: behavior tests with synthetic data; typecheck, lint, full tests,
frontend and Worker builds; desktop and mobile synthetic browser flows. Release
only to the three verified testing tenant Workers. Never change founder selections,
publication content, gateway routing, domains.domains or its www redirect.

Design context: domain investors selecting/managing holdings and prospective buyers
browsing/inquiring. Simple, confident and useful; retain existing palette and type.

## Verification (14 September 2026)

- Typecheck, lint, frontend build: passed.
- 497 tests passed, one existing skip; includes Worker HTTP and tenant isolation.
- Synthetic localhost browser: bulk add with inquiry intent, edit from review,
  individual revert, publication receipt, pending removal and published removal,
  explicit history assertion, visitor pagination, history search reset, inquiry
  restrictions, and embedded preview search via Apply and Enter.
- Responsive checks at 390 × 844 and 1280 × 900: no document horizontal overflow;
  desktop domain text does not wrap; mobile registrar details expand on demand;
  narrow review puts publishing after changes. These are viewport tests, not
  physical-device checks.
- Live tenant versions, bindings and schedules inspected; release configuration
  prepared locally from those current values. No owner listings, draft settings,
  publication data or legacy host routing were changed during implementation.

Release remains pending authenticated before/after preservation checks and the
associated testing-tenant deployment. The saved founder credential/private-state
check requires explicit access approval after automatic review rejected that action.
