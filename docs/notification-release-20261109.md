# Notification release, 9 November 2026

Domains.Domains runs the notification implementation from [PR #200](https://github.com/heathermhuang/dombot/pull/200), with reliability corrections in [PR #201](https://github.com/heathermhuang/dombot/pull/201) and [PR #203](https://github.com/heathermhuang/dombot/pull/203). The final gateway source is `ea4c0cd22873cf90cd3978000939024c3c1ff823`; engine `2.2.0-hosted.1` is retained across all 47 admitted portfolios and the qualified future template. The initial notification rollout used engine `2.1.0-hosted.7`, source `12f22e338b930a2bc76fd868b10d292c894b6e9d`, and passed its fleet audit at 13:03 UTC. Evidence below identifies each consumed candidate. Recheck current production before later operations.

The design is for owners with about 10–20 names. Existing accounts are not subscribed to renewal mail by deployment, import or page views. No per-domain daily countdown is added.

## Events and owner controls

| Event                                                       | Email behavior                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Inquiry submitted                                           | Send the buyer a confirmation; notify the owner after the buyer confirms.                                             |
| New buyer message                                           | Notify the owner when owner inquiry alerts are enabled.                                                               |
| Owner reply                                                 | Send the reply to the buyer independently of the owner-alert preference.                                              |
| Requested sign-in, verification or recovery                 | Retain the existing single-use proof and expiry rules.                                                                |
| Committed password change/reset or passkey addition/removal | Queue a security notice; failed changes do not claim success.                                                         |
| Manual/unknown renewal setup within 30 days                 | Explicit opt-in; group new stages into a change-only Monday review after 09:00 in the saved timezone.                 |
| Fresh near deadline that cannot wait for the next review    | A separate urgent envelope, with name/cycle/stage deduplication.                                                      |
| Healthy auto-renew setup                                    | Quiet for ordinary deadlines; an optional weekly overview may include it. Enabled is not proof of successful renewal. |

Settings → Notifications controls inquiry alerts, renewal reminders, the optional overview and timezone. Renewals provides Mark handled, Let expire and Resume. These choices do not change registrar settings or renew a name. Optional email needs a verified account recipient and explicit consent. Unsubscribe GETs are read-only; explicit POSTs stop optional portfolio mail while preserving requested authentication, security and buyer replies.

Every account, inquiry, renewal, security and operator template uses the shared HTML/text shell: wordmark, mobile wrapping, readable type, action and fallback URL, support/privacy, and relevant preferences. Portfolio messages show up to 20 names with a full count, recorded dates, renewal setup, observation freshness and available estimates. Missing prices are not zero. The current adapter does not fabricate an automatic-renewal-failure feed.

## Release evidence

- The initial implementation checks passed 290 test files: 3,049 tests passed and one intentional skip. Types, lint, pinned source/archive/installed-engine integrity, security/relay checks, web builds, Worker dry bundles and PR CI passed.
- All 47 admitted portfolios served the expected inner engine/source. Forty-two passed private status and exact HTML/JS/CSS readback; five legacy portfolios passed their existing public release route plus exact management module/settings/schema checks. No new secret custody was required.
- All 61 original accounts, 578 original workspace identities, 42 platform mappings, encrypted credential/settings/publication fingerprints and 28 public routes were preserved. Original schedules, ingress and maintenance policies were retained. Allocation was restored at initial cutover. No account was automatically enrolled in portfolio email.
- The qualified future template retained all 15 previous bindings, added the notification flag and updated release metadata. The gateway/provisioner template hashes agreed. Control migration 0025 and tenant migration 0011 were applied; initial-release backup format was 14.
- One normal production sign-in email reached the owner’s Gmail Inbox at 2026-11-09T12:59:46.000Z. SPF, DKIM and DMARC passed. Both MIME alternatives and the released layout, support/privacy, expiry and fallback copy were present. The sign-in proof was not consumed. No message body, auth code or bearer link is published in this receipt.

Managed notification acceptance passed on engine `2.2.0-hosted.1`, source `adabbae439981d44f148853ae192021ace437865`. A fresh trusted QA lease exercised zero allocation on open/preview, one allocation on valid import, two retry reuses, readback, defaults, explicit preference saves, stale-revision rejection, invalid-timezone rejection and verified-email enrollment gating. The synthetic renewal candidate and exact served UI asset passed. Guarded independent cleanup completed; no optional email was sent.

The gateway retry corrections are [PR #201](https://github.com/heathermhuang/dombot/pull/201) and [PR #203](https://github.com/heathermhuang/dombot/pull/203). Successful portfolio mutations persist a wake hint, while the scheduler owns send leases and retry checkpoints. Cache-only recovery is bounded to 15 minutes and retains known future provider retries. A forced-clock D1/gateway regression reproduces both the late-import delay and another update during backoff; it passes without an early provider call, then retries at the original deadline. All 11 notification tests, types, lint and required CI passed. This changes neither email grouping nor registrar polling. The managed acceptance on source `adabbae439981d44f148853ae192021ace437865` covers the unchanged import, preference and wake paths; the scheduler-only follow-up is qualified by that regression and deployment readback.

## Recovery and qualification limits

Recovery used code/settings snapshots and Cloudflare Time Travel bookmarks. No database-content or root-key export was made. The notification preference exercise initially hit the import cleanup guard's unknown-control-reference hold. Review confirmed one test-owned, non-enrolled preference row as the sole extra reference. A fenced rollback restored that test state, preserved the attempt counter, and the unchanged trusted cleanup revalidated identity, data and resources before deletion. Later test teardown restores its own setting before invoking cleanup. No shared cleanup guard was weakened.

Uncertain uploads were reconciled against the exact original or target module/settings before continuing. A proposed read of older secret custody was rejected by automatic approval review and was not performed; the existing public release route provided the safer runtime check.

Native Apple Mail rendered a synthetic long renewal preview in dark mode and a narrow window. That is rendering evidence, not inbox delivery. A final native browser check still requires the unlocked Mac, and a new real inquiry receipt still requires the normal user-completed Turnstile check. No Outlook/QQ/163 or independent customer-adoption claim is made.

[Machine receipt](notification-release-20261109.json) · [Notification behavior and operations](notifications.md)
