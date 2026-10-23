import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { D1DocStore } from './storage/d1-doc-store';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import {
  clearLoginAttempts,
  LOGIN_ATTEMPTS,
  LOGIN_WINDOW_MS,
  loginSource,
  reserveLoginAttempt,
} from './login-rate-limit';
import { deriveSessionKey, toBase64Url } from './keys';
vi.mock('cloudflare:sockets', () => ({ connect: vi.fn() }));
import worker from './index';

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_docs.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0002_login_attempts.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0003_session_revocations.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0007_root_retirement.sql', 'utf8'));
  // Execute production SQL against SQLite; only the D1 transport is simulated.
  db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      // The production SQL uses D1's numbered placeholders (?1, ?2). Bind by
      // number, as D1 does: older node:sqlite (22.14, 24.1) treats ?NNN as a
      // named parameter and rejects positional values for it.
      const bind = (...values: (string | number)[]) => {
        const params = Object.fromEntries(
          values.map((value, i) => [String(i + 1), value]),
        );
        return {
          async first() {
            return stmt.get(params) ?? null;
          },
          async run() {
            return stmt.run(params);
          },
          async all() {
            return { results: stmt.all(params) };
          },
        };
      };
      return { ...bind(), bind };
    },
  } as unknown as D1Database;
});

it('serves a valid owner login after another source exhausts its attempts', async () => {
  const env = {
    DB: db,
    DOMBOT_AUTH: 'password',
    DOMBOT_SECRET: btoa('a'.repeat(32)),
    DOMBOT_PASSWORD: 'a-long-synthetic-password',
    ASSETS: { fetch: async () => new Response('unused') },
  } as unknown as Env;
  const login = (ip: string, password: string) =>
    worker.fetch(
      new Request('https://app.example/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://app.example',
          'content-type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify({ password }),
      }),
      env,
    );
  for (let i = 0; i < LOGIN_ATTEMPTS; i++)
    expect((await login('192.0.2.1', 'wrong')).status).toBe(401);
  const limited = await login('192.0.2.1', 'wrong');
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  const owner = await login('192.0.2.2', env.DOMBOT_PASSWORD!);
  expect(owner.status).toBe(200);
  expect(owner.headers.get('set-cookie')).toContain('HttpOnly');
  const status = await worker.fetch(
    new Request('https://app.example/auth/status', {
      headers: { cookie: owner.headers.get('set-cookie')!.split(';')[0] },
    }),
    env,
  );
  expect(await status.json()).toMatchObject({ authenticated: true });
});

it('rejects a copied password session after logout, including through a fresh Worker runtime', async () => {
  const env = {
    DB: db,
    DOMBOT_AUTH: 'password',
    DOMBOT_SECRET: btoa('s'.repeat(32)),
    DOMBOT_PASSWORD: 'synthetic-session-regression-password',
  } as Env;
  const login = () =>
    worker.fetch(
      new Request('https://app.example/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://app.example',
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.50',
        },
        body: JSON.stringify({ password: env.DOMBOT_PASSWORD }),
      }),
      env,
    );
  const first = await login();
  expect(first.status).toBe(200);
  const cookie = first.headers.get('set-cookie')!.split(';')[0];
  const second = await login();
  const otherCookie = second.headers.get('set-cookie')!.split(';')[0];
  const status = (host = worker, value = cookie) =>
    host.fetch(
      new Request('https://app.example/auth/status', {
        headers: { cookie: value },
      }),
      env,
    );
  expect(await (await status()).json()).toMatchObject({ authenticated: true });
  const logout = await worker.fetch(
    new Request('https://app.example/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://app.example', cookie },
    }),
    env,
  );
  expect(logout.status).toBe(200);
  expect(await (await status()).json()).toMatchObject({ authenticated: false });
  // HMAC signatures have equivalent padded base64 encodings. The revocation
  // must identify the signed session rather than the raw cookie spelling.
  expect(await (await status(worker, cookie + '=')).json()).toMatchObject({
    authenticated: false,
  });
  const replay = await worker.fetch(
    new Request('https://app.example/api/getRegistrarMetadata', {
      method: 'POST',
      headers: {
        origin: 'https://app.example',
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ args: [] }),
    }),
    env,
  );
  expect(replay.status).toBe(401);
  vi.resetModules();
  const { default: fresh } = await import('./index');
  expect(await (await status(fresh)).json()).toMatchObject({
    authenticated: false,
  });
  expect(await (await status(fresh, otherCookie)).json()).toMatchObject({
    authenticated: true,
  });
});

it('rejects cross-origin password logout without claiming success', async () => {
  const response = await worker.fetch(
    new Request('https://app.example/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    }),
    {
      DB: db,
      DOMBOT_AUTH: 'password',
      DOMBOT_SECRET: btoa('c'.repeat(32)),
      DOMBOT_PASSWORD: 'synthetic-password',
    } as Env,
  );
  expect(response.status).toBe(403);
  expect(response.headers.has('set-cookie')).toBe(false);
});

it('revokes legacy cookies and fails closed when durable revocation storage is unavailable', async () => {
  const env = {
    DB: db,
    DOMBOT_AUTH: 'password',
    DOMBOT_SECRET: btoa('l'.repeat(32)),
    DOMBOT_PASSWORD: 'legacy-synthetic-password',
  } as Env;
  const key = await deriveSessionKey(
    new Uint8Array(32).fill('l'.charCodeAt(0)),
    env.DOMBOT_PASSWORD!,
  );
  const body = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ iat: Date.now(), exp: Date.now() + 60_000 }),
    ),
  );
  const signature = toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    ),
  );
  const cookie = `dombot_session=${body}.${signature}`;
  const call = (path: string, method = 'GET') =>
    worker.fetch(
      new Request('https://app.example' + path, {
        method,
        headers: { origin: 'https://app.example', cookie },
      }),
      env,
    );
  expect(await (await call('/auth/status')).json()).toMatchObject({
    authenticated: true,
  });
  const prepare = db.prepare.bind(db);
  const fault = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    if (sql.includes('session_revocations'))
      throw new Error('Synthetic unavailable revocation store');
    return prepare(sql);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const failedLogout = await call('/auth/logout', 'POST');
  expect(failedLogout.status).toBe(500);
  expect(failedLogout.headers.has('set-cookie')).toBe(false);
  expect((await call('/auth/status')).status).toBe(500);
  fault.mockRestore();
  expect((await call('/auth/logout', 'POST')).status).toBe(200);
  expect(await (await call('/auth/status')).json()).toMatchObject({
    authenticated: false,
  });
  const stored = sqlite
    .prepare('SELECT token_hash FROM session_revocations')
    .get() as { token_hash: string };
  expect(stored.token_hash).not.toContain(body);
  expect(stored.token_hash).not.toContain(signature);
});
afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

it('permits exactly one atomic encrypted grant consume across independent adapters', async () => {
  const cipher = await aesGcmCipher(new Uint8Array(32).fill(1));
  const a = new EncryptedDocStore(new D1DocStore(db), cipher);
  const b = new EncryptedDocStore(new D1DocStore(db), cipher);
  await a.put('mcp', 'code:test', { clientId: 'client' });
  const results = await Promise.all([
    a.take('mcp', 'code:test'),
    b.take('mcp', 'code:test'),
  ]);
  expect(results.filter(Boolean)).toEqual([{ clientId: 'client' }]);
});

it('limits a source atomically, without locking out other sources or extending the window', async () => {
  const now = 1000;
  const waits = await Promise.all(
    Array.from({ length: 25 }, () => reserveLoginAttempt(db, 'attacker', now)),
  );
  expect(waits.filter((n) => n === 0)).toHaveLength(LOGIN_ATTEMPTS);
  expect(await reserveLoginAttempt(db, 'owner', now)).toBe(0);
  expect(await reserveLoginAttempt(db, 'attacker', now + 5000)).toBe(
    LOGIN_WINDOW_MS - 5000,
  );
  expect(await reserveLoginAttempt(db, 'attacker', now + LOGIN_WINDOW_MS)).toBe(
    0,
  );
  await clearLoginAttempts(db, 'owner');
  expect(await reserveLoginAttempt(db, 'owner', now + LOGIN_WINDOW_MS)).toBe(0);
});

it('uses the Cloudflare source header and fails closed without it outside local development', async () => {
  const key = await deriveSessionKey(
    new Uint8Array(32).fill(1),
    'test-password',
  );
  const a = new Request('https://app.example/auth/login', {
    headers: { 'cf-connecting-ip': '192.0.2.1' },
  });
  const b = new Request(a, {
    headers: {
      'cf-connecting-ip': '192.0.2.1',
      'x-forwarded-for': '192.0.2.99',
    },
  });
  expect(await loginSource(a, key)).toBe(await loginSource(b, key));
  expect(await loginSource(a, key)).not.toContain('192.0.2.1');
  expect(
    await loginSource(new Request('https://app.example/'), key),
  ).toBeNull();
  expect(
    await loginSource(new Request('http://localhost/'), key),
  ).not.toBeNull();
});
