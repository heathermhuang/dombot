import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createProductionImportQa,
  readQaRun,
  type QaRun,
} from './production-import-qa';
import { tokenHash } from './crypto';

let mf: Miniflare, db: D1Database, client: Fetcher, run: QaRun;
let database = false,
  uploaded = false,
  creates = 0,
  uploads = 0;
let loseCreate = true;
let moduleRequested = false;
let releaseModule: () => void;
const moduleGate = new Promise<void>((resolve) => {
  releaseModule = resolve;
});
const databaseId = '33333333-3333-4333-8333-333333333333';
const module = 'export default {fetch(){return new Response("fixture")}}';
const schema = JSON.stringify({ statements: [] });
const ok = (result: unknown) => Response.json({ success: true, result });
beforeAll(async () => {
  const manifest = JSON.stringify({
    engine: 'fixture',
    sourceSha256: 'a'.repeat(64),
    moduleSha256: await tokenHash(module),
    bootstrapSha256: await tokenHash(schema),
    compatibilityDate: '2026-10-01',
    bindings: [
      { type: 'service', name: 'DOMBOT_PUBLIC_DIRECTORY', service: 'fixture' },
    ],
  });
  const script = (
    await build({
      stdin: {
        contents: `import {PortfolioSetup,Provisioner} from './src/hosted/provisioner';
        export {Provisioner};
        export class TestSetup extends PortfolioSetup {
          received=0;
          provision(...args){this.received++;return super.provision(...args);}
          constructor(ctx,env){super(ctx,{...env,DISPATCHER:{get:()=>env.TENANT}});}
          reset(){this.ctx.abort('Synthetic reset after journal persistence');}
          async inspect(){const s=await this.ctx.storage.get('setup');return {received:this.received,diagnostic:await this.diagnostics(),keys:(await this.ctx.storage.list()).size,alarm:await this.ctx.storage.getAlarm(),identity:s?{databaseId:s.databaseId,root:s.root,gateway:s.gateway}:null};}
        }
        export default {async fetch(r,env){const b=await r.json();try{return Response.json(await env.SETUPS.get(env.SETUPS.idFromName(b.workspace))[b.reset?'reset':'inspect']());}catch{return new Response('reset',{status:503});}}};`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      external: ['cloudflare:*', 'node:*'],
    })
  ).outputFiles[0].text;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'client',
          modules: true,
          compatibilityDate: '2026-10-01',
          script: `export default {async fetch(r,env){const b=await r.json();try{return Response.json(await env.PROVISIONER[b.method](...b.args));}catch(e){return Response.json({error:e.message},{status:503});}}};`,
          serviceBindings: {
            PROVISIONER: { name: 'provisioner', entrypoint: 'Provisioner' },
          },
        },
        {
          name: 'provisioner',
          modules: true,
          script,
          compatibilityDate: '2026-10-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { CONTROL_DB: 'provisioning-rpc' },
          durableObjects: {
            SETUPS: { className: 'TestSetup', useSQLite: true },
          },
          bindings: {
            CF_ACCOUNT_ID: 'fixture-account',
            CF_DISPATCH_NAMESPACE: 'fixture-namespace',
            CF_PROVISIONING_TOKEN: 'fixture-secret',
            TENANT_SECRETS_JSON: '{}',
            TEMPLATE_SHA256: await tokenHash(manifest),
            ASSET_SERVICE: 'fixture',
          },
          serviceBindings: {
            ASSETS: async (r) => {
              if (new URL(r.url).pathname.endsWith('tenant.mjs')) {
                moduleRequested = true;
                await moduleGate;
              }
              return new Response(
                new URL(r.url).pathname.endsWith('manifest.json')
                  ? manifest
                  : new URL(r.url).pathname.endsWith('schema.json')
                    ? schema
                    : module,
              );
            },
            TENANT: (r) => {
              const path = new URL(r.url).pathname;
              if (path.endsWith('/bootstrap'))
                return Response.json({ ready: true });
              if (path.endsWith('/getAppInfo'))
                return Response.json(
                  { result: {} },
                  {
                    headers: {
                      'X-DomBot-Engine': 'fixture',
                      'X-DomBot-Engine-Source': 'a'.repeat(64),
                    },
                  },
                );
              return Response.json({
                workspace: run.workspace_id,
                engine: 'fixture',
                alarmAt: null,
                maintenance: { policy: true, inspection: { state: 'empty' } },
              });
            },
          },
          outboundService: async (r) => {
            const path = new URL(r.url).pathname;
            if (path.endsWith('/d1/database')) {
              if (r.method === 'POST') {
                creates++;
                database = true;
                if (loseCreate) {
                  loseCreate = false;
                  throw Error('fixture lost database response');
                }
                return ok({ uuid: databaseId });
              }
              return ok(
                database
                  ? [
                      {
                        uuid: databaseId,
                        name: 'dombot-wfp-' + run.workspace_id,
                      },
                    ]
                  : [],
              );
            }
            if (path.endsWith('/d1/database/' + databaseId)) {
              if (r.method === 'DELETE') {
                database = false;
                return ok(null);
              }
              return database
                ? ok({
                    uuid: databaseId,
                    name: 'dombot-wfp-' + run.workspace_id,
                    created_at: new Date().toISOString(),
                  })
                : new Response('', { status: 404 });
            }
            if (path.endsWith('/query')) return ok([{ results: [] }]);
            if (path.endsWith('/settings'))
              return ok({
                bindings: [
                  { name: 'DB', id: databaseId },
                  { name: 'DOMBOT_WORKSPACE_ID', text: run.workspace_id },
                  {
                    name: 'WORKSPACE_COORDINATOR',
                    namespace_id: 'f'.repeat(32),
                  },
                ],
              });
            if (r.method === 'PUT') {
              uploads++;
              uploaded = true;
              return ok({ id: 'fixture' });
            }
            if (r.method === 'DELETE') {
              uploaded = false;
              return ok(null);
            }
            if (path.endsWith('/scripts/dombot-wfp-' + run.workspace_id))
              return ok({ script: { created_on: new Date().toISOString() } });
            return uploaded
              ? new Response(module)
              : new Response('', { status: 404 });
          },
        },
      ],
    }),
  );
  db = (await mf.getD1Database(
    'CONTROL_DB',
    'provisioner',
  )) as unknown as D1Database;
  client = (await mf.getWorker('client')) as unknown as Fetcher;
  for (const name of readdirSync('hosted/migrations')
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('hosted/migrations/' + name, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  run = (
    await createProductionImportQa(
      db,
      'fixture-pepper'.repeat(4),
      {
        template: await tokenHash(manifest),
        module: await tokenHash(module),
        bootstrap: await tokenHash(schema),
        engine: 'fixture',
        source: 'a'.repeat(64),
        account: 'fixture-account',
        namespace: 'fixture-namespace',
      },
      'b'.repeat(40),
    )
  ).run;
  await db
    .prepare(
      'UPDATE pending_workspaces SET requested_at=? WHERE workspace_id=?',
    )
    .bind(Date.now(), run.workspace_id)
    .run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
async function call(method: string, args: unknown[]) {
  const r = await client.fetch('http://localhost/check', {
    method: 'POST',
    body: JSON.stringify({ method, args }),
  });
  return {
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  };
}
async function inspect() {
  const worker = await mf.getWorker('provisioner');
  return (await (
    await worker.fetch('http://localhost/inspect', {
      method: 'POST',
      body: JSON.stringify({ workspace: run.workspace_id }),
    })
  ).json()) as {
    keys: number;
    alarm: number | null;
    identity: unknown;
    diagnostic?: { operationId: string; phase: string; code: string };
    received: number;
  };
}
it('recovers through service RPC and the setup queue after a lost create, with the same keys and one pair', async () => {
  expect((await call('armQa', [run.run_id])).status).toBe(200);
  const operationId = crypto.randomUUID();
  const first = await call('provision', [
    run.workspace_id,
    run.user_id,
    operationId,
  ]);
  expect(first.status).toBe(503);
  expect(creates).toBe(1);
  const original = (await inspect()).identity;
  const diagnostic = (await inspect()).diagnostic;
  expect(diagnostic).toMatchObject({
    operationId,
    phase: 'database-create',
    code: 'setup_failed',
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /fixture-secret|root|gateway|fixture lost/,
  );
  const worker = await mf.getWorker('provisioner');
  expect(
    (
      await worker.fetch('http://localhost/reset', {
        method: 'POST',
        body: JSON.stringify({ workspace: run.workspace_id, reset: true }),
      })
    ).status,
  ).toBe(503);
  expect((await inspect()).identity).toEqual(original);
  const pending = Promise.all(
    Array.from({ length: 8 }, () =>
      call('provision', [run.workspace_id, run.user_id]),
    ),
  );
  await vi.waitFor(async () => {
    expect(moduleRequested).toBe(true);
    expect((await inspect()).received).toBe(8);
  });
  const cleanup = call('cleanupQa', [run.run_id]);
  // The provider read remains in progress. Cleanup cannot overtake it or clear its journal.
  expect((await inspect()).diagnostic?.phase).toBe('module-read');
  expect((await readQaRun(db, run.run_id))?.state).toBe('active');
  releaseModule!();
  const results = await pending;
  expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
  expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  expect((await inspect()).identity).toMatchObject(original!);
  expect(creates).toBe(1);
  expect(uploads).toBe(1);
  expect((await cleanup).status).toBe(200);
  expect((await readQaRun(db, run.run_id))?.state).toBe('complete');
  expect(await inspect()).toMatchObject({
    keys: 0,
    alarm: null,
    identity: null,
  });
  expect(
    (await call('provision', [run.workspace_id, run.user_id])).status,
  ).toBe(503);
  expect(await inspect()).toMatchObject({
    keys: 0,
    alarm: null,
    identity: null,
  });
  expect(database).toBe(false);
  expect(uploaded).toBe(false);
}, 15000);
