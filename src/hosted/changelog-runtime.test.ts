import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import fs from 'node:fs';

let runtime: Miniflare;
let requests = 0;
let redirect = false;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import {loadChangelog} from './src/hosted/changelog-feed';export default {async fetch(request){return Response.json(await loadChangelog({cache:caches.default,now:Number(new URL(request.url).searchParams.get('now'))}));}};`,
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
      cf: false,
      workers: [
        {
          name: 'changelog-runtime',
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          outboundService: async (request) => {
            requests++;
            if (redirect)
              return new Response(null, {
                status: 302,
                headers: { Location: 'https://other.invalid/feed' },
              });
            const file = new URL(request.url).pathname.split(
              '/site/public/',
            )[1];
            return new Response(fs.readFileSync('site/public/' + file));
          },
        },
      ],
    }),
  );
}, 30_000);
afterAll(async () => runtime?.dispose());
it('refreshes and caches both feeds through native Workers fetch and Cache APIs', async () => {
  const now = Date.now();
  const read = async (time: number) => {
    const response = await runtime.dispatchFetch(
      `https://runtime.fixture.example/changelog?now=${time}`,
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      stale: boolean;
      checkedAt: number;
      entries: { id: string }[];
    }>;
  };
  const first = await read(now);
  expect(first.stale).toBe(false);
  expect(requests).toBe(4);
  expect(
    first.entries.some(
      (entry) => entry.id === 'saas-automatic-release-archive-2026-11-06',
    ),
  ).toBe(true);
  const cached = await read(now + 1);
  expect(cached.stale).toBe(false);
  expect(requests).toBe(4);
  redirect = true;
  const refused = await read(now + 300_001);
  expect(refused.stale).toBe(true);
  expect(requests).toBe(5); // The index redirect is refused without following its target.
});
