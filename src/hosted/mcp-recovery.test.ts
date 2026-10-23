import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { Accounts } from './accounts';
import { opaqueToken, passwordHash, tokenHash } from './crypto';
import gateway from './gateway';

const origin = 'https://domains.domains';
const password = 'controlled-original-password';
const nextPassword = 'controlled-recovered-password';
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const verifier = 'controlled-pkce-verifier-'.repeat(3);
let mf: Miniflare, db: D1Database, env: HostedEnv;
let accounts: Accounts;
let sessions: string[];
let clientId: string;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'mcp-recovery-control' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of [
    '0001_control.sql',
    '0002_password_recovery.sql',
    '0005_passwordless_passkeys.sql',
    '0010_shared_mcp.sql',
  ])
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.exec(
    'DELETE FROM mcp_grants; DELETE FROM mcp_authorizations; DELETE FROM mcp_clients; DELETE FROM password_resets; DELETE FROM sessions; DELETE FROM users; DELETE FROM workspaces; DELETE FROM rate_limits;',
  );
  // The tenant fixture handles settings and successful delegated reads only.
  // OAuth, browser sessions, recovery and all SQL run through real handlers/D1.
  const tenant = {
    async fetch(input: RequestInfo | URL) {
      const request = input as Request;
      return Response.json({
        result:
          new URL(request.url).pathname === '/api/getSettings'
            ? { mcpEnabled: true }
            : { tools: [] },
      });
    },
  } as Fetcher;
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: 'controlled-mcp-recovery-pepper-'.repeat(3),
    GATEWAY_KEYS: JSON.stringify(
      Object.fromEntries(
        ids.map((id) => [id, 'controlled-gateway-key-'.repeat(3)]),
      ),
    ),
    WORKSPACES: JSON.stringify(
      ids.map((id, i) => ({
        id,
        label: 'Recovery test ' + i,
        binding: 'WORKSPACE_' + i,
      })),
    ),
    CANONICAL_ORIGIN: origin,
    WORKSPACE_0: tenant,
    WORKSPACE_1: tenant,
  } as HostedEnv;
  accounts = new Accounts(db, env.AUTH_PEPPER);
  sessions = [];
  const encoded = await passwordHash(password, env.AUTH_PEPPER);
  for (let i = 0; i < ids.length; i++) {
    await db.batch([
      db
        .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
        .bind(ids[i], 'Recovery test ' + i),
      db
        .prepare(
          'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
        )
        .bind(
          'owner-' + i,
          `owner-${i}@example.test`,
          ids[i],
          encoded,
          Date.now(),
        ),
    ]);
    sessions.push(
      (await accounts.newSession({
        id: 'owner-' + i,
        email: `owner-${i}@example.test`,
        workspace_id: ids[i],
        label: 'Recovery test',
        credentialHash: encoded,
      }))!,
    );
  }
  const registered = await post('/register', {
    client_name: 'Controlled recovery assistant',
    redirect_uris: ['http://127.0.0.1:4567/callback'],
    token_endpoint_auth_method: 'none',
  });
  expect(registered.status).toBe(201);
  clientId = ((await registered.json()) as { client_id: string }).client_id;
});

function post(path: string, body: unknown, session?: string, database = db) {
  return gateway.fetch(
    new Request(origin + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(session ? { Cookie: '__Host-dd_session=' + session } : {}),
      },
      body: JSON.stringify(body),
    }),
    { ...env, CONTROL_DB: database },
  );
}
async function consent(i = 0) {
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');
  const response = await gateway.fetch(
    new Request(
      origin +
        '/authorize?' +
        new URLSearchParams({
          client_id: clientId,
          redirect_uri: 'http://127.0.0.1:4567/callback',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          resource: origin + '/mcp',
        }),
    ),
    env,
  );
  expect(response.status).toBe(303);
  const page = await gateway.fetch(
    new Request(origin + response.headers.get('location'), {
      headers: { Cookie: '__Host-dd_session=' + sessions[i] },
    }),
    env,
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  return {
    id: html.match(/name="id" value="([a-f0-9]+)"/)![1],
    csrf: html.match(/name="csrf" value="([a-f0-9]+)"/)![1],
    decision: 'approve',
  };
}
async function authorize(i = 0) {
  const form = await consent(i);
  const approved = await post('/oauth/consent', form, sessions[i]);
  expect(approved.status).toBe(303);
  return new URL(approved.headers.get('location')!).searchParams.get('code')!;
}
function exchange(code: string, database = db) {
  return post(
    '/token',
    {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:4567/callback',
      resource: origin + '/mcp',
    },
    undefined,
    database,
  );
}
async function grant(i = 0) {
  const response = await exchange(await authorize(i));
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}
function mcpAdmission(token: string) {
  return gateway.fetch(
    new Request(origin + '/mcp', {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json, text/event-stream',
      },
    }),
    env,
  );
}
async function recoveryCode() {
  const code = opaqueToken();
  await db
    .prepare(
      "INSERT INTO password_resets(token_hash,user_id,expires_at,operator_case) VALUES(?,'owner-0',?,'controlled-recovery')",
    )
    .bind(await tokenHash(code), Date.now() + 900_000)
    .run();
  return code;
}
// Hold a real transaction immediately before submission; never split its SQL.
function pausedBatch() {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const database = new Proxy(db, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          entered();
          await gate;
          return target.batch(statements);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { database, started, release };
}

describe('password recovery revokes shared SaaS MCP authority atomically', () => {
  it('revokes issued grants, pending codes and consent while preserving another account', async () => {
    const token = await grant();
    const other = await grant(1);
    const code = await authorize();
    const otherCode = await authorize(1);
    const pending = await consent();
    expect((await mcpAdmission(token)).status).toBe(200);
    const recovery = await recoveryCode();
    const result = await gateway.fetch(
      new Request(origin + '/recover', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: recovery,
          password: nextPassword,
          confirm: nextPassword,
        }),
      }),
      env,
    );
    expect(result.status).toBe(200);
    expect(await accounts.session(sessions[0])).toBeNull();
    expect((await mcpAdmission(token)).status).toBe(401);
    expect((await exchange(code)).status).toBe(400);
    expect(
      await db
        .prepare("SELECT id FROM mcp_authorizations WHERE user_id='owner-0'")
        .first(),
    ).toBeNull();
    expect((await post('/oauth/consent', pending, sessions[0])).status).toBe(
      401,
    );
    expect((await mcpAdmission(other)).status).toBe(200);
    expect((await exchange(otherCode)).status).toBe(200);
    expect(await accounts.session(sessions[1])).not.toBeNull();
    const revoked = await db
      .prepare('SELECT revoked_at FROM mcp_grants WHERE token_hash=?')
      .bind(await tokenHash(token))
      .first<{ revoked_at: number }>();
    expect(revoked!.revoked_at).toBeGreaterThan(0);
  });

  it('rejects an exchange validated before recovery but committed afterward', async () => {
    const code = await authorize();
    const recovery = await recoveryCode();
    const paused = pausedBatch();
    const response = exchange(code, paused.database);
    await paused.started;
    try {
      expect(await accounts.recoverPassword(recovery, nextPassword)).toBe(true);
    } finally {
      paused.release();
    }
    const result = await response;
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: 'invalid_grant' });
    expect(
      await db
        .prepare(
          "SELECT id FROM mcp_grants WHERE user_id='owner-0' AND revoked_at IS NULL",
        )
        .first(),
    ).toBeNull();
  });

  it('revokes a grant minted while recovery waits to commit', async () => {
    const code = await authorize();
    const recovery = await recoveryCode();
    const paused = pausedBatch();
    const recovering = new Accounts(
      paused.database,
      env.AUTH_PEPPER,
    ).recoverPassword(recovery, nextPassword);
    await paused.started;
    let token!: string;
    try {
      const result = await exchange(code);
      expect(result.status).toBe(200);
      token = ((await result.json()) as { access_token: string }).access_token;
      expect((await mcpAdmission(token)).status).toBe(200);
    } finally {
      paused.release();
    }
    expect(await recovering).toBe(true);
    expect((await mcpAdmission(token)).status).toBe(401);
  });

  it.each(['invalid', 'expired', 'disabled'] as const)(
    'does not revoke authority for an %s recovery',
    async (kind) => {
      const token = await grant();
      const code = await authorize();
      const recovery = await recoveryCode();
      if (kind === 'expired')
        await db.prepare('UPDATE password_resets SET expires_at=1').run();
      if (kind === 'disabled')
        await db
          .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
          .bind(ids[0])
          .run();
      expect(
        await accounts.recoverPassword(
          kind === 'invalid' ? 'f'.repeat(64) : recovery,
          nextPassword,
        ),
      ).toBe(false);
      if (kind === 'disabled')
        await db
          .prepare('UPDATE workspaces SET enabled=1 WHERE id=?')
          .bind(ids[0])
          .run();
      expect((await mcpAdmission(token)).status).toBe(200);
      expect((await exchange(code)).status).toBe(200);
      expect(await accounts.session(sessions[0])).not.toBeNull();
    },
  );

  it('does not let replayed recovery revoke a newly authorized connection', async () => {
    const recovery = await recoveryCode();
    expect(await accounts.recoverPassword(recovery, nextPassword)).toBe(true);
    const user = (await accounts.login('owner-0@example.test', nextPassword))!;
    sessions[0] = (await accounts.newSession(user))!;
    const token = await grant();
    const code = await authorize();
    expect(
      await accounts.recoverPassword(recovery, 'unwanted-replayed-password'),
    ).toBe(false);
    expect((await mcpAdmission(token)).status).toBe(200);
    expect((await exchange(code)).status).toBe(200);
  });

  it('does not let an in-flight losing recovery revoke new authority', async () => {
    const recovery = await recoveryCode();
    const paused = pausedBatch();
    const losing = new Accounts(
      paused.database,
      env.AUTH_PEPPER,
    ).recoverPassword(recovery, 'losing-concurrent-password');
    await paused.started;
    let token!: string, code!: string;
    try {
      expect(await accounts.recoverPassword(recovery, nextPassword)).toBe(true);
      sessions[0] = (await accounts.newSession(
        (await accounts.login('owner-0@example.test', nextPassword))!,
      ))!;
      token = await grant();
      code = await authorize();
    } finally {
      paused.release();
    }
    expect(await losing).toBe(false);
    expect((await mcpAdmission(token)).status).toBe(200);
    expect((await exchange(code)).status).toBe(200);
  });

  it('rolls back password, proof consumption and revocation on a transaction failure', async () => {
    const token = await grant();
    const code = await authorize();
    const recovery = await recoveryCode();
    const failing = new Proxy(db, {
      get(target, key) {
        if (key === 'batch')
          return (statements: D1PreparedStatement[]) =>
            target.batch([
              ...statements,
              target
                .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
                .bind(ids[0], 'Duplicate must fail'),
            ]);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      new Accounts(failing, env.AUTH_PEPPER).recoverPassword(
        recovery,
        nextPassword,
      ),
    ).rejects.toThrow();
    expect(
      await accounts.login('owner-0@example.test', password),
    ).not.toBeNull();
    expect(await accounts.session(sessions[0])).not.toBeNull();
    expect((await mcpAdmission(token)).status).toBe(200);
    expect((await exchange(code)).status).toBe(200);
    expect(await accounts.recoverPassword(recovery, nextPassword)).toBe(true);
    expect((await mcpAdmission(token)).status).toBe(401);
  });

  it('preserves the documented separate policy for an ordinary password change', async () => {
    const token = await grant();
    const code = await authorize();
    const user = (await accounts.session(sessions[0]))!;
    expect(await accounts.changePassword(user, password, nextPassword)).toBe(
      true,
    );
    expect(await accounts.session(sessions[0])).toBeNull();
    expect((await mcpAdmission(token)).status).toBe(200);
    expect((await exchange(code)).status).toBe(200);
  });
});
