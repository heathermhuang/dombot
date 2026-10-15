// Restore only into explicitly named isolated drill databases. Values are
// bound parameters, so a large sealed document never becomes long SQL text.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const allowed = new Set([
  'docs',
  'portfolio_drafts',
  'published_portfolios',
  'login_attempts',
  'd1_migrations',
]);
const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const identifier = (value) => {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(value))
    throw Error('Unexpected backup identifier');
  return '"' + value + '"';
};
export function loadBackup(file) {
  const python = String.raw`import sqlite3,json,sys,os
if os.path.getsize(sys.argv[1])>16*1024*1024: raise ValueError('Backup exceeds bounded restore size')
c=sqlite3.connect(':memory:');c.enable_load_extension(False)
def authorize(op,a,b,db,trigger):
 if op in (sqlite3.SQLITE_ATTACH,sqlite3.SQLITE_DETACH): return sqlite3.SQLITE_DENY
 if op==sqlite3.SQLITE_FUNCTION and (b or '').lower()=='load_extension': return sqlite3.SQLITE_DENY
 if op==sqlite3.SQLITE_PRAGMA and (a or '').lower() not in ('foreign_keys','defer_foreign_keys','table_info'): return sqlite3.SQLITE_DENY
 return sqlite3.SQLITE_OK
c.set_authorizer(authorize)
c.executescript(open(sys.argv[1],encoding='utf-8').read())
tables=[]
for name,sql in c.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").fetchall():
 cols=[r[1] for r in c.execute('PRAGMA table_info("'+name.replace('"','""')+'")')]
 rows=c.execute('SELECT * FROM "'+name.replace('"','""')+'"').fetchall()
 tables.append({'name':name,'sql':sql,'columns':cols,'rows':rows})
indexes=[r[0] for r in c.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")]
print(json.dumps({'tables':tables,'indexes':indexes}))`;
  const snapshot = JSON.parse(
    execFileSync('python3', ['-c', python, file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  if (
    snapshot.tables.some((t) => !allowed.has(t.name)) ||
    !snapshot.tables.some((t) => t.name === 'docs')
  )
    throw Error('Not a supported tenant backup');
  return snapshot;
}
export function insertBatches(table) {
  const batches = [];
  let rows = [],
    bytes = 0;
  const maxRows = Math.max(1, Math.floor(96 / table.columns.length));
  const flush = () => {
    if (!rows.length) return;
    batches.push({
      sql: `INSERT OR IGNORE INTO ${identifier(table.name)} (${table.columns.map(identifier).join(',')}) VALUES ${rows.map(() => '(' + table.columns.map(() => '?').join(',') + ')').join(',')}`,
      params: rows.flat(),
    });
    rows = [];
    bytes = 0;
  };
  for (const row of table.rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (rows.length && (rows.length >= maxRows || bytes + size > 512 * 1024))
      flush();
    rows.push(row);
    bytes += size;
  }
  flush();
  return batches;
}
export async function restoreSnapshot(
  snapshot,
  query,
  checkpoint = async () => {},
) {
  for (const table of snapshot.tables) {
    await query(
      table.sql.replace(
        /^CREATE TABLE\s+(?!IF NOT EXISTS)/i,
        'CREATE TABLE IF NOT EXISTS ',
      ),
    );
    const select = `SELECT ${table.columns.map(identifier).join(',')} FROM ${identifier(table.name)}`;
    const current = await query(select),
      expected = new Set(table.rows.map((r) => digest(r)));
    if (
      current.some(
        (row) => !expected.has(digest(table.columns.map((c) => row[c]))),
      )
    )
      throw Error(
        'Restore target contains data outside the selected backup; refusing overwrite',
      );
    for (const batch of insertBatches(table))
      await query(batch.sql, batch.params);
    const actual = await query(select);
    if (
      actual.length !== table.rows.length ||
      actual.some(
        (row) => !expected.has(digest(table.columns.map((c) => row[c]))),
      )
    )
      throw Error('Restored data differs from source backup');
    await checkpoint({
      table: table.name,
      rows: actual.length,
      hash: digest(
        actual
          .map((row) => JSON.stringify(table.columns.map((c) => row[c])))
          .sort(),
      ),
    });
  }
  for (const sql of snapshot.indexes)
    await query(
      sql.replace(
        /^CREATE (UNIQUE )?INDEX\s+(?!IF NOT EXISTS)/i,
        (_m, unique = '') => 'CREATE ' + unique + 'INDEX IF NOT EXISTS ',
      ),
    );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    option = (name) => {
      const i = args.indexOf('--' + name);
      return i < 0 ? undefined : args[i + 1];
    };
  const file = option('file'),
    cfg = JSON.parse(await fs.readFile(option('config'), 'utf8')),
    out = option('receipt');
  const db = cfg.d1_databases?.find((b) => b.binding === 'DB');
  if (
    !file ||
    !out ||
    !db ||
    !/^domains-staging-restore-[a-z0-9-]+$/.test(db.database_name) ||
    !/^[a-f0-9]{32}$/.test(cfg.account_id)
  )
    throw Error(
      'Use --file, --receipt and an isolated restore database config',
    );
  const snapshot = loadBackup(file),
    fileHash = createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  const auth =
    process.env.CLOUDFLARE_API_TOKEN ||
    (
      await fs.readFile(
        path.join(os.homedir(), '.wrangler/config/default.toml'),
        'utf8',
      )
    ).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!auth) throw Error('Operator authentication unavailable');
  const cf = async (endpoint, body) => {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfg.account_id}${endpoint}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    const v = await r.json();
    if (!r.ok || !v.success)
      throw Error(
        `Restore request incomplete: HTTP ${r.status}; reconcile the protected receipt before retrying`,
      );
    return v.result;
  };
  if ((await cf('/d1/database/' + db.database_id)).name !== db.database_name)
    throw Error('Restore target name does not match provider identity');
  let receipt;
  try {
    receipt = JSON.parse(await fs.readFile(out, 'utf8'));
    if (
      receipt.database !== db.database_id ||
      receipt.sourceSha256 !== fileHash
    )
      throw Error('Receipt does not match target/source');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    receipt = {
      database: db.database_id,
      sourceSha256: fileHash,
      status: 'pending',
      tables: [],
    };
  }
  const save = async () => {
    await fs.mkdir(path.dirname(path.resolve(out)), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(out, JSON.stringify(receipt, null, 2) + '\n', {
      mode: 0o600,
    });
    await fs.chmod(out, 0o600);
  };
  await save();
  await restoreSnapshot(
    snapshot,
    async (sql, params = []) => {
      const result = await cf(`/d1/database/${db.database_id}/query`, {
        sql,
        params,
      });
      return result[0].results;
    },
    async (proof) => {
      receipt.tables = receipt.tables.filter((t) => t.table !== proof.table);
      receipt.tables.push(proof);
      await save();
      console.log(JSON.stringify({ restored: proof.table, rows: proof.rows }));
    },
  );
  receipt.status = 'restored';
  receipt.at = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: receipt.status, receipt: out }));
}
