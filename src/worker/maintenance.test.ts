import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { readMaintenanceState } from './maintenance';

let sqlite: DatabaseSync;
let env: Env;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync('migrations/' + f, 'utf8'));
  const prepare = (sql: string) => {
    const query = sqlite.prepare(sql);
    const bind = (...params: (string | number)[]) => ({
      async all() {
        return { results: query.all(...params) };
      },
      async first() {
        return query.get(...params) ?? null;
      },
    });
    return { ...bind(), bind };
  };
  env = {
    DOMBOT_AUTH: 'gateway',
    DOMBOT_SECRET: btoa('x'.repeat(32)),
    DB: {
      prepare,
      batch: async (statements: { all(): Promise<unknown> }[]) =>
        Promise.all(statements.map((s) => s.all())),
    },
  } as unknown as Env;
});
afterEach(() => sqlite.close());
async function doc(ns: string, key: string, value: unknown) {
  const cipher = await aesGcmCipher(
    await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
  );
  const sealed = {
    __sealed: 1,
    alg: 'aes-gcm',
    ct: await cipher.seal(JSON.stringify(value)),
  };
  sqlite
    .prepare('INSERT OR REPLACE INTO docs VALUES(?,?,?,?)')
    .run(ns, key, JSON.stringify(sealed), Date.now());
}
it('allows an empty migrated account, settings and identity-only records to sleep', async () => {
  await doc('meta', 'schemaVersion', 4);
  await doc('settings', 'theme', 'light');
  await doc('mcp', 'grant:one', { secret: 'test-grant' });
  await doc('folders', 'folders', [{ id: 'empty', name: 'Empty folder' }]);
  expect(await readMaintenanceState(env)).toMatchObject({
    state: 'empty',
    reason: 'no-maintenance-work',
  });
});
it.each([
  'registrar-credentials',
  'imported-domains',
  'domain-events',
  'bulk-jobs',
  'renewal-pricing-jobs',
  'registrar-domains',
])(
  'retains maintenance for %s, independently of cached domain count',
  async (ns) => {
    await doc(ns, 'test', {
      configured: true,
      domains: [],
      enabled: false,
      lastError: 'test',
    });
    expect((await readMaintenanceState(env)).state).toBe('work');
  },
);
it('retains work for SQL publication, inquiry and retention records', async () => {
  sqlite
    .prepare('INSERT INTO portfolio_drafts VALUES(?,?,?)')
    .run('main', 'test', 'sealed');
  expect((await readMaintenanceState(env)).state).toBe('work');
  sqlite.exec('DELETE FROM portfolio_drafts');
  sqlite.prepare('INSERT INTO sales_abuse VALUES(?,?,?)').run('test', 1, 1);
  expect((await readMaintenanceState(env)).state).toBe('work');
});
it('cannot mistake corrupt credentials or an unsupported schema for empty', async () => {
  sqlite
    .prepare('INSERT INTO docs VALUES(?,?,?,?)')
    .run(
      'registrar-credentials',
      'x',
      '{"__sealed":1,"alg":"aes-gcm","ct":"corrupt"}',
      1,
    );
  expect((await readMaintenanceState(env)).state).toBe('unknown');
  sqlite.exec('DELETE FROM docs');
  await doc('meta', 'schemaVersion', 999);
  expect((await readMaintenanceState(env)).state).toBe('unknown');
});
it('retains scheduling when inspection is incomplete or a new responsibility appears', async () => {
  sqlite.exec('DROP TABLE sales_outbox');
  expect((await readMaintenanceState(env)).state).toBe('unknown');
});
it('does not guess about unknown document or SQL schemas', async () => {
  await doc('future-jobs', 'x', {});
  expect((await readMaintenanceState(env)).state).toBe('unknown');
  sqlite.exec('DELETE FROM docs; CREATE TABLE xcf_jobs(id TEXT)');
  expect((await readMaintenanceState(env)).state).toBe('unknown');
});
it('sleeps after the last real work is removed and gives a stable empty revision', async () => {
  await doc('registrar-credentials', 'x', { apiKey: 'test-only' });
  expect((await readMaintenanceState(env)).state).toBe('work');
  await doc('registrar-credentials', 'x', {});
  const first = await readMaintenanceState(env);
  expect(first.state).toBe('empty');
  expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await readMaintenanceState(env)).toEqual(first);
});
