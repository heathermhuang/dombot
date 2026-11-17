# UI/UX audit remediation

Scope: address every item in the 17 November audit, retaining the approved forest/neutral design, publication boundaries, account/provider access and existing data. Original checkout is preserved; implementation uses an isolated branch from current main.

## Sequence

1. Mobile composition: one predictable page scroll, compact status footer, accessible inventory summaries, bounded history, direct inquiry/page navigation, profile task before optional address setup.
2. Shared controls: accessible sorting/scrolling, density preference, responsive forms and readable copy.
3. Profile and selling: backup protection, validation/navigation, conflict/action feedback, channels/inbox/shop flows.
4. Renewals and settings: inspectable forecasts and drill-down, honest async/save states, notification/proxy/MCP controls.
5. Public pages: shorter inquiry path, consistent inquiries, bounded browsing and accurate integration counts.
6. Verify source and packaged engine: required unit/type/lint/security/build checks, isolated local fixture, mobile and desktop page matrix. No production writes as test fixtures. Prepare a reviewable PR; deployment is a distinct step requiring release qualification.

## Verification matrix

Phone 375×812 and 440×860; tablet 768×1024; desktop 1280×800. Include narrow landscape and keyboard focus, loading/empty/failure/dirty states, collapsed/expanded history, long content, publication disabled and enabled. Use deterministic local synthetic data; never customer accounts as mutation fixtures. Test the rebuilt package as well as source assets.

## Audit disposition

Every row requires implementation or a documented disproven finding with evidence. A source-only suspicion is reproduced before being called a runtime fix.

| ID | Priority | Area | Requested correction | Status |
|---|---|---|---|---|
| G01 | P1 | Shared shell / Mobile footer | The persistent footer consumes too much working space | Implemented: phone footer is one 45 px status row; Sign out remains in Account. Mobile/desktop shell captures. |
| G02 | P3 | Shared shell / Desktop actions | Sync is repeated without a clear hierarchy | Implemented: Domains uses its own Sync control; the redundant header control is omitted there. |
| G03 | P2 | Shared shell / Density preferences | Normal density is overridden on phones and tablets | Implemented: removed the forced compact density rule below 1024 px; saved preference applies across sizes. |
| G04 | P2 | Shared shell / Secondary text | Some explanatory text has extremely low contrast | Implemented: shared scope note uses the readable secondary-text token without the 40% opacity override. |
| G05 | P2 | Shared shell / Touch links | Edit and Preview miss the touch-target treatment applied to buttons | Implemented: public-page Edit/Preview links have padded phone touch targets. |
| G06 | P2 | Shared shell / Table accessibility | Sort direction is not exposed programmatically | Implemented: sortable headers expose aria-sort and a named next sort action; keyboard/table check. |
| G07 | P2 | Shared shell / Table scrolling | Sideways overflow is difficult to discover | Implemented: native thin scrollbars, named focusable scroll region, phone summary/table toggle; ArrowRight scroll check. |
| D01 | P1 | Domains / Warning and filters | The expiry warning and filter toolbar are clipped on phones | Implemented: header/filter stack no longer shrinks or clips inside a nested scroller; full expiry warning visible at 375/440 px. |
| D02 | P1 | Domains / Expanded connection history | Expanding history displaces the main task and clips the page header | Implemented: bounded connection history scrolls locally; primary page header stays in normal flow. Expanded-history capture. |
| D03 | P1 | Domains / Mobile inventory | The first visible columns prioritize publication over domain health | Implemented: phone summaries prioritize registrar, expiry urgency, renewal estimate and auto-renew; details mount on demand. |
| D04 | P2 | Domains / Column preferences | Column customization disappears at narrow widths | Implemented: Columns remains available at narrow widths; full table remains selectable. |
| D05 | P2 | Domains / Row composition | Publication actions make rows too tall and inconsistent | Implemented: published/draft actions use one disclosure; desktop rows remain compact. |
| D06 | P2 | Domains / Domain navigation | The domain name opens the external domain rather than its workspace | Implemented: external navigation has a persistent external-link glyph; phone Manage explicitly opens domain actions. |
| D07 | P2 | Domains / Summary cards | The Total BIN dash does not explain the missing value | Implemented: missing BIN displays Not set with an explanation of what the total measures. |
| D08 | P3 | Domains / Filter presentation | Default filter controls look like active removable filters | Implemented: inactive default filters have dashed outlines; removable active filters retain their distinct presentation. |
| D09 | P2 | Domains / Connection history | Recent jobs are indistinguishable without opening them | Implemented: bounded history summaries include a domain name and completed time, with overflow count where applicable. Worker tests. |
| D10 | P2 | Domains / Metric definitions across pages | Related counts change between pages without a clear scope explanation | Implemented: totals state filtered scope; registrar sources and connected registrar counts have distinct labels. |
| P01 | P1 | Public profile / Page hierarchy | Address and DNS setup precede the actual profile editor | Implemented: profile editor appears before optional address/domain setup in the compatibility editor; modern editor remains task first. |
| P02 | P2 | Public profile / Address controls | The same public address and copy action are repeated | Implemented: compatibility address/setup is grouped after editing; repeated initial address blocks removed. |
| P03 | P2 | Public profile / Validation | Only the first six validation errors are presented | Implemented: all validation errors render and navigate to exact indexed fields, opening disclosures and finding the correct domain page. Focus tests and browser cases. |
| P04 | P1 | Public profile / Backup export | Private backup export omits the main backup flow’s encryption choice and disclosure | Implemented: backup action routes to the existing protected Import/Export flow with its encryption choice and disclosure. |
| P05 | P2 | Public profile / Navigation state | Editor location is not reliably reflected in the URL | Implemented: editor view and section use URL state; navigation does not reload or discard the current editor. |
| P06 | P2 | Public profile / Conditional migration UI | Internal v3 terminology appears in customer controls | Implemented: customer controls use feature names instead of internal v3 migration terminology. |
| P07 | P3 | Public profile / Unpublished state | A draft can present a clickable Published address before publication | Implemented: unpublished address is labelled as a future address and rendered as text until publication. |
| S01 | P1 | Sales and inquiries / Primary navigation | Sales reporting and hosted inquiry management are disconnected | Implemented: primary navigation has Inquiries; Sales report links to sales pages, inbox, channels and private sale entry. |
| S02 | P2 | Sales and inquiries / Sales empty state | The empty sales report gives no next action | Implemented: empty Sales reports explain the next actions and link directly to them. |
| S03 | P2 | Sales and inquiries / Sales-page filters | The status selector truncates its selected label on mobile | Implemented: mobile sales filters wrap and retain their full selected labels. |
| S04 | P3 | Sales and inquiries / Sales-page rows | Repeated privacy reassurance crowds every row | Implemented: privacy reassurance appears once at page level rather than in every listing row. |
| S05 | P2 | Sales and inquiries / Conflict recovery | Saved-version comparison is a raw JSON dump | Implemented: conflict comparison shows changed fields, Your edits and Saved version. Competing-revision browser case retained unsaved edits. |
| S06 | P2 | Sales and inquiries / Availability actions | Pause and Unpublish lack local pending protection and consequence review | Implemented: shared single-flight action guard and pending-disabled availability buttons; Unpublish describes consequences and requires confirmation. |
| S07 | P2 | Sales and inquiries / Provider selection | Destination options contain long URLs and raw check status | Implemented: provider selector uses bounded domain/path labels; exact selected URL remains available below. |
| S08 | P2 | Sales and inquiries / Channels management | Saved manual provider links have no correction or retirement UI | Implemented: Edit link updates the existing manual destination through its revision-checked API. Browser edit preserved one record. |
| S09 | P2 | Sales and inquiries / Channels empty/loading states | Blank tables do not explain whether links or accounts are missing | Implemented: channels distinguishes loading, no links and missing connected accounts with useful next actions. |
| S10 | P2 | Sales and inquiries / Inbox failures | An unavailable inbox can also claim that there are no inquiries | Implemented: unavailable inbox shows an error/retry state without also claiming there are no inquiries. |
| S11 | P2 | Sales and inquiries / Inquiry status language | The same inquiry state has different labels across views | Implemented: inbox and conversation share the same customer-facing status labels. |
| S12 | P2 | Sales and inquiries / Inbox pagination | There is no Previous page or current range in the inbox | Implemented: First/Previous/Next and page context; pending navigation disabled and cursor deduplication prevents rapid double advance. Regression tests. |
| S13 | P2 | Sales and inquiries / Conversation task order | Technical records precede the reply composer | Implemented: a primary reply action focuses the composer; technical delivery records are disclosed below the task. |
| S14 | P3 | Sales and inquiries / Outcome terminology | Outcome controls expose machine identifiers | Implemented: outcome controls use readable labels rather than raw machine identifiers. |
| S15 | P2 | Sales and inquiries / Shop address | Shop address lacks an immediate resulting-URL preview | Implemented: shop editor previews the resulting full address and explains its separate selection from Public profile. |
| R01 | P2 | Renewals / Monthly chart | Exact monthly values are hidden from touch users | Implemented: monthly details expose exact amounts/counts and links for touch and keyboard. |
| R02 | P2 | Renewals / Information hierarchy | Detailed price provenance precedes the dashboard controls and forecast | Implemented: price coverage is a compact summary with details collapsed before the forecast controls. |
| R03 | P2 | Renewals / Cost definitions | Annualized cost and the next-12-month forecast are not reconciled visibly | Implemented: annualized holdings and scheduled forecast definitions state the date window and exclusions. |
| R04 | P3 | Renewals / Money formatting | Coverage subtotals use a different number format from the headline cards | Implemented: coverage subtotals use shared currency/number formatting; affected assertions updated. |
| R05 | P2 | Renewals / Decision-to-action flow | Forecast and composition charts do not lead to the affected domains | Implemented: monthly/composition links open scoped inventory; scope composes with normal filters. Browser 60→0→60 auto-renew filter case; membership tests. |
| T01 | P2 | Settings / Mobile navigation | The settings section picker lacks a purpose label | Implemented: mobile settings selector has an explicit section label. |
| T02 | P2 | Settings / Registrar list | Park.io uses a separate dominant layout ahead of all other accounts | Implemented: Park.io is grouped in an optional other-inventory disclosure after registrar accounts. |
| T03 | P2 | Settings / MCP client identity | Repeated client names provide little help choosing which grant to revoke | Implemented: grants show stable short identity, dates and explicit permissions; revoke labels identify the grant. |
| T04 | P2 | Settings / MCP failure recovery | MCP load and action failures have no local recovery state | Implemented: MCP load failures have Retry, actions expose failures and busy revoke state. Injected read-failure/recovery browser case. |
| T05 | P2 | Settings / MCP copy controls | Copy has no useful failure fallback for long truncated values | Implemented: commands/URL are fully readable and selectable; copy announces success or actionable manual fallback. Browser success verified; denial path source-reviewed. |
| T06 | P2 | Settings / Notification save state | Saved confirmation survives subsequent unsaved edits | Implemented: edits clear saved notice; dirty draft survives section navigation and uses authenticated workspace-scoped storage. Isolation tests. |
| T07 | P2 | Settings / Notification read failure | Notification settings have no retry after an initial failure | Implemented: notification initial-read failure has retry; injected failure/recovery browser case. |
| T08 | P2 | Settings / Notification timezone | A technical timezone identifier is required as free text | Implemented: timezone suggestions and local delivery schedule preview; incomplete input retained but validated on Save. |
| T09 | P2 | Settings / Proxy Test | Test silently persists settings in one case | Implemented: Test suggests a discovered public IP without saving settings. Synthetic browser response filled the IP with zero save requests. |
| T10 | P2 | Settings / Proxy credentials | Saved credential-bearing proxy URLs are shown as ordinary text | Implemented: credential-bearing proxy URL uses the existing masked/reveal input. |
| T11 | P3 | Settings / Proxy example | The IPv4 example is invalid | Implemented: IP placeholder directs the user to Test instead of supplying an invalid address. |
| T12 | P3 | Settings / Long folder content | Long names and descriptions lack a complete reading strategy | Implemented: folder names/counts wrap; descriptions can be expanded for complete reading. |
| T13 | P2 | Settings / Notification destination | Email preferences do not show the delivery address | Implemented: notification preferences show the authenticated delivery address, verification state and Account link. |
| F01 | P1 | Shared forms / URL forwarding | The forwarding-rule grid cannot fit a narrow phone dialog | Implemented: forwarding rules stack with labelled fields on phones; 375 px edit/save fixture has no horizontal overflow. |
| F02 | P2 | Shared forms / Desktop long dialogs | Height and scroll protection only applies to the mobile/coarse-pointer media query | Implemented: shared dialogs have viewport height limits and internal scrolling at every pointer/viewport size; 1280×300 fine-pointer case. |
| V01 | P2 | Public visitor pages / Inquiry form | Four optional fields interrupt the required inquiry task | Implemented: optional professional fields follow Message in a disclosure; required inquiry path comes first. Public browser check. |
| V02 | P2 | Public visitor pages / Inquiry entry points | Portfolio inquiries and individual-page inquiries use different communication paths | Implemented: portfolio email action explicitly says Email owner, with fallback help; hosted inquiry retains its confirmation flow. |
| V03 | P2 | Public visitor pages / Portfolio browsing | Long card pages provide little initial page context | Implemented: 24 cards per page, initial range/top pager and bottom pager; browser pages 1–24 and 25–48 of 69; query-preservation tests. |
| V04 | P2 | Public visitor pages / Landing support claims | The registrar count and displayed provider list are not reconciled | Implemented: support count derives from the displayed provider list and says registrars and domain providers; 13 observed in fixture. |

## Completion evidence

All 63 audit items have an implementation disposition above. See [verification and limits](ui-ux-verification-20261118.md). This is a bounded remediation of the supplied audit, not a claim that every possible account, provider, browser or data state is defect-free.
