// Local synthetic owner only. No remote databases, accounts, mail or provider APIs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqlStatements } from './prepare-on-demand.mjs';
const root = process.cwd(),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dombot-import-flow-'));
const salesEnabled = process.argv.includes('--sales');
const assetDirectory = process.argv.includes('--source-ui')
  ? path.join(root, 'dist/web')
  : path.join(root, 'node_modules/@domains-domains/dombot-engine/web');
const origin = 'http://127.0.0.1:5196',
  workspace = randomUUID(),
  user = randomUUID(),
  token = randomBytes(32).toString('hex');
const sha = (x) => createHash('sha256').update(x).digest('hex');
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) {
    super(input, { ...init, duplex: 'half' });
  }
};
await build({
  stdin: {
    contents: `export {default as gateway} from './src/hosted/gateway'; export {provisionPortfolio} from './src/hosted/provisioning';`,
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['cloudflare:*'],
  banner: {
    js: "import {createRequire as qualificationRequire} from 'node:module'; const require=qualificationRequire(import.meta.url);",
  },
  outfile: dir + '/gateway.mjs',
});
const { gateway, provisionPortfolio } = await import(dir + '/gateway.mjs');
const module = (
  await build({
    entryPoints: ['src/hosted/provisioned-tenant.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    external: ['cloudflare:*', 'node:*'],
  })
).outputFiles[0].text;
const statements = [];
for (const name of (await fs.readdir('migrations'))
  .filter((x) => x.endsWith('.sql'))
  .sort())
  statements.push(
    ...sqlStatements(await fs.readFile('migrations/' + name, 'utf8')),
  );
const schema = JSON.stringify({ statements }),
  engine = JSON.parse(
    await fs.readFile(
      'node_modules/@domains-domains/dombot-engine/engine-manifest.json',
      'utf8',
    ),
  );
const manifest = JSON.stringify({
  engine: engine.version,
  sourceSha256: engine.sourceSha256,
  moduleSha256: sha(module),
  bootstrapSha256: sha(schema),
  compatibilityDate: '2026-09-09',
  bindings: [
    {
      name: 'DOMBOT_PUBLIC_DIRECTORY',
      type: 'service',
      service: 'synthetic-directory',
    },
    ...(salesEnabled
      ? [{ name: 'DOMBOT_SALES_V1', type: 'plain_text', text: 'true' }]
      : []),
  ],
});
const controlRuntime = new Miniflare(
  convertV4MiniflareOptions({
    cf: false,
    modules: true,
    script: `export default { async fetch(request) { const { html, prepend } = await request.json(); return new HTMLRewriter().on('head', {element(head) {head.prepend(prepend,{html:true});}}).transform(new Response(html)); } }`,
    d1Databases: { DB: 'synthetic-control' },
  }),
);
const control = await controlRuntime.getD1Database('DB');
const rewriter = await controlRuntime.getWorker();
// Node invokes the real Worker HTMLRewriter for the unchanged gateway head hook.
globalThis.HTMLRewriter = class {
  on(selector, handlers) {
    assert.equal(selector, 'head');
    this.handler = handlers.element;
    return this;
  }
  transform(response) {
    let prepend = '';
    this.handler({
      prepend(value, options) {
        assert.equal(options.html, true);
        prepend += value;
      },
    });
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const result = await rewriter.fetch('http://localhost/rewrite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: await response.text(), prepend }),
            });
            controller.enqueue(new Uint8Array(await result.arrayBuffer()));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
      { status: response.status, headers: response.headers },
    );
  }
};
for (const name of (await fs.readdir('hosted/migrations'))
  .filter((x) => x.endsWith('.sql'))
  .sort())
  for (const sql of sqlStatements(
    await fs.readFile('hosted/migrations/' + name, 'utf8'),
  ))
    await control.prepare(sql).run();
await control.batch([
  control
    .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
    .bind(workspace, 'Synthetic import qualification'),
  control
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(
      user,
      'import-qualification@example.test',
      workspace,
      'synthetic-no-password',
      Date.now(),
    ),
  control
    .prepare(
      'INSERT INTO pending_workspaces(workspace_id,created_at) VALUES(?,?)',
    )
    .bind(workspace, Date.now()),
  control
    .prepare(
      'INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) VALUES(?,?,?,?,?)',
    )
    .bind(
      sha(token),
      user,
      Date.now() + 3600000,
      Date.now(),
      'synthetic-qualification',
    ),
]);
let tenantRuntime,
  tenant,
  state,
  database,
  metadata,
  workers = 0,
  databases = 0,
  failNext = false;
const assets = async (request) => {
  let file = new URL(request.url).pathname;
  if (!/^\/(assets|fonts)\//.test(file)) file = '/index.html';
  try {
    const bytes = await fs.readFile(path.join(assetDirectory, file));
    return new Response(bytes, {
      headers: {
        'Content-Type': file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.svg')
              ? 'image/svg+xml'
              : file.endsWith('.woff2')
                ? 'font/woff2'
                : 'text/html',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
const transport = async (input, init = {}) => {
  const pathname = new URL(String(input)).pathname;
  if (pathname.endsWith('/d1/database') && init.method === 'POST') {
    database = randomUUID();
    databases++;
    return Response.json({ success: true, result: { uuid: database } });
  }
  if (pathname.endsWith('/d1/database'))
    return Response.json({
      success: true,
      result: database
        ? [{ uuid: database, name: 'dombot-wfp-' + workspace }]
        : [],
    });
  if (pathname.endsWith('/settings'))
    return Response.json({ success: true, result: metadata });
  if (init.method === 'PUT') {
    metadata = JSON.parse(await init.body.get('metadata').text());
    const bindings = Object.fromEntries(
      metadata.bindings
        .filter((b) => b.text !== undefined)
        .map((b) => [b.name, b.text]),
    );
    tenantRuntime = new Miniflare(
      convertV4MiniflareOptions({
        cf: false,
        workers: [
          {
            name: 'synthetic-tenant',
            routes: ['workspace.internal/*', 'synthetic-import.invalid/*'],
            modules: true,
            script: await init.body.get('tenant.mjs').text(),
            compatibilityDate: '2026-09-09',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: database },
            durableObjects: {
              WORKSPACE_COORDINATOR: {
                className: 'WorkspaceCoordinator',
                useSQLite: true,
              },
            },
            bindings,
            serviceBindings: {
              ASSETS: assets,
              DOMBOT_PUBLIC_DIRECTORY: () =>
                new Response('Synthetic directory disabled', { status: 503 }),
            },
            outboundService: () =>
              new Response('Synthetic fixture denies provider access', {
                status: 503,
              }),
          },
        ],
      }),
    );
    tenant = await tenantRuntime.getWorker('synthetic-tenant');
    workers++;
    if (failNext) {
      failNext = false;
      throw Error('Injected lost upload receipt');
    }
    return Response.json({ success: true, result: { id: 'synthetic-worker' } });
  }
  return tenant
    ? new Response(module)
    : new Response('Not found', { status: 404 });
};
const provisioning = {
  CONTROL_DB: control,
  ASSETS: {
    fetch: async (request) => {
      const p = new URL(request.url).pathname;
      return new Response(
        p.endsWith('manifest.json')
          ? manifest
          : p.endsWith('schema.json')
            ? schema
            : module,
      );
    },
  },
  CF_ACCOUNT_ID: 'synthetic',
  CF_DISPATCH_NAMESPACE: 'synthetic',
  CF_PROVISIONING_TOKEN: 'synthetic-no-provider-access',
  TENANT_SECRETS_JSON: '{}',
  TEMPLATE_SHA256: sha(manifest),
  ASSET_SERVICE: 'synthetic-assets',
  DISPATCHER: {
    get: () => ({
      fetch: async (request) => {
        const response = await tenant.fetch(request);
        if (!response.ok)
          console.error(
            'Synthetic native response',
            new URL(request.url).pathname,
            response.status,
            (await response.clone().text()).slice(0, 300),
          );
        return response;
      },
    }),
  },
};
let queue = Promise.resolve(),
  lastError = null;
const env = {
  CONTROL_DB: control,
  AUTH_PEPPER: 'synthetic-import-qualification-pepper'.repeat(3),
  WORKSPACES: '[]',
  GATEWAY_KEYS: '{}',
  CANONICAL_ORIGIN: 'https://synthetic-import.invalid',
  PLATFORM_ENABLED: 'true',
  ON_DEMAND_ENABLED: 'true',
  ON_DEMAND_TEMPLATE_SHA256: sha(manifest),
  DISPATCHER: provisioning.DISPATCHER,
  PROVISIONER: {
    provision: (id, owner) => {
      const work = queue.then(async () => {
        return provisionPortfolio(
          provisioning,
          {
            get: async () => state,
            put: async (value) => {
              state = structuredClone(value);
            },
          },
          id,
          owner,
          transport,
        );
      });
      const observed = work
        .then((value) => {
          lastError = null;
          return value;
        })
        .catch((error) => {
          lastError = error.message;
          throw error;
        });
      queue = observed.catch(() => {});
      return observed;
    },
  },
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (url.pathname === '/__qualification/session') {
      outgoing.writeHead(303, {
        'Set-Cookie': `import_qualification_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
        Location: `/w/${workspace}/`,
      });
      outgoing.end();
      return;
    }
    if (url.pathname === '/__qualification/status') {
      const row = await control
        .prepare(
          'SELECT requested_at,activated_at FROM pending_workspaces WHERE workspace_id=?',
        )
        .bind(workspace)
        .first();
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(
        JSON.stringify({
          synthetic: true,
          lastError,
          workspace,
          user,
          workers,
          databases,
          databaseId: database ?? null,
          ...row,
        }),
      );
      return;
    }
    if (
      url.pathname === '/__qualification/fail-next' &&
      incoming.method === 'POST'
    ) {
      failNext = true;
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    const chunks = [];
    for await (const c of incoming) chunks.push(Buffer.from(c));
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    // Keep the production HTTPS/cookie/origin checks active behind this local proxy.
    const headers = new Headers(incoming.headers);
    if (headers.get('origin') === origin)
      headers.set('origin', 'https://synthetic-import.invalid');
    const localSession = headers
      .get('cookie')
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('import_qualification_session='))
      ?.split('=')[1];
    headers.set(
      'cookie',
      localSession ? '__Host-dd_session=' + localSession : '',
    );
    url.protocol = 'https:';
    url.hostname = 'synthetic-import.invalid';
    url.port = '';
    const response = await gateway.fetch(
      new Request(url, { method: incoming.method, headers, body }),
      env,
    );
    const outgoingHeaders = new Headers(response.headers);
    if (outgoingHeaders.has('Location'))
      outgoingHeaders.set(
        'Location',
        outgoingHeaders
          .get('Location')
          .replace('https://synthetic-import.invalid', origin),
      );
    outgoing.writeHead(response.status, Object.fromEntries(outgoingHeaders));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500);
    outgoing.end(String(error));
  }
});
await new Promise((resolve) => server.listen(5196, '127.0.0.1', resolve));
console.log(
  `Local synthetic import qualification: ${origin}/__qualification/session`,
);
if (process.argv.includes('--check')) {
  try {
    const login = await fetch(origin + '/__qualification/session', {
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const status = async () =>
      (await fetch(origin + '/__qualification/status')).json();
    const before = await status(),
      base = origin + '/w/' + workspace;
    for (const path of ['/', '/import'])
      assert.equal(
        (await fetch(base + path, { headers: { Cookie: cookie } })).status,
        200,
      );
    const legacy = await fetch(base + '/start', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'reason=import',
    });
    assert.equal(legacy.status, 303);
    const submit = async (rows, token = cookie, from = origin) =>
      fetch(base + '/api/importDomains', {
        method: 'POST',
        headers: {
          Cookie: token,
          Origin: from,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          args: [rows, { importId: 'synthetic-stable-import' }],
        }),
      });
    const rows = [
      {
        line: 1,
        domain: 'allocation-check.invalid',
        registration: { expirationDate: '2027-03-04' },
        notes: 'Synthetic qualification',
      },
    ];
    assert.equal((await submit([])).status, 400);
    assert.equal((await submit([{ line: 1, domain: 'bad row' }])).status, 400);
    assert.equal((await submit(rows, '')).status, 401);
    assert.equal(
      (await submit(rows, cookie, 'https://evil.invalid')).status,
      403,
    );
    const idle = await status();
    assert.equal(idle.workers, 0);
    assert.equal(idle.databases, 0);
    assert.equal(idle.requested_at, null);
    await fetch(origin + '/__qualification/fail-next', { method: 'POST' });
    assert.equal((await submit(rows)).status, 503);
    const partial = await status();
    assert.equal(partial.workers, 1);
    assert.equal(partial.databases, 1);
    assert.equal(partial.activated_at, null);
    const saved = await submit(rows);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).result.counts.new, 1);
    const retry = await submit(rows);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).result.counts.unchanged, 1);
    const read = await fetch(base + '/api/getImportedDomains', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: [] }),
    });
    assert.equal(read.status, 200);
    const imported = (await read.json()).result;
    assert.equal(
      imported['allocation-check.invalid'].expirationDate,
      '2027-03-04',
    );
    const after = await status();
    assert.equal(after.workers, 1);
    assert.equal(after.databases, 1);
    assert.equal(after.workspace, before.workspace);
    assert.equal(after.user, before.user);
    assert.equal(after.databaseId, partial.databaseId);
    assert(after.activated_at > 0);
    console.log(
      JSON.stringify({
        passed: true,
        openingAndInvalidImportsAllocateNothing: true,
        lostUploadReconciled: true,
        onePair: true,
        identityPreserved: true,
        importAndReadback: true,
        retryUnchanged: true,
        engine: engine.version,
      }),
    );
  } finally {
    server.close();
    await controlRuntime.dispose();
    await tenantRuntime?.dispose();
  }
}

process.on('SIGTERM', () => {
  server.close();
  void Promise.all([controlRuntime.dispose(), tenantRuntime?.dispose()]).then(
    () => process.exit(),
  );
});
