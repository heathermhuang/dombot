import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { Accounts } from './accounts';
import { passwordHash, tokenHash } from './crypto';
let mf: Miniflare, db: D1Database, accounts: Accounts;
const pepper = 'controlled-recovery-test-pepper-'.repeat(3),
  email = 'recovery@example.test',
  password = 'original-strong-password',
  code = 'a'.repeat(64);
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'recovery-control' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of [
    '0001_control.sql',
    '0005_passwordless_passkeys.sql',
    '0002_password_recovery.sql',
    '0010_shared_mcp.sql',
  ])
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  accounts = new Accounts(db, pepper);
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.exec(
    'DELETE FROM password_resets; DELETE FROM sessions; DELETE FROM users; DELETE FROM workspaces;',
  );
  await db
    .prepare(
      "INSERT INTO workspaces(id,label) VALUES('test-workspace','Controlled recovery')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES('test-owner',?1,'test-workspace',?2,?3)",
    )
    .bind(email, await passwordHash(password, pepper), Date.now())
    .run();
});
async function issue() {
  await db
    .prepare(
      "INSERT INTO password_resets(token_hash,user_id,expires_at,operator_case) VALUES(?1,'test-owner',?2,'controlled-identity')",
    )
    .bind(await tokenHash(code), Date.now() + 900000)
    .run();
}
describe('credential changes are atomic against old verified operations', () => {
  it('refuses a late session insertion verified with the pre-recovery password', async () => {
    const old = await accounts.login(email, password);
    expect(old).not.toBeNull();
    await issue();
    expect(
      await accounts.recoverPassword(code, 'recovered-strong-password'),
    ).toBe(true);
    expect(await accounts.newSession(old!)).toBeNull();
    expect(
      (await db.prepare('SELECT count(*) AS count FROM sessions').first())
        ?.count,
    ).toBe(0);
  });
  it('refuses an in-flight old-password change that reaches persistence after recovery', async () => {
    let release!: () => void, start!: () => void;
    const started = new Promise<void>((resolve) => (start = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve));
    const delayed = new Proxy(db, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            start();
            await gate;
            return target.batch(statements);
          };
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const user = await accounts.login(email, password);
    await issue();
    const change = new Accounts(delayed, pepper).changePassword(
      user!,
      password,
      'late-old-password-change',
    );
    await started;
    expect(
      await accounts.recoverPassword(code, 'recovered-strong-password'),
    ).toBe(true);
    release();
    expect(await change).toBe(false);
    expect(await accounts.login(email, 'late-old-password-change')).toBeNull();
    expect(
      await accounts.login(email, 'recovered-strong-password'),
    ).not.toBeNull();
  });
  it('invalidates an earlier recovery link when the owner changes password normally', async () => {
    const user = await accounts.login(email, password);
    await issue();
    expect(
      await accounts.changePassword(
        user!,
        password,
        'owner-new-strong-password',
      ),
    ).toBe(true);
    expect(
      await accounts.recoverPassword(code, 'unexpected-later-password'),
    ).toBe(false);
    expect(
      await accounts.login(email, 'owner-new-strong-password'),
    ).not.toBeNull();
  });
});
