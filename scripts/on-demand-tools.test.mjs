import { describe, expect, it } from 'vitest';
import { sqlStatements } from './prepare-on-demand.mjs';
import {
  planReserveRetirement,
  providerErrorSummary,
} from './plan-reserve-retirement.mjs';

describe('provisioning preparation', () => {
  it('keeps complete trigger bodies, nested CASE and quoted END text together', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const sql =
      "CREATE TABLE x(n INTEGER); CREATE TABLE changes(n INTEGER); CREATE TRIGGER bump AFTER INSERT ON x BEGIN INSERT INTO changes VALUES(CASE WHEN NEW.n>0 THEN 1 ELSE 0 END); UPDATE changes SET n=n+length('END;'); END; INSERT INTO x VALUES(1);";
    const statements = sqlStatements(sql);
    expect(statements).toHaveLength(4);
    const db = new DatabaseSync(':memory:');
    try {
      for (const statement of statements) db.exec(statement);
      expect(db.prepare('SELECT n FROM changes').get().n).toBe(5);
    } finally {
      db.close();
    }
    expect(() =>
      sqlStatements('CREATE TRIGGER bad AFTER INSERT ON x BEGIN SELECT 1;'),
    ).toThrow('Incomplete SQL');
  });
  it('keeps semicolons in SQL literals and strips comments without changing statements', () => {
    expect(
      sqlStatements(
        "-- comment;\nCREATE TABLE x(a TEXT); INSERT INTO x VALUES('a'';b'); /* another; */ SELECT \"a;b\";",
      ),
    ).toEqual([
      'CREATE TABLE x(a TEXT)',
      "INSERT INTO x VALUES('a'';b')",
      'SELECT "a;b"',
    ]);
    expect(() => sqlStatements("SELECT 'unterminated")).toThrow(
      'Incomplete SQL',
    );
  });
});

describe('read-only reserve retirement proposal', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const databases = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const gateway = {
    bindings: [
      { name: 'CONTROL_DB', id: 'control' },
      { name: 'DISPATCHER', namespace: 'fixture' },
      { name: 'SOURCE_COMMIT', text: 'test-source' },
    ],
  };
  function provider({ nonempty = false, unavailable = false } = {}) {
    return async (endpoint, body) => {
      // No request may delete or mutate provider/customer records.
      if (body) expect(body.sql).toMatch(/^(SELECT|PRAGMA) /);
      if (endpoint.includes('/scripts/')) {
        const i = endpoint.includes(ids[0]) ? 0 : 1;
        if (unavailable && i === 1)
          throw Object.assign(Error('provider unavailable'), { status: 500 });
        return {
          bindings: [
            { name: 'DB', id: databases[i] },
            { name: 'DOMBOT_WORKSPACE_ID', text: ids[i] },
            { name: 'WORKSPACE_COORDINATOR', namespace_id: 'coordinator-' + i },
          ],
        };
      }
      let result;
      if (endpoint.includes('/control/')) {
        result = body.sql.startsWith('SELECT p.workspace_id')
          ? ids.map((id, i) => ({
              workspace_id: id,
              database_id: databases[i],
              qualified_at: 1,
              signup_enabled: 1,
            }))
          : [];
      } else if (body.sql.startsWith('SELECT name FROM sqlite_schema'))
        result = [{ name: 'docs' }];
      else
        result = [
          { docs: nonempty && endpoint.includes(databases[1]) ? 1 : 0 },
        ];
      return [{ success: true, results: result }];
    };
  }
  it('proposes only empty unowned resources and records the others as retained', async () => {
    const { manifest, sha256 } = await planReserveRetirement(
      provider({ nonempty: true }),
      gateway,
    );
    expect(manifest.proposed.map((row) => row.workspace)).toEqual([ids[0]]);
    expect(manifest.retained).toEqual([
      { workspace: ids[1], reason: 'database_records_present' },
    ]);
    expect(manifest.providerMutations).toBe(0);
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('retains a resource whose provider reading fails while preserving the completed proposal', async () => {
    const { manifest } = await planReserveRetirement(
      provider({ unavailable: true }),
      gateway,
    );
    expect(manifest.proposed).toHaveLength(1);
    expect(manifest.retained).toEqual([
      { workspace: ids[1], reason: 'provider_read_unavailable', status: 500 },
    ]);
  });
});

describe('provider failure receipts', () => {
  it('retains bounded status/codes without writing provider-controlled messages or request data', () => {
    const receipt = providerErrorSummary('/d1/database/private/query', 429, [
      { code: 7429, message: 'secret; ../../file' },
      { code: '../unsafe' },
      { code: -1 },
    ]);
    expect(receipt).toEqual({
      phase: 'database-read',
      status: 429,
      codes: [7429],
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /secret|private|unsafe|message|query/,
    );
  });
});
