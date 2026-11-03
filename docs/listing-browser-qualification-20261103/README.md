# Browser qualification · 3 November 2026

Completed in the in-app browser against a loopback-only synthetic account using the pinned `1.5.2-hosted.41` engine/UI. The account, market observation, credentials and operator control admission are invented fixture inputs. This qualifies the application flow under controlled admission; it does not qualify real account authentication, DNS control, checkout availability, payment, transfer, payout or customer acceptance. No production records, provider listings, DNS or real messages changed.

| Flow | Observed result |
| --- | --- |
| Market-only domain in Domains → Listings | One derived **Market listing** row, without an imported holding or registrar control grant. |
| Prepare private page | Selected Sedo observation supplied exact USD 1,479.09 and its public identity destination without retyping. The canonical buyer page remained unavailable before publication. |
| Inquiry boundary | Review rejected an inquiry/questions path without a verified recipient. A provider-only path could be reviewed independently. |
| Stale editor tab | A second tab's save was rejected after the first tab saved a newer revision. Its unsaved text remained visible; the current draft was not overwritten. |
| Review and publish | Review showed exact amount/currency, domain, destination, description, questions disabled and shop omitted. Explicit publication produced `/working.io` with one primary provider action and no lead form. |
| Provider handoff | The button reached Sedo for `working.io`. Sedo redirected this fixture domain to brokerage and its CDN returned script 404s; this is handoff evidence only, not verified checkout or purchase availability. |
| Source changes | A deterministic fixture control changed the invented source to USD 1,480.01 and ran the real source reconciliation. The buyer's old numerical claim disappeared and its action became **View on Sedo**. |
| Publication after drift | Reviewing stale terms was rejected. Preparing the fresh private draft did not reactivate the old price. A new explicit review showed USD 1,479.09 → USD 1,480.01; publication then exposed the new exact amount. |
| Legacy link | `/w/<synthetic-account>/d/working.io?ref=browser-qualification` resolved to `/working.io?ref=browser-qualification`. |
| Withdrawal | Unpublish showed “Public sales page removed. Private draft retained.” The canonical, provider and legacy entry paths became unavailable. |
| Owner console | No first-party console errors observed. The external Sedo CDN errors above are retained as a provider qualification limitation. |

Browser corrections: label derived marketplace rows **Market listing**, keep their existing unverified-row authority boundary, explain their provenance in details, and replace **Approved source selection** with **Selected marketplace source** while still private. The derived marker is not persisted or imported as a holding. Two focused row-boundary tests were added; the existing preparation/publication regressions were retained.

Evidence:

- [Market-only Domains row](domains-market-only.jpg)
- [Stale-tab conflict and retained text](stale-tab-conflict.jpg)
- [Reviewed publication receipt](reviewed-publication.jpg)
- [Buyer view before source drift](buyer-published.jpg)
- [Buyer view with unsupported price suppressed](buyer-source-stale.jpg)
- [Exact price update review](price-update-review.jpg)
- [Buyer view after explicit update](buyer-reviewed-update.jpg)
- [Owner withdrawal receipt](owner-withdrawal-receipt.jpg)
- [Unavailable buyer page after withdrawal](buyer-withdrawn.jpg)
