# Renewal dates and planning

Gandi's `dates.updated_at` is a modification timestamp, not a next-renewal
deadline. The maintained registrar dependency leaves `renewalDate` null and
retains `registry_ends_at` as expiry. A renewal-window opening is not a charge
date either. See [Gandi's domain API](https://api.gandi.net/docs/domains/).

The `gandi-updated-at-v1` read qualification handles old registrar list and detail
caches, including UUID account IDs and backup restores. It ignores the unverified
date for planning and returns `renewalDateIssue` to explain the expiry fallback.
It never rewrites stored entries, timestamps, quotes, keys, accounts, events or
publications. Unknown legacy provenance is retained rather than destructively
repaired. Imported user dates and other registrars' renewal deadlines are retained.
A normal corrected provider read replaces the obsolete value through the existing
cache path; this qualification starts no provider request.

Upcoming renewal estimates include dates from now through the chosen cutoff.
Past planning dates are separate verification work, not presumed unpaid bills.
When no provider renewal date is known, reported expiry supplies a planning date.
The amounts remain annualized estimates, not confirmed next-charge amounts.

Release qualification must cover old list/detail overlays, repeated read/hydration,
backup restoration and another account's preservation. No control migration or
registrar mutation is required. Retain a protected pre-release recovery snapshot,
and compare publication and account identities during the coordinated rollout.
