// Explicit local-only browser fixture. No production account, import lease or mail.
// The isolated bundle substitutes only the RP/origin constants for localhost.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqlStatements } from './prepare-on-demand.mjs';
const origin = 'http://localhost:5197';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dombot-passkey-local-'));
const output = path.join(dir, 'fixture.mjs');
let translated = false;
await build({
  stdin: {
    contents: `export {default as gateway} from './src/hosted/gateway';export {Accounts} from './src/hosted/accounts';export {passwordHash} from './src/hosted/crypto';`,
    resolveDir: process.cwd(),
  },
  plugins: [
    {
      name: 'local-only-relying-party',
      setup(builder) {
        builder.onLoad(
          { filter: /src\/hosted\/passkeys\.ts$/ },
          async ({ path: file }) => {
            const source = await fs.readFile(file, 'utf8');
            const production =
              "const origin = 'https://domains.domains',\n  rpID = 'domains.domains';";
            assert(
              source.includes(production),
              'RP fixture adapter needs review',
            );
            translated = true;
            return {
              contents: source.replace(
                production,
                `const origin = '${origin}',\n  rpID = 'localhost';`,
              ),
              loader: 'ts',
            };
          },
        );
        builder.onLoad(
          { filter: /src\/hosted\/launch\.ts$/ },
          async ({ path: file }) => {
            const source = await fs.readFile(file, 'utf8');
            const guard = 'const configured = new URL(origin);';
            assert(
              source.includes(guard),
              'Loopback fixture adapter needs review',
            );
            return {
              contents: source.replace(
                guard,
                `if (origin === '${origin}' && incoming.origin === origin) return null;\n${guard}`,
              ),
              loader: 'ts',
            };
          },
        );
      },
    },
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['cloudflare:*'],
  banner: {
    js: "import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);",
  },
  outfile: output,
});
assert(translated);
const { gateway, Accounts, passwordHash } = await import(output);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    cf: false,
    modules: true,
    script: 'export default {fetch(){return new Response("local")}}',
    d1Databases: { DB: 'passkey-local-only' },
    outboundService: () => {
      throw Error('External provider access forbidden');
    },
  }),
);
const db = await mf.getD1Database('DB');
for (const name of (await fs.readdir('hosted/migrations'))
  .filter((n) => n.endsWith('.sql'))
  .sort())
  for (const sql of sqlStatements(
    await fs.readFile('hosted/migrations/' + name, 'utf8'),
  ))
    await db.prepare(sql).run();
const workspace = randomUUID(),
  user = randomUUID(),
  password = randomBytes(32).toString('hex');
const env = {
  CONTROL_DB: db,
  AUTH_PEPPER: randomBytes(32).toString('hex'),
  CANONICAL_ORIGIN: origin,
  WORKSPACES: '[]',
  GATEWAY_KEYS: '{}',
  EMAIL: {
    send: async () => {
      throw Error('External mail forbidden');
    },
  },
};
await db
  .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
  .bind(workspace, 'Disposable local passkey fixture')
  .run();
await db
  .prepare(
    'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
  )
  .bind(
    user,
    'passkey@fixture.invalid',
    workspace,
    await passwordHash(password, env.AUTH_PEPPER),
    Date.now(),
  )
  .run();
const accounts = new Accounts(db, env.AUTH_PEPPER);
const owner = await accounts.login('passkey@fixture.invalid', password);
const session = await accounts.newSession(owner);
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (url.pathname === '/__qualification/session') {
      outgoing.writeHead(303, {
        'Set-Cookie': `dd_session=${session}; Path=/; HttpOnly; SameSite=Lax`,
        Location: '/account',
      });
      outgoing.end();
      return;
    }
    if (url.pathname === '/__qualification/status') {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(
        JSON.stringify({
          synthetic: true,
          rp: 'localhost',
          passkeys: await db
            .prepare('SELECT count(*) n FROM passkeys')
            .first('n'),
          sessions: await db
            .prepare('SELECT count(*) n FROM sessions')
            .first('n'),
        }),
      );
      return;
    }
    if (
      url.pathname === '/__qualification/stale-auth' &&
      incoming.method === 'POST'
    ) {
      assert.equal(incoming.headers.origin, origin);
      await db.prepare('UPDATE sessions SET authenticated_at=0').run();
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const response = await gateway.fetch(
      new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        body,
        ...(body ? { duplex: 'half' } : {}),
      }),
      env,
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end('Local fixture request failed');
  }
});
async function stop() {
  await new Promise((resolve) => server.close(resolve));
  await mf.dispose();
}
await new Promise((resolve) => server.listen(5197, '127.0.0.1', resolve));
if (process.argv.includes('--check')) {
  try {
    const page = await fetch(origin + '/account', {
      headers: { Cookie: 'dd_session=' + session },
    });
    assert.equal(page.status, 200);
    assert((await page.text()).includes('Add a passkey'));
    const options = await fetch(origin + '/auth/passkeys/options', {
      method: 'POST',
      headers: {
        Cookie: 'dd_session=' + session,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'register' }),
    });
    assert.equal(options.status, 200);
    const value = await options.json();
    assert.equal(value.options.rp.id, 'localhost');
    assert.equal(
      value.options.authenticatorSelection.userVerification,
      'required',
    );
    console.log(
      JSON.stringify({
        fixtureReady: true,
        nonProduction: true,
        localRelyingParty: 'localhost',
        accountPage: true,
        registrationOptions: true,
        browserEnrollment: 'not_run',
        physicalDevice: 'not_run',
      }),
    );
  } finally {
    await stop();
  }
} else {
  console.log(
    'Disposable local passkey fixture: ' + origin + '/__qualification/session',
  );
  console.log(
    'Use a virtual test authenticator. Enroll, sign out, sign in by passkey, expire freshness using POST /__qualification/stale-auth, confirm again, then remove the key. Production RP and physical-device acceptance remain separate.',
  );
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
