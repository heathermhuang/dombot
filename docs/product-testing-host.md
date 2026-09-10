# Portfolio and product testing hosts

Effective 10 September 2026:

- `https://domains.domains` serves the original portfolio from DreamHost
  (`205.196.209.138`). The DomBot gateway must have no route on this hostname.
- `https://www.domains.domains` redirects to the root portfolio, preserving paths
  and queries. The old provider otherwise serves its setup page on this hostname.
  Deploy this redirect with `hosted/wrangler.portfolio-redirect.jsonc`.
- `https://domains.domains.domains` is the DomBot product testing host, attached
  as a Custom Domain to the existing `domains-staging` gateway.
- The gateway's `CANONICAL_ORIGIN` is `https://domains.domains.domains`.
  Its existing workspace IDs, control database, service bindings, public
  collection alias, credentials and tenant databases are preserved.
- The existing Workers development hostname redirects to the testing hostname.
  The original portfolio is independent of future product deployments.

Owner login is available at `/login`; `/app` opens the authenticated workspace.
The portfolio editor is `#/public-portfolio` inside that workspace. Sign in on
this new hostname; browser cookies and MCP grants from the previous hostname
are not transferred. Reconnect MCP clients using the new workspace MCP URL.

The old root-domain route and `www` gateway route were removed before deploying
portfolio-builder release `7db685373e2112e91b3272ec10401b510839bd94` to the existing
tenants. This routing change does not publish or change portfolio selections.
Mail, FTP/SSH, registrar settings, and nameserver delegation are unchanged.

The files `hosted/wrangler.gateway.jsonc` and `hosted/wrangler.tenant.jsonc` are
provisioning templates, not complete configs for the existing deployment.
Generate deployment configs from the current live bindings, preserving all
plain-text variables, database IDs, service bindings and existing secrets. Set
only the gateway's canonical origin and Custom Domain to the testing hostname.
Do not run the original staging seed/import scripts against existing workspaces.
The root `wrangler.jsonc` belongs to the older alternative.domains instance and
must not be used to deploy this hosted product.
