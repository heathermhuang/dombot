# Public changelog

`/changelog` is a public, server-rendered page in the SaaS gateway. The shared
footer links to it on the landing, source, legal and account pages. It works
without sign-in, tenant/database bindings or JavaScript. `?layer=core` and
`?layer=saas` filter the history; unknown values show all entries. Entry headings
link to stable `/changelog#<id>` permalinks.

Edit `src/hosted/changelog-entries.ts` to add a public update, newest date first.
Keep existing IDs stable. Each entry has a UTC event date, a `core` or `saas`
layer, a short title, explicit status, user-facing changes and public evidence
links. Link upstream releases to `aoxborrow/dombot`; link hosted changes and
release records to `heathermhuang/dombot`. Use immutable revisions for release
records. Keep private operational and customer data out of this public history.

A merged change is not a deployment. Mark source integrations awaiting rollout
explicitly, then update their status only when the managed release has been
verified. The initial history starts in November 2026 and links to both full
source histories for older changes. It records the 2.1.0 integration as awaiting
hosted rollout and uses the existing deployed release records for SaaS updates.

This is a gateway-only change. Publishing the page does not require repacking or
redeploying tenant engines, changing databases or running production import QA.

Validation: `npx vitest run src/hosted/changelog.test.ts`, the project typecheck,
lint, full suite, security/relay checks and gateway dry bundle. Visually check
`/changelog` and both filters at desktop and mobile widths.
