import {
  PortfolioDomains,
  portfolioProviderConfigured,
  portfolioDomainsEnabled,
  portfolioWorkspaceAllowed,
  portfolioControlLease,
  type PortfolioHostnameRow,
} from './portfolio-domains';
import {
  observePortfolioDns,
  DomainServiceError,
} from './portfolio-domain-provider';
/** Existing deterministic cron, bounded batch and finite control leases. Never
 * provisions new certificates/routes or queries private portfolio inventory. */
export async function refreshPortfolioDomains(
  env: HostedEnv,
  fetcher?: typeof fetch,
) {
  if (!portfolioProviderConfigured(env)) return;
  const rows = await env.CONTROL_DB.prepare(
    `SELECT h.*,c.workspace_id AS closed_workspace FROM portfolio_hostnames h
  JOIN workspaces w ON w.id=h.workspace_id LEFT JOIN closure_requests c ON c.workspace_id=h.workspace_id
  WHERE h.status IN ('active','blocked','detaching') AND h.next_check_at<=?
  AND (h.status='detaching' OR c.workspace_id IS NOT NULL OR (?=1 AND w.enabled=1))
  ORDER BY h.next_check_at LIMIT 20`,
  )
    .bind(Date.now(), portfolioDomainsEnabled(env) ? 1 : 0)
    .all<PortfolioHostnameRow & { closed_workspace: string | null }>();
  const controller = new PortfolioDomains(env, fetcher);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, rows.results.length) }, async () => {
      while (cursor < rows.results.length) {
        const row = rows.results[cursor++];
        if (
          !row.closed_workspace &&
          row.status !== 'detaching' &&
          !portfolioWorkspaceAllowed(env, row.workspace_id)
        )
          continue;
        const claimed = await env.CONTROL_DB.prepare(
          'UPDATE portfolio_hostnames SET next_check_at=?,check_generation=check_generation+1 WHERE hostname=? AND epoch=? AND next_check_at<=? AND status=? AND operation IS NULL RETURNING check_generation',
        )
          .bind(
            Date.now() + 900000,
            row.hostname,
            row.epoch,
            Date.now(),
            row.status,
          )
          .first<{ check_generation: number }>();
        if (!claimed) continue;
        row.check_generation = claimed.check_generation;
        if (row.closed_workspace || row.status === 'detaching') {
          await controller.detach(row.workspace_id, row.hostname, row.epoch);
          continue;
        }
        try {
          const answers = await observePortfolioDns(
            '_domains-portfolio.' + row.hostname,
            'TXT',
            controller.provider.fetcher,
          );
          const proof = answers.some(
            (a) =>
              a.type === 16 &&
              a.data.replaceAll('"', '') ===
                'domains-portfolio=' + row.challenge,
          );
          const certificate = row.provider_id
            ? await controller.provider.getCertificate(
                row.provider_id,
                row.hostname,
              )
            : null;
          const route = row.route_id
            ? (await controller.provider.routes()).find(
                (r) => r.id === row.route_id,
              )
            : null;
          const routeValid =
            !!route &&
            route.pattern === row.hostname + '/*' &&
            route.script === env.PORTFOLIO_EDGE_WORKER;
          const revoked =
            !!certificate &&
            (['moved', 'deleted', 'blocked'].includes(certificate.status) ||
              ['expired', 'revoked', 'deleted'].includes(
                certificate.ssl.status,
              ));
          const positive =
            proof &&
            certificate?.status === 'active' &&
            certificate.ssl.status === 'active' &&
            routeValid;
          if (!proof || (row.route_id && !routeValid) || revoked) {
            await env.CONTROL_DB.prepare(
              "UPDATE portfolio_hostnames SET status='blocked',control_expires_at=0,last_error='dns-proof',updated_at=? WHERE hostname=? AND epoch=? AND check_generation=? AND status IN ('active','blocked')",
            )
              .bind(Date.now(), row.hostname, row.epoch, row.check_generation)
              .run();
          } else if (positive && row.observed_revision) {
            await env.CONTROL_DB.prepare(
              "UPDATE portfolio_hostnames SET status='active',control_expires_at=?,last_error=NULL,updated_at=? WHERE hostname=? AND epoch=? AND check_generation=? AND status IN ('active','blocked') AND EXISTS(SELECT 1 FROM public_hostname_claims c WHERE c.hostname=portfolio_hostnames.hostname AND c.kind='portfolio' AND c.owner_key=portfolio_hostnames.owner_key AND c.held=1)",
            )
              .bind(
                Date.now() + portfolioControlLease,
                Date.now(),
                row.hostname,
                row.epoch,
                row.check_generation,
              )
              .run();
          }
        } catch (error) {
          // An unavailable observation is not proof of lost ownership. Keep the last
          // positive lease, stop serving on expiry, and retry a bounded later batch.
          if (
            error instanceof DomainServiceError &&
            error.code === 'provider-not-found'
          ) {
            await env.CONTROL_DB.prepare(
              "UPDATE portfolio_hostnames SET status='blocked',control_expires_at=0,last_error='provider-mismatch' WHERE hostname=? AND epoch=? AND check_generation=? AND status IN ('active','blocked')",
            )
              .bind(row.hostname, row.epoch, row.check_generation)
              .run();
          } else
            await env.CONTROL_DB.prepare(
              'UPDATE portfolio_hostnames SET last_error=?,next_check_at=? WHERE hostname=? AND epoch=? AND check_generation=?',
            )
              .bind(
                error instanceof DomainServiceError
                  ? error.code
                  : 'provider-unavailable',
                Date.now() + 300000,
                row.hostname,
                row.epoch,
                row.check_generation,
              )
              .run();
        }
      }
    }),
  );
}
