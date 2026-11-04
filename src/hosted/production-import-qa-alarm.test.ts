import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createProductionImportQa,
  readQaRun,
  qaManifestSha,
  type QaRun,
} from './production-import-qa';
let mf: Miniflare, db: D1Database, worker: Fetcher, run: QaRun;
const other = '44444444-4444-4444-8444-444444444444';
beforeAll(async () => {
  const script = (
    await build({
      stdin: {
        contents: `import {PortfolioSetup} from './src/hosted/provisioner';export class TestSetup extends PortfolioSetup {async seed(){await this.ctx.storage.put('setup',{workspace:'real-fixture',root:'real-private-fixture'});return true;}async inspect(){return{setup:await this.ctx.storage.get('setup'),keys:(await this.ctx.storage.list()).size,alarm:await this.ctx.storage.getAlarm()};}}export default {async fetch(request,env){const body=await request.json(),stub=env.SETUPS.get(env.SETUPS.idFromName(body.workspace));try{return Response.json(await stub[body.method](...(body.args??[])));}catch(e){return Response.json({error:e.message},{status:400});}}};`,
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
      modules: true,
      script,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { CONTROL_DB: 'native-qa-alarm' },
      durableObjects: { SETUPS: { className: 'TestSetup', useSQLite: true } },
      bindings: {
        CF_ACCOUNT_ID: 'fixture-account',
        CF_DISPATCH_NAMESPACE: 'fixture-namespace',
        CF_PROVISIONING_TOKEN: 'fake-token',
        TEMPLATE_SHA256: 'a'.repeat(64),
      },
      outboundService: (request) =>
        new URL(request.url).pathname.endsWith('/d1/database')
          ? Response.json({ success: true, result: [] })
          : new Response('', { status: 404 }),
    }),
  );
  db = (await mf.getD1Database('CONTROL_DB')) as unknown as D1Database;
  worker = (await mf.getWorker()) as unknown as Fetcher;
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
      'native-alarm-pepper'.repeat(3),
      {
        template: 'a'.repeat(64),
        module: 'b'.repeat(64),
        bootstrap: 'c'.repeat(64),
        engine: 'fixture',
        source: 'd'.repeat(64),
        account: 'fixture-account',
        namespace: 'fixture-namespace',
      },
      'e'.repeat(40),
      60,
    )
  ).run;
  // Model a genuinely older trusted lease; do not alter the runtime clock.
  run.created_at -= 120000;
  run.expires_at -= 120000;
  run.manifest_sha256 = await qaManifestSha(run);
  await db
    .prepare(
      'UPDATE production_import_qa_runs SET created_at=?,expires_at=?,manifest_sha256=? WHERE run_id=?',
    )
    .bind(run.created_at, run.expires_at, run.manifest_sha256, run.run_id)
    .run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
async function call(workspace: string, method: string, args: unknown[] = []) {
  const r = await worker.fetch('http://localhost/check', {
    method: 'POST',
    body: JSON.stringify({ workspace, method, args }),
  });
  return {
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  };
}
it('native lease alarm cleans an abandoned account and its journal without touching another object', async () => {
  await call(other, 'seed');
  const untouched = await call(other, 'inspect');
  expect((await call(other, 'armQa', [run.run_id])).status).toBe(400);
  expect((await call(run.workspace_id, 'armQa', [run.run_id])).body.armed).toBe(
    true,
  );
  await vi.waitFor(
    async () =>
      expect((await readQaRun(db, run.run_id))?.state).toBe('complete'),
    { timeout: 5000, interval: 50 },
  );
  expect((await readQaRun(db, run.run_id))?.cleanup_trigger).toBe('expiry');
  expect(
    await db
      .prepare('SELECT count(*) n FROM users WHERE id=?')
      .bind(run.user_id)
      .first('n'),
  ).toBe(0);
  const clean = await call(run.workspace_id, 'inspect');
  expect(clean.body.keys).toBe(0);
  expect(clean.body.alarm).toBeNull();
  expect(await call(other, 'inspect')).toEqual(untouched);
  expect((await call(run.workspace_id, 'armQa', [run.run_id])).body.armed).toBe(
    false,
  );
  expect((await call(run.workspace_id, 'inspect')).body.keys).toBe(0);
});
