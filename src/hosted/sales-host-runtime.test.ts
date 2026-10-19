import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';

let runtime: Miniflare;
let redirect = false;
let requests = 0;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import {salesDns} from './src/hosted/sales-hostnames'; export default {async fetch(){try{await salesDns('fixture.example','A');return new Response('observed')}catch{return new Response('unavailable',{status:503})}}};`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'sales-host-runtime',
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: '2026-10-08',
          compatibilityFlags: ['nodejs_compat'],
          outboundService: async () => {
            requests++;
            return redirect
              ? new Response(null, {
                  status: 302,
                  headers: { Location: 'https://other.example/dns' },
                })
              : Response.json({ Status: 0, Answer: [] });
          },
        },
      ],
    }),
  );
}, 30_000);
beforeEach(() => {
  redirect = false;
  requests = 0;
});
afterAll(async () => runtime?.dispose());
it('observes DNS through the actual Workers fetch API', async () => {
  const response = await runtime.dispatchFetch(
    'https://runtime.fixture.example/',
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('observed');
  expect(requests).toBe(1);
});
it('rejects a redirected DNS observation without following it', async () => {
  redirect = true;
  const response = await runtime.dispatchFetch(
    'https://runtime.fixture.example/',
  );
  expect(response.status).toBe(503);
  expect(requests).toBe(1);
});
