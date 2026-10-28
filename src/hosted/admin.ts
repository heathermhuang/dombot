import { onDemandSchemaReady } from './on-demand';
import { readWorkspace } from './workspace-observation';
import {
  adminInventoryQuerySchema,
  adminInventorySchema,
} from '../shared/admin-inventory';
import {
  SYNC_ALERT_RECIPIENT,
  isEmailAlert,
  type SyncAlert,
} from './sync-monitor';
import { Hono } from 'hono';
import { Accounts, type SessionUser } from './accounts';
import { Passkeys } from './passkeys';
import { adminSnapshotSchema, type AdminSnapshot } from './admin-metrics';
import { page, escapeHtml as e } from './views';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';

type UserRow = {
  id: string;
  email: string;
  workspace_id: string;
  created_at: number;
  enabled: number;
  not_started?: number;
  snapshot: string | null;
  observed_at: number | null;
  attempted_at?: number | null;
  unavailable?: number;
};
const PAGE_SIZE = 25;
const SNAPSHOT_AGE = 15 * 60_000;
const timestamp = (n: number | null | undefined) =>
  n
    ? new Date(n).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : 'Not observed';
export function isAdmin(env: HostedEnv, user: SessionUser | null): boolean {
  try {
    const ids: unknown = JSON.parse(env.ADMIN_USER_IDS ?? '[]');
    return Boolean(
      user &&
      Array.isArray(ids) &&
      ids.every((id) => typeof id === 'string') &&
      ids.includes(user.id),
    );
  } catch {
    return false;
  }
}
function snapshot(row: UserRow): AdminSnapshot | null {
  try {
    return adminSnapshotSchema.parse(JSON.parse(row.snapshot ?? 'null'));
  } catch {
    return null;
  }
}
export function aggregateAdmin(rows: UserRow[], now = Date.now()) {
  let owned = 0,
    archived = 0,
    imported = 0,
    observed = 0,
    stale = 0,
    failed = 0,
    unavailable = 0;
  for (const row of rows.filter((r) => r.enabled && !r.not_started)) {
    if (row.unavailable) unavailable++;
    const s = snapshot(row);
    if (!s) continue;
    observed++;
    owned += s.owned;
    archived += s.archived;
    imported += s.imported;
    if (now - s.at > SNAPSHOT_AGE) stale++;
    if (s.accounts.some((a) => ['failed', 'stale', 'never'].includes(a.state)))
      failed++;
  }
  const enabled = rows.filter((r) => r.enabled).length;
  return {
    users: rows.length,
    enabled,
    observed,
    unknown:
      enabled -
      observed -
      rows.filter((r) => r.enabled && r.not_started).length,
    stale,
    failed,
    owned,
    archived,
    imported,
    unavailable,
  };
}
const styles = `<style>
.admin{margin:24px 0 64px}.admin h1{font-size:32px;letter-spacing:-.035em;margin:12px 0}.admin h2{font-size:20px;margin:0 0 16px}.admin p{max-width:80ch}.admin nav{display:flex;gap:20px;flex-wrap:wrap;align-items:center}.admin .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);background:#fff;border-radius:10px;margin:24px 0}.admin .metric{padding:20px;border-right:1px solid var(--line)}.admin .metric:last-child{border:0}.admin .metric strong{display:block;font-size:30px;font-variant-numeric:tabular-nums;line-height:1.3}.admin .metric span{font-size:13px;color:var(--muted)}.admin .surface{padding:24px;border:1px solid var(--line);border-radius:10px;background:#fff;margin:24px 0}.admin form{max-width:none;margin:16px 0;display:flex;gap:12px;align-items:end;flex-wrap:wrap}.admin form label{margin:0;flex:1 1 240px}.admin table{width:100%;min-width:680px;border-collapse:collapse;font-size:14px;text-align:left}.admin th,.admin td{padding:14px 12px;border-bottom:1px solid var(--line);vertical-align:top}.admin th{white-space:nowrap;font-size:12px;color:var(--muted);font-weight:600}.admin .scroll{overflow-x:auto}.admin td:first-child a{display:inline-block;min-height:44px;padding-block:8px;white-space:nowrap}.admin .number{font-variant-numeric:tabular-nums;text-align:right}.admin .state{display:inline-block;border-radius:20px;padding:3px 9px;font-size:12px;background:#edf3e9;color:#295433}.admin .attention{background:#f8eedc;color:#764d15}.admin .unknown{background:#edf0ed;color:#536158}.admin .muted{font-size:12px;color:var(--muted)}.admin code{font-size:12px;overflow-wrap:anywhere}.admin details{margin:12px 0}.admin .toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}.admin .toolbar form{margin:0}.admin .toolbar a{min-height:44px;display:inline-flex;align-items:center}@media(max-width:650px){.admin .summary{grid-template-columns:repeat(2,minmax(0,1fr))}.admin .metric{border-bottom:1px solid var(--line)}.admin .surface{padding:16px}.admin td,.admin th{padding:10px 8px}.admin h1{font-size:28px}.admin form button{width:100%}}
</style>`;
const rowUnavailable = (row: UserRow) =>
  row.unavailable
    ? `<span class="state attention">Unavailable</span><br><span class="muted">Attempt ${timestamp(row.attempted_at)}</span><br>`
    : '';
const pill = (value: string, warning = false) =>
  `<span class="state ${warning ? 'attention' : ''}">${e(value)}</span>`;
const metric = (label: string, value: number, help: string) =>
  `<div class="metric"><span>${e(label)}</span><strong>${value.toLocaleString('en-US')}</strong><span>${e(help)}</span></div>`;
const shell = (body: string) =>
  page(
    'System administration',
    `${styles}<section class="admin"><nav aria-label="Admin navigation"><a href="/admin">Overview & users</a><a href="/admin/sync-monitor">Dynadot monitoring</a><a href="/account">Account security</a><a href="/app">My portfolio</a></nav>${body}</section>`,
  );
const selectUsers = (env: HostedEnv) =>
  `SELECT u.id,u.email,u.workspace_id,u.created_at,w.enabled,s.snapshot,s.observed_at,s.attempted_at,s.unavailable ${onDemandSchemaReady(env) ? ',EXISTS(SELECT 1 FROM pending_workspaces p WHERE p.workspace_id=w.id AND p.activated_at IS NULL) not_started' : ''} FROM users u JOIN workspaces w ON w.id=u.workspace_id LEFT JOIN admin_snapshots s ON s.workspace_id=w.id`;

export function adminRoutes(
  session: (request: Request, env: HostedEnv) => Promise<SessionUser | null>,
) {
  const app = new Hono<{
    Bindings: HostedEnv;
    Variables: { admin: SessionUser };
  }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const user = await session(c.req.raw, c.env);
    if (!user) return c.redirect('/login?next=%2Fadmin', 303);
    if (!isAdmin(c.env, user)) return c.text('Forbidden', 403);
    if (!(await new Passkeys(c.env).fresh(user!)))
      return c.redirect('/account/reauth?next=%2Fadmin', 303);
    c.set('admin', user!);
    await next();
  });
  const audit = async (
    env: HostedEnv,
    user: SessionUser,
    action: 'view' | 'refresh',
    target: string | null = null,
  ) => {
    await env.CONTROL_DB.prepare(
      'INSERT INTO admin_audit(id,actor_id,action,created_at,target_user_id) VALUES(?,?,?,?,?)',
    )
      .bind(crypto.randomUUID(), user.id, action, Date.now(), target)
      .run();
  };
  app.get('/', async (c) => {
    const rows = (
      await c.env.CONTROL_DB.prepare(
        selectUsers(c.env) + ' ORDER BY u.created_at DESC,u.id',
      ).all<UserRow>()
    ).results;
    const totals = aggregateAdmin(rows);
    const q = (c.req.query('q') ?? '').trim().slice(0, 120);
    const offset = Math.min(
      Math.max(0, Number.parseInt(c.req.query('offset') ?? '0') || 0),
      Math.max(0, rows.length - 1),
    );
    const filtered = rows.filter((r) =>
      `${r.email} ${r.id} ${r.workspace_id}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    );
    const shown = filtered.slice(offset, offset + PAGE_SIZE);
    const capacity = await c.env.CONTROL_DB.prepare(
      'SELECT COUNT(*) AS total FROM platform_workspaces p JOIN workspaces w ON w.id=p.workspace_id WHERE p.qualified_at>0 AND p.signup_enabled=1 AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM users u WHERE u.workspace_id=w.id)',
    ).first<{ total: number }>();
    await audit(c.env, c.get('admin'), 'view');
    const notices = c.req.query('refreshed')
      ? `<p class="notice" role="status">Observation complete: ${e(c.req.query('refreshed')!)} available, ${e(c.req.query('unavailable') ?? '0')} unavailable. Unavailable portfolios retain their last observation.</p>`
      : '';
    return c.html(
      shell(`<span class="eyebrow">Operator console</span><h1>System status</h1><p>Storage checked ${timestamp(Date.now())}. Portfolio readings are cached observations; refreshing reads stored inventory without contacting registrars.</p>${notices}
      <div class="summary">${metric('User accounts', totals.users, `${totals.enabled} enabled`)}${metric('Owned domains observed', totals.owned, `${totals.observed} of ${totals.enabled} enabled users`)}${metric('Need attention', totals.failed, 'Sync failed, stale or never completed')}${metric('Unknown / stale readings', totals.unknown + totals.stale, 'Refresh before relying on totals')}</div>
      <section class="surface"><h2>System overview</h2><p>${totals.unavailable} portfolios unavailable on their last observation attempt.</p><p>${pill('Control database reachable')} ${pill(totals.unknown || totals.stale || totals.failed || totals.unavailable ? 'Attention required' : 'Snapshot coverage current', Boolean(totals.unknown || totals.stale || totals.failed || totals.unavailable))}</p><p>${onDemandSchemaReady(c.env) ? `${rows.filter((r) => r.enabled && r.not_started).length} portfolios not started; on-demand setup ${c.env.ON_DEMAND_ENABLED === 'true' ? 'enabled' : 'paused'}.` : `${capacity?.total ?? 0} unclaimed qualified signup slots.`} Public registration: ${c.env.PUBLIC_REGISTRATION_ENABLED === 'true' ? 'enabled' : 'disabled'}. Email delivery qualification: ${c.env.EMAIL_DELIVERY_VERIFIED === 'true' ? 'configured as verified' : 'not verified'}.</p><p class="muted">Owned counts deduplicate names within each user and include imports; archived names are excluded. The aggregate sums user holdings, so the same name held by two users counts twice. Disabled accounts are excluded. ${totals.archived} archived and ${totals.imported} imported names observed. Unknown users are never counted as zero. Totals may contain readings older than 15 minutes.</p><details><summary>Release & monitoring coverage</summary><p>Gateway source: <code>${e(c.env.SOURCE_COMMIT ?? 'Not configured')}</code></p><p>Generic runtime outcomes retain up to 100 events per portfolio. The Dynadot monitor separately retains sanitized sync attempts for 30 days, including failures followed by successful retries. Uptime, provider availability and backup recovery are not measured by this view.</p></details></section>
      <section class="surface"><div class="toolbar"><h2>Users & portfolios</h2><form action="/admin/refresh" method="post"><input type="hidden" name="offset" value="${offset}"><input type="hidden" name="q" value="${e(q)}"><button>Refresh these ${shown.length} users</button></form></div><form method="get" action="/admin"><label>Search email or user / portfolio ID<input type="search" name="q" value="${e(q)}" maxlength="120"></label><button>Search users</button></form><p class="muted">${filtered.length} matches. Showing ${shown.length ? offset + 1 : 0}–${Math.min(offset + PAGE_SIZE, filtered.length)}. Includes operator and test accounts.</p>
      <div class="scroll" tabindex="0" role="region" aria-label="User portfolio counts"><table><thead><tr><th>User</th><th>Access</th><th class="number">Owned</th><th>Sync status</th><th>Observation</th></tr></thead><tbody>${
        shown
          .map((r) => {
            const s = snapshot(r);
            const issues =
              s?.accounts.filter((a) =>
                ['failed', 'stale', 'never'].includes(a.state),
              ).length ?? 0;
            return `<tr><td><a href="/admin/users/${encodeURIComponent(r.id)}">${e(r.email)}</a><br><span class="muted">Joined ${timestamp(r.created_at)}</span></td><td>${r.enabled ? 'Enabled' : 'Disabled'}</td><td class="number">${r.not_started ? '—' : s ? s.owned : 'Unknown'}</td><td>${r.not_started ? pill('Not started') : s ? pill(issues ? `${issues} need attention` : `${s.accounts.length} connected`, issues > 0) : '<span class="unknown state">Not observed</span>'}</td><td>${rowUnavailable(r)}${timestamp(s?.at)}${s && Date.now() - s.at > SNAPSHOT_AGE ? '<br>Stale reading' : ''}</td></tr>`;
          })
          .join('') || '<tr><td colspan="5">No matching users.</td></tr>'
      }</tbody></table></div><nav aria-label="User pages">${offset > 0 ? `<a href="/admin?q=${encodeURIComponent(q)}&offset=${Math.max(0, offset - PAGE_SIZE)}">← Previous</a>` : ''}${offset + PAGE_SIZE < filtered.length ? `<a href="/admin?q=${encodeURIComponent(q)}&offset=${offset + PAGE_SIZE}">Next users →</a>` : ''}</nav></section>`),
    );
  });
  app.get('/sync-monitor', async (c) => {
    const now = Date.now();
    const control = await c.env.CONTROL_DB.prepare(
      'SELECT completed_at FROM sync_monitor_control WHERE id=1',
    ).first<{ completed_at: number | null }>();
    const coverage = await c.env.CONTROL_DB.prepare(
      `SELECT COUNT(*) total,SUM(CASE WHEN c.checked_at>? AND c.errors=0 THEN 1 ELSE 0 END) current,SUM(CASE WHEN c.errors>0 THEN 1 ELSE 0 END) unavailable FROM users u JOIN workspaces w ON w.id=u.workspace_id LEFT JOIN sync_monitor_checks c ON c.workspace_id=u.workspace_id WHERE w.enabled=1 ${onDemandSchemaReady(c.env) ? 'AND NOT EXISTS(SELECT 1 FROM pending_workspaces p WHERE p.workspace_id=w.id AND p.activated_at IS NULL)' : ''}`,
    )
      .bind(now - 10 * 60_000)
      .first<{ total: number; current: number; unavailable: number }>();
    const events = (
      await c.env.CONTROL_DB.prepare(
        'SELECT s.*,u.id user_id,u.email FROM sync_monitor_events s LEFT JOIN users u ON u.workspace_id=s.workspace_id ORDER BY s.at DESC,s.seq DESC LIMIT 100',
      ).all<{
        id: string;
        user_id: string;
        email: string;
        at: number;
        ok: number;
        diagnostic: string;
      }>()
    ).results;
    const alerts = (
      await c.env.CONTROL_DB.prepare(
        'SELECT * FROM sync_monitor_alerts ORDER BY at DESC,id DESC LIMIT 50',
      ).all<SyncAlert>()
    ).results;
    const probes = (
      await c.env.CONTROL_DB.prepare(
        'SELECT c.workspace_id,c.checked_at,c.errors,c.probe_json,c.last_failure_json,u.email FROM sync_monitor_checks c JOIN users u ON u.workspace_id=c.workspace_id ORDER BY c.errors DESC,c.checked_at DESC LIMIT 100',
      ).all<{
        workspace_id: string;
        checked_at: number;
        errors: number;
        probe_json: string | null;
        last_failure_json: string | null;
        email: string;
      }>()
    ).results;
    const pending = await c.env.CONTROL_DB.prepare(
      "SELECT COUNT(*) n FROM sync_monitor_alerts WHERE kind IN ('failure','test') AND status!='sent'",
    ).first<{ n: number }>();
    await audit(c.env, c.get('admin'), 'view');
    return c.html(
      shell(`<span class="eyebrow">Operator console</span><h1>Dynadot sync monitoring</h1><p>${pill(c.env.SYNC_MONITOR_ENABLED === 'true' ? 'Enabled' : 'Disabled', c.env.SYNC_MONITOR_ENABLED !== 'true')} Last completed check: ${timestamp(control?.completed_at)}. Refresh this page for current readings.</p>
      <div class="summary">${metric('Portfolios covered', coverage?.current ?? 0, `of ${coverage?.total ?? 0} enabled, checked within 10 minutes`)}${metric('Observation errors', coverage?.unavailable ?? 0, 'Not treated as healthy')}${metric('Email deliveries outstanding', pending?.n ?? 0, 'Queued or delivery uncertain')}${metric('Retained days', 30, 'Up to 200 attempts per portfolio before collection')}</div>
      <section class="surface"><h2>Alert policy</h2><p>Actual Dynadot inventory failures and changes in failure cause are grouped and emailed to ${e(SYNC_ALERT_RECIPIENT)}. Repeated failures with the same cause remain recorded without repeated incident emails. The production cron checks every two minutes, up to 25 portfolios per run; fleet coverage currently takes approximately ${Math.max(1, Math.ceil((coverage?.total ?? 0) / 25)) * 2} minutes. No registrar calls are initiated by this monitor.</p><p>Monitoring availability, recovery and retention-gap notices stay in this dashboard, including previously queued notices. They are not emailed. Actual sync failures are grouped into at most one email every 30 minutes across all portfolios; remaining new failures stay queued for the next digest. An uncertain send may have reached the mailbox and is retried up to three times, subject to the same fleet-wide cooldown. After that, it remains visible here for operator follow-up. This view records provider acceptance, not inbox delivery.</p><p class="muted">Capture begins with engine 1.5.2-hosted.14. Earlier failures cannot be reconstructed. Successful retries do not erase retained failures. Attempts retain correlation ID, account ID, timing, trigger, route class, classified failure, HTTP status and exact engine/source version. Provider messages, credentials and domain names are excluded.</p></section>
      <section class="surface"><h2>Observer diagnostics</h2><p class="muted">Latest probe and last classified read failure, including failures recovered by retry. A failed probe remains unknown until a read succeeds. Earlier incidents may lack detailed traces.</p><div class="scroll" tabindex="0" role="region" aria-label="Observer probe diagnostics"><table><thead><tr><th>User / last check</th><th>Observation</th><th>Probe details</th></tr></thead><tbody>${probes.map((probe) => `<tr><td>${e(probe.email)}<br>${timestamp(probe.checked_at)}</td><td>${pill(probe.errors ? 'Unavailable' : 'Read succeeded', probe.errors > 0)}</td><td><details><summary>Latest probe / last failure</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${e(JSON.stringify({ latest: probe.probe_json ? JSON.parse(probe.probe_json) : null, lastFailure: probe.last_failure_json ? JSON.parse(probe.last_failure_json) : null }, null, 2))}</pre></details></td></tr>`).join('') || '<tr><td colspan="3">No probe telemetry retained yet.</td></tr>'}</tbody></table></div></section>
      <section class="surface"><h2>Recent sync attempts</h2><p class="muted">Latest 100 across all users, retained for 30 days. Times are UTC.</p><div class="scroll" tabindex="0" role="region" aria-label="Dynadot sync attempts"><table><thead><tr><th>Time / user</th><th>Outcome</th><th>Diagnostics</th></tr></thead><tbody>${events.map((row) => `<tr><td>${timestamp(row.at)}<br><a href="/admin/users/${encodeURIComponent(row.user_id)}">${e(row.email ?? row.user_id)}</a></td><td>${pill(row.ok ? 'Succeeded' : 'Failed', !row.ok)}</td><td><details><summary>Sanitized attempt ${e(row.id.slice(0, 8))}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${e(JSON.stringify(JSON.parse(row.diagnostic), null, 2))}</pre></details></td></tr>`).join('') || '<tr><td colspan="3">No Dynadot attempts collected yet.</td></tr>'}</tbody></table></div></section>
      <section class="surface"><h2>Recent alerts & delivery</h2><div class="scroll" tabindex="0" role="region" aria-label="Dynadot alerts"><table><thead><tr><th>Time</th><th>Alert</th><th>Delivery</th></tr></thead><tbody>${alerts.map((row) => `<tr><td>${timestamp(row.at)}</td><td>${e(row.kind)}<details><summary>Alert ${e(row.id.slice(0, 8))}</summary><code>${e(row.id)}</code><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${e(JSON.stringify(JSON.parse(row.diagnostic), null, 2))}</pre></details></td><td>${pill(row.status === 'sent' ? 'Accepted by email provider' : isEmailAlert(row.kind) ? row.status : 'Dashboard only', row.status !== 'sent' && isEmailAlert(row.kind))}<br>${timestamp(row.sent_at)}</td></tr>`).join('') || '<tr><td colspan="3">No incidents or alert deliveries recorded.</td></tr>'}</tbody></table></div></section>`),
    );
  });
  app.post('/refresh', async (c) => {
    if (c.req.header('origin') !== new URL(c.req.url).origin)
      return c.text('Bad origin', 403);
    const accounts = new Accounts(c.env.CONTROL_DB, c.env.AUTH_PEPPER);
    if (!(await accounts.rateLimit(`admin-refresh:${c.get('admin').id}`, 12)))
      return c.text('Too many refreshes. Try again later.', 429);
    const body = await c.req.parseBody();
    const q = String(body.q ?? '')
      .trim()
      .slice(0, 120);
    const offset = Math.max(
      0,
      Number.parseInt(String(body.offset ?? '0')) || 0,
    );
    const rows = (
      await c.env.CONTROL_DB.prepare(
        selectUsers(c.env) + ' ORDER BY u.created_at DESC,u.id',
      ).all<UserRow>()
    ).results
      .filter((r) =>
        `${r.email} ${r.id} ${r.workspace_id}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      )
      .slice(offset, offset + PAGE_SIZE);
    let available = 0,
      unavailable = 0;
    await audit(c.env, c.get('admin'), 'refresh');
    // Bound the fleet fan-out. Failure in one tenant never erases other readings.
    for (let i = 0; i < rows.length; i += 4)
      await Promise.all(
        rows.slice(i, i + 4).map(async (row) => {
          if (!row.enabled || row.not_started) return;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const work = async () => {
              const configured = await workspaceFor(c.env, row.workspace_id);
              if (!configured) throw Error('Unavailable');
              const request = new Request(
                'https://workspace.internal/platform-internal/admin-snapshot',
              );
              request.headers.set(
                PROOF_HEADER,
                await signGatewayRequest(
                  await workspaceKey(c.env, row.workspace_id),
                  row.workspace_id,
                  null,
                  request,
                ),
              );
              const response = await workspaceService(
                c.env,
                configured.binding,
              ).fetch(request);
              if (!response.ok) throw Error('Unavailable');
              return adminSnapshotSchema.parse(await response.json());
            };
            const value = await Promise.race([
              work(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(Error('Timeout')), 8000);
              }),
            ]);
            await c.env.CONTROL_DB.prepare(
              'INSERT INTO admin_snapshots(workspace_id,observed_at,snapshot,attempted_at,unavailable) VALUES(?,?,?,?,0) ON CONFLICT(workspace_id) DO UPDATE SET observed_at=excluded.observed_at,snapshot=excluded.snapshot,attempted_at=excluded.attempted_at,unavailable=0',
            )
              .bind(
                row.workspace_id,
                value.at,
                JSON.stringify(value),
                Date.now(),
              )
              .run();
            available++;
          } catch {
            await c.env.CONTROL_DB.prepare(
              'INSERT INTO admin_snapshots(workspace_id,attempted_at,unavailable) VALUES(?,?,1) ON CONFLICT(workspace_id) DO UPDATE SET attempted_at=excluded.attempted_at,unavailable=1',
            )
              .bind(row.workspace_id, Date.now())
              .run();
            unavailable++;
          } finally {
            clearTimeout(timer);
          }
        }),
      );
    return c.redirect(
      `/admin?q=${encodeURIComponent(q)}&offset=${offset}&refreshed=${available}&unavailable=${unavailable}`,
      303,
    );
  });
  app.get('/users/:id/domains', async (c) => {
    const row = await c.env.CONTROL_DB.prepare(
      selectUsers(c.env) + ' WHERE u.id=?',
    )
      .bind(c.req.param('id'))
      .first<UserRow>();
    if (!row) return c.notFound();
    if (row.not_started) {
      await audit(c.env, c.get('admin'), 'view', row.id);
      return c.html(
        shell(
          `<h1>${e(row.email)}</h1><p>Portfolio not started. No customer Worker or database has been allocated. Setup starts when the owner chooses registrar connection or import.</p><a href="/admin">Back to users</a>`,
        ),
      );
    }
    if (!row.enabled)
      return c.html(
        shell(
          `<h1>${e(row.email)}</h1><p>Portfolio access is disabled.</p><a href="/admin/users/${encodeURIComponent(row.id)}">Back to user</a>`,
        ),
        403,
      );
    const rate = new Accounts(c.env.CONTROL_DB, c.env.AUTH_PEPPER);
    if (!(await rate.rateLimit('admin-inventory:' + c.get('admin').id, 120)))
      return c.text('Too many inventory reads. Try again shortly.', 429);
    await audit(c.env, c.get('admin'), 'view', row.id);
    const query = adminInventoryQuerySchema.parse({
      q: (c.req.query('q') ?? '').slice(0, 120),
      offset: Math.min(
        1000000,
        Math.max(0, Number.parseInt(c.req.query('offset') ?? '0') || 0),
      ),
      limit: 100,
      state: ['owned', 'archived', 'all'].includes(c.req.query('state') ?? '')
        ? c.req.query('state')
        : 'owned',
    });
    try {
      const { value: data } = await readWorkspace(
        c.env,
        row.workspace_id,
        'admin-inventory',
        (value) => adminInventorySchema.parse(value),
        { body: query, timeoutMs: 20000, attempts: 1 },
      );
      const link = (offset: number) =>
        `/admin/users/${encodeURIComponent(row.id)}/domains?q=${encodeURIComponent(query.q)}&state=${query.state}&offset=${offset}`;
      const sources: Record<string, string> = {
        api: 'Cached API quote',
        manual: 'Manual price',
        base: 'Bundled estimate',
        tld: 'TLD estimate',
        unavailable: 'Unknown price',
      };
      const amount = (currency: string, value: string) => {
        const [whole, fraction] = value.split('.');
        return `${e(currency)} ${e(whole.replace(/\B(?=(\d{3})+(?!\d))/g, ','))}${fraction === undefined ? '' : '.' + e(fraction)}`;
      };
      return c.html(
        shell(`<nav><a href="/admin/users/${encodeURIComponent(row.id)}">← User status</a></nav><span class="eyebrow">Cached inventory</span><h1>${e(row.email)}</h1><p>Read ${timestamp(data.at)}. No registrar requests or price refreshes were started.</p>
        ${!data.available ? '<p class="notice" role="status">No cached inventory is available yet. The user must sync a registrar or import holdings before a list can be shown.</p>' : ''}
        <div class="summary">${metric('Observed owned domains', data.owned, 'Distinct cached names')}${metric('Priced names', data.priced, `${data.unpriced} unpriced or ambiguous`)}${metric('Stale API quotes', data.stalePrices, 'Older than 24 hours')}${metric('Accounts not observed', data.unobservedAccounts, `${data.failedAccounts} with cached sync errors; ${data.staleAccounts} stale`)}</div>
        <section class="surface"><h2>Known annual renewal subtotal</h2>${data.totals.length ? data.totals.map((total) => `<p><strong>${amount(total.currency, total.amount)}</strong> / year · ${total.domains} priced ${total.domains === 1 ? 'name' : 'names'}</p>`).join('') : '<p>No known prices in the cached holdings.</p>'}<p class="muted">Each currency is totalled separately. No FX conversion, tax or future registrar changes are assumed. These are cached quotes, manual rates and estimates, not an invoice. Unknown prices are excluded; ${data.ambiguous} names listed in multiple accounts are also excluded to avoid double-counting. Stale quotes remain in the subtotal and are flagged in the list. ${data.archived} archived names in history are excluded from annual totals. Unobserved accounts may contain additional holdings.</p></section>
        <section class="surface"><h2>Domains & renewal costs</h2><form method="get"><label>Search domain, registrar or account<input name="q" type="search" value="${e(query.q)}" maxlength="120"></label><label>Cached records<select name="state"><option value="owned" ${query.state === 'owned' ? 'selected' : ''}>Owned</option><option value="archived" ${query.state === 'archived' ? 'selected' : ''}>Archived</option><option value="all" ${query.state === 'all' ? 'selected' : ''}>All</option></select></label><button>Search domains</button></form><p class="muted">${data.matched} cached ${data.matched === 1 ? 'row matches' : 'rows match'}. Showing ${data.rows.length ? query.offset + 1 : 0}–${query.offset + data.rows.length}. Historical archived holdings are included when selected. Missing expiry dates and prices remain unknown.</p>
        <div class="scroll" tabindex="0" role="region" aria-label="User domains and renewal costs"><table><thead><tr><th>Domain</th><th>Registrar / account</th><th>Expiry</th><th>Annual renewal</th><th>Price source / age</th></tr></thead><tbody>${data.rows.map((item) => `<tr><td><strong>${e(item.domain)}</strong><br><span class="muted">${item.departed ? 'Historical holding' : item.source === 'imported' ? 'Imported holding' : 'Registrar holding'}${item.archived ? ' · Archived' : ''}${item.ambiguous ? ' · Duplicate holding' : ''}</span></td><td>${e(item.registrar || 'Unknown')}<br>${e(item.accountLabel)}<br><span class="muted">Inventory: ${timestamp(item.inventoryAt)}${item.inventoryStale ? ' · Stale or unknown' : ''}</span></td><td>${item.expiresAt !== null ? new Date(item.expiresAt).toISOString().slice(0, 10) : 'Unknown'}</td><td>${item.renewal !== null && item.currency ? amount(item.currency, item.renewal) : 'Unknown'}${item.ambiguous ? '<br><span class="muted">Excluded from subtotal</span>' : ''}</td><td>${e(sources[item.priceSource])}<br><span class="muted">${item.priceAge === 'stale' ? 'Stale quote · ' : item.priceAge === 'estimate' ? 'Estimate · ' : item.priceAge === 'manual' ? 'Update time unknown · ' : item.priceAge === 'unknown' ? 'Quote age unknown · ' : ''}${item.quoteAt ? timestamp(item.quoteAt) : ''}</span></td></tr>`).join('') || '<tr><td colspan="5">No cached rows match this search.</td></tr>'}</tbody></table></div>
        <nav aria-label="Domain pages">${query.offset > 0 ? `<a href="${e(link(Math.max(0, query.offset - query.limit)))}">← Previous domains</a>` : ''}${query.offset + query.limit < data.matched ? `<a href="${e(link(query.offset + query.limit))}">Next domains →</a>` : ''}</nav></section>`),
      );
    } catch {
      return c.html(
        shell(
          `<h1>${e(row.email)}</h1><p class="notice" role="status">Cached inventory could not be read. A portfolio operation may still be in progress. Try again shortly; no domains or prices have been replaced with zero.</p><a href="/admin/users/${encodeURIComponent(row.id)}">Back to user status</a>`,
        ),
        503,
      );
    }
  });
  app.get('/users/:id', async (c) => {
    const row = await c.env.CONTROL_DB.prepare(
      selectUsers(c.env) + ' WHERE u.id=?',
    )
      .bind(c.req.param('id'))
      .first<UserRow>();
    if (!row) return c.notFound();
    if (row.not_started) {
      await audit(c.env, c.get('admin'), 'view', row.id);
      return c.html(
        shell(
          `<h1>${e(row.email)}</h1><p>Portfolio not started. No customer Worker or database has been allocated. Setup starts when the owner chooses registrar connection or import.</p><a href="/admin">Back to users</a>`,
        ),
      );
    }
    await audit(c.env, c.get('admin'), 'view', row.id);
    const s = snapshot(row);
    return c.html(
      shell(
        `<h1>${e(row.email)}</h1>${rowUnavailable(row)}<p>Access: ${row.enabled ? 'Enabled' : 'Disabled'}. User ID: <code>${e(row.id)}</code><br>Portfolio ID: <code>${e(row.workspace_id)}</code></p><p><a href="/admin/users/${encodeURIComponent(row.id)}/domains">View domains & renewal costs →</a></p><form action="/admin/refresh" method="post"><input type="hidden" name="q" value="${e(row.id)}"><button>Refresh this user</button></form>${s ? `<p>Observed ${timestamp(s.at)}. Owned: ${s.owned}; imported: ${s.imported}; archived: ${s.archived}.</p><section class="surface"><h2>Registrar accounts</h2>${s.maintenance ? `<p>Background maintenance: ${e(s.maintenance.policy ? (s.maintenance.paused ? 'Operator paused' : s.maintenance.inspection.state === 'empty' ? 'Sleeping: no maintenance work' : s.maintenance.inspection.state === 'work' ? 'Work present' : 'Unknown: scheduling retained') : 'Legacy scheduling')}. Checked ${timestamp(s.maintenance.observedAt)}. Next alarm ${timestamp(s.maintenance.alarmAt)}.</p>` : ''}<div class="scroll" tabindex="0" role="region" aria-label="Registrar status"><table><thead><tr><th>Registrar</th><th>Status / category</th><th class="number">Cached rows</th><th>Last successful sync</th></tr></thead><tbody>${s.accounts.map((a) => `<tr><td>${e(a.registrar)}<br><code>${e(a.accountId)}</code></td><td>${pill(a.recovery?.state ?? a.state, ['failed', 'stale', 'never'].includes(a.recovery?.state ?? a.state))}${a.recovery?.retryAt ? ` · Retry eligible ${timestamp(a.recovery.retryAt)}` : ''} ${a.code === 'none' ? '' : e(a.code)}</td><td class="number">${a.domains}</td><td>${timestamp(a.lastSyncedAt)}</td></tr>`).join('') || '<tr><td colspan="4">No connected registrar accounts.</td></tr>'}</tbody></table></div></section><section class="surface"><h2>Recent operations</h2><p class="muted">Up to 100 events, starting with this release. Readings and event absence do not prove uptime. Scheduled entries report the resulting cached sync state, including runs skipped because data was fresh.</p><div class="scroll" tabindex="0" role="region" aria-label="Operation history"><table><thead><tr><th>When</th><th>Operation</th><th>Outcome</th><th>Duration</th></tr></thead><tbody>${s.operations.map((o) => `<tr><td>${timestamp(o.at)}</td><td>${e(o.kind)}</td><td>${pill(o.status, o.status === 'failed')} ${o.code === 'none' ? '' : e(o.code)}</td><td>${o.durationMs} ms</td></tr>`).join('') || '<tr><td colspan="4">No recorded operations yet.</td></tr>'}</tbody></table></div></section>` : '<p class="notice">No observation yet. Refresh this user to read stored counts and sync status.</p>'}`,
      ),
    );
  });
  return app;
}
