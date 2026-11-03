import { beforeEach, expect, it } from 'vitest';
import { recoverPortfolio, type RecoveryPlan } from './provisioning-recovery';
import { tokenHash } from './crypto';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import type { ProvisioningEnv, SetupState } from './provisioning';

let plan: RecoveryPlan, env: ProvisioningEnv, state: SetupState;
let manifest: string, module: string, schema: string, eligible: boolean;
let bindings: {
  name: string;
  type: string;
  text?: string;
  id?: string;
  namespace_id?: string;
  service?: string;
}[];
let engine: string,
  idle: string,
  alarm: number | null,
  providerWrites: number,
  tenantCalls: string[];
beforeEach(async () => {
  module = 'export default {fetch(){return new Response("current")}}';
  schema = JSON.stringify({
    statements: ['CREATE TABLE original_schema(id TEXT)'],
  });
  manifest = JSON.stringify({
    engine: 'current',
    sourceSha256: 'a'.repeat(64),
    moduleSha256: await tokenHash(module),
    bootstrapSha256: 'b'.repeat(64),
    compatibilityDate: '2026-10-01',
    bindings: [
      { type: 'service', name: 'DOMBOT_PUBLIC_DIRECTORY', service: 'gateway' },
    ],
  });
  plan = {
    workspace: '11111111-1111-4111-8111-111111111111',
    user: '22222222-2222-4222-8222-222222222222',
    databaseId: '33333333-3333-4333-8333-333333333333',
    coordinatorNamespace: 'c'.repeat(32),
    originalTemplate: 'd'.repeat(64),
    originalBootstrap: await tokenHash(schema),
    currentTemplate: await tokenHash(manifest),
  };
  state = {
    workspace: plan.workspace,
    user: plan.user,
    databaseId: plan.databaseId,
    template: plan.originalTemplate,
    root: 'original-root-stays-private',
    gateway: 'e'.repeat(64),
    createAttempted: true,
    uploadAttempted: true,
  };
  eligible = true;
  engine = 'current';
  idle = 'empty';
  alarm = null;
  providerWrites = 0;
  tenantCalls = [];
  bindings = [
    { name: 'DB', type: 'd1', id: plan.databaseId },
    {
      name: 'WORKSPACE_COORDINATOR',
      type: 'durable_object_namespace',
      namespace_id: plan.coordinatorNamespace,
    },
    { name: 'DOMBOT_WORKSPACE_ID', type: 'plain_text', text: plan.workspace },
    {
      name: 'DOMBOT_PUBLIC_BASE_PATH',
      type: 'plain_text',
      text: '/w/' + plan.workspace,
    },
    {
      name: 'DOMBOT_BOOTSTRAP_SHA256',
      type: 'plain_text',
      text: plan.originalBootstrap,
    },
    { name: 'DOMBOT_SECRET', type: 'secret_text' },
    { name: 'DOMBOT_GATEWAY_SECRET', type: 'secret_text' },
    { name: 'DOMBOT_PUBLIC_DIRECTORY', type: 'service', service: 'gateway' },
  ];
  env = {
    RECOVERY_PLAN_SHA256: await tokenHash(JSON.stringify(plan)),
    TEMPLATE_SHA256: plan.currentTemplate,
    CONTROL_DB: {
      prepare: (sql: string) => {
        expect(sql).toContain('closure_requests');
        return {
          bind: (...args: string[]) => {
            expect(args).toEqual([plan.workspace, plan.user]);
            return { first: async () => (eligible ? { eligible: 1 } : null) };
          },
        };
      },
    },
    ASSETS: {
      fetch: async (request: Request) =>
        new Response(
          new URL(request.url).pathname.endsWith('manifest.json')
            ? manifest
            : schema,
        ),
    },
    CF_ACCOUNT_ID: 'account',
    CF_DISPATCH_NAMESPACE: 'namespace',
    CF_PROVISIONING_TOKEN: 'fixture-not-a-real-token',
    DISPATCHER: {
      get: (name: string) => {
        expect(name).toBe('dombot-wfp-' + plan.workspace);
        return {
          fetch: async (request: Request) => {
            const path = new URL(request.url).pathname;
            tenantCalls.push(path);
            const proof = await verifyGatewayRequest(
              state.gateway,
              plan.workspace,
              request,
            );
            expect(proof).not.toBeNull();
            expect(proof?.owner).toBe(
              path.endsWith('getAppInfo') ? plan.user : null,
            );
            if (path.endsWith('bootstrap')) {
              expect(await request.text()).toBe(schema);
              return Response.json({ ready: true });
            }
            if (path.endsWith('getAppInfo'))
              return Response.json(
                { result: {} },
                {
                  headers: {
                    'X-DomBot-Engine': engine,
                    'X-DomBot-Engine-Source': 'a'.repeat(64),
                  },
                },
              );
            return Response.json({
              workspace: plan.workspace,
              engine,
              alarmAt: alarm,
              maintenance: { policy: true, inspection: { state: idle } },
            });
          },
        };
      },
    },
  } as unknown as ProvisioningEnv;
});
const transport: typeof fetch = async (input, init) => {
  if (init?.method && init.method !== 'GET') providerWrites++;
  if (String(input).endsWith('/settings'))
    return Response.json({ success: true, result: { bindings } });
  const parts = new FormData();
  parts.append('worker.mjs', new Blob([module]), 'worker.mjs');
  return new Response(parts);
};
it('requalifies the original bootstrap and key without mutating the saved setup or provider resources', async () => {
  const before = structuredClone(state);
  const receipt = await recoverPortfolio(env, state, plan, transport);
  expect(receipt).toEqual({
    workspace: plan.workspace,
    databaseId: plan.databaseId,
    gatewayKey: state.gateway,
    engine: 'current',
    templateSha256: plan.currentTemplate,
  });
  expect(state).toEqual(before);
  expect(providerWrites).toBe(0);
  expect(tenantCalls).toEqual([
    '/platform-internal/bootstrap',
    '/api/getAppInfo',
    '/platform-internal/reconcile',
  ]);
});
it('is disabled by default and binds approval to the exact plan and live template', async () => {
  const approved = env.RECOVERY_PLAN_SHA256;
  env.RECOVERY_PLAN_SHA256 = undefined;
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'not authorized',
  );
  env.RECOVERY_PLAN_SHA256 = approved;
  await expect(
    recoverPortfolio(
      env,
      state,
      { ...plan, originalTemplate: 'f'.repeat(64) },
      transport,
    ),
  ).rejects.toThrow('not authorized');
  env.TEMPLATE_SHA256 = 'f'.repeat(64);
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'not authorized',
  );
  expect(tenantCalls).toEqual([]);
});
it('refuses changed saved identities, previously admitted setups and closure races before runtime calls', async () => {
  await expect(
    recoverPortfolio(env, { ...state, user: plan.workspace }, plan, transport),
  ).rejects.toThrow('identity changed');
  await expect(
    recoverPortfolio(
      env,
      { ...state, databaseId: plan.workspace },
      plan,
      transport,
    ),
  ).rejects.toThrow('identity changed');
  await expect(
    recoverPortfolio(
      env,
      { ...state, uploadAttempted: false },
      plan,
      transport,
    ),
  ).rejects.toThrow('identity changed');
  eligible = false;
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'not admitted',
  );
  expect(tenantCalls).toEqual([]);
});
it('refuses changed code, namespace, database or bootstrap instead of overwriting resources', async () => {
  module += 'changed';
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'resource identity changed',
  );
  module = 'export default {fetch(){return new Response("current")}}';
  for (const name of [
    'DB',
    'WORKSPACE_COORDINATOR',
    'DOMBOT_BOOTSTRAP_SHA256',
  ]) {
    const index = bindings.findIndex((b) => b.name === name),
      old = bindings[index];
    bindings[index] = {
      ...old,
      id: 'wrong',
      namespace_id: 'wrong',
      text: 'wrong',
    };
    await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
      'resource identity changed',
    );
    bindings[index] = old;
  }
  expect(providerWrites).toBe(0);
  expect(tenantCalls).toEqual([]);
});
it('requires current native provenance and strictly empty, alarm-free maintenance', async () => {
  engine = 'old';
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'provenance mismatch',
  );
  engine = 'current';
  idle = 'unknown';
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'idle qualification failed',
  );
  idle = 'empty';
  alarm = Date.now();
  await expect(recoverPortfolio(env, state, plan, transport)).rejects.toThrow(
    'idle qualification failed',
  );
});
