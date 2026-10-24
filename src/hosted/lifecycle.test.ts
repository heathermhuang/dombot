import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { closeWorkspace, requestAccess } from './lifecycle';
import { mcpPolicyDenial } from './mcp-policy';
let mf: Miniflare, db: D1Database;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'lifecycle' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const f of [
    '0001_control.sql',
    '0005_passwordless_passkeys.sql',
    '0011_passkey_names.sql',
    '0002_password_recovery.sql',
    '0003_lifecycle.sql',
  ])
    await db.exec(
      readFileSync('hosted/migrations/' + f, 'utf8').replace(/\n/g, ' '),
    );
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.exec(
    'DELETE FROM signup_requests;DELETE FROM closure_requests;DELETE FROM password_resets;DELETE FROM sessions;DELETE FROM users;DELETE FROM workspaces;',
  );
});
describe('bounded free-service lifecycle', () => {
  it('keeps concurrent access requests bounded and duplicate requests idempotent without allocating capacity', async () => {
    await Promise.all(
      Array.from({ length: 110 }, (_, i) =>
        requestAccess(db, `qa-${i}@example.test`),
      ),
    );
    await requestAccess(db, 'qa-0@example.test');
    expect(
      (await db.prepare('SELECT count(*) AS n FROM signup_requests').first())
        ?.n,
    ).toBe(100);
    expect(
      (await db.prepare('SELECT count(*) AS n FROM workspaces').first())?.n,
    ).toBe(0);
  });
  it('closes only the reauthenticated owner, invalidates sessions and retains the immutable mapping', async () => {
    await db.exec(
      "INSERT INTO workspaces(id,label) VALUES('one','one'),('two','two');INSERT INTO users VALUES('owner','one@example.test','one','current',0),('other','two@example.test','two','other',0);INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('a','owner',9999999999999),('b','other',9999999999999);INSERT INTO password_resets(token_hash,user_id,expires_at,operator_case) VALUES('r','owner',9999999999999,'qa');",
    );
    const user = {
      id: 'owner',
      workspace_id: 'one',
      email: 'one@example.test',
      label: 'one',
    };
    expect(await closeWorkspace(db, user, 'stale')).toBe(false);
    expect(
      (
        await db
          .prepare("SELECT enabled FROM workspaces WHERE id='one'")
          .first()
      )?.enabled,
    ).toBe(1);
    expect(await closeWorkspace(db, user, 'current')).toBe(true);
    expect(
      (
        await db
          .prepare("SELECT enabled FROM workspaces WHERE id='one'")
          .first()
      )?.enabled,
    ).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT enabled FROM workspaces WHERE id='two'")
          .first()
      )?.enabled,
    ).toBe(1);
    expect(
      (await db.prepare('SELECT count(*) AS n FROM users').first())?.n,
    ).toBe(2);
    expect(
      (await db.prepare('SELECT user_id FROM sessions').first())?.user_id,
    ).toBe('other');
    expect(
      (await db.prepare('SELECT count(*) AS n FROM password_resets').first())
        ?.n,
    ).toBe(0);
    const receipt = await db.prepare('SELECT * FROM closure_requests').first();
    expect(Number(receipt?.purge_after) - Number(receipt?.requested_at)).toBe(
      30 * 86400_000,
    );
  });
});
describe('agent access and zero spend budget', () => {
  const call = (name: string, args = {}) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  it('rejects every paid tool regardless of a broad grant or policy', () => {
    for (const name of [
      'domain_renew',
      'registrar_register_domain',
      'registrar_transfer_domain',
    ])
      expect(
        mcpPolicyDenial(
          call(name),
          'one',
          JSON.stringify({ one: { allowedTools: [name] } }),
        ),
      ).toContain('zero');
  });
  it('restricts explicit tools and account IDs without permitting portfolio-wide aggregation', () => {
    const policy = JSON.stringify({
      one: {
        allowedTools: ['domain_get', 'portfolio_query'],
        accountIds: ['account-a'],
      },
    });
    expect(
      mcpPolicyDenial(
        call('domain_get', { accountId: 'account-a' }),
        'one',
        policy,
      ),
    ).toBe(null);
    expect(
      mcpPolicyDenial(
        call('domain_get', { accountId: 'account-b' }),
        'one',
        policy,
      ),
    ).toContain('permitted');
    expect(mcpPolicyDenial(call('domain_get'), 'one', policy)).toContain(
      'permitted',
    );
    expect(
      mcpPolicyDenial(
        call('portfolio_query', { accountId: 'account-a' }),
        'one',
        policy,
      ),
    ).toContain('permitted');
    expect(
      mcpPolicyDenial(
        call('domain_dns_set', { accountId: 'account-a' }),
        'one',
        policy,
      ),
    ).toContain('outside');
    expect(mcpPolicyDenial([call('domain_get')], 'one', policy)).toContain(
      'Batch',
    );
  });
});
