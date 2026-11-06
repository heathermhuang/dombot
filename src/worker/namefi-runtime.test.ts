import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { expect, it } from 'vitest';

it('authenticates Namefi in the Worker runtime and refuses redirects without forwarding its key', async () => {
  const bundle = await build({
    stdin: {
      contents: `import {createRegistrar} from '@aoxborrow/registrar-client';
      export default {async fetch(request) {
        const calls=[];
        const redirect=new URL(request.url).pathname==='/redirect';
        const registrar=createRegistrar('namefi',{apiKey:'nfk_synthetic-only'}, {retries:0, fetch:async(input,init)=>{
          // Construct a real runtime Request: Node mocks do not enforce the
          // edge runtime's supported redirect modes.
          const outgoing=new Request(input,init);
          calls.push({url:outgoing.url,redirect:outgoing.redirect});
          return redirect ? new Response(null,{status:302,headers:{Location:'https://untrusted.example/'}}) : Response.json({id:'synthetic-user'});
        }});
        return Response.json({result:await registrar.testConnection(),calls});
      }};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
  });
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      compatibilityDate: '2026-10-01',
      script: bundle.outputFiles[0].text,
    }),
  );
  try {
    const success = (await (
      await runtime.dispatchFetch('https://fixture.invalid/')
    ).json()) as { result: { success: boolean }; calls: unknown[] };
    expect(success.result.success).toBe(true);
    expect(success.calls).toEqual([
      { url: 'https://api.namefi.io/v-next/user', redirect: 'manual' },
    ]);
    const redirected = (await (
      await runtime.dispatchFetch('https://fixture.invalid/redirect')
    ).json()) as { result: { success: boolean }; calls: unknown[] };
    expect(redirected.result.success).toBe(false);
    expect(redirected.calls).toEqual(success.calls);
    expect(JSON.stringify(redirected.result)).not.toContain(
      'nfk_synthetic-only',
    );
  } finally {
    await runtime.dispose();
  }
}, 20_000);
