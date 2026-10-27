import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
const workspace = '11111111-1111-4111-8111-111111111111',
  key = 'synthetic-direct-observer-key-'.repeat(3);
let mf: Miniflare;
beforeAll(async () => {
  const old = readFileSync(
    'src/hosted/test-fixtures/tenant-coordinator-monitor.ts',
    'utf8',
  );
  const scripts = await Promise.all([
    build({
      entryPoints: ['src/hosted/tenant.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      external: ['cloudflare:*'],
      logLevel: 'silent',
    }),
    build({
      stdin: {
        contents: old,
        loader: 'ts',
        resolveDir: process.cwd() + '/src/hosted/test-fixtures',
        sourcefile: 'previous-tenant.ts',
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      external: ['cloudflare:*'],
      logLevel: 'silent',
    }),
  ]);
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: scripts.map((result, index) => ({
        name: index ? 'previous' : 'current',
        modules: true,
        script: result.outputFiles[0].text,
        compatibilityDate: '2026-09-09',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'direct-read' },
        bindings: {
          DOMBOT_AUTH: 'gateway',
          DOMBOT_WORKSPACE_ID: workspace,
          DOMBOT_GATEWAY_SECRET: key,
          DOMBOT_SECRET: btoa('x'.repeat(32)),
        },
      })),
    }),
  );
  const db = await mf.getD1Database('DB', 'current');
  await db
    .prepare(
      'CREATE TABLE docs(ns TEXT,key TEXT,value TEXT,updated_at INTEGER,PRIMARY KEY(ns,key))',
    )
    .run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
const request = async (owner: string | null = null) => {
  const req = new Request(
    'https://workspace.internal/platform-internal/sync-monitor',
  );
  req.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      key,
      workspace,
      owner,
      req as unknown as globalThis.Request,
    ),
  );
  return req;
};
it('the previous observer fails when its owner coordinator is unavailable', async () => {
  const worker = await mf.getWorker('previous');
  await expect(worker.fetch(await request())).rejects.toThrow(
    'Workspace coordinator is not configured',
  );
});
it('the stateless monitor works without the owner coordinator or its request queue', async () => {
  const worker = await mf.getWorker('current');
  const response = await worker.fetch(await request());
  expect(response.status).toBe(200);
  expect(response.headers.get('X-DomBot-Monitor-Path')).toBe('direct-d1');
  expect(await response.json()).toEqual({ diagnostics: null });
});
it('retains the private-proof and null-owner admission requirements', async () => {
  const worker = await mf.getWorker('current');
  expect(
    (
      await worker.fetch(
        new Request(
          'https://workspace.internal/platform-internal/sync-monitor',
        ),
      )
    ).status,
  ).toBe(403);
  expect((await worker.fetch(await request('owner'))).status).toBe(403);
});
