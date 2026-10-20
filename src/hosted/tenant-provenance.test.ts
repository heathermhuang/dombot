import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { signGatewayRequest } from '../shared/gateway-proof';
const id = '11111111-1111-4111-8111-111111111111',
  key = 'local-test-gateway-signing-key'.repeat(3);
let mf: Miniflare, tenant: Fetcher;
beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/hosted/tenant.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    external: ['cloudflare:*'],
    logLevel: 'silent',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'current-wrapper',
          modules: true,
          script: result.outputFiles[0].text,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            DOMBOT_AUTH: 'gateway',
            DOMBOT_WORKSPACE_ID: id,
            DOMBOT_GATEWAY_SECRET: key,
          },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'OldCoordinator',
              scriptName: 'previous-coordinator',
              useSQLite: true,
            },
          },
        },
        {
          name: 'previous-coordinator',
          modules: true,
          script: `import {DurableObject} from 'cloudflare:workers';export class OldCoordinator extends DurableObject{async fetch(request){return new Response('Previous coordinator body',{headers:new URL(request.url).searchParams.has('unversioned')?{}:{'X-DomBot-Engine':'previous-engine','X-DomBot-Engine-Source':'previous-source'}})}};export default{fetch(){return new Response('not public',{status:404})}}`,
          compatibilityDate: '2026-09-09',
        },
      ],
    }),
  );
  tenant = await mf.getWorker('current-wrapper');
});
afterAll(async () => {
  await mf?.dispose();
});
async function request(query = '') {
  const r = new Request('http://localhost/api/getSettings' + query, {
    method: 'POST',
    body: JSON.stringify({ args: [] }),
  });
  r.headers.set(
    'x-dombot-gateway-proof',
    await signGatewayRequest(key, id, 'owner', r),
  );
  return tenant.fetch(r);
}
describe('eventually consistent coordinator deployments', () => {
  it('reports the serving coordinator version even when the outer Worker is newer', async () => {
    const r = await request();
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('Previous coordinator body');
    expect(r.headers.get('X-DomBot-Engine')).toBe('previous-engine');
    expect(r.headers.get('X-DomBot-Engine-Source')).toBe('previous-source');
  });
  it('does not invent current provenance when an older coordinator supplies none', async () => {
    const r = await request('?unversioned=1');
    expect(r.status).toBe(200);
    expect(r.headers.get('X-DomBot-Engine')).toBeNull();
    expect(r.headers.get('X-DomBot-Engine-Source')).toBeNull();
  });
});
