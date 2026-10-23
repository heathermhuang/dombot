import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { parseRootSecret, rootGeneration } from './keys';

let mf: Miniflare;
const oldSecret = btoa('old-synthetic-runtime-root-32byte!');
const nextSecret = btoa('new-synthetic-runtime-root-32byte!');
const password = 'synthetic-runtime-owner-password';
const header = 'X-DomBot-Root-Generation';
beforeAll(async () => {
  const bundled = await build({
    entryPoints: ['src/worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:sockets'],
  });
  const workers = ['old', 'new'].map((name) => ({
    name,
    modules: true,
    script: bundled.outputFiles[0].text,
    d1Databases: { DB: 'rotation-shared-runtime' },
    bindings: {
      DOMBOT_AUTH: 'password',
      DOMBOT_PASSWORD: password,
      DOMBOT_SECRET: name === 'old' ? oldSecret : nextSecret,
    },
    serviceBindings: { ASSETS: () => new Response('synthetic assets') },
  }));
  mf = new Miniflare(convertV4MiniflareOptions({ cf: false, workers }));
  const db = await mf.getD1Database('DB', 'old');
  for (const name of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('migrations/' + name, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
});
afterAll(async () => {
  await mf?.dispose();
});
it('rekeys a real shared D1 through separate old/new Worker isolates without admitting old-root sessions', async () => {
  const old = await mf.getWorker('old'),
    next = await mf.getWorker('new');
  const root = await rootGeneration(parseRootSecret(oldSecret)),
    nextRoot = await rootGeneration(parseRootSecret(nextSecret));
  const call = (
    worker: typeof old,
    path: string,
    body: unknown,
    session?: string,
    generation?: string,
  ) =>
    worker.fetch('https://selfhost.example' + path, {
      method: 'POST',
      headers: {
        Referer: 'https://selfhost.example/',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.1',
        ...(session ? { Cookie: session } : {}),
        ...(generation ? { [header]: generation } : {}),
      },
      body: JSON.stringify(body),
    });
  const logged = await call(old, '/auth/login', { password });
  expect(logged.status, await logged.clone().text()).toBe(200);
  expect(logged.headers.get(header)).toBe(root);
  const oldCookie = logged.headers.get('set-cookie')!.split(';')[0];
  expect(
    (
      await call(
        old,
        '/api/createFolder',
        {
          args: [
            {
              name: 'Preserved synthetic folder',
              description: '',
              color: 'red',
            },
          ],
        },
        oldCookie,
        root,
      )
    ).status,
  ).toBe(200);
  const retired = await call(
    old,
    '/auth/retire-root',
    { password, nextRoot },
    oldCookie,
    root,
  );
  expect(retired.status).toBe(200);
  const final = (await retired.json()) as { drained: boolean; bundle: string };
  expect(final.drained).toBe(true);
  expect(final.bundle).toContain('Preserved synthetic folder');
  expect((await call(old, '/auth/login', { password })).status).toBe(503);
  expect(
    (await call(old, '/api/getFolders', { args: [] }, oldCookie)).status,
  ).toBe(503);
  expect((await call(old, '/mcp', {})).status).toBe(503);
  // Each request is independently generation-bound, even if routing returns
  // to an old isolate after the new login succeeded.
  expect(
    (
      await call(
        old,
        '/api/importData',
        { args: [final.bundle] },
        oldCookie,
        nextRoot,
      )
    ).status,
  ).toBe(409);
  const newLogin = await call(
    next,
    '/auth/login',
    { password },
    undefined,
    nextRoot,
  );
  expect(newLogin.status).toBe(200);
  const newCookie = newLogin.headers.get('set-cookie')!.split(';')[0];
  expect(
    (await call(next, '/api/getFolders', { args: [] }, oldCookie, nextRoot))
      .status,
  ).toBe(401);
  expect(
    (
      await call(
        next,
        '/api/importData',
        { args: [final.bundle] },
        newCookie,
        nextRoot,
      )
    ).status,
  ).toBe(200);
  const folders = await call(
    next,
    '/api/getFolders',
    { args: [] },
    newCookie,
    nextRoot,
  );
  expect(folders.status).toBe(200);
  expect(await folders.text()).toContain('Preserved synthetic folder');
});
