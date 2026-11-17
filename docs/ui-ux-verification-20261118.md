# UI/UX verification — 18 November 2026

The 63-item audit is addressed on `codex/full-ui-ux-remediation`, based on `04772fff0082ba65a3163cbfd0edeb5c5db0add6`. No production deployment is included in these results. The user's original dirty checkout was preserved.

## Page matrix

The packaged engine was exercised in isolated localhost fixtures with synthetic holdings, profile data, listings and inquiries. No real email, DNS, registrar, payment or public publication was used as a mutation fixture.

| Page / section | Mobile 375×812 | Desktop 1280×800 | Additional state evidence |
|---|---|---|---|
| Domains | Pass | Pass | 320, 440, 768 px, 812×375 landscape; full warning, summary/table switch, selection across pages, keyboard horizontal scroll |
| Connection history | Pass | Shared shell checked | Expanded 440 px list bounded; page title remains visible; readable job identity |
| Public profile compatibility editor | Pass | Pass | Editing precedes optional address/domain setup |
| Public profile modern editor | Pass | Pass | URL sections; future address nonclickable; collection and paginated-domain validation focus |
| Renewals | Pass | Pass | Touch-readable monthly values; forecast drill-down and normal filter composition |
| Sales reports | Pass | Pass | Empty-state actions and primary navigation |
| Sales pages | Pass | Pass | Empty/populated states; mobile filter labels |
| Listing editor | Pass | Pass | Competing revision retains local edits and shows field comparison |
| Channels | Pass | Pass | Empty/accounts state; existing manual link edited without duplication |
| Inquiry inbox | Pass | Pass | Empty/populated states; readable status and page controls |
| Inquiry conversation | Pass | Pass | Reply action focuses composer; diagnostics initially collapsed |
| Sales shop | Pass | Pass | Resulting full address and separate selection explained |
| General settings | Pass | Pass | Density preference description and responsive controls |
| Registrars settings | Pass | Pass | Account list and optional other-inventory layout |
| Markets settings | Pass | Pass | Section layout and controls |
| Sync settings | Pass | Pass | Section layout and controls |
| Notifications settings | Pass | Pass | Injected read failure/retry; dirty notice; incomplete draft survives navigation; address and timezone context |
| Import/Export settings | Pass | Pass | Existing protected backup flow remains reachable |
| Folders settings | Pass | Pass | Empty-state layout; wrap/expansion implementation inspected |
| Proxy settings | Pass | Pass | Masked input; synthetic Test fills IP with zero Save requests |
| MCP settings | Pass | Pass | Disabled/enabled, duplicate identities, injected read failure/retry, copy success |
| About settings | Pass | Pass | Section layout and controls |
| URL forwarding dialog | Pass | Pass | Stacked fields; local save; short fine-pointer 1280×300 dialog scrolls |
| Public individual sales page | Pass | Pass | Message before optional professional disclosure; no inquiry submitted |
| Public legacy portfolio | Pass | Pass | 69 synthetic holdings, 24 per page, working Next and top range |
| Public landing page | Pass | Pass | Support copy agrees with the 13 displayed providers |

Pass here means the page was opened and the relevant responsive layout and changed controls were inspected in the in-app Chromium browser. It does not mean every action or integration on the page was executed.

## Regression and build checks

- Typecheck and ESLint pass.
- Full final serial unit suite: **322 files passed; 3,475 tests passed; 1 pre-existing skip**.
- Security regression suite: 4 passed. Relay checks: 4 passed.
- Final engine verification passes: candidate `2.2.2-hosted.4`, source SHA-256 `5940077762cbc27c9a0004572d025f2f0cd2427762c029bdc1b87f2f836ce232`, archive SHA-256 `d0c532571bddd3c24731b42229317fb1099e0443bd687491df89fa0905eb3859`.
- Final dry-run bundles: gateway, lander, tenant, provisioner, proxy scheduler and self-hosted Worker. Provisioner preparation, demo and site builds pass. No upload/deployment occurred.
- New regression coverage includes forecast membership, public paging/query preservation, bounded history summaries without provider writes, authenticated notification recipient/workspace identity, unfinished draft isolation, inbox cursor navigation, exact indexed validation focus and provider destination labels.
- Review follow-ups fixed hidden duplicate table mounting/presence requests, a populated desktop header overflow, workspace isolation of notification drafts, rapid inbox navigation and forecast/filter integration.

## Evidence and limits

The local evidence directory contains the original audit separately from remediation screenshots, a screenshot hash/dimension index, retained DOM measurements and the detailed verification record. Screenshots include only synthetic data in the remediation fixtures. Private original audit screenshots are not committed.

The evidence logger retained DOM measurements for only a subset of captures because its in-memory list did not persist across tool calls; the complete screenshot index and observed page matrix above are retained. Do not interpret missing rows in `page-verification.json` as unvisited pages or fabricate missing measurements.

Physical iPhone/Safari, full screen-reader and enlarged-text acceptance were not performed. No real provider, paid action, email delivery, passkey or customer authentication journey is claimed. Proxy discovery and read failures use explicit local test responses. Clipboard copy succeeded; a clipboard-denial UI case could not be reproduced, so its fallback is source-reviewed. A final browser-native discard confirmation caused an automation timeout; its acceptance and cleanup could not be observed. The preceding conflict preservation/comparison was verified and captured. This does not establish a product failure in the discard action.

Production release still requires the project's exact-candidate fleet qualification and deployment workflow. These local checks do not establish live rollout or physical-device acceptance.
