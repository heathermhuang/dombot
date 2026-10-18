# Credits and licenses

## Original DomBot

DomBot was created by **Aaron Oxborrow**.

- Upstream source: <https://github.com/aoxborrow/dombot>
- Upstream website: <https://dombot.ai>
- Copyright (C) 2026 Aaron Oxborrow.
- License: GNU Affero General Public License v3.0 or later
  (`AGPL-3.0-or-later`); see [LICENSE](LICENSE).

The original copyright and license notices are retained. The hosted engine's
recorded upstream revision and artifact integrity are in
[hosted/dombot-engine.lock.json](hosted/dombot-engine.lock.json).

## domains.domains SaaS layer

domains.domains is a hosted, multi-tenant version of [aoxborrow/dombot](https://github.com/aoxborrow/dombot). Its SaaS-layer source is
included in this public repository under **AGPL-3.0-or-later**: the gateway,
registration/recovery flows, tenant isolation, migrations, deployment templates,
build scripts and tests. See [docs/hosted-source.md](docs/hosted-source.md).

The hosted service links to `/source` without requiring sign-in. That page links
to the complete source and build instructions at the deployed revision when
`SOURCE_COMMIT` is configured. The software license and hosted-service Terms
serve different purposes; the Terms do not reduce the software license rights.

## Separately licensed components

- `@aoxborrow/registrar-client` is Aaron Oxborrow's separate MIT-licensed project.
  Its bundled notices remain in the vendored package and source archive.
- Archivo is distributed under the SIL Open Font License 1.1; see
  [assets/brand/typography/OFL.txt](assets/brand/typography/OFL.txt).
- The SaaS authentication layer uses SimpleWebAuthn by Matthew Miller and other
  MIT-licensed dependencies. Their full notices are in
  [hosted/THIRD_PARTY_NOTICES.txt](hosted/THIRD_PARTY_NOTICES.txt).
- Other dependencies retain their own copyright and license notices.

Customer portfolios, credentials, database contents and production secrets are
private operational data, not part of the public source distribution.
