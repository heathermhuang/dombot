import { z } from 'zod';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import {
  landerSelectionSchema,
  landerManifestDigestSchema,
  hostingPlanSchema,
  type LanderJobView,
  canonicalJson,
} from '../shared/lander-connection';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import {
  LanderHosting,
  LanderPreparationPending,
  LanderCertificatePlanChanged,
} from './lander-hosting';
import { salesRecipient } from './sales-notifications';
import {
  dynadotDnsSetupScope,
  dynadotDnsSetupScopeSchema,
} from '../shared/dynadot-dns-setup';
import { page, escapeHtml as e } from './views';

export async function landerInternal(
  env: HostedEnv,
  workspace: string,
  path: string,
  recipient = false,
  body?: unknown,
) {
  const configured = await workspaceFor(env, workspace);
  if (!configured) throw Error('Account unavailable');
  const request = new Request(
    new URL('/sales-internal/lander/' + path, env.CANONICAL_ORIGIN),
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      request,
      { purpose: 'sales-connections', recipientVerified: recipient },
    ),
  );
  return workspaceService(env, configured.binding).fetch(request);
}
async function wake(env: HostedEnv, workspace: string) {
  await env.CONTROL_DB.prepare(
    'INSERT INTO lander_workspaces(workspace_id,due_at) VALUES(?,0) ON CONFLICT(workspace_id) DO UPDATE SET due_at=0',
  )
    .bind(workspace)
    .run();
}
export async function landerRequest(
  env: HostedEnv,
  workspace: string,
  email: string,
  path: string,
  request: Request,
) {
  const suffix = path.slice('/sales/lander/'.length);
  if (suffix === 'dns-setup') {
    const setup = dynadotDnsSetupScope(env.DYNDNS_SETUP_FIXTURE, workspace);
    if (!setup) return new Response('Not found', { status: 404 });
    const failed = () =>
      new Response(
        page(
          'DNS setup needs attention',
          `<section class="account"><h1>DNS setup did not complete</h1><p>The setup for ${e(setup.domain)} could not finish. Check its current status before trying again. A submitted request is reconciled before another change.</p><p><a href="/w/${workspace}/sales/lander/dns-setup">Check setup status</a> · <a href="/w/${workspace}/">Back to portfolio</a></p></section>`,
        ),
        {
          status: 409,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex,nofollow',
          },
        },
      );
    try {
      let content: string;
      if (request.method === 'GET') {
        const r = await landerInternal(env, workspace, 'dns-setup');
        if (!r.ok) throw Error('DNS setup unavailable');
        const v = z
          .object({
            domain: z.string(),
            scope: dynadotDnsSetupScopeSchema,
            requestId: z.string().uuid().nullable(),
            reconciliation: z.boolean(),
          })
          .parse(await r.json());
        if (
          v.domain !== setup.domain ||
          canonicalJson(v.scope) !== canonicalJson(setup) ||
          v.requestId !== setup.requestId
        )
          throw Error('DNS setup scope mismatch');
        content = `<section class="account"><h1>Set up Dynadot DNS</h1><p>Move only <strong>${e(setup.domain)}</strong> from Park.io to your connected Dynadot DNS account. Its existing Park.io web destination stays in place while the lander is prepared.</p><p>The original Park.io delegation is retained for rollback. Other domains are unaffected.</p><form method="post" action="/w/${workspace}/sales/lander/dns-setup"><input type="hidden" name="requestId" value="${setup.requestId}"><label class="check"><input type="checkbox" name="unused" required> This unused domain has no email or custom DNS services to migrate.</label><button>${v.reconciliation ? 'Recheck DNS setup' : `Move ${e(setup.domain)} to Dynadot DNS`}</button></form><p><a href="/w/${workspace}/">Back to portfolio</a></p></section>`;
      } else if (request.method === 'POST') {
        const f = await request.formData();
        if (f.get('requestId') !== setup.requestId || f.get('unused') !== 'on')
          throw Error('Confirm the exact unused-domain setup.');
        const r = await landerInternal(env, workspace, 'dns-setup', false, {
          requestId: setup.requestId,
          unused: true,
          expectedScope: setup,
        });
        if (!r.ok) {
          await r.body?.cancel();
          return failed();
        }
        const v = z
          .object({
            domain: z.string(),
            state: z.enum(['configured', 'held', 'rejected']),
            nameservers: z.array(z.string()).optional(),
            receipt: z.string(),
          })
          .parse(await r.json());
        if (
          v.domain !== setup.domain ||
          v.receipt !== 'dns-setup:' + setup.requestId
        )
          throw Error('DNS setup scope mismatch');
        content = `<section class="account"><h1>${v.state === 'configured' ? 'Dynadot DNS configured' : v.state === 'rejected' ? 'DNS setup was refused' : 'DNS setup needs a recheck'}</h1><p>${e(setup.domain)}</p><p>${v.state === 'configured' ? 'DNS propagation, lander HTTPS and restoration checks still need to finish before automatic connections are enabled.' : 'The retained request will be checked before another write. An uncertain submission is never replayed.'}</p>${v.nameservers ? `<p>${v.nameservers.map(e).join('<br>')}</p>` : ''}<p><a href="/w/${workspace}/sales/lander/dns-setup">Recheck setup</a> · <a href="/w/${workspace}/">Back to portfolio</a></p></section>`;
      } else return new Response('Not found', { status: 404 });
      return new Response(page('Dynadot DNS setup', content), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex,nofollow',
        },
      });
    } catch {
      return failed();
    }
  }

  if (suffix === 'config' && request.method === 'GET')
    return Response.json(
      {
        enabled:
          env.LANDER_CONNECTIONS_ENABLED === 'true' &&
          z
            .array(z.string().uuid())
            .parse(JSON.parse(env.LANDER_CONNECTION_WORKSPACES ?? '[]'))
            .includes(workspace),
        supportedProviders: ['cloudflare', 'dynadot'],
        provider: 'cloudflare',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  if (
    !/^jobs(?:\/[0-9a-f-]{36}(?:\/(?:approve|cancel|restore))?)?$/.test(suffix)
  )
    return Response.json({ error: 'Not found' }, { status: 404 });
  const recipient = (await salesRecipient(env, workspace, email)).verified;
  let body: unknown;
  if (request.method === 'POST') {
    if (suffix === 'jobs') {
      if (
        env.LANDER_CONNECTIONS_ENABLED !== 'true' ||
        !z
          .array(z.string().uuid())
          .parse(JSON.parse(env.LANDER_CONNECTION_WORKSPACES ?? '[]'))
          .includes(workspace)
      )
        throw Error('Connections are not qualified for this account.');
    }
    const raw: unknown = await request.json();
    body =
      suffix === 'jobs'
        ? z
            .object({ id: z.string().uuid(), selection: landerSelectionSchema })
            .strict()
            .parse(raw)
        : suffix.endsWith('/approve')
          ? z.object({ digest: landerManifestDigestSchema }).strict().parse(raw)
          : z.object({}).strict().parse(raw);
    // Wake before forwarding: even a lost response must leave a durable scan.
    await wake(env, workspace);
  } else if (request.method !== 'GET')
    return Response.json({ error: 'Not found' }, { status: 404 });
  const result = await landerInternal(
    env,
    workspace,
    suffix + new URL(request.url).search,
    recipient,
    body,
  );
  if (
    request.method === 'GET' &&
    result.ok &&
    /^jobs\/[0-9a-f-]{36}$/.test(suffix)
  ) {
    const view = (await result.json()) as LanderJobView;
    const hostnames = view.items.flatMap(
      (i) => i.hosts?.map((h) => h.hostname) ?? [],
    );
    if (hostnames.length) {
      const rows = await env.CONTROL_DB.prepare(
        'SELECT hostname,epoch,connection_receipt FROM sales_hostnames WHERE workspace_id=? AND hostname IN (SELECT value FROM json_each(?))',
      )
        .bind(workspace, JSON.stringify(hostnames))
        .all<{
          hostname: string;
          epoch: number;
          connection_receipt: string | null;
        }>();
      for (const item of view.items)
        for (const host of item.hosts ?? []) {
          const row = rows.results.find(
            (r) => r.hostname === host.hostname && r.epoch === host.epoch,
          );
          host.receipt = row?.connection_receipt
            ? JSON.parse(row.connection_receipt)
            : null;
        }
    }
    return Response.json(view, { headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(result.body, {
    status: result.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
const workSchema = z.object({
  job: z.string().uuid(),
  ordinal: z.number().int(),
  generation: z.string().uuid(),
  domain: z.string(),
  listing: z.string().uuid(),
  state: z.string(),
  hosts: z.array(hostingPlanSchema).nullable(),
  publication: z.object({ revision: z.string() }).passthrough().nullable(),
});
/** Fair finite work slices. Progress is driven by the existing cron, not tabs. */
export async function drainLanderConnections(env: HostedEnv) {
  if (env.LANDER_CONNECTIONS_ENABLED !== 'true') return;
  const now = Date.now();
  const rows = await env.CONTROL_DB.prepare(
    'SELECT l.workspace_id FROM lander_workspaces l JOIN workspaces w ON w.id=l.workspace_id WHERE l.due_at<=? AND l.lease_until<=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id) ORDER BY l.due_at LIMIT 4',
  )
    .bind(now, now)
    .all<{ workspace_id: string }>();
  for (const { workspace_id: workspace } of rows.results) {
    const lease = crypto.randomUUID(),
      claimed = await env.CONTROL_DB.prepare(
        'UPDATE lander_workspaces SET lease=?,lease_until=? WHERE workspace_id=? AND lease_until<=? RETURNING workspace_id',
      )
        .bind(lease, now + 240000, workspace, now)
        .first();
    if (!claimed) continue;
    try {
      const fence = async () => {
        if (
          !(await env.CONTROL_DB.prepare(
            'SELECT 1 FROM lander_workspaces l JOIN workspaces w ON w.id=l.workspace_id WHERE l.workspace_id=? AND l.lease=? AND l.lease_until>? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
          )
            .bind(workspace, lease, Date.now() + 15000)
            .first())
        )
          throw Error('Connection scheduler lease expired.');
      };
      const service = new LanderHosting(env, fetch, fence);
      for (let n = 0; n < 4; n++) {
        await fence();
        const response = await landerInternal(env, workspace, 'work');
        if (!response.ok) throw Error('Connection work unavailable');
        const work = z
          .object({ work: workSchema.nullable() })
          .parse(await response.json()).work;
        if (!work) break;
        let hosts: z.infer<typeof hostingPlanSchema>[] | undefined,
          hostingState: string | undefined;
        try {
          if (work.state === 'preparing')
            hosts = await service.prepare(
              workspace,
              work.listing,
              work.domain,
              work.generation,
            );
          else if (work.state === 'cleanup')
            hostingState = await service.finishPreparation(
              workspace,
              work.listing,
              work.domain,
              work.generation,
            );
          else if (work.state === 'restored-dns' && work.hosts)
            hostingState = await service.finishRestore(
              workspace,
              work.listing,
              work.generation,
              work.hosts,
            );
          else if (work.hosts && work.publication && work.state !== 'restore')
            hostingState = await service.verify(
              workspace,
              work.listing,
              work.domain,
              work.generation,
              work.hosts,
              work.publication.revision,
            );
        } catch (e) {
          if (e instanceof LanderCertificatePlanChanged) {
            hosts = await service.prepare(
              workspace,
              work.listing,
              work.domain,
              work.generation,
            );
            hostingState = 'certificate-review';
          } else {
            if (e instanceof LanderPreparationPending) continue;
            hostingState =
              e instanceof Error
                ? e.message.slice(0, 300)
                : 'Hosting is unavailable.';
          }
        }
        const step = await landerInternal(env, workspace, 'step', false, {
          job: work.job,
          ordinal: work.ordinal,
          generation: work.generation,
          ...(hosts ? { hosts } : {}),
          ...(hostingState ? { hostingState } : {}),
        });
        if (!step.ok) throw Error('Connection step unavailable');
        await step.body?.cancel();
      }
    } finally {
      await env.CONTROL_DB.prepare(
        'UPDATE lander_workspaces SET due_at=?,lease=NULL,lease_until=0 WHERE workspace_id=? AND lease=?',
      )
        // Cron runs every two minutes. A delay measured from the end of a
        // slice falls after the next tick and needlessly skips that scan.
        .bind((Math.floor(Date.now() / 120000) + 1) * 120000, workspace, lease)
        .run();
    }
  }
}
