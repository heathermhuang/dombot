import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadBackup,
  insertBatches,
  restoreSnapshot,
} from './hosted-backup.mjs';
describe('bounded parameterized tenant restore', () => {
  it('keeps a large sealed document out of SQL text', () => {
    const value = 'a'.repeat(200000),
      batches = insertBatches({
        name: 'docs',
        columns: ['ns', 'key', 'value', 'updated_at'],
        rows: [['cache', 'portfolio', value, 1]],
      });
    expect(batches[0].sql.length).toBeLessThan(200);
    expect(batches[0].params[2]).toBe(value);
    expect(
      insertBatches({
        name: 'docs',
        columns: ['ns', 'key', 'value', 'updated_at'],
        rows: Array.from({ length: 50 }, (_, i) => [
          'test',
          String(i),
          'value',
          1,
        ]),
      }).every((b) => b.params.length <= 96),
    ).toBe(true);
  });
  it('loads a real export locally and refuses filesystem attachment', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-parse-test-'));
    try {
      const file = path.join(dir, 'backup.sql');
      await fs.writeFile(
        file,
        "CREATE TABLE docs(ns TEXT,key TEXT,value TEXT,updated_at INTEGER); INSERT INTO docs VALUES('test','one','" +
          'x'.repeat(150000) +
          "',1);",
      );
      expect(loadBackup(file).tables[0].rows[0][2].length).toBe(150000);
      await fs.writeFile(
        file,
        "ATTACH DATABASE '/private/tmp/forbidden-backup-target' AS unsafe;",
      );
      expect(() => loadBackup(file)).toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  it('refuses an existing target row outside the selected backup before inserting', async () => {
    const table = {
      name: 'docs',
      sql: 'CREATE TABLE docs(ns TEXT,key TEXT,value TEXT,updated_at INTEGER)',
      columns: ['ns', 'key', 'value', 'updated_at'],
      rows: [['private', 'one', 'expected', 1]],
    };
    let writes = 0;
    await expect(
      restoreSnapshot({ tables: [table], indexes: [] }, async (sql) => {
        if (sql.startsWith('CREATE')) return [];
        if (sql.startsWith('SELECT'))
          return [
            { ns: 'private', key: 'one', value: 'different', updated_at: 1 },
          ];
        writes++;
        return [];
      }),
    ).rejects.toThrow(/refusing overwrite/);
    expect(writes).toBe(0);
  });
});
