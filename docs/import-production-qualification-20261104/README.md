# Production import qualification · 4 November 2026

**Passed on the actual domains.domains production gateway and Cloudflare resources.**
Released gateway source: `b7d9be213a6983fd58bf592573fac7a6fd30be9f`.
Native tenant engine: `1.5.2-hosted.41`, source digest
`85e446bd12e518a55cfc5f99b66b2440617de2d3cfec583b457511c15a40745b`.

The operator created one ordinary-role QA account with control metadata only,
then signed in through the normal production password form. This was an
operator-seeded test identity; public signup, legal acceptance and email delivery
were outside this test. No existing customer identity was used or changed.

## Production observations

| Stage | Workers | Tenant databases | Registry admission | Setup requested |
|---|---:|---:|---:|---|
| QA account created | 0 | 0 | 0 | No |
| Import opened | 0 | 0 | 0 | No |
| Invalid-date preview | 0 | 0 | 0 | No |
| Valid preview | 0 | 0 | 0 | No |
| Save domains completed | 1 | 1 | 1 | Yes |
| After two retries | 1 | 1 | 1 | Yes |

Each resource checkpoint read the live control database, exact-name D1 inventory
and dispatch-script descriptor. Preview did not even set `requested_at`. The
browser's Save domains action created the real pair, qualified/admitted it and
saved one reserved `.invalid` domain with explicitly synthetic notes, expiration
date and manual renewal price. The normal production application displayed that
record and the actual engine/source information. See [preview](preview.jpg) and
[saved production result](saved-production.jpg).

Normal authenticated production owner API reads confirmed the stored domain,
expiration date and USD 12.50 manual renewal price. The original import ID was
read from the saved domain event. Two repeat submissions used that original ID
and the same normalized rows. Each returned HTTP 200, `new: 0`, `update: 0`,
`unchanged: 1`, `history: 0`. Saved domain data and events remained identical.

The Worker descriptor/version, database UUID, coordinator namespace, tenant
bindings, registry row and encrypted gateway-key envelope fingerprint matched
between first admission and both retries. No second pair or duplicate domain
was created. Gateway and provisioner configuration remained unchanged throughout;
this qualification deployed no application code.

## Preservation and QA custody

All **55 pre-existing users** retained their workspace identity and credential
fingerprint. All **531 pre-existing workspace rows**, **39 platform registry rows**
and **eight pending records** matched the pre-test snapshots. Existing registry
key envelopes, database mappings and qualification data were unchanged.

At qualification, the new QA account, synthetic import and single pair were retained for audit.
Only that new tenant's background maintenance was paused through the existing
private lifecycle interface; its alarm was null. All QA browser/HTTP sessions
were signed out/revoked. The account is excluded from public signup capacity.
No customer data, registrar credential, real domain holding, publication, inquiry,
message, DNS/registrar write, purchase or payment was used for this test.

Sanitized machine-readable counts are in [summary.json](summary.json). Protected
identity manifests, credentials, before/after configurations and provider receipts
are retained under `.wrangler/production-import-qualification-20261104` in the
primary checkout (directories 0700/files 0600), excluded from public source.

These receipts establish the controlled production import/allocation/retry flow.
They do not establish independent customer adoption or external mailbox delivery.

## Subsequent authorized cleanup · 4 November 2026

The user then explicitly requested cleanup. The QA account, Worker, database,
coordinator and stored setup keys were deleted and independently verified absent;
all real accounts were preserved. The test password was scrubbed and only the
non-reusable deletion audit identity remains. See the
[cleanup receipt](../import-production-cleanup-20261104/README.md) for current state.
The qualification summary above is an immutable historical checkpoint.
