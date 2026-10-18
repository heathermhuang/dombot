import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { isoCBOR } from '../../hosted/webauthn';
import { EmailAuth } from './email-auth';
import { Passkeys } from './passkeys';
import { Accounts } from './accounts';
import { passwordHash, tokenHash } from './crypto';
import { legalVersion } from './legal';
import gateway from './gateway';
let mf: Miniflare, db: D1Database, env: HostedEnv;
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const messages: EmailMessageBuilder[] = [];
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest();
const b64 = (v: Buffer | Uint8Array) => Buffer.from(v).toString('base64url');
const password = 'a-strong-existing-password';
const cookie = (token: string) => `__Host-dd_session=${token}`;
const post = (
  path: string,
  body: Record<string, string>,
  session?: string,
  origin = 'https://domains.domains',
) =>
  gateway.fetch(
    new Request('https://domains.domains' + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(session ? { Cookie: cookie(session) } : {}),
      },
      body: new URLSearchParams(body),
    }),
    env,
  );
function delivered() {
  const text = messages.at(-1)!.text!;
  const url = new URL(text.match(/https:\/\/\S+/)![0]);
  return {
    id: url.searchParams.get('id')!,
    token: url.searchParams.get('token')!,
    code: text.match(/browser where you requested it: (\d{6})/)![1],
    url,
  };
}
async function owner() {
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?1,?2,?3,?4,?5)',
    )
    .bind(
      'owner-id',
      'owner@example.test',
      ids[0],
      await passwordHash(password, env.AUTH_PEPPER),
      Date.now(),
    )
    .run();
  const accounts = new Accounts(db, env.AUTH_PEPPER),
    user = (await accounts.login('owner@example.test', password))!,
    token = (await accounts.newSession(user))!;
  return {
    accounts,
    user: { ...user, ...(await accounts.session(token)) },
    token,
  };
}
// An actual ES256 authenticator fixture: CBOR attestation, RP hash, UV flags,
// credential public key and signatures. No verification function is mocked.
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    }),
    jwk = publicKey.export({ format: 'jwk' }),
    id = b64(randomBytes(32));
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
    ]),
  );
  const client = (
    challenge: string,
    type: string,
    origin = 'https://domains.domains',
  ) =>
    Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  return {
    id,
    register(challenge: string, origin = 'https://domains.domains', uv = true) {
      const data = client(challenge, 'webauthn.create', origin),
        counter = Buffer.alloc(4),
        len = Buffer.alloc(2);
      len.writeUInt16BE(32);
      const auth = Buffer.concat([
        hash('domains.domains'),
        Buffer.from([uv ? 0x45 : 0x41]),
        counter,
        Buffer.alloc(16),
        len,
        Buffer.from(id, 'base64url'),
        cose,
      ]);
      return {
        id,
        rawId: id,
        type: 'public-key' as const,
        response: {
          clientDataJSON: b64(data),
          attestationObject: b64(
            isoCBOR.encode(
              new Map([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', new Uint8Array(auth)],
              ]),
            ),
          ),
          transports: ['internal' as const],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform' as const,
      };
    },
    assert(
      challenge: string,
      count: number,
      origin = 'https://domains.domains',
      uv = true,
      rp = 'domains.domains',
    ) {
      const data = client(challenge, 'webauthn.get', origin),
        counter = Buffer.alloc(4);
      counter.writeUInt32BE(count);
      const auth = Buffer.concat([
        hash(rp),
        Buffer.from([uv ? 5 : 1]),
        counter,
      ]);
      return {
        id,
        rawId: id,
        type: 'public-key' as const,
        response: {
          clientDataJSON: b64(data),
          authenticatorData: b64(auth),
          signature: b64(
            sign('sha256', Buffer.concat([auth, hash(data)]), privateKey),
          ),
          userHandle: b64(Buffer.from('owner-id')),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform' as const,
      };
    },
  };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'passwordless' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of readdirSync('hosted/migrations').sort())
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
    'DELETE FROM webauthn_challenges;DELETE FROM email_signins;DELETE FROM passkeys;DELETE FROM legal_acceptances;DELETE FROM signup_proofs;DELETE FROM email_budgets;DELETE FROM closure_requests;DELETE FROM password_resets;DELETE FROM sessions;DELETE FROM invitations;DELETE FROM users;DELETE FROM workspaces;DELETE FROM rate_limits;DELETE FROM signup_requests;',
  );
  for (const id of ids)
    await db
      .prepare('INSERT INTO workspaces(id,label) VALUES(?1,?2)')
      .bind(id, 'Private portfolio')
      .run();
  messages.length = 0;
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: 'passwordless-controlled-pepper-'.repeat(3),
    GATEWAY_KEYS: '{}',
    WORKSPACES: JSON.stringify(
      ids.map((id, i) => ({
        id,
        label: 'Private portfolio',
        binding: `WORKSPACE_${i}`,
      })),
    ),
    CANONICAL_ORIGIN: 'https://domains.domains',
    PUBLIC_REGISTRATION_ENABLED: 'true',
    PUBLIC_SIGNUP_IDS: ids.join(','),
    LEGAL_OPERATOR_NAME: 'Test Operator',
    LEGAL_JURISDICTION: 'Test jurisdiction',
    EMAIL_FROM: 'accounts@mail.domains.domains',
    EMAIL_DELIVERY_VERIFIED: 'true',
    EMAIL: {
      async send(message: EmailMessageBuilder) {
        messages.push(message);
        return { messageId: 'local-only' };
      },
    } as unknown as SendEmail,
  } as HostedEnv;
});
describe('one email flow for sign-in and signup', () => {
  it('keeps login email-first with self-hosted passkeys and an explicit password fallback', async () => {
    const r = await gateway.fetch(
        new Request('https://domains.domains/login'),
        env,
      ),
      html = await r.text();
    expect(html).toContain('Continue with email');
    expect(html).not.toContain('type="password"');
    expect(html).toContain('/login/password');
    expect(r.headers.get('Content-Security-Policy')).toContain(
      "script-src 'self'",
    );
  });
  it('stores no link or code, never consumes GET and requires legal acceptance for passwordless signup', async () => {
    expect(
      (await post('/auth/email/request', { email: 'New@EXAMPLE.test' })).status,
    ).toBe(202);
    const proof = delivered(),
      auth = new EmailAuth(env);
    const row = await db.prepare('SELECT * FROM email_signins').first();
    expect(row?.token_hash).toBe(await tokenHash(proof.token));
    expect(JSON.stringify(row)).not.toContain(proof.code);
    expect(JSON.stringify(row)).not.toContain(proof.token);
    for (let i = 0; i < 2; i++)
      expect((await gateway.fetch(new Request(proof.url), env)).status).toBe(
        200,
      );
    expect(await auth.consume(proof.id, proof.code, false, false)).toBeNull();
    const response = await post('/auth/email/confirm', {
      id: proof.id,
      code: proof.code,
      accept: 'yes',
      legalVersion,
    });
    expect(response.status).toBe(303);
    const user = await db.prepare('SELECT * FROM users').first();
    expect(user?.email).toBe('new@example.test');
    expect(user?.password_hash).toMatch(/^email-only-v1:/);
    expect(
      (await db.prepare('SELECT * FROM legal_acceptances').first())
        ?.terms_version,
    ).toBe(legalVersion);
    expect(await auth.consume(proof.id, proof.token, true, true)).toBeNull();
  });
  it('allows only one winner when link and code are raced', async () => {
    const auth = new EmailAuth(env);
    await auth.issue('race@example.test', '/app');
    const p = delivered();
    const r = await Promise.all([
      auth.consume(p.id, p.token, true, true),
      auth.consume(p.id, p.code, false, true),
      auth.consume(p.id, p.code, false, true),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(
      (await db.prepare('SELECT count(*) AS n FROM users').first())?.n,
    ).toBe(1);
    expect(
      (await db.prepare('SELECT count(*) AS n FROM sessions').first())?.n,
    ).toBe(1);
  });
  it('caps guesses at five attempts and replaces old proofs', async () => {
    const auth = new EmailAuth(env);
    await auth.issue('guess@example.test', '/app');
    const p = delivered();
    for (let i = 0; i < 5; i++)
      expect(
        await auth.consume(
          p.id,
          p.code === '999999' ? '000000' : '999999',
          false,
          true,
        ),
      ).toBeNull();
    expect(await auth.consume(p.id, p.token, true, true)).toBeNull();
    await auth.issue('guess@example.test', '/app');
    const next = delivered();
    expect(await auth.peek(p.id, p.token)).toBeNull();
    expect(await auth.consume(next.id, next.code, false, true)).not.toBeNull();
  });
  it('rejects expired proofs and foreign-origin submissions before consumption', async () => {
    const auth = new EmailAuth(env);
    await auth.issue('expiry@example.test', '/app');
    const p = delivered();
    expect(
      (
        await post(
          '/auth/email/confirm',
          { id: p.id, token: p.token, accept: 'yes', legalVersion },
          undefined,
          'https://attacker.test',
        )
      ).status,
    ).toBe(403);
    expect(await auth.peek(p.id, p.token)).not.toBeNull();
    await db.prepare('UPDATE email_signins SET expires_at=0').run();
    expect(await auth.consume(p.id, p.code, false, true)).toBeNull();
  });
  it('serializes capacity allocation without creating passwords or reusing another account identity', async () => {
    const auth = new EmailAuth(env);
    const p = [];
    for (let i = 0; i < 3; i++) {
      await auth.issue(`slot${i}@example.test`, '/app');
      p.push(delivered());
    }
    const r = await Promise.all(
      p.map((x) => auth.consume(x.id, x.code, false, true)),
    );
    expect(r.filter(Boolean)).toHaveLength(2);
    expect(
      (await db.prepare('SELECT count(*) AS n FROM users').first())?.n,
    ).toBe(2);
  });
  it('signs existing users into their same portfolio when signup is closed and rejects a proof after password rotation', async () => {
    const { accounts, user } = await owner();
    env.PUBLIC_REGISTRATION_ENABLED = 'false';
    const auth = new EmailAuth(env);
    await auth.issue(user.email, '/app');
    let p = delivered();
    const r = await auth.consume(p.id, p.code, false, false);
    expect((await accounts.session(r!.token))?.id).toBe(user.id);
    await auth.issue(user.email, '/app');
    p = delivered();
    await accounts.changePassword(user, password, 'another-strong-password');
    expect(await auth.consume(p.id, p.token, true, false)).toBeNull();
  });
  it('makes unknown/disabled responses generic, sends no mail for disabled or unqualified new accounts', async () => {
    await owner();
    env.PUBLIC_REGISTRATION_ENABLED = 'false';
    const a = await post('/auth/email/request', {
      email: 'owner@example.test',
    });
    expect(messages).toHaveLength(1);
    const b = await post('/auth/email/request', {
      email: 'unknown@example.test',
    });
    expect(messages).toHaveLength(1);
    expect(a.status).toBe(b.status);
    expect(
      (await a.text()).replace(/value="[a-f0-9]{64}"/g, 'value="ID"'),
    ).toBe((await b.text()).replace(/value="[a-f0-9]{64}"/g, 'value="ID"'));
    await db.prepare('UPDATE workspaces SET enabled=0').run();
    await new EmailAuth(env).issue('owner@example.test', '/app');
    expect(messages).toHaveLength(1);
  });
  it('binds reauthentication to its original active session and rotates that session', async () => {
    const { accounts, user, token } = await owner(),
      auth = new EmailAuth(env);
    await auth.issue(user.email, '/account', user, token);
    const p = delivered();
    expect(
      await auth.consume(p.id, p.code, false, false, 'b'.repeat(64)),
    ).toBeNull();
    const r = await auth.consume(p.id, p.code, false, false, token);
    expect(r).not.toBeNull();
    expect(await accounts.session(token)).toBeNull();
    expect((await accounts.session(r!.token))?.auth_method).toBe('email');
  });
  it('does not revive a revoked session through its pending reauthentication email', async () => {
    const { accounts, user, token } = await owner(),
      auth = new EmailAuth(env);
    await auth.issue(user.email, '/account', user, token);
    const p = delivered();
    await accounts.logout(token);
    expect(await auth.consume(p.id, p.code, false, false, token)).toBeNull();
  });
});
describe('passkeys and fresh authentication', () => {
  it('binds only a validated local return path when issuing the passkey challenge', async () => {
    for (const [next, expected] of [
      ['/account/close', '/account/close'],
      ['javascript:alert(1)', '/app'],
      ['//evil.test/path', '/app'],
      ['/w/' + ids[0] + '/settings', '/w/' + ids[0] + '/settings'],
    ]) {
      const response = await gateway.fetch(
        new Request('https://domains.domains/auth/passkeys/options', {
          method: 'POST',
          headers: {
            Origin: 'https://domains.domains',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ kind: 'login', next }),
        }),
        env,
      );
      expect(response.status).toBe(200);
      const challenge = (await response.json()) as { id: string };
      expect(
        (
          await db
            .prepare('SELECT next_path FROM webauthn_challenges WHERE id=?1')
            .bind(challenge.id)
            .first()
        )?.next_path,
      ).toBe(expected);
    }
  });
  it('verifies a real ES256 registration and login, rotates tokens, and rejects replay', async () => {
    const { accounts, user, token } = await owner(),
      keys = new Passkeys(env),
      device = authenticator(),
      r = await keys.options(
        'register',
        (await accounts.session(token)) ?? user,
        token,
      );
    expect(r.options).toHaveProperty(
      'authenticatorSelection.userVerification',
      'required',
    );
    const enrolled = await keys.verify(
      r.id,
      device.register(r.options.challenge),
      user,
      token,
    );
    expect(enrolled).not.toBeNull();
    expect(await accounts.session(token)).toBeNull();
    expect(
      await keys.verify(
        r.id,
        device.register(r.options.challenge),
        user,
        token,
      ),
    ).toBeNull();
    const a = await keys.options('login'),
      assertion = device.assert(a.options.challenge, 1);
    const results = await Promise.all([
      keys.verify(a.id, assertion),
      keys.verify(a.id, assertion),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await accounts.session(results.find(Boolean)!))?.auth_method).toBe(
      'passkey',
    );
    expect(await keys.list(user)).toHaveLength(1);
  });
  it('rejects wrong origin, wrong RP, missing verification, different challenge and rolled-back counters', async () => {
    const { accounts, user, token } = await owner(),
      keys = new Passkeys(env),
      device = authenticator(),
      r = await keys.options(
        'register',
        (await accounts.session(token)) ?? user,
        token,
      );
    expect(
      await keys.verify(
        r.id,
        device.register(r.options.challenge, 'https://evil.test'),
        user,
        token,
      ),
    ).toBeNull();
    expect(
      await keys.verify(
        r.id,
        device.register(r.options.challenge, 'https://domains.domains', false),
        user,
        token,
      ),
    ).toBeNull();
    expect(
      await keys.verify(
        r.id,
        device.register(r.options.challenge),
        user,
        token,
      ),
    ).not.toBeNull();
    for (const bad of ['origin', 'rp', 'uv', 'challenge']) {
      const a = await keys.options('login');
      expect(
        await keys.verify(
          a.id,
          device.assert(
            bad === 'challenge' ? 'wrong' : a.options.challenge,
            1,
            bad === 'origin' ? 'https://evil.test' : 'https://domains.domains',
            bad !== 'uv',
            bad === 'rp' ? 'evil.test' : 'domains.domains',
          ),
        ),
      ).toBeNull();
    }
    let a = await keys.options('login');
    expect(
      await keys.verify(a.id, device.assert(a.options.challenge, 3)),
    ).not.toBeNull();
    a = await keys.options('login');
    expect(
      await keys.verify(a.id, device.assert(a.options.challenge, 2)),
    ).toBeNull();
  });
  it('requires the original user/session and fresh existing passkey for enrollment/removal after enrollment', async () => {
    const { accounts, user, token } = await owner(),
      keys = new Passkeys(env),
      device = authenticator(),
      r = await keys.options(
        'register',
        (await accounts.session(token)) ?? user,
        token,
      );
    expect(
      await keys.verify(
        r.id,
        device.register(r.options.challenge),
        { ...user, id: 'someone-else' },
        token,
      ),
    ).toBeNull();
    const enrolled = (await keys.verify(
      r.id,
      device.register(r.options.challenge),
      user,
      token,
    ))!;
    const current = (await accounts.session(enrolled))!;
    expect(await keys.fresh(current)).toBe(true);
    const passwordSession = (await accounts.newSession(
        (await accounts.login(user.email, password))!,
      ))!,
      weak = (await accounts.session(passwordSession))!;
    expect(await keys.fresh(weak)).toBe(false);
    await expect(
      keys.options('register', weak, passwordSession),
    ).rejects.toThrow();
    expect(await keys.remove(weak, device.id, passwordSession)).toBe(false);
    const auth = new EmailAuth(env);
    await auth.issue(user.email, '/account', weak, passwordSession);
    const p = delivered();
    expect(
      await auth.consume(p.id, p.code, false, false, passwordSession),
    ).toBeNull();
    expect(await keys.remove(current, device.id, enrolled)).toBe(true);
    expect(await accounts.session(passwordSession)).toBeNull();
  });
  it('rejects enrollment if its session is revoked or expires, and expires login challenges', async () => {
    const { accounts, user, token } = await owner(),
      keys = new Passkeys(env),
      device = authenticator(),
      r = await keys.options(
        'register',
        (await accounts.session(token)) ?? user,
        token,
      );
    await accounts.logout(token);
    expect(
      await keys.verify(
        r.id,
        device.register(r.options.challenge),
        user,
        token,
      ),
    ).toBeNull();
    const a = await keys.options('login');
    await db.prepare('UPDATE webauthn_challenges SET expires_at=0').run();
    expect(
      await keys.verify(a.id, device.assert(a.options.challenge, 1)),
    ).toBeNull();
  });
  it('blocks stale browser access to credentials, backups and mutations before forwarding', async () => {
    const { token } = await owner();
    await db.prepare('UPDATE sessions SET authenticated_at=0').run();
    for (const name of [
      'getRegistrarCredentials',
      '%67etRegistrarCredentials',
      '%65xportData',
      'getProxySettings',
      'saveRegistrarCredentials',
      'connectRegistrarAccount',
      'exportData',
      'importData',
      'applyDomainOp',
    ]) {
      const response = await gateway.fetch(
        new Request(`https://domains.domains/w/${ids[0]}/api/${name}`, {
          method: 'POST',
          headers: {
            Cookie: cookie(token),
            Origin: 'https://domains.domains',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ args: [] }),
        }),
        env,
      );
      expect(response.status, name).toBe(428);
    }
    expect(
      (
        await gateway.fetch(
          new Request('https://domains.domains/account/close', {
            headers: { Cookie: cookie(token) },
          }),
          env,
        )
      ).status,
    ).toBe(303);
  });
});
