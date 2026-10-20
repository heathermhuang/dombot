import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { EmailAuth } from './email-auth';
import { Accounts } from './accounts';
import { registrationIds, Registration } from './registration';
import { sealPlatformKey, openPlatformKey } from './platform-keys';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
let mf: Miniflare, db: D1Database, env: HostedEnv;
const messages: EmailMessageBuilder[] = [];
const ids = Array.from({ length: 500 }, () => crypto.randomUUID());
const pepper = 'platform-local-test-pepper'.repeat(3);
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'platform-tests' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of readdirSync('hosted/migrations')
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync(`hosted/migrations/${file}`, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  for (let i = 0; i < ids.length; i += 25)
    await db.batch(
      ids
        .slice(i, i + 25)
        .flatMap((id) => [
          db
            .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
            .bind(id, 'Conference portfolio'),
          db
            .prepare(
              'INSERT INTO platform_workspaces(workspace_id,database_id,gateway_key_box,engine_version,qualified_at,signup_enabled,created_at) VALUES(?,?,?,?,1,1,1)',
            )
            .bind(id, crypto.randomUUID(), 'not-used-by-allocation', 'test'),
        ]),
    );
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: pepper,
    GATEWAY_KEYS: '{}',
    WORKSPACES: '[]',
    PLATFORM_ENABLED: 'true',
    DISPATCHER: {
      get: () => ({ fetch: async () => new Response('private platform') }),
    },
    PUBLIC_REGISTRATION_ENABLED: 'true',
    PUBLIC_SIGNUP_IDS: '',
    CANONICAL_ORIGIN: 'https://domains.domains',
    LEGAL_OPERATOR_NAME: 'Magic Crystal Limited',
    LEGAL_JURISDICTION: 'Hong Kong',
    EMAIL_FROM: 'accounts@mail.domains.domains',
    EMAIL_DELIVERY_VERIFIED: 'true',
    AUTH_EMAIL_DAILY_LIMIT: '1000',
    AUTH_EMAIL_MONTHLY_LIMIT: '10000',
    EMAIL_CAMPAIGN_ID: 'local-conference',
    EMAIL_CAMPAIGN_LIMIT: '10000',
    EMAIL_CAMPAIGN_DAILY_LIMIT: '1000',
    EMAIL: {
      async send(message: EmailMessageBuilder) {
        messages.push(message);
        return { messageId: 'local-only' };
      },
    },
  } as unknown as HostedEnv;
});
afterAll(async () => {
  await mf?.dispose();
});
describe('500 qualified platform accounts', () => {
  it('allocates 500 unique portfolios with concurrent legal/email transactions, rejects replay and account 501, and preserves a legacy owner', async () => {
    const legacy = crypto.randomUUID();
    await db
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(legacy, 'Existing customer')
      .run();
    await db
      .prepare(
        'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,1)',
      )
      .bind(
        'existing-owner',
        'existing@example.test',
        legacy,
        'unchanged-private-credential',
      )
      .run();
    const before = await db
      .prepare('SELECT * FROM users WHERE id=?')
      .bind('existing-owner')
      .first();
    const auth = new EmailAuth(env),
      proofs: { id: string; token: string }[] = [];
    for (let i = 0; i < 500; i += 25) {
      await Promise.all(
        Array.from({ length: 25 }, (_, n) =>
          auth.issue(`attendee-${i + n}@example.test`, '/account'),
        ),
      );
    }
    expect(messages).toHaveLength(500);
    for (const m of messages) {
      const u = new URL(m.text!.match(/https:\/\/\S+/)![0]);
      proofs.push({
        id: u.searchParams.get('id')!,
        token: u.searchParams.get('token')!,
      });
    }
    const sessions: string[] = [];
    for (let i = 0; i < 500; i += 25) {
      const claimed = await Promise.all(
        proofs
          .slice(i, i + 25)
          .map((p) => auth.consume(p.id, p.token, true, true)),
      );
      expect(claimed.every(Boolean)).toBe(true);
      sessions.push(...claimed.map((x) => x!.token));
    }
    const rows = await db
      .prepare("SELECT workspace_id FROM users WHERE id!='existing-owner'")
      .all<{ workspace_id: string }>();
    expect(rows.results).toHaveLength(500);
    expect(new Set(rows.results.map((x) => x.workspace_id)).size).toBe(500);
    expect(
      await db
        .prepare('SELECT count(*) AS n FROM legal_acceptances')
        .first('n'),
    ).toBe(500);
    expect(
      await db
        .prepare('SELECT * FROM users WHERE id=?')
        .bind('existing-owner')
        .first(),
    ).toEqual(before);
    expect(
      await auth.consume(proofs[0].id, proofs[0].token, true, true),
    ).toBeNull();
    expect(
      await new Registration(db, pepper, registrationIds(env)).hasCapacity(),
    ).toBe(false);
    await auth.issue('overflow@example.test', '/account');
    const u = new URL(messages.at(-1)!.text!.match(/https:\/\/\S+/)![0]);
    expect(
      await auth.consume(
        u.searchParams.get('id')!,
        u.searchParams.get('token')!,
        true,
        true,
      ),
    ).toBeNull();
    const accounts = new Accounts(db, pepper);
    const a = await accounts.session(sessions[0]),
      b = await accounts.session(sessions[1]);
    expect(a?.workspace_id).not.toBe(b?.workspace_id);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  }, 120000);
  it('authenticates encrypted keys to the exact tenant and refuses unqualified/disabled dispatch', async () => {
    const [a, b] = ids,
      key = 'local-only-private-gateway-key'.repeat(3),
      box = await sealPlatformKey(pepper, a, key);
    expect(await openPlatformKey(pepper, a, box)).toBe(key);
    await expect(openPlatformKey(pepper, b, box)).rejects.toThrow();
    await expect(
      openPlatformKey('different-pepper'.repeat(4), a, box),
    ).rejects.toThrow();
    await db
      .prepare(
        'UPDATE platform_workspaces SET gateway_key_box=? WHERE workspace_id=?',
      )
      .bind(box, a)
      .run();
    expect(await workspaceKey(env, a)).toBe(key);
    const mapped = await workspaceFor(env, a);
    expect(mapped?.binding).toBe(`PLATFORM:${a}`);
    expect(
      await (
        await workspaceService(env, mapped!.binding).fetch(
          'https://example.test',
        )
      ).text(),
    ).toBe('private platform');
    await db
      .prepare(
        'UPDATE platform_workspaces SET qualified_at=0 WHERE workspace_id=?',
      )
      .bind(a)
      .run();
    expect(await workspaceFor(env, a)).toBeNull();
    await expect(workspaceKey(env, a)).rejects.toThrow();
    expect(
      await workspaceFor({ ...env, PLATFORM_ENABLED: 'false' }, b),
    ).toBeNull();
    await db
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(b)
      .run();
    expect(await workspaceFor(env, b)).toBeNull();
  });
});
