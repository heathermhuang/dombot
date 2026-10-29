import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sha = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw Error('Unrecognized schema identifier');
  return '"' + value + '"';
};
/** Read-only. The output is a deletion proposal, never deletion authority.
 * Any unknown schema, data, identity mismatch or provider error retains a resource. */
export async function planReserveRetirement(api, gateway, options = {}) {
  const binding = (name) => gateway.bindings.find((b) => b.name === name);
  const controlDb = binding('CONTROL_DB')?.id,
    namespace = binding('DISPATCHER')?.namespace;
  if (!controlDb || !namespace)
    throw Error('Control database and dispatch namespace required');
  const query = async (database, sql, params = []) => {
    const data = await api('/d1/database/' + database + '/query', {
      sql,
      params,
    });
    if (!Array.isArray(data) || data.some((row) => !row.success))
      throw Error('Inventory query failed');
    return data.flatMap((row) => row.results);
  };
  const candidates = await query(
    controlDb,
    `SELECT p.workspace_id,p.database_id,p.qualified_at,p.signup_enabled FROM platform_workspaces p JOIN workspaces w ON w.id=p.workspace_id WHERE w.enabled=1 AND p.qualified_at>0 AND NOT EXISTS(SELECT 1 FROM users u WHERE u.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM invitations i WHERE i.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id) ORDER BY p.workspace_id`,
  );
  const controlTables = await query(
    controlDb,
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='platform_workspaces' ORDER BY name",
  );
  const referenceTables = [];
  for (const table of controlTables) {
    const columns = await query(
      controlDb,
      `PRAGMA table_info(${identifier(table.name)})`,
    );
    if (columns.some((column) => column.name === 'workspace_id'))
      referenceTables.push(table);
  }
  const referenced = new Set();
  for (const table of referenceTables) {
    const rows = await query(
      controlDb,
      `SELECT DISTINCT workspace_id FROM ${identifier(table.name)} WHERE workspace_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(candidates.map((row) => row.workspace_id))],
    );
    for (const row of rows) referenced.add(row.workspace_id);
  }
  const migrationRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../migrations',
  );
  const knownTables = new Set();
  for (const file of (await fs.readdir(migrationRoot)).filter((f) =>
    f.endsWith('.sql'),
  )) {
    const sql = await fs.readFile(path.join(migrationRoot, file), 'utf8');
    for (const match of sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)? ([A-Za-z_][A-Za-z0-9_]*)/g,
    ))
      knownTables.add(match[1]);
  }
  const retained = [],
    proposed = [];
  let index = 0,
    fatal,
    consecutiveUnavailable = 0;
  const progress = () =>
    options.onProgress?.({
      gatewaySource: binding('SOURCE_COMMIT')?.text,
      at: new Date().toISOString(),
      proposed,
      retained,
    });
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (index < candidates.length && !fatal) {
        const candidate = candidates[index++],
          id = candidate.workspace_id;
        try {
          if (
            !/^[a-f0-9-]{36}$/.test(id) ||
            !/^[a-f0-9-]{36}$/.test(candidate.database_id)
          )
            throw Error('Invalid resource identity');
          if (referenced.has(id)) {
            retained.push({ workspace: id, reason: 'control_records_present' });
            continue;
          }
          const previous = (options.resume?.proposed ?? []).find(
            (row) =>
              row.workspace === id && row.database === candidate.database_id,
          );
          if (previous) {
            proposed.push(previous);
            continue;
          }
          const retainedCheckpoint = (options.resume?.retained ?? []).find(
            (row) => row.workspace === id,
          );
          if (retainedCheckpoint) {
            retained.push(retainedCheckpoint);
            continue;
          }
          const script = 'dombot-wfp-' + id;
          const settings = await api(
            '/workers/dispatch/namespaces/' +
              encodeURIComponent(namespace) +
              '/scripts/' +
              script +
              '/settings',
          );
          if (
            settings.bindings.find((b) => b.name === 'DB')?.id !==
              candidate.database_id ||
            settings.bindings.find((b) => b.name === 'DOMBOT_WORKSPACE_ID')
              ?.text !== id
          ) {
            retained.push({
              workspace: id,
              reason: 'binding_identity_mismatch',
            });
            continue;
          }
          const coordinator = settings.bindings.find(
            (b) => b.name === 'WORKSPACE_COORDINATOR',
          )?.namespace_id;
          if (!coordinator) {
            retained.push({
              workspace: id,
              reason: 'coordinator_identity_unavailable',
            });
            continue;
          }
          const tables = await query(
            candidate.database_id,
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY name",
          );
          if (
            !tables.some((t) => t.name === 'docs') ||
            tables.some((t) => !knownTables.has(t.name))
          ) {
            retained.push({ workspace: id, reason: 'unknown_database_schema' });
            continue;
          }
          const [countRow] = await query(
            candidate.database_id,
            'SELECT ' +
              tables
                .map(
                  (table) =>
                    `(SELECT COUNT(*) FROM ${identifier(table.name)}) AS ${identifier(table.name)}`,
                )
                .join(','),
          );
          const counts = Object.entries(countRow ?? {}).map(([name, n]) => ({
            name,
            n,
          }));
          if (
            counts.length !== tables.length ||
            counts.some(
              (table) => !Number.isSafeInteger(table.n) || table.n !== 0,
            )
          ) {
            retained.push({
              workspace: id,
              reason: 'database_records_present',
            });
            continue;
          }
          proposed.push({
            workspace: id,
            observedAt: new Date().toISOString(),
            script,
            database: candidate.database_id,
            coordinator,
            settingsSha256: sha(settings),
            emptyTables: counts.map((table) => table.name),
            qualifiedAt: candidate.qualified_at,
            signupEnabled: candidate.signup_enabled,
          });

          consecutiveUnavailable = 0;
        } catch (error) {
          if (
            error.status === 404 ||
            error.status >= 500 ||
            ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
          ) {
            retained.push({
              workspace: id,
              reason: 'provider_read_unavailable',
              status: error.status ?? null,
            });
            if (++consecutiveUnavailable >= 3) fatal = error;
          } else fatal = error;
        } finally {
          await progress();
        }
      }
    }),
  );
  if (fatal) throw fatal;
  if (new Set(proposed.map((row) => row.coordinator)).size !== proposed.length)
    throw Error('Shared coordinator detected; no retirement plan issued');
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    gatewaySource: binding('SOURCE_COMMIT')?.text,
    controlDb,
    namespace,
    candidates: candidates.length,
    proposed: proposed.sort((a, b) => a.workspace.localeCompare(b.workspace)),
    retained: retained.sort((a, b) => a.workspace.localeCompare(b.workspace)),
    providerMutations: 0,
  };
  return { manifest, sha256: sha(manifest) };
}

export function providerErrorSummary(endpoint, status, errors) {
  const number = Number(status);
  return {
    phase: endpoint.startsWith('/d1/') ? 'database-read' : 'worker-read',
    status:
      Number.isSafeInteger(number) && number >= 100 && number <= 599
        ? number
        : 0,
    codes: (Array.isArray(errors) ? errors : [])
      .map((error) => Number(error?.code))
      .filter(
        (code) => Number.isSafeInteger(code) && code > 0 && code < 1000000000,
      ),
  };
}

async function main() {
  const [account, output] = process.argv.slice(2),
    token = process.env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !output || !token)
    throw Error(
      'Usage: CLOUDFLARE_API_TOKEN=<existing credential> node scripts/plan-reserve-retirement.mjs ACCOUNT OUTPUT',
    );
  const api = async (endpoint, query) => {
    const response = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + account + endpoint,
      {
        method: query ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          ...(query ? { 'Content-Type': 'application/json' } : {}),
        },
        body: query ? JSON.stringify(query) : undefined,
        signal: AbortSignal.timeout(45000),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      await fs.writeFile(
        output + '.error.json',
        JSON.stringify(
          providerErrorSummary(endpoint, response.status, data.errors),
          null,
          2,
        ),
        { mode: 0o600 },
      );
      throw Object.assign(
        Error('Read-only inventory stopped: HTTP ' + response.status),
        { status: response.status },
      );
    }
    if (!data.success) throw Error('Read-only inventory rejected');
    return data.result;
  };
  const gateway = await api('/workers/scripts/domains-staging/settings');
  let resume;
  try {
    resume = JSON.parse(await fs.readFile(output + '.partial.json', 'utf8'));
  } catch {
    /* No saved checkpoint. */
  }
  if (
    resume?.gatewaySource !==
      gateway.bindings.find((b) => b.name === 'SOURCE_COMMIT')?.text ||
    Date.now() - Date.parse(resume?.at) > 30 * 60000
  )
    resume = undefined;
  let saving = Promise.resolve(),
    completed = 0;
  const result = await planReserveRetirement(api, gateway, {
    resume,
    onProgress: async (checkpoint) => {
      const count = checkpoint.proposed.length + checkpoint.retained.length;
      if (count - completed < 20) return;
      completed = count;
      const bytes = JSON.stringify(checkpoint, null, 2) + '\n';
      saving = saving.then(() =>
        fs.writeFile(output + '.partial.json', bytes, { mode: 0o600 }),
      );
      await saving;
      console.log(JSON.stringify({ checked: count }));
    },
  });
  await saving;
  await fs.writeFile(
    output,
    JSON.stringify({ account, ...result }, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      candidates: result.manifest.candidates,
      verifiedEmpty: result.manifest.proposed.length,
      retained: result.manifest.retained.length,
      manifestSha256: result.sha256,
      providerMutations: 0,
    }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
