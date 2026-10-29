import { beforeEach, describe, expect, it } from 'vitest';
import {
  provisionPortfolio,
  type ProvisioningEnv,
  type SetupJournal,
  type SetupState,
} from './provisioning';
import { tokenHash } from './crypto';
import { verifyGatewayRequest } from '../shared/gateway-proof';

const workspace = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const databaseId = '33333333-3333-4333-8333-333333333333';
let env: ProvisioningEnv, journal: SetupJournal, saved: SetupState | undefined;
let database: boolean,
  worker: boolean,
  lostCreate: boolean,
  lostUpload: boolean,
  failQualification: boolean;
let creates: number, uploads: number, admitted: boolean;
let module: string, schema: string, manifest: string;
const ok = (result: unknown) => Response.json({ success: true, result });
beforeEach(async () => {
  saved = undefined;
  database = false;
  worker = false;
  creates = 0;
  uploads = 0;
  lostCreate = false;
  lostUpload = false;
  failQualification = false;
  admitted = true;
  module = 'export default {fetch(){return new Response("fixture")}}';
  schema = JSON.stringify({ statements: ['CREATE TABLE docs (id TEXT)'] });
  manifest = JSON.stringify({
    engine: 'test-engine',
    sourceSha256: 'a'.repeat(64),
    moduleSha256: await tokenHash(module),
    bootstrapSha256: await tokenHash(schema),
    compatibilityDate: '2026-10-28',
    bindings: [],
  });
  journal = {
    get: async () => (saved ? structuredClone(saved) : undefined),
    put: async (state) => {
      saved = structuredClone(state);
    },
  };
  env = {
    CONTROL_DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => (admitted ? { eligible: 1 } : null),
        }),
      }),
    },
    ASSETS: {
      fetch: async (request: Request) =>
        new Response(
          new URL(request.url).pathname.endsWith('manifest.json')
            ? manifest
            : new URL(request.url).pathname.endsWith('schema.json')
              ? schema
              : module,
        ),
    },
    CF_ACCOUNT_ID: 'fixture-account',
    CF_DISPATCH_NAMESPACE: 'fixture-namespace',
    CF_PROVISIONING_TOKEN: 'fixture-token-never-log',
    TENANT_SECRETS_JSON: '{}',
    TEMPLATE_SHA256: await tokenHash(manifest),
    ASSET_SERVICE: 'fixture-assets',
    DISPATCHER: {
      get: () => ({
        fetch: async (request: Request) => {
          const proof = await verifyGatewayRequest(
            saved!.gateway,
            workspace,
            request,
          );
          expect(proof).not.toBeNull();
          expect(proof!.owner).toBe(
            new URL(request.url).pathname.endsWith('/getAppInfo') ? user : null,
          );
          if (failQualification)
            return new Response('unavailable', { status: 503 });
          const path = new URL(request.url).pathname;
          if (path.endsWith('/bootstrap')) {
            expect(await request.text()).toBe(schema);
            return Response.json({ ready: true });
          }
          if (path.endsWith('/getAppInfo'))
            return Response.json(
              { result: {} },
              {
                headers: {
                  'X-DomBot-Engine': 'test-engine',
                  'X-DomBot-Engine-Source': 'a'.repeat(64),
                },
              },
            );
          return Response.json({
            workspace,
            engine: 'test-engine',
            alarmAt: null,
            maintenance: {
              policy: true,
              paused: false,
              inspection: { state: 'empty' },
            },
          });
        },
      }),
    },
  } as unknown as ProvisioningEnv;
});
const transport: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  expect(new Headers(init.headers).get('Authorization')).toBe(
    'Bearer fixture-token-never-log',
  );
  if (url.pathname.endsWith('/d1/database') && init.method === 'POST') {
    creates++;
    database = true;
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'dombot-wfp-' + workspace,
    });
    if (lostCreate) {
      lostCreate = false;
      throw Error('connection lost after create');
    }
    return ok({ uuid: databaseId });
  }
  if (url.pathname.endsWith('/d1/database'))
    return ok(
      database ? [{ uuid: databaseId, name: 'dombot-wfp-' + workspace }] : [],
    );
  if (url.pathname.endsWith('/settings'))
    return ok({
      bindings: [
        { name: 'DB', id: databaseId },
        { name: 'DOMBOT_WORKSPACE_ID', text: workspace },
      ],
    });
  if (init.method === 'PUT') {
    uploads++;
    worker = true;
    const body = init.body as FormData;
    const metadata = JSON.parse(await (body.get('metadata') as Blob).text());
    expect(
      metadata.bindings.find((b: { name: string }) => b.name === 'DB').id,
    ).toBe(databaseId);
    expect(
      metadata.bindings.find(
        (b: { name: string }) => b.name === 'DOMBOT_SECRET',
      ).text,
    ).toBe(saved!.root);
    if (lostUpload) {
      lostUpload = false;
      throw Error('connection lost after upload');
    }
    return ok({ id: 'uploaded' });
  }
  // The details endpoint returns a JSON descriptor, including a null script
  // before content exists. Module bytes are a separate /content resource.
  if (!url.pathname.endsWith('/content'))
    return ok({
      dispatch_namespace: 'fixture-namespace',
      script: worker ? { id: 'dombot-wfp-' + workspace } : null,
    });
  return worker
    ? new Response(module)
    : new Response('missing', { status: 404 });
};
describe('durable portfolio provisioning', () => {
  it('creates and qualifies one isolated tenant without ever receiving customer credentials', async () => {
    const receipt = await provisionPortfolio(
      env,
      journal,
      workspace,
      user,
      transport,
    );
    expect(receipt).toMatchObject({
      workspace,
      databaseId,
      engine: 'test-engine',
      templateSha256: env.TEMPLATE_SHA256,
    });
    expect(creates).toBe(1);
    expect(uploads).toBe(1);
    expect(saved!.root).not.toBe(saved!.gateway);
  });
  it('reconciles a lost database-create response without creating a second database or rotating keys', async () => {
    lostCreate = true;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('connection lost');
    const original = structuredClone(saved!);
    await provisionPortfolio(env, journal, workspace, user, transport);
    expect(creates).toBe(1);
    expect(uploads).toBe(1);
    expect(saved!.root).toBe(original.root);
    expect(saved!.gateway).toBe(original.gateway);
  });
  it('reconciles a lost Worker upload response without another upload or new resources', async () => {
    lostUpload = true;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('connection lost');
    await provisionPortfolio(env, journal, workspace, user, transport);
    expect(creates).toBe(1);
    expect(uploads).toBe(1);
  });
  it('retains resources after qualification failure and resumes against the same database and keys', async () => {
    failQualification = true;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('qualification failed');
    const key = saved!.gateway;
    failQualification = false;
    await provisionPortfolio(env, journal, workspace, user, transport);
    expect(creates).toBe(1);
    expect(uploads).toBe(1);
    expect(saved!.gateway).toBe(key);
  });
  it('refuses to reuse an unexpected database or overwrite an existing Worker', async () => {
    database = true;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('Database identity conflict');
    database = false;
    saved = undefined;
    worker = true;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('Worker identity conflict');
    expect(uploads).toBe(0);
  });
  it('does no provider work for an unrequested or disabled account, and rejects a changed template during recovery', async () => {
    admitted = false;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('not admitted');
    expect(saved).toBeUndefined();
    expect(creates).toBe(0);
    admitted = true;
    lostCreate = true;
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('connection lost');
    manifest = manifest.replace('2026-10-28', '2026-10-27');
    env.TEMPLATE_SHA256 = await tokenHash(manifest);
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('identity or artifact changed');
    expect(creates).toBe(1);
  });
  it('rejects template overrides of protected identities before allocating resources', async () => {
    const value = JSON.parse(manifest);
    value.bindings = [{ name: 'DB', type: 'plain_text', text: 'foreign-db' }];
    manifest = JSON.stringify(value);
    env.TEMPLATE_SHA256 = await tokenHash(manifest);
    await expect(
      provisionPortfolio(env, journal, workspace, user, transport),
    ).rejects.toThrow('Unsafe template');
    expect(creates).toBe(0);
  });
  it('stops on an actual provider rate limit without retrying the mutation', async () => {
    let calls = 0;
    const limited: typeof fetch = async (input, init = {}) => {
      calls++;
      if (init.method === 'POST')
        return new Response('limited', { status: 429 });
      return transport(input, init);
    };
    await expect(
      provisionPortfolio(env, journal, workspace, user, limited),
    ).rejects.toThrow('(429)');
    expect(calls).toBe(2);
    expect(uploads).toBe(0);
  });
});
