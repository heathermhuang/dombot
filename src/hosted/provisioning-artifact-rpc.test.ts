import { afterEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { createProductionImportQa, readQaRun } from './production-import-qa';
import { tokenHash } from './crypto';

let mf: Miniflare | undefined;
afterEach(async () => {
  await mf?.dispose();
  mf = undefined;
});
it.each(['headers', 'body'] as const)(
  'native RPC cancels stalled artifact %s, releases cleanup and cannot write later',
  async (kind) => {
    const module = 'export default {fetch(){return new Response("fixture")}}';
    const schema = JSON.stringify({ statements: [] });
    const manifest = JSON.stringify({
      engine: 'fixture',
      sourceSha256: 'a'.repeat(64),
      moduleSha256: await tokenHash(module),
      bootstrapSha256: await tokenHash(schema),
      compatibilityDate: '2026-10-01',
      bindings: [
        {
          type: 'service',
          name: 'DOMBOT_PUBLIC_DIRECTORY',
          service: 'fixture',
        },
      ],
    });
    const script = (
      await build({
        stdin: {
          contents: `import {PortfolioSetup,Provisioner} from './src/hosted/provisioner';export {Provisioner};export class TestSetup extends PortfolioSetup {async inspect(){return{keys:(await this.ctx.storage.list()).size,alarm:await this.ctx.storage.getAlarm()};}}export default {async fetch(r,env){const b=await r.json();return Response.json(await env.SETUPS.get(env.SETUPS.idFromName(b.workspace)).inspect());}};`,
          resolveDir: process.cwd(),
        },
        // Exercise the real Worker implementation with a deterministic short test
        // deadline. Production keeps the 45-second immutable-artifact read bound.
        plugins: [
          {
            name: 'fault-deadline',
            setup(builder) {
              builder.onLoad(
                { filter: /provisioning-artifact\.ts$/ },
                ({ path }) => {
                  const source = readFileSync(path, 'utf8');
                  expect(source).toContain(
                    'const ARTIFACT_READ_TIMEOUT_MS = 45000;',
                  );
                  return {
                    contents: source.replace(
                      'const ARTIFACT_READ_TIMEOUT_MS = 45000;',
                      'const ARTIFACT_READ_TIMEOUT_MS = 1000;',
                    ),
                    loader: 'ts',
                  };
                },
              );
            },
          },
        ],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        external: ['cloudflare:*', 'node:*'],
      })
    ).outputFiles[0].text;
    let database = false,
      creates = 0,
      uploads = 0,
      late!: () => void;
    const databaseId = '33333333-3333-4333-8333-333333333333';
    const ok = (result: unknown) => Response.json({ success: true, result });
    mf = new Miniflare(
      convertV4MiniflareOptions({
        cf: false,
        workers: [
          {
            name: 'client',
            modules: true,
            compatibilityDate: '2026-10-01',
            script: `export default {async fetch(r,env){const b=await r.json();try{return Response.json(await env.PROVISIONER[b.method](...b.args));}catch{return Response.json({failed:true},{status:503});}}};`,
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
            d1Databases: { CONTROL_DB: 'artifact-timeout' },
            durableObjects: {
              SETUPS: { className: 'TestSetup', useSQLite: true },
            },
            bindings: {
              CF_ACCOUNT_ID: 'fixture-account',
              CF_DISPATCH_NAMESPACE: 'fixture-namespace',
              CF_PROVISIONING_TOKEN: 'fixture-not-real',
              TENANT_SECRETS_JSON: '{}',
              TEMPLATE_SHA256: await tokenHash(manifest),
              ASSET_SERVICE: 'fixture',
            },
            serviceBindings: {
              ASSETS: (request) => {
                const path = new URL(request.url).pathname;
                if (path.endsWith('manifest.json'))
                  return new Response(manifest);
                if (path.endsWith('tenant.mjs')) {
                  if (kind === 'headers')
                    return new Promise<Response>((resolve) => {
                      late = () => resolve(new Response(module));
                    });
                  return new Response(
                    new ReadableStream({
                      start(controller) {
                        late = () => {
                          try {
                            controller.enqueue(
                              new TextEncoder().encode(module),
                            );
                            controller.close();
                          } catch {
                            /* Already cancelled. */
                          }
                        };
                      },
                    }),
                  );
                }
                return new Response(schema);
              },
            },
            outboundService: async (request) => {
              const path = new URL(request.url).pathname;
              if (path.endsWith('/d1/database')) {
                if (request.method === 'POST') {
                  database = true;
                  creates++;
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
                if (request.method === 'DELETE') {
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
              if (request.method === 'PUT') {
                uploads++;
                return ok({ id: 'unexpected' });
              }
              return new Response('', { status: 404 });
            },
          },
        ],
      }),
    );
    const db = (await mf.getD1Database(
      'CONTROL_DB',
      'provisioner',
    )) as unknown as D1Database;
    for (const file of readdirSync('hosted/migrations')
      .filter((n) => n.endsWith('.sql'))
      .sort())
      await db.exec(
        readFileSync('hosted/migrations/' + file, 'utf8')
          .replace(/^--.*$/gm, '')
          .replace(/\n/g, ' '),
      );
    const run = (
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
    const client = await mf.getWorker('client');
    async function call(method: string, args: unknown[]) {
      return client.fetch('http://localhost/check', {
        method: 'POST',
        body: JSON.stringify({ method, args }),
      });
    }
    expect((await call('armQa', [run.run_id])).status).toBe(200);
    expect(
      (await call('provision', [run.workspace_id, run.user_id])).status,
    ).toBe(503);
    const status = (await (await call('qaStatus', [run.run_id])).json()) as {
      diagnostic: { phase: string; code: string };
    };
    expect(status.diagnostic).toMatchObject({
      phase: 'module-read',
      code: 'artifact_timeout',
    });
    expect(creates).toBe(1);
    expect(uploads).toBe(0);
    expect((await call('cleanupQa', [run.run_id])).status).toBe(200);
    expect((await readQaRun(db, run.run_id))?.state).toBe('complete');
    late();
    expect(
      (await call('provision', [run.workspace_id, run.user_id])).status,
    ).toBe(503);
    const worker = await mf.getWorker('provisioner');
    const cleared = await (
      await worker.fetch('http://localhost/inspect', {
        method: 'POST',
        body: JSON.stringify({ workspace: run.workspace_id }),
      })
    ).json();
    expect(cleared).toEqual({ keys: 0, alarm: null });
    expect(database).toBe(false);
    expect(creates).toBe(1);
    expect(uploads).toBe(0);
  },
  15000,
);
