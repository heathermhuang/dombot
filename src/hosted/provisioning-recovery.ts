import { z } from 'zod';
import { tokenHash } from './crypto';
import {
  templateSchema,
  type ProvisioningEnv,
  type SetupState,
} from './provisioning';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
import type { ProvisionReceipt } from './on-demand';
import { readProvisioningArtifact } from './provisioning-artifact';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const recoveryPlanSchema = z
  .object({
    workspace: z.string().uuid(),
    user: z.string().uuid(),
    databaseId: z.string().uuid(),
    coordinatorNamespace: z.string().regex(/^[a-f0-9]{32}$/),
    originalTemplate: digest,
    originalBootstrap: digest,
    currentTemplate: digest,
  })
  .strict();
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>;

/** Requalify an operator-upgraded, never-admitted setup. No provider writes,
 * root-key export, journal replacement or admission occurs here. Ordinary retries
 * keep their strict template guard. The gateway's existing activation commits
 * the returned receipt; the operator disables this one-plan capability afterward. */
export async function recoverPortfolio(
  env: ProvisioningEnv,
  state: SetupState | undefined,
  input: unknown,
  transport: typeof fetch = fetch,
): Promise<ProvisionReceipt> {
  const plan = recoveryPlanSchema.parse(input);
  if (
    !env.RECOVERY_PLAN_SHA256 ||
    (await tokenHash(JSON.stringify(plan))) !== env.RECOVERY_PLAN_SHA256 ||
    plan.currentTemplate !== env.TEMPLATE_SHA256
  )
    throw Error('Recovery plan is not authorized');
  if (
    !state ||
    state.workspace !== plan.workspace ||
    state.user !== plan.user ||
    state.databaseId !== plan.databaseId ||
    state.template !== plan.originalTemplate ||
    !state.createAttempted ||
    !state.uploadAttempted
  )
    throw Error('Recovery setup identity changed');
  const eligible = await env.CONTROL_DB.prepare(
    'SELECT 1 FROM pending_workspaces q JOIN workspaces w ON w.id=q.workspace_id JOIN users u ON u.workspace_id=w.id WHERE q.workspace_id=? AND u.id=? AND w.enabled=1 AND q.requested_at IS NOT NULL AND q.activated_at IS NULL AND NOT EXISTS(SELECT 1 FROM platform_workspaces p WHERE p.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
  )
    .bind(plan.workspace, plan.user)
    .first();
  if (!eligible) throw Error('Recovery is not admitted');
  const asset = (path: string) =>
    readProvisioningArtifact(env.ASSETS, path, 'Recovery');
  const manifest = await asset('_provision/manifest.json');
  if ((await tokenHash(manifest)) !== plan.currentTemplate)
    throw Error('Recovery artifact changed');
  const template = templateSchema.parse(JSON.parse(manifest));
  const schema = await asset('_recovery/' + plan.originalBootstrap + '.json');
  if ((await tokenHash(schema)) !== plan.originalBootstrap)
    throw Error('Recovery bootstrap changed');
  const prefix =
    '/workers/dispatch/namespaces/' +
    encodeURIComponent(env.CF_DISPATCH_NAMESPACE) +
    '/scripts/dombot-wfp-' +
    plan.workspace;
  const get = async (suffix: string) => {
    const response = await transport(
      'https://api.cloudflare.com/client/v4/accounts/' +
        env.CF_ACCOUNT_ID +
        prefix +
        suffix,
      {
        headers: { Authorization: 'Bearer ' + env.CF_PROVISIONING_TOKEN },
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!response.ok) throw Error('Recovery provider read failed');
    return response;
  };
  const content = await get('/content');
  let module: string;
  if (content.headers.get('content-type')?.includes('multipart/form-data')) {
    const parts = [...(await content.formData()).entries()].filter(([name]) =>
      /\.m?js$/.test(name),
    );
    if (parts.length !== 1) throw Error('Recovery module unavailable');
    const value = parts[0][1];
    module = typeof value === 'string' ? value : await value.text();
  } else module = await content.text();
  const settings = (await (await get('/settings')).json()) as {
    success: boolean;
    result: {
      bindings: {
        name: string;
        type: string;
        id?: string;
        namespace_id?: string;
        text?: string;
        service?: string;
      }[];
    };
  };
  const bindings = settings.result?.bindings ?? [];
  const binding = (name: string) => bindings.find((b) => b.name === name);
  const directory = template.bindings.find(
    (b) => b.name === 'DOMBOT_PUBLIC_DIRECTORY',
  );
  if (
    !settings.success ||
    (await tokenHash(module)) !== template.moduleSha256 ||
    binding('DB')?.id !== plan.databaseId ||
    binding('WORKSPACE_COORDINATOR')?.namespace_id !==
      plan.coordinatorNamespace ||
    binding('DOMBOT_WORKSPACE_ID')?.text !== plan.workspace ||
    binding('DOMBOT_PUBLIC_BASE_PATH')?.text !== '/w/' + plan.workspace ||
    binding('DOMBOT_BOOTSTRAP_SHA256')?.text !== plan.originalBootstrap ||
    binding('DOMBOT_SECRET')?.type !== 'secret_text' ||
    binding('DOMBOT_GATEWAY_SECRET')?.type !== 'secret_text' ||
    directory?.type !== 'service' ||
    binding('DOMBOT_PUBLIC_DIRECTORY')?.service !== directory.service
  )
    throw Error('Recovery resource identity changed');
  const send = async (
    path: string,
    body?: string,
    owner: string | null = null,
  ) => {
    const request = new Request('https://workspace.internal' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://workspace.internal',
      },
      body,
    });
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(state.gateway, plan.workspace, owner, request),
    );
    const response = await env.DISPATCHER.get(
      'dombot-wfp-' + plan.workspace,
    ).fetch(request);
    if (!response.ok) throw Error('Recovery tenant qualification failed');
    return response;
  };
  // Replays the original receipt, never the new template's incompatible bootstrap.
  if (
    !(
      (await (await send('/platform-internal/bootstrap', schema)).json()) as {
        ready: boolean;
      }
    ).ready
  )
    throw Error('Recovery bootstrap is not ready');
  const info = await send(
    '/api/getAppInfo',
    JSON.stringify({ args: [] }),
    plan.user,
  );
  if (
    info.headers.get('X-DomBot-Engine') !== template.engine ||
    info.headers.get('X-DomBot-Engine-Source') !== template.sourceSha256
  )
    throw Error('Recovery provenance mismatch');
  await info.body?.cancel();
  const health = (await (
    await send('/platform-internal/reconcile')
  ).json()) as {
    workspace: string;
    engine: string;
    alarmAt: number | null;
    maintenance: {
      policy: boolean;
      paused?: boolean;
      inspection: { state: string };
    };
  };
  if (
    health.workspace !== plan.workspace ||
    health.engine !== template.engine ||
    health.alarmAt !== null ||
    !health.maintenance.policy ||
    health.maintenance.paused ||
    health.maintenance.inspection.state !== 'empty'
  )
    throw Error('Recovery idle qualification failed');
  return {
    workspace: plan.workspace,
    databaseId: plan.databaseId,
    gatewayKey: state.gateway,
    engine: template.engine,
    templateSha256: plan.currentTemplate,
  };
}
