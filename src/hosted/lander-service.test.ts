import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let runtime: Miniflare;
let reads = 0;
beforeAll(async () => {
  const compiled = await build({
    stdin: {
      contents:
        "export {LanderService} from './src/hosted/lander-service';export default {fetch(){return new Response('Not found',{status:404})}};",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    external: ['cloudflare:*'],
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'caller',
          modules: true,
          script:
            'export default {async fetch(r,env){return Response.json(await env.SERVICE.inspectHosting())}}',
          compatibilityDate: '2026-10-01',
          serviceBindings: {
            SERVICE: { name: 'hosting', entrypoint: 'LanderService' },
          },
        },
        {
          name: 'hosting',
          modules: true,
          script: compiled.outputFiles[0].text,
          compatibilityDate: '2026-10-01',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            PORTFOLIO_CF_ZONE_ID: 'a'.repeat(32),
            PORTFOLIO_CF_API_TOKEN: 'fixture-private-token',
            PORTFOLIO_CNAME_TARGET: 'origin.example',
            PORTFOLIO_EDGE_WORKER: 'domains-sales-lander',
          },
          outboundService: async (request) => {
            expect(request.method).toBe('GET');
            reads++;
            return Response.json({
              success: true,
              result: new URL(request.url).pathname.endsWith('/fallback_origin')
                ? { origin: 'origin.example', status: 'active' }
                : [{ hostname: 'private-customer.example' }],
              result_info: { total_count: 1 },
            });
          },
        },
      ],
    }),
  );
}, 30000);
afterAll(async () => runtime?.dispose());
it('exposes only sanitized fixed-path inspection through a service-bound RPC entrypoint', async () => {
  const caller = await runtime.getWorker('caller'),
    response = await caller.fetch('https://caller.internal/');
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({
    configured: true,
    hostnames: { reachable: true, count: 1 },
    fallback: { state: 'active' },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /fixture-private-token|private-customer/,
  );
  expect(reads).toBe(2);
  const target = await runtime.getWorker('hosting');
  expect(
    (await target.fetch('https://hosting.internal/inspectHosting')).status,
  ).toBe(404);
  expect(reads).toBe(2);
});
