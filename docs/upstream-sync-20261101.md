# Selective upstream sync, 1 November 2026

The hosted engine remains based on upstream v1.5.0 (`feef729a`). This release
selectively incorporates changes inspected against upstream `1cc33720`; it is
not a wholesale merge of current upstream main.

- Core #188 (`056e9816`): report each active account's stale sync in MCP,
  Settings, the sync control and footer. Existing thresholds remain 24 hours
  for MCP and seven days for the UI. Failed accounts stay in errors.
- Core #178 (`08ce3e06`): inclusive Created, Expires, Purchase date and Sale date
  ranges with shortcuts in the Domains table.
- Core #179 (`3c3831ce`): separate saved Active/Archive column visibility and
  ordering, including keyboard controls and filtered columns forced visible.
- Core #191 and subsequent dependency updates: MCP SDK 1.32.2, Hono 4.13.13,
  Hono Node server 2.1.5, Electron 44.9.1, Vite 6.4.5, Vitest 4.1.12,
  Wrangler 4.154.0 and Zod 4.6.7. Hosted schemas use explicit record keys;
  reusable draft objects retain the existing publication validation boundaries.
- Registrar-client 0.12.0, with a pinned hosted patch rebase. Dynadot auto-renew
  off now means manual renewal (`reset`), retaining expiry reminders, instead
  of Do Not Renew (`donot`). Gandi forwarding preserves HTTPS and applies
  creates/updates before deletes. The dependency's transfer-out methods are
  supported by the in-memory demo; no new live transfer UI or MCP tool is added.

Hosted MCP scope filtering, tenant routing, publication controls, incremental
pricing, managed egress, retry limits and secret bindings remain in place.
The date/layout controls apply to the shared Domains table used by current
owner profiles and the legacy Archive/fallback view. The separate old portfolio
editor retains its existing management layout.

Upstream core #185/#186/#187/#193/#194 already merged our earlier fixes.
Name.com pricing #74 and Dynadot pricing #75 remain open in registrar-client;
this sync retains those fixes locally and does not duplicate the submissions.
Marketplaces, Sales and exchange-rate conversion are a separate integration.

Qualification covers unit/security/relay checks, typecheck and lint, engine
integrity, all configured Worker bundle checks, and browser date/layout flows
on synthetic data. Production promotion additionally requires pilot and fleet
artifact/runtime receipts, protected-state comparisons and future-template
promotion; local or CI success alone does not establish deployment.
