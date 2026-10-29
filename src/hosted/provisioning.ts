import { z } from 'zod';
import { opaqueToken, tokenHash } from './crypto';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
import type { ProvisionReceipt } from './on-demand';

export interface ProvisioningEnv extends ProvisioningBindings {
  CF_PROVISIONING_TOKEN: string;
  TENANT_SECRETS_JSON: string;
}
const bindingSchema = z.union([
  z
    .object({
      type: z.literal('plain_text'),
      name: z.string(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('service'),
      name: z.string(),
      service: z.string(),
    })
    .strict(),
]);
export const templateSchema = z
  .object({
    engine: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    moduleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bootstrapSha256: z.string().regex(/^[a-f0-9]{64}$/),
    compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bindings: z.array(bindingSchema).max(40),
  })
  .strict();
export interface SetupState {
  workspace: string;
  user: string;
  template: string;
  root: string;
  gateway: string;
  databaseId?: string;
  createAttempted?: boolean;
  uploadAttempted?: boolean;
}
export interface SetupJournal {
  get(): Promise<SetupState | undefined>;
  put(state: SetupState): Promise<void>;
}
const reserved = new Set([
  'DB',
  'ASSETS',
  'DOMBOT_SECRET',
  'DOMBOT_GATEWAY_SECRET',
  'DOMBOT_WORKSPACE_ID',
  'DOMBOT_PUBLIC_BASE_PATH',
  'DOMBOT_AUTH',
  'WORKSPACE_COORDINATOR',
  'DOMBOT_PLATFORM_ALARMS',
  'DOMBOT_EMPTY_SLEEP',
  'DOMBOT_BOOTSTRAP_SHA256',
]);
const safeId = (id: string) => z.string().uuid().parse(id);

/** Exported for deterministic provider-failure tests. The DO serializes this
 * function; state is written before mutations and uncertain writes are read back. */
export async function provisionPortfolio(
  env: ProvisioningEnv,
  journal: SetupJournal,
  workspace: string,
  user: string,
  transport: typeof fetch = fetch,
): Promise<ProvisionReceipt> {
  safeId(workspace);
  safeId(user);
  const eligible = await env.CONTROL_DB.prepare(
    'SELECT 1 FROM pending_workspaces q JOIN workspaces w ON w.id=q.workspace_id JOIN users u ON u.workspace_id=w.id WHERE q.workspace_id=? AND u.id=? AND w.enabled=1 AND q.requested_at IS NOT NULL AND q.activated_at IS NULL AND NOT EXISTS(SELECT 1 FROM platform_workspaces p WHERE p.workspace_id=w.id)',
  )
    .bind(workspace, user)
    .first();
  if (!eligible) throw Error('Setup is not admitted');
  const readAsset = async (path: string) => {
    const response = await env.ASSETS.fetch(
      new Request('https://assets.internal/_provision/' + path),
    );
    if (!response.ok) throw Error('Setup artifact unavailable');
    const bytes = await response.text();
    if (bytes.length > 10000000) throw Error('Setup artifact too large');
    return bytes;
  };
  const manifestText = await readAsset('manifest.json');
  if ((await tokenHash(manifestText)) !== env.TEMPLATE_SHA256)
    throw Error('Setup artifact changed');
  const template = templateSchema.parse(JSON.parse(manifestText));
  const names = template.bindings.map((b) => b.name);
  if (
    new Set(names).size !== names.length ||
    names.some((n) => reserved.has(n))
  )
    throw Error('Unsafe template bindings');
  const secrets = z
    .record(z.string().min(1))
    .parse(JSON.parse(env.TENANT_SECRETS_JSON));
  if (
    Object.keys(secrets).some(
      (name) =>
        reserved.has(name) ||
        names.includes(name) ||
        !/^DOMBOT_(?:MANAGED_|PROXY_)/.test(name),
    )
  )
    throw Error('Unsafe tenant secrets');
  let state = await journal.get();
  if (!state) {
    state = {
      workspace,
      user,
      template: env.TEMPLATE_SHA256,
      root: btoa(
        String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
      ),
      gateway: opaqueToken(),
    };
    await journal.put(state);
  }
  if (
    state.workspace !== workspace ||
    state.user !== user ||
    state.template !== env.TEMPLATE_SHA256
  )
    throw Error('Setup identity or artifact changed');
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await transport(
      'https://api.cloudflare.com/client/v4/accounts/' +
        env.CF_ACCOUNT_ID +
        path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          Authorization: 'Bearer ' + env.CF_PROVISIONING_TOKEN,
        },
        signal: AbortSignal.timeout(45000),
      },
    );
    if (response.status === 404 && (!init.method || init.method === 'GET')) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok)
      throw Error(
        'Provisioning provider unavailable (' + response.status + ')',
      );
    return response;
  };
  const json = async <T>(path: string, init: RequestInit = {}) => {
    const response = await api(path, init);
    if (!response) return null;
    const data = (await response.json()) as { success: boolean; result: T };
    if (!data.success) throw Error('Provisioning provider rejected request');
    return data.result;
  };
  const name = 'dombot-wfp-' + workspace;
  if (!state.databaseId) {
    const existing = await json<{ uuid: string; name: string }[]>(
      '/d1/database?name=' + encodeURIComponent(name),
    );
    const matches = (existing ?? []).filter((db) => db.name === name);
    if (matches.length > 1 || (matches.length && !state.createAttempted))
      throw Error('Database identity conflict');
    if (matches.length) state.databaseId = safeId(matches[0].uuid);
    else {
      state.createAttempted = true;
      await journal.put(state);
      const created = await json<{ uuid: string }>('/d1/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!created) throw Error('Database receipt missing');
      state.databaseId = safeId(created.uuid);
    }
    await journal.put(state);
  }
  const scriptPath =
    '/workers/dispatch/namespaces/' +
    encodeURIComponent(env.CF_DISPATCH_NAMESPACE) +
    '/scripts/' +
    name;
  const module = await readAsset('tenant.mjs');
  if ((await tokenHash(module)) !== template.moduleSha256)
    throw Error('Tenant artifact changed');
  const previous = await api(scriptPath + '/content');
  if (previous) {
    if (!state.uploadAttempted) throw Error('Worker identity conflict');
    let source: string;
    if (previous.headers.get('content-type')?.includes('multipart/form-data')) {
      const parts = [...(await previous.formData()).entries()].filter(
        ([key]) => key === 'tenant.mjs',
      );
      if (parts.length !== 1) throw Error('Worker content unavailable');
      const value = parts[0][1];
      source = typeof value === 'string' ? value : await value.text();
    } else source = await previous.text();
    const settings = await json<{
      bindings: { name: string; id?: string; text?: string }[];
    }>(scriptPath + '/settings');
    if (
      (await tokenHash(source)) !== template.moduleSha256 ||
      settings?.bindings.find((b) => b.name === 'DB')?.id !==
        state.databaseId ||
      settings?.bindings.find((b) => b.name === 'DOMBOT_WORKSPACE_ID')?.text !==
        workspace
    )
      throw Error('Worker identity conflict');
  } else {
    state.uploadAttempted = true;
    await journal.put(state);
    const bindings = [
      ...template.bindings,
      ...Object.entries(secrets).map(([name, text]) => ({
        name,
        text,
        type: 'secret_text',
      })),
      { name: 'DB', type: 'd1', id: state.databaseId },
      { name: 'ASSETS', type: 'service', service: env.ASSET_SERVICE },
      {
        name: 'WORKSPACE_COORDINATOR',
        type: 'durable_object_namespace',
        class_name: 'WorkspaceCoordinator',
      },
      ...Object.entries({
        DOMBOT_AUTH: 'gateway',
        DOMBOT_WORKSPACE_ID: workspace,
        DOMBOT_PUBLIC_BASE_PATH: '/w/' + workspace,
        DOMBOT_PLATFORM_ALARMS: 'true',
        DOMBOT_EMPTY_SLEEP: 'true',
        DOMBOT_BOOTSTRAP_SHA256: template.bootstrapSha256,
      }).map(([name, text]) => ({ name, text, type: 'plain_text' })),
      { name: 'DOMBOT_SECRET', type: 'secret_text', text: state.root },
      {
        name: 'DOMBOT_GATEWAY_SECRET',
        type: 'secret_text',
        text: state.gateway,
      },
    ];
    const body = new FormData();
    body.append(
      'metadata',
      new Blob(
        [
          JSON.stringify({
            main_module: 'tenant.mjs',
            compatibility_date: template.compatibilityDate,
            compatibility_flags: ['nodejs_compat'],
            bindings,
            migrations: {
              new_tag: 'workspace-coordinator-v1',
              steps: [{ new_sqlite_classes: ['WorkspaceCoordinator'] }],
            },
            observability: {
              enabled: true,
              head_sampling_rate: 1,
              logs: { enabled: true, invocation_logs: false },
              traces: { enabled: false },
            },
          }),
        ],
        { type: 'application/json' },
      ),
    );
    body.append(
      'tenant.mjs',
      new Blob([module], { type: 'application/javascript+module' }),
      'tenant.mjs',
    );
    await json(scriptPath, { method: 'PUT', body });
  }
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
      await signGatewayRequest(state!.gateway, workspace, owner, request),
    );
    const response = await env.DISPATCHER.get(name).fetch(request);
    if (!response.ok) throw Error('Tenant qualification failed');
    return response;
  };
  const schema = await readAsset('schema.json');
  if ((await tokenHash(schema)) !== template.bootstrapSha256)
    throw Error('Schema artifact changed');
  const bootstrap = (await (
    await send('/platform-internal/bootstrap', schema)
  ).json()) as { ready: boolean };
  if (!bootstrap.ready) throw Error('Tenant schema is not ready');
  const info = await send(
    '/api/getAppInfo',
    JSON.stringify({ args: [] }),
    user,
  );
  if (
    info.headers.get('X-DomBot-Engine') !== template.engine ||
    info.headers.get('X-DomBot-Engine-Source') !== template.sourceSha256
  )
    throw Error('Tenant provenance mismatch');
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
    health.workspace !== workspace ||
    health.engine !== template.engine ||
    health.alarmAt !== null ||
    !health.maintenance.policy ||
    health.maintenance.paused ||
    health.maintenance.inspection.state !== 'empty'
  )
    throw Error('Tenant idle qualification failed');
  return {
    workspace,
    databaseId: state.databaseId,
    gatewayKey: state.gateway,
    engine: template.engine,
    templateSha256: env.TEMPLATE_SHA256,
  };
}
