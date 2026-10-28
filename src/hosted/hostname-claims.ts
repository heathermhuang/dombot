export class HostnameClaimError extends Error {}
/** A cross-product reservation. DNS verification must precede new acquisitions.
 * The missing-table case supports older deployments with portfolio hosting off;
 * once the additive migration exists the guard stays effective even on rollback. */
export async function hostnameClaimsExist(db: D1Database): Promise<boolean> {
  return !!(await db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_hostname_claims'",
    )
    .first());
}
export async function claimHostname(
  db: D1Database,
  hostname: string,
  kind: 'sales' | 'portfolio',
  workspace: string,
  ownerKey: string,
  portfolioLimit = 20,
): Promise<void> {
  if (!(await hostnameClaimsExist(db))) {
    const portfolioTable = await db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='portfolio_hostnames'",
      )
      .first();
    if (kind === 'portfolio' || portfolioTable)
      throw new Error('Domain hosting is not ready.');
    return;
  }
  const row = await db
    .prepare(
      `
    INSERT INTO public_hostname_claims(hostname,kind,workspace_id,owner_key,held,updated_at)
    SELECT ?1,?2,?3,?4,1,?5 FROM workspaces w WHERE w.id=?3 AND w.enabled=1
    AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)
    AND (?2='sales' OR (SELECT COUNT(*) FROM public_hostname_claims WHERE kind='portfolio' AND held=1)<?6
      OR EXISTS(SELECT 1 FROM public_hostname_claims WHERE hostname=?1 AND kind=?2 AND owner_key=?4 AND held=1))
    AND (?2='portfolio' OR NOT EXISTS(SELECT 1 FROM portfolio_hostnames p WHERE p.hostname=?1 AND p.status!='detached'))
    AND (?2='sales' OR NOT EXISTS(SELECT 1 FROM sales_hostnames s WHERE s.hostname=?1 AND s.status NOT IN ('detached','pending-proof')))
    ON CONFLICT(hostname) DO UPDATE SET kind=excluded.kind,workspace_id=excluded.workspace_id,
      owner_key=excluded.owner_key,held=1,updated_at=excluded.updated_at
    WHERE public_hostname_claims.held=0 OR (public_hostname_claims.kind=excluded.kind AND public_hostname_claims.owner_key=excluded.owner_key)
      OR (excluded.kind='sales' AND public_hostname_claims.kind='sales'
        AND public_hostname_claims.workspace_id=excluded.workspace_id
        AND substr(public_hostname_claims.owner_key,1,length(?7))=?7
        AND EXISTS(SELECT 1 FROM sales_hostnames s WHERE s.hostname=?1 AND s.status!='detached'
          AND s.workspace_id||':'||s.listing_id||':'||s.epoch=excluded.owner_key))
    RETURNING hostname
  `,
    )
    .bind(
      hostname,
      kind,
      workspace,
      ownerKey,
      Date.now(),
      portfolioLimit,
      ownerKey.slice(0, ownerKey.lastIndexOf(':') + 1),
    )
    .first();
  if (!row)
    throw new HostnameClaimError(
      'This domain is already connected, or custom-domain capacity is currently full.',
    );
}
export async function releaseHostname(
  db: D1Database,
  hostname: string,
  kind: 'sales' | 'portfolio',
  ownerKey: string,
) {
  if (!(await hostnameClaimsExist(db))) return;
  await db
    .prepare(
      'UPDATE public_hostname_claims SET held=0,updated_at=? WHERE hostname=? AND kind=? AND owner_key=?',
    )
    .bind(Date.now(), hostname, kind, ownerKey)
    .run();
}
export async function ownsHostname(
  db: D1Database,
  hostname: string,
  kind: 'sales' | 'portfolio',
  ownerKey: string,
) {
  return !!(await db
    .prepare(
      'SELECT 1 FROM public_hostname_claims WHERE hostname=? AND kind=? AND owner_key=? AND held=1',
    )
    .bind(hostname, kind, ownerKey)
    .first());
}

export async function releaseSalesHostname(
  db: D1Database,
  hostname: string,
  workspace: string,
  listing: string,
  detachedFromEpoch: number,
) {
  if (!(await hostnameClaimsExist(db))) return;
  const row = await db
    .prepare(
      "SELECT owner_key FROM public_hostname_claims WHERE hostname=? AND kind='sales' AND workspace_id=? AND held=1",
    )
    .bind(hostname, workspace)
    .first<{ owner_key: string }>();
  const prefix = `${workspace}:${listing}:`;
  if (!row?.owner_key.startsWith(prefix)) return;
  const epoch = Number(row.owner_key.slice(prefix.length));
  if (!Number.isSafeInteger(epoch) || epoch > detachedFromEpoch) return;
  await releaseHostname(db, hostname, 'sales', row.owner_key);
}

export async function rememberHostnameProvider(
  db: D1Database,
  hostname: string,
  kind: 'sales' | 'portfolio',
  ownerKey: string,
  providerId: string,
) {
  if (!(await hostnameClaimsExist(db))) return;
  await db
    .prepare(
      'UPDATE public_hostname_claims SET provider_id=?,updated_at=? WHERE hostname=? AND kind=? AND owner_key=? AND held=1',
    )
    .bind(providerId, Date.now(), hostname, kind, ownerKey)
    .run();
}
