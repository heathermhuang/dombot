import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { signGatewayRequest } from '../shared/gateway-proof';

const id = '11111111-1111-4111-8111-111111111111';
const key = 'test-only-coordinator-gateway-key-'.repeat(3);
let mf: Miniflare;
let frontends: Fetcher[];
let legacy: Fetcher[];
let barrierEnabled = false;
const waiting = new Set<() => void>();
const barrier = async () => {
  if (barrierEnabled)
    await new Promise<void>((resolve) => {
      const release = () => {
        clearTimeout(timer);
        waiting.delete(release);
        resolve();
      };
      const timer = setTimeout(release, 100);
      waiting.add(release);
      if (waiting.size === 2) for (const resume of [...waiting]) resume();
    });
  return new Response('ok');
};
async function call(front: Fetcher, method: string, args: unknown[] = []) {
  const request = new Request(`http://localhost/api/${method}`, {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  request.headers.set(
    'x-dombot-gateway-proof',
    await signGatewayRequest(key, id, 'owner', request),
  );
  const response = await front.fetch(request);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { result: unknown }).result;
}
beforeAll(async () => {
  const instrument = `
    import { env } from 'cloudflare:workers';
    import { D1DocStore } from './src/worker/storage/d1-doc-store';
    const load = D1DocStore.prototype.loadAll;
    D1DocStore.prototype.loadAll = async function() {
      const snapshot = await load.call(this);
      await env.BARRIER.fetch('https://test-only-hydration-barrier/');
      return snapshot;
    };
  `;
  const bundle = async (entry: string) =>
    (
      await build({
        stdin: {
          contents: instrument + entry,
          resolveDir: process.cwd(),
          sourcefile: 'test-entry.ts',
        },
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
        external: ['cloudflare:*'],
        logLevel: 'silent',
      })
    ).outputFiles[0].text;
  const [coordinated, uncoordinated] = await Promise.all([
    bundle(
      `export { default, WorkspaceCoordinator } from './src/hosted/tenant';`,
    ),
    bundle(`export { default } from './src/worker';`),
  ]);
  const bindings = {
    DOMBOT_AUTH: 'gateway',
    DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!'),
    DOMBOT_GATEWAY_SECRET: key,
    DOMBOT_WORKSPACE_ID: id,
    DOMBOT_PUBLIC_BASE_PATH: `/w/${id}`,
  };
  const base = {
    modules: true,
    compatibilityDate: '2026-09-09',
    compatibilityFlags: ['nodejs_compat'],
    bindings,
    serviceBindings: { BARRIER: barrier, ASSETS: () => new Response('assets') },
  };
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          ...base,
          name: 'coordinator',
          script: coordinated,
          d1Databases: { DB: 'coordinated' },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'WorkspaceCoordinator',
              useSQLite: true,
            },
          },
        },
        ...['front-a', 'front-b'].map((name) => ({
          ...base,
          name,
          script: coordinated,
          d1Databases: { DB: 'coordinated' },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'WorkspaceCoordinator',
              scriptName: 'coordinator',
              useSQLite: true,
            },
          },
        })),
        ...['legacy-a', 'legacy-b'].map((name) => ({
          ...base,
          name,
          script: uncoordinated,
          d1Databases: { DB: 'legacy' },
        })),
      ],
    }),
  );
  for (const name of ['coordinator', 'legacy-a']) {
    const db = await mf.getD1Database('DB', name);
    for (const file of ['0001_docs.sql', '0002_publication.sql'])
      await db.exec(
        readFileSync('migrations/' + file, 'utf8')
          .replace(/^--.*$/gm, '')
          .replace(/\n/g, ' '),
      );
  }
  frontends = await Promise.all(
    ['front-a', 'front-b'].map((name) => mf.getWorker(name)),
  );
  legacy = await Promise.all(
    ['legacy-a', 'legacy-b'].map((name) => mf.getWorker(name)),
  );
  // Warm migrations before the deterministic read/snapshot barrier.
  await Promise.all(
    [...frontends, ...legacy].map((front) => call(front, 'getFolders')),
  );
}, 60_000);
afterAll(async () => {
  await mf?.dispose();
});

describe('workspace-wide single-writer boundary', () => {
  it('demonstrates acknowledged folder loss with two original Worker runtimes sharing D1', async () => {
    barrierEnabled = true;
    await Promise.all(
      legacy.map((front, i) =>
        call(front, 'createFolder', [
          { name: `Legacy ${i}`, color: 'teal', description: '' },
        ]),
      ),
    );
    barrierEnabled = false;
    const { folders } = (await call(legacy[0], 'getFolders')) as {
      folders: unknown[];
    };
    expect(folders).toHaveLength(1);
  });
  it('preserves concurrent settings and every acknowledged folder across two front-end isolates', async () => {
    barrierEnabled = true;
    try {
      await call(frontends[0], 'updateSettings', [{ mcpEnabled: true }]);
      await Promise.all([
        call(frontends[0], 'updateSettings', [{ mcpEnabled: false }]),
        call(frontends[1], 'updateSettings', [{ preferredCurrency: 'EUR' }]),
        ...Array.from({ length: 12 }, (_, i) =>
          call(frontends[i % 2], 'createFolder', [
            { name: `Coordinated ${i}`, color: 'teal', description: '' },
          ]),
        ),
      ]);
    } finally {
      barrierEnabled = false;
    }
    expect(await call(frontends[1], 'getSettings')).toMatchObject({
      mcpEnabled: false,
      preferredCurrency: 'EUR',
    });
    expect(await call(frontends[0], 'getFolders')).toMatchObject({
      folders: expect.any(Array),
    });
    expect(
      ((await call(frontends[0], 'getFolders')) as { folders: unknown[] })
        .folders,
    ).toHaveLength(12);
    // The scheduler RPC reaches the same stateful runtime.
    const ns = await mf.getDurableObjectNamespace(
      'WORKSPACE_COORDINATOR',
      'coordinator',
    );
    const stub = ns.get(ns.idFromName(id));
    await stub.runScheduled('0 * * * *', Date.now());
    expect(await call(frontends[0], 'getFolders')).toMatchObject({
      folders: expect.any(Array),
    });
    expect(
      ((await call(frontends[0], 'getFolders')) as { folders: unknown[] })
        .folders,
    ).toHaveLength(12);
  }, 15_000);
});
