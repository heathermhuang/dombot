# Open-source hosted DomBot

**domains.domains is a hosted, multi-tenant version of
[aoxborrow/dombot](https://github.com/aoxborrow/dombot).** The original DomBot project was
created by Aaron Oxborrow. This entire hosted fork is public at
<https://github.com/heathermhuang/dombot> under **AGPL-3.0-or-later**.
See [LICENSE](../LICENSE) and [credits and notices](../NOTICE.md).

## What is included

| Source                                                                   | Purpose                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `src/hosted/gateway.ts`                                                  | Public pages, authenticated gateway and tenant admission  |
| `src/hosted/accounts.ts`, `registration.ts`, `lifecycle.ts`              | Registration, sign-in, recovery, email limits and closure |
| `src/hosted/tenant.ts`, `workspace-coordinator.ts`                       | Isolated tenant runtime and serialized access             |
| `src/shared/gateway-proof.ts`                                            | Signed gateway request proof                              |
| `hosted/migrations/`                                                     | Control database schema                                   |
| `hosted/wrangler.*.jsonc`                                                | Generic Cloudflare deployment templates                   |
| `scripts/*hosted*.mjs`                                                   | Provisioning, deployment, account and backup tooling      |
| `src/core/`, `src/worker/`, `src/renderer/`, `migrations/`               | Maintained DomBot engine, application and tenant schema   |
| `scripts/dombot-engine.mjs`, `hosted/dombot-engine.lock.json`, `vendor/` | Rebuildable, pinned engine package and provenance         |
| `src/hosted/*.test.ts`, `security-review/`                               | Account isolation, registration and security regressions  |

The engine archive contains source and its build manifest/lock. The root
repository includes both that engine and the SaaS layer, not just compiled
browser assets. Secrets, live account mappings, customer databases and customer
portfolios are deliberately not published; the repository contains deployment
templates to configure your own installation.

## Build and check

Use Node.js 22.13 or newer. In a clean checkout:

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npm ci --prefix hosted --ignore-scripts
node hosted/build-auth.mjs
npm run engine:verify
npm run typecheck
npm run lint
npm test
npx vitest run --config security-review/vitest.config.mts
npm run web:build
npx wrangler deploy --config hosted/wrangler.gateway.jsonc --dry-run
npx wrangler deploy --config hosted/wrangler.tenant.jsonc --dry-run
```

These dry runs build without deploying customer infrastructure. Configuration
templates contain placeholders and public registration defaults to disabled.
If you change engine source, follow [the pinned engine rebuild
procedure](dombot-engine.md) before verifying or deploying it.

## Run your own hosted edition

Read [the hosted foundation](hosted-staging.md) for the isolated Worker/D1 pool,
gateway keys, service bindings and provisioning. That document records the
original invitation-based milestone; [public registration](public-registration.md)
describes its verified-email successor. [Hosted operations](hosted-operations.md)
covers account lifecycle and backup procedures.

Use your own Cloudflare resources, credentials and legal operator details. Each
tenant needs its own immutable identity, database and encryption/admission keys;
do not route different customers through a caller-selected database. Public
registration draws only from prequalified unused capacity and requires configured
email delivery and legal policies. Paid registrar operations through hosted MCP
remain blocked in this edition.

To operate only a private, single-owner DomBot instance, use the upstream
[self-hosting instructions](self-hosting.md) instead of the multi-tenant gateway.

## Source offered by the live service

The footer and Terms link to the public `/source` page. Production deployments
set `SOURCE_COMMIT` to their exact 40-character Git commit. The page then provides
revision-specific links for the complete source archive, SaaS layer, build
instructions, license and notices. Preserve this source offer when modifying the
network service and retain the original DomBot attribution.

## Product wording

DomBot describes a portfolio that gathers domains from different registrars.
The hosted offer uses **“All your domains. One portfolio.”** and identifies
itself as hosted DomBot. “Account” means the email or passkey sign-in; “registrar
account” means an account held at a domain registrar. A portfolio is the set of
domains a person manages. Creating a sign-in does not create or transfer domain
registrations, and importing a list does not move domains between registrars.

### Public product previews

The gateway uses the `LANDING_ASSETS` static-assets binding for the two original
DomBot demo screenshots under `site/public`. Keep `run_worker_first: true`: the
gateway exposes only the explicit, content-hashed preview paths in
`src/hosted/product-images.ts`. Other public files do not bypass gateway routing.
The images are credited as upstream sample data and contain no customer holdings.
