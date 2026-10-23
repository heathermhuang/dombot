import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import gateway from './gateway';
import { Accounts } from './accounts';
import {
  Registration,
  registrationReady,
  sendAccountEmail,
  issueRecovery,
} from './registration';
import { legalVersion } from './legal';
import { tokenHash } from './crypto';
let mf: Miniflare, db: D1Database, env: HostedEnv, registration: Registration;
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const password = 'a-strong-registration-password';
const messages: EmailMessageBuilder[] = [];
const post = (
  path: string,
  body: Record<string, string>,
  origin = 'https://domains.domains',
) =>
  gateway.fetch(
    new Request('https://domains.domains' + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    }),
    env,
  );
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'registration' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of [
    '0001_control.sql',
    '0005_passwordless_passkeys.sql',
    '0002_password_recovery.sql',
    '0003_lifecycle.sql',
    '0004_public_registration.sql',
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
    'DELETE FROM legal_acceptances;DELETE FROM signup_proofs;DELETE FROM email_budgets;DELETE FROM closure_requests;DELETE FROM password_resets;DELETE FROM sessions;DELETE FROM invitations;DELETE FROM users;DELETE FROM workspaces;DELETE FROM rate_limits;DELETE FROM signup_requests;',
  );
  for (const id of ids)
    await db
      .prepare('INSERT INTO workspaces(id,label) VALUES(?1,?2)')
      .bind(id, 'Private portfolio')
      .run();
  messages.length = 0;
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: 'test-registration-pepper'.repeat(3),
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
    PUBLIC_SIGNUP_IDS: ids.slice(0, 2).join(','),
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
  registration = new Registration(db, env.AUTH_PEPPER, ids.slice(0, 2));
});
describe('verified public account creation', () => {
  it('keeps registration closed without operator identity, verified mail or prequalified mappings', async () => {
    expect(registrationReady(env)).toBe(true);
    for (const override of [
      { LEGAL_OPERATOR_NAME: '' },
      { LEGAL_JURISDICTION: '' },
      { EMAIL: undefined },
      { EMAIL_DELIVERY_VERIFIED: 'false' },
      { PUBLIC_SIGNUP_IDS: ids[2] + ',unknown' },
      { PUBLIC_REGISTRATION_ENABLED: 'false' },
    ])
      expect(registrationReady({ ...env, ...override })).toBe(false);
    env.LEGAL_OPERATOR_NAME = '';
    expect(
      (await gateway.fetch(new Request('https://domains.domains/terms'), env))
        .status,
    ).toBe(503);
    expect(
      await (
        await gateway.fetch(new Request('https://domains.domains/'), env)
      ).text(),
    ).not.toContain('Create free account');
    expect(
      (await post('/signup/verify', { code: 'a'.repeat(64) })).status,
    ).toBe(503);
  });
  it('sends a verification link without allocating capacity, stores only its hash, and GET never consumes it', async () => {
    const response = await post('/signup', { email: 'NEW@example.test' });
    expect(response.status).toBe(202);
    expect(messages).toHaveLength(1);
    const code = new URL(
      messages[0].text!.match(/https:\/\/\S+/)![0],
    ).searchParams.get('code')!;
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (await db.prepare('SELECT count(*) AS n FROM users').first())?.n,
    ).toBe(0);
    const proof = await db.prepare('SELECT * FROM signup_proofs').first();
    expect(proof?.token_hash).toBe(await tokenHash(code));
    expect(JSON.stringify(proof)).not.toContain(code);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await gateway.fetch(
            new Request('https://domains.domains/signup/verify?code=' + code),
            env,
          )
        ).status,
      ).toBe(200);
    expect(await registration.emailFor(code)).toBe('new@example.test');
  });
  it('requires same-origin submission, matching passwords and the current explicit legal acceptance before consuming proof', async () => {
    const code = (await registration.issue('new@example.test'))!;
    const form = {
      code,
      password,
      confirm: password,
      accept: 'yes',
      legalVersion,
    };
    expect(
      (await post('/signup/verify', form, 'https://attacker.test')).status,
    ).toBe(403);
    for (const override of [
      { accept: '' },
      { legalVersion: 'old' },
      { confirm: 'different-password' },
    ])
      expect(
        (await post('/signup/verify', { ...form, ...override })).status,
      ).toBe(400);
    expect(await registration.emailFor(code)).toBe('new@example.test');
    const response = await post('/signup/verify', form);
    expect(response.status, await response.clone().text()).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('__Host-dd_session=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await registration.emailFor(code)).toBeNull();
    expect((await post('/signup/verify', form)).status).toBe(409);
    const acceptance = await db
      .prepare('SELECT * FROM legal_acceptances')
      .first();
    expect(acceptance?.terms_version).toBe(legalVersion);
    expect(acceptance?.privacy_version).toBe(legalVersion);
  });
  it('serializes racing claims without oversubscribing or selecting an unapproved tenant', async () => {
    const codes = await Promise.all(
      [0, 1, 2].map((i) => registration.issue(`race${i}@example.test`)),
    );
    const results = await Promise.allSettled(
      codes.map((code) => registration.claim(code!, password)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const users = await db
      .prepare('SELECT workspace_id FROM users')
      .all<{ workspace_id: string }>();
    expect(new Set(users.results.map((u) => u.workspace_id))).toEqual(
      new Set(ids.slice(0, 2)),
    );
    expect(await registration.hasCapacity()).toBe(false);
    expect(await registration.issue('another@example.test')).toBeNull();
    expect(
      (await post('/signup', { email: 'another@example.test' })).status,
    ).toBe(503);
  });
  it('rejects expired, superseded, and concurrently reused proofs and never claims invitation or closed slots', async () => {
    const old = await registration.issue('same@example.test');
    const code = await registration.issue('same@example.test');
    expect(await registration.emailFor(old!)).toBeNull();
    const raced = await Promise.allSettled([
      registration.claim(code!, password),
      registration.claim(code!, password),
    ]);
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const occupied = (
      await db.prepare('SELECT workspace_id FROM users').first()
    )?.workspace_id;
    const remaining = ids.slice(0, 2).find((id) => id !== occupied)!;
    await db
      .prepare(
        'INSERT INTO invitations(token_hash,email,workspace_id,expires_at) VALUES(?,?,?,?)',
      )
      .bind('reserved', 'invite@example.test', remaining, 0)
      .run();
    expect(await registration.hasCapacity()).toBe(false);
    await db.prepare('DELETE FROM invitations').run();
    await db
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(remaining)
      .run();
    expect(await registration.hasCapacity()).toBe(false);
    await db
      .prepare('UPDATE workspaces SET enabled=1 WHERE id=?')
      .bind(remaining)
      .run();
    const expired = await registration.issue('expired@example.test');
    await db
      .prepare('UPDATE signup_proofs SET expires_at=0 WHERE email=?')
      .bind('expired@example.test')
      .run();
    await expect(registration.claim(expired!, password)).rejects.toThrow();
  });
  it('supports email recovery without changing passwords until single-use proof is submitted and revokes browser sessions', async () => {
    const user = await registration.claim(
      (await registration.issue('owner@example.test'))!,
      password,
    );
    const accounts = new Accounts(db, env.AUTH_PEPPER);
    const session = await accounts.newSession(user);
    const unknown = await post('/recover/request', {
      email: 'unknown@example.test',
    });
    const known = await post('/recover/request', {
      email: 'owner@example.test',
    });
    expect(known.status).toBe(202);
    expect(await known.text()).toBe(await unknown.text());
    expect(messages).toHaveLength(1);
    const code = new URL(
      messages[0].text!.match(/https:\/\/\S+/)![0],
    ).searchParams.get('code')!;
    expect(await accounts.login(user.email, password)).not.toBeNull();
    expect(await accounts.recoverPassword(code, 'a-new-strong-password')).toBe(
      true,
    );
    expect(await accounts.session(session!)).toBeNull();
    expect(
      await accounts.recoverPassword(code, 'another-strong-password'),
    ).toBe(false);
    const replacement = await issueRecovery(db, user.email);
    expect(replacement).toMatch(/^[a-f0-9]{64}$/);
    expect(await issueRecovery(db, 'unknown@example.test')).toBeNull();
  });
  it('enforces a non-resetting campaign allowance across concurrent sends and calendar buckets', async () => {
    env.EMAIL_CAMPAIGN_ID = 'conference-test';
    env.EMAIL_CAMPAIGN_LIMIT = '5';
    env.EMAIL_CAMPAIGN_DAILY_LIMIT = '20';
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        sendAccountEmail(env, 'owner@example.test', 'a'.repeat(64), 'signup'),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(messages).toHaveLength(5);
    await db
      .prepare("DELETE FROM email_budgets WHERE bucket NOT LIKE 'campaign:%'")
      .run();
    expect(
      await sendAccountEmail(
        env,
        'owner@example.test',
        'b'.repeat(64),
        'signup',
      ),
    ).toBe(false);
    expect(messages).toHaveLength(5);
    const budget = await db
      .prepare(
        "SELECT expires_at FROM email_budgets WHERE bucket='campaign:conference-test'",
      )
      .first();
    expect(Number(budget?.expires_at)).toBeGreaterThan(
      Date.now() + 365 * 86400_000,
    );
  });
  it('fails closed on partial campaign configuration', async () => {
    env.EMAIL_CAMPAIGN_ID = 'conference-test';
    expect(
      await sendAccountEmail(
        env,
        'owner@example.test',
        'a'.repeat(64),
        'signup',
      ),
    ).toBe(false);
    expect(messages).toHaveLength(0);
  });
  it('fails closed on mail errors and reserves atomic daily/monthly budgets before concurrent sends', async () => {
    env.EMAIL = {
      async send() {
        throw Error('provider unavailable');
      },
    } as unknown as SendEmail;
    expect(
      await sendAccountEmail(
        env,
        'owner@example.test',
        'a'.repeat(64),
        'signup',
      ),
    ).toBe(false);
    env.EMAIL = {
      async send(message: EmailMessageBuilder) {
        messages.push(message);
        return { messageId: 'local-only' };
      },
    } as unknown as SendEmail;
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        sendAccountEmail(env, 'owner@example.test', 'a'.repeat(64), 'signup'),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(29);
    expect(messages).toHaveLength(29);
    await db.prepare('DELETE FROM email_budgets').run();
    await db
      .prepare('INSERT INTO email_budgets VALUES(?1,300,?2)')
      .bind(
        'month:' + new Date().toISOString().slice(0, 7),
        Date.now() + 86400_000,
      )
      .run();
    expect(
      await sendAccountEmail(
        env,
        'owner@example.test',
        'a'.repeat(64),
        'recovery',
      ),
    ).toBe(false);
  });
});
