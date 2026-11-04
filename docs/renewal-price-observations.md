# Renewal quote observations

Owner pricing responses carry `observedAt`, `inventoryAt` and `priceAge`
independently. A fresh inventory snapshot does not establish a fresh quote.
Current API/portal quotes were observed less than 24 hours ago; stale starts at
24 hours. Missing, invalid or future observation times mean unknown age. TLD/base
rates are estimates, manual rates retain their provenance, and unavailable values
are not zero. These are annualized estimates, never guaranteed next-charge amounts.

The owner, MCP and admin inventory reuse the same age classification. Owner
Renewals displays source/age counts and exact per-currency subtotals, with a paged
observation inspector. Totals count the selected account records; a duplicate
name across accounts is explicitly called out for reconciliation. Unknown values
are excluded from subtotals. The main reporting view retains its existing
preferred-currency/FX rules; the coverage table does not convert or mix currencies.

`portfolio_query` reads cached data and supports `renewalPriceAge`. Its rows
include `inventoryAt` and the renewal estimate's observation/age fields.
`domain_renewal_price` retains its existing live read where supported and reports
the genuine successful read time. Failed or empty live quotes retain the previous
saved quote and its age. It does not stamp an old price fresh or persist a new
quote merely because inventory or detail was read.

The existing pricing queue supplies pending, blocked, failed and next-eligible
time. Footer and Renewals show those states together; retry displays include the
date and timezone. Coverage's minute clock is display-only and refreshes when
pricing inputs change. It never sends a request or advances a pricing job.
Provider admission, quotas, concurrency, cooldowns and scheduling are unchanged.

All added metadata is derived in read projections. No control/tenant migration,
credential change or publication mutation is required. Legacy Gandi qualification
also stays out of failed-sync persistence paths; the raw legacy field is retained
until an ordinary corrected provider read replaces it.
