import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let runtime: Miniflare;
let dnssecReads = 0;
beforeAll(async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import {DynadotDnsSetup} from './src/worker/dynadot-dns-setup';
      import {LanderHosting} from './src/hosted/lander-hosting';
      import {LanderCloudflare} from './src/core/services/lander-cloudflare';
      import {MemoryDocStore} from './src/core/storage/doc-store';
      import {configureStore,hydrateStores} from './src/core/storage/namespace';
      import {createAccount} from './src/core/services/accounts';
      export default {async fetch(request, env) {
        try {
          const url = new URL(request.url), path = url.pathname; const transport = url.searchParams.has('explicit') ? fetch : undefined;
          if (path === '/hosting') return Response.json(await new LanderHosting(env,transport).zoneCall('/custom_hostnames'));
          configureStore(new MemoryDocStore()); await hydrateStores();
          if(path === '/cloudflare') {
            await createAccount('cloudflare','Synthetic',{apiToken:'fixture-token',accountId:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},undefined,'cloudflare');
            return Response.json(await new LanderCloudflare('cloudflare',transport).call('/zones'));
          }
          await createAccount('dynadot','Synthetic',{apiKey:'fixture-key',apiSecret:'fixture-secret'},undefined,'dynadot');
          return Response.json(await new DynadotDnsSetup({...env,DYNDNS_SETUP_FIXTURE:JSON.stringify({workspace:env.DOMBOT_WORKSPACE_ID,domain:'fixture.example',accountId:'dynadot',requestId:'22222222-2222-4222-8222-222222222222',expiresAt:Date.now()+3600000})},transport).inspect());
        } catch(error) {return Response.json({error:error.message},{status:500});}
      }};`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    external: ['cloudflare:*', 'node:*'],
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'lander-default-fetch',
          modules: true,
          script: compiled.outputFiles[0].text,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'runtime-fetch' },
          bindings: {
            DOMBOT_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
            DOMBOT_SECRET: btoa(
              String.fromCharCode(...new Uint8Array(32).fill(8)),
            ),
            SALES_CF_ZONE_ID: 'a'.repeat(32),
            SALES_CF_API_TOKEN: 'fixture-token',
            SALES_CNAME_TARGET: 'origin.example',
          },
          outboundService: async (request) => {
            expect(request.method).toBe('GET');
            const u = new URL(request.url);
            if (u.hostname === 'cloudflare-dns.com') {
              dnssecReads++;
              return Response.json({ Status: 0 });
            }
            if (u.hostname === 'api.cloudflare.com')
              return Response.json({ success: true, result: [] });
            expect(u.hostname).toBe('api.dynadot.com');
            const ns = {
              nameserver_list: [
                { server_name: 'a.dns.park.io' },
                { server_name: 'b.dns.park.io' },
              ],
            };
            const data = u.pathname.endsWith('/nameservers')
              ? ns
              : u.pathname.endsWith('/dnssec')
                ? { dnssec_info_list: [] }
                : { glue_info: { glue_type: 'NAME_SERVERS', ...ns } };
            return Response.json({ code: 200, data });
          },
        },
      ],
    }),
  );
}, 30000);
afterAll(async () => runtime?.dispose());
it.each(['', '?explicit=1'])(
  'runs the native DNS preflight using ambient Worker fetch %s, with no registrar mutation',
  async (query) => {
    const before = dnssecReads;
    const r = await runtime.dispatchFetch(
      'https://fixture.internal/setup' + query,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ preflight: { ready: true } });
    expect(dnssecReads).toBe(before + 1);
  },
  20000,
);
it.each(['', '?explicit=1'])(
  'reads lander hosting through ambient Worker fetch %s',
  async (query) => {
    const r = await runtime.dispatchFetch(
      'https://fixture.internal/hosting' + query,
    );
    expect(await r.json()).toMatchObject({ result: [] });
    expect(r.status).toBe(200);
  },
);
it.each(['', '?explicit=1'])(
  'reads the Cloudflare DNS adapter through ambient Worker fetch %s',
  async (query) => {
    const r = await runtime.dispatchFetch(
      'https://fixture.internal/cloudflare' + query,
    );
    expect(await r.json()).toEqual({ success: true, result: [] });
    expect(r.status).toBe(200);
  },
);
