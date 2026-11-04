import { z } from 'zod';
import { opaqueToken, passwordHash, tokenHash } from './crypto';
import {
  templateSchema,
  type ProvisioningEnv,
  type SetupState,
} from './provisioning';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';

export interface QaTemplate {
  template: string;
  module: string;
  bootstrap: string;
  engine: string;
  source: string;
  account: string;
  namespace: string;
}
export interface QaRun {
  run_id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  label: string;
  credential_sha256: string;
  template_sha256: string;
  module_sha256: string;
  bootstrap_sha256: string;
  engine: string;
  engine_source: string;
  source_commit: string;
  account_id: string;
  dispatch_namespace: string;
  domain: string;
  manifest_sha256: string;
  created_at: number;
  expires_at: number;
  state: 'active' | 'cleaning' | 'retry' | 'blocked' | 'complete';
  cleanup_started_at: number | null;
  cleanup_trigger: 'finish' | 'expiry' | null;
  database_id: string | null;
  coordinator_id: string | null;
  worker_delete_attempted_at: number | null;
  database_delete_attempted_at: number | null;
  worker_absent: number;
  database_absent: number;
  setup_erased: number;
  attempts: number;
  next_cleanup_at: number;
  last_error: string | null;
  completed_at: number | null;
}
export interface QaJournal {
  get(): Promise<SetupState | undefined>;
  clear(): Promise<void>;
  empty(): Promise<boolean>;
}
export class QaHold extends Error {}
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const immutable = (r: QaRun) => ({
  run: r.run_id,
  workspace: r.workspace_id,
  user: r.user_id,
  email: r.email,
  label: r.label,
  credential: r.credential_sha256,
  template: r.template_sha256,
  module: r.module_sha256,
  bootstrap: r.bootstrap_sha256,
  engine: r.engine,
  engineSource: r.engine_source,
  source: r.source_commit,
  account: r.account_id,
  namespace: r.dispatch_namespace,
  domain: r.domain,
  created: r.created_at,
  expires: r.expires_at,
});
export const qaManifestSha = (run: QaRun) =>
  tokenHash(JSON.stringify(immutable(run)));
const hold = (condition: unknown) => {
  if (!condition) throw new QaHold('identity_or_data_changed');
};
export async function qaTemplate(env: ProvisioningEnv): Promise<QaTemplate> {
  const response = await env.ASSETS.fetch(
    new Request('https://assets.internal/_provision/manifest.json'),
  );
  if (!response.ok) throw Error('QA template unavailable');
  const text = await response.text();
  hold((await tokenHash(text)) === env.TEMPLATE_SHA256);
  const t = templateSchema.parse(JSON.parse(text));
  return {
    template: env.TEMPLATE_SHA256,
    module: t.moduleSha256,
    bootstrap: t.bootstrapSha256,
    engine: t.engine,
    source: t.sourceSha256,
    account: env.CF_ACCOUNT_ID,
    namespace: env.CF_DISPATCH_NAMESPACE,
  };
}
/** No caller-selected identities. All rows and the trusted marker commit together.
 * The partial unique index allows one outstanding test, including failed cleanups. */
export async function createProductionImportQa(
  db: D1Database,
  pepper: string,
  template: QaTemplate,
  source: string,
  leaseSeconds = 900,
  prepared?: (value: { run: QaRun; password: string }) => Promise<void>,
) {
  z.string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(source);
  for (const v of [
    template.template,
    template.module,
    template.bootstrap,
    template.source,
  ])
    hash.parse(v);
  z.number().int().min(60).max(1800).parse(leaseSeconds);
  const id = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    user = crypto.randomUUID(),
    password = opaqueToken(),
    credential = await passwordHash(password, pepper),
    now = Number(
      await db
        .prepare("SELECT CAST(unixepoch('now')*1000 AS INTEGER) now")
        .first('now'),
    );
  z.number().int().positive().parse(now);
  const r = {
    run_id: id,
    workspace_id: workspace,
    user_id: user,
    email: `qa-import-${id}@qa.domains.domains`,
    label: `Operator QA import ${id}`,
    credential_sha256: await tokenHash(credential),
    template_sha256: template.template,
    module_sha256: template.module,
    bootstrap_sha256: template.bootstrap,
    engine: template.engine,
    engine_source: template.source,
    source_commit: source,
    account_id: template.account,
    dispatch_namespace: template.namespace,
    domain: `qa-import-${id}.invalid`,
    created_at: now,
    expires_at: now + leaseSeconds * 1000,
    state: 'active',
    cleanup_started_at: null,
    cleanup_trigger: null,
    database_id: null,
    coordinator_id: null,
    worker_delete_attempted_at: null,
    database_delete_attempted_at: null,
    worker_absent: 0,
    database_absent: 0,
    setup_erased: 0,
    attempts: 0,
    next_cleanup_at: 0,
    last_error: null,
    completed_at: null,
    manifest_sha256: '',
  } as QaRun;
  r.manifest_sha256 = await qaManifestSha(r);
  await prepared?.({ run: structuredClone(r), password });
  const fields = Object.keys(r),
    values = Object.values(r);
  await db.batch([
    db
      .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
      .bind(workspace, r.label),
    db
      .prepare(
        'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(user, r.email, workspace, credential, now),
    db
      .prepare(
        'INSERT INTO pending_workspaces(workspace_id,created_at) VALUES(?,?)',
      )
      .bind(workspace, now),
    db
      .prepare(
        `INSERT INTO production_import_qa_runs(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`,
      )
      .bind(...values),
  ]);
  return { run: r, password };
}
export async function readQaRun(db: D1Database, id: string) {
  uuid.parse(id);
  return db
    .prepare('SELECT * FROM production_import_qa_runs WHERE run_id=?')
    .bind(id)
    .first<QaRun>();
}
async function validateRun(r: QaRun) {
  uuid.parse(r.run_id);
  uuid.parse(r.workspace_id);
  uuid.parse(r.user_id);
  hold(
    r.workspace_id !== r.user_id &&
      r.workspace_id !== r.run_id &&
      r.user_id !== r.run_id,
  );
  hold(
    r.email === `qa-import-${r.run_id}@qa.domains.domains` &&
      r.label === `Operator QA import ${r.run_id}` &&
      r.domain === `qa-import-${r.run_id}.invalid`,
  );
  hold((await qaManifestSha(r)) === r.manifest_sha256);
}
export async function qaLease(db: D1Database, id: string) {
  const run = await readQaRun(db, id);
  if (!run) throw new QaHold('unregistered_run');
  await validateRun(run);
  return run;
}
const referenceTables = [
  'admin_snapshots',
  'sync_monitor_checks',
  'sync_monitor_events',
  'sync_monitor_accounts',
  'sync_monitor_alerts',
  'renewal_pricing_checks',
  'sales_dispatch_checkpoints',
];
const allowedReferences = new Set([
  'users',
  'sessions',
  'pending_workspaces',
  'platform_workspaces',
  'production_import_qa_runs',
  'retired_platform_workspaces',
  ...referenceTables,
]);
const ident = (name: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new QaHold('unknown_schema');
  return '"' + name + '"';
};
async function checkControl(db: D1Database, r: QaRun) {
  const owner = await db
    .prepare(
      'SELECT id,workspace_id,email,password_hash FROM users WHERE id=? OR workspace_id=? OR email=?',
    )
    .bind(r.user_id, r.workspace_id, r.email)
    .all<{
      id: string;
      workspace_id: string;
      email: string;
      password_hash: string;
    }>();
  if (owner.results.length) {
    hold(owner.results.length === 1);
    const u = owner.results[0];
    hold(
      u.id === r.user_id &&
        u.workspace_id === r.workspace_id &&
        u.email === r.email &&
        (await tokenHash(u.password_hash)) === r.credential_sha256,
    );
  } else hold(r.cleanup_started_at !== null);
  const w = await db
    .prepare('SELECT label,enabled FROM workspaces WHERE id=?')
    .bind(r.workspace_id)
    .first<{ label: string; enabled: number }>();
  hold(
    w &&
      (w.label === r.label ||
        (r.cleanup_started_at !== null && w.enabled === 0)),
  );
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
    )
    .all<{ name: string }>();
  const names = tables.results
    .map((t) => t.name)
    .filter((name) => !allowedReferences.has(name));
  const descriptions = await db.batch(
    names.map((name) => db.prepare('PRAGMA table_info(' + ident(name) + ')')),
  );
  const checks: D1PreparedStatement[] = [];
  names.forEach((name, index) => {
    const columns = descriptions[index].results as { name: string }[],
      clauses: string[] = [],
      params: string[] = [];
    for (const column of [
      'workspace_id',
      'user_id',
      'actor_id',
      'target_user_id',
      'email',
    ])
      if (columns.some((c) => c.name === column)) {
        clauses.push(ident(column) + '=?');
        params.push(
          column === 'workspace_id'
            ? r.workspace_id
            : column === 'email'
              ? r.email
              : r.user_id,
        );
      }
    if (clauses.length)
      checks.push(
        db
          .prepare(
            'SELECT 1 FROM ' +
              ident(name) +
              ' WHERE ' +
              clauses.join(' OR ') +
              ' LIMIT 1',
          )
          .bind(...params),
      );
  });
  if (checks.length) {
    const references = await db.batch(checks);
    hold(references.every((result) => result.results.length === 0));
  }
}
async function freeze(db: D1Database, r: QaRun, trigger: 'finish' | 'expiry') {
  const result = await db.batch([
    db
      .prepare(
        "UPDATE production_import_qa_runs SET cleanup_started_at=COALESCE(cleanup_started_at,?),cleanup_trigger=COALESCE(cleanup_trigger,?),state='cleaning',last_error=NULL WHERE run_id=? AND manifest_sha256=? AND state<>'complete' RETURNING run_id",
      )
      .bind(Date.now(), trigger, r.run_id, r.manifest_sha256),
    db
      .prepare(
        'UPDATE workspaces SET enabled=0 WHERE id=? AND EXISTS(SELECT 1 FROM production_import_qa_runs WHERE run_id=? AND workspace_id=workspaces.id AND cleanup_started_at IS NOT NULL)',
      )
      .bind(r.workspace_id, r.run_id),
    db.prepare('DELETE FROM sessions WHERE user_id=?').bind(r.user_id),
  ]);
  hold(result[0].results.length === 1);
}
/** Private service RPC only. Never adopts a real account or selects by label/prefix.
 * Runs on the same setup queue as provisioning, and reconciles uncertain deletes. */
export async function cleanupProductionImportQa(
  env: ProvisioningEnv,
  journal: QaJournal,
  id: string,
  transport: typeof fetch = fetch,
  trigger: 'finish' | 'expiry' = 'finish',
) {
  let r = await readQaRun(env.CONTROL_DB, id);
  if (!r) throw new QaHold('unregistered_run');
  try {
    await validateRun(r);
    if (r.state === 'complete')
      return { complete: true, runId: id, alreadyComplete: true };
    hold(
      r.account_id === env.CF_ACCOUNT_ID &&
        r.dispatch_namespace === env.CF_DISPATCH_NAMESPACE,
    );
    await env.CONTROL_DB.prepare(
      'UPDATE production_import_qa_runs SET attempts=attempts+1 WHERE run_id=?',
    )
      .bind(id)
      .run();
    r.attempts++;
    await checkControl(env.CONTROL_DB, r);
    const state = await journal.get();
    if (state)
      hold(
        state.workspace === r.workspace_id &&
          state.user === r.user_id &&
          state.template === r.template_sha256,
      );
    await freeze(env.CONTROL_DB, r, trigger);
    r = (await readQaRun(env.CONTROL_DB, id))!;
    const api = async (path: string, init: RequestInit = {}) => {
      const response = await transport(
        `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
          path,
        {
          ...init,
          headers: {
            Authorization: 'Bearer ' + env.CF_PROVISIONING_TOKEN,
            ...Object.fromEntries(new Headers(init.headers)),
          },
          signal: AbortSignal.timeout(45000),
        },
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw Error('provider_unavailable');
      return response;
    };
    const json = async <T>(path: string, init: RequestInit = {}) => {
      const response = await api(path, init);
      if (!response) return null;
      const data = (await response.json()) as { success: boolean; result: T };
      if (!data.success) throw Error('provider_unavailable');
      return data.result;
    };
    const name = 'dombot-wfp-' + r.workspace_id,
      prefix =
        '/workers/dispatch/namespaces/' +
        encodeURIComponent(env.CF_DISPATCH_NAMESPACE) +
        '/scripts/' +
        name;
    if (state?.databaseId) {
      hold(!r.database_id || r.database_id === state.databaseId);
      r.database_id = uuid.parse(state.databaseId);
    }
    const found = (
      (await json<{ uuid: string; name: string }[]>(
        '/d1/database?name=' + encodeURIComponent(name),
      )) ?? []
    ).filter((d) => d.name === name);
    hold(found.length <= 1);
    let databaseMetadata: {
      uuid: string;
      name: string;
      created_at: string;
    } | null = null;
    if (r.database_id) {
      const known = await json<{
        uuid: string;
        name: string;
        created_at: string;
      }>('/d1/database/' + r.database_id);
      if (known) {
        databaseMetadata = known;
        hold(known.name === name);
        hold(!found.length || found[0].uuid === known.uuid);
        if (!found.length) found.push(known);
      } else hold(!found.length);
    }
    if (found.length) {
      hold(!!state?.createAttempted);
      hold(!state?.databaseId || state.databaseId === found[0].uuid);
      hold(!r.database_id || r.database_id === found[0].uuid);
      r.database_id = uuid.parse(found[0].uuid);
      databaseMetadata ??= await json('/d1/database/' + r.database_id);
      hold(
        databaseMetadata?.name === name &&
          Date.parse(databaseMetadata.created_at) >= r.created_at - 5000,
      );
      hold(
        !(await env.CONTROL_DB.prepare(
          'SELECT 1 FROM platform_workspaces WHERE database_id=? AND workspace_id<>?',
        )
          .bind(r.database_id, r.workspace_id)
          .first()),
      );
    }
    const content = await api(prefix + '/content');
    let settings: {
      bindings: {
        name: string;
        id?: string;
        text?: string;
        namespace_id?: string;
      }[];
    } | null = null;
    if (content) {
      hold(!!state?.uploadAttempted && !!r.database_id);
      const descriptor = await json<{ script: { created_on: string } }>(prefix);
      hold(
        descriptor?.script &&
          Date.parse(descriptor.script.created_on) >= r.created_at - 5000,
      );
      let source: string;
      if (
        content.headers.get('content-type')?.includes('multipart/form-data')
      ) {
        const parts = [...(await content.formData()).entries()].filter(([n]) =>
          /\.m?js$/.test(n),
        );
        hold(parts.length === 1);
        source =
          typeof parts[0][1] === 'string'
            ? parts[0][1]
            : await parts[0][1].text();
      } else source = await content.text();
      hold((await tokenHash(source)) === r.module_sha256);
      settings = await json(prefix + '/settings');
      hold(
        settings?.bindings.find((b) => b.name === 'DB')?.id === r.database_id &&
          settings?.bindings.find((b) => b.name === 'DOMBOT_WORKSPACE_ID')
            ?.text === r.workspace_id,
      );
      const ns = settings?.bindings.find(
        (b) => b.name === 'WORKSPACE_COORDINATOR',
      )?.namespace_id;
      hold(ns && (!r.coordinator_id || r.coordinator_id === ns));
      r.coordinator_id = ns!;
    }
    const registered = await env.CONTROL_DB.prepare(
      'SELECT * FROM platform_workspaces WHERE workspace_id=?',
    )
      .bind(r.workspace_id)
      .first<{ database_id: string }>();
    if (registered) hold(registered.database_id === r.database_id);
    if (
      !registered &&
      ((state?.createAttempted &&
        !found.length &&
        !r.database_absent &&
        !r.database_delete_attempted_at) ||
        (state?.uploadAttempted &&
          !content &&
          !r.worker_absent &&
          !r.worker_delete_attempted_at)) &&
      Date.now() - r.cleanup_started_at! < 120000
    )
      throw Error('provider_still_settling');
    await env.CONTROL_DB.prepare(
      'UPDATE production_import_qa_runs SET database_id=?,coordinator_id=? WHERE run_id=?',
    )
      .bind(r.database_id, r.coordinator_id, id)
      .run();
    if (found.length) {
      const sql = async (query: string) => {
        const value = await json<{ results: Record<string, unknown>[] }[]>(
          '/d1/database/' + r!.database_id + '/query',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: query }),
          },
        );
        hold(value?.[0]);
        return value![0].results;
      };
      for (let attempt = 0; attempt < 6; attempt++) {
        const tables = await sql(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
        );
        const names = tables.map((t) => String(t.name));
        if (!names.length) break;
        if (names.includes('root_request_leases')) {
          const leases = await sql(
            'SELECT count(*) n FROM root_request_leases',
          );
          if (Number(leases[0].n) > 0) {
            if (attempt === 5) throw Error('requests_not_drained');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
        }
        const presence = names.filter(
          (name) =>
            !['docs', 'd1_migrations', 'publication_dependencies'].includes(
              name,
            ),
        );
        if (presence.length) {
          const rows = await sql(
            'SELECT ' +
              presence
                .map(
                  (name, i) =>
                    'EXISTS(SELECT 1 FROM ' +
                    ident(name) +
                    ' LIMIT 1) AS c' +
                    i,
                )
                .join(','),
          );
          hold(presence.every((_name, i) => Number(rows[0]['c' + i]) === 0));
        }
        let documents: Record<string, unknown>[] = [];
        if (names.includes('docs')) {
          const docs = await sql('SELECT ns,key FROM docs');
          documents = docs;
          const allowed = new Set([
            'meta',
            'settings',
            'imported-domains',
            'domain-events',
            'domain-notes',
            'domain-prices',
          ]);
          for (const d of docs) {
            hold(allowed.has(String(d.ns)));
            if (
              ['imported-domains', 'domain-notes', 'domain-prices'].includes(
                String(d.ns),
              )
            )
              hold(d.key === r.domain);
          }
        }
        if (
          !content &&
          !r.worker_delete_attempted_at &&
          documents.some((d) => !['meta', 'settings'].includes(String(d.ns)))
        )
          throw Error('inspection_unavailable');
        if (content && state) {
          for (const method of [
            'getImportedDomains',
            'getDomainEvents',
            'getManualPrices',
          ]) {
            const request = new Request(
              'https://workspace.internal/api/' + method,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Origin: 'https://workspace.internal',
                },
                body: JSON.stringify({ args: [] }),
              },
            );
            request.headers.set(
              PROOF_HEADER,
              await signGatewayRequest(
                state.gateway,
                r.workspace_id,
                r.user_id,
                request,
              ),
            );
            const response = await env.DISPATCHER.get(name).fetch(request);
            if (!response.ok) throw Error('inspection_unavailable');
            const body = (await response.json()) as { result: unknown };
            if (method === 'getDomainEvents')
              hold(
                Array.isArray(body.result) &&
                  body.result.every((e) => e.domain === r!.domain) &&
                  body.result.length ===
                    documents.filter((d) => d.ns === 'domain-events').length,
              );
            else
              hold(
                body.result &&
                  typeof body.result === 'object' &&
                  Object.keys(body.result).every((key) => key === r!.domain) &&
                  Object.keys(body.result).length ===
                    documents.filter(
                      (d) =>
                        d.ns ===
                        (method === 'getImportedDomains'
                          ? 'imported-domains'
                          : 'domain-prices'),
                    ).length,
              );
          }
        }
        break;
      }
    }
    await checkControl(env.CONTROL_DB, r);
    // Preserve the standard retirement audit for an allocated pair before routing is removed.
    const priorRetirement = await env.CONTROL_DB.prepare(
      'SELECT database_id,manifest_sha256 FROM retired_platform_workspaces WHERE workspace_id=?',
    )
      .bind(r.workspace_id)
      .first<{ database_id: string; manifest_sha256: string }>();
    if (priorRetirement)
      hold(
        priorRetirement.database_id === r.database_id &&
          priorRetirement.manifest_sha256 === r.manifest_sha256,
      );
    const ops: D1PreparedStatement[] = [];
    if (r.database_id)
      ops.push(
        env.CONTROL_DB.prepare(
          'INSERT INTO retired_platform_workspaces(workspace_id,database_id,dispatch_namespace,manifest_sha256,registry_json,retired_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id) DO NOTHING',
        ).bind(
          r.workspace_id,
          r.database_id,
          env.CF_DISPATCH_NAMESPACE,
          r.manifest_sha256,
          JSON.stringify(registered ?? {}),
          Date.now(),
        ),
      );
    for (const table of referenceTables)
      ops.push(
        env.CONTROL_DB.prepare(
          'DELETE FROM ' + table + ' WHERE workspace_id=?',
        ).bind(r.workspace_id),
      );
    ops.push(
      env.CONTROL_DB.prepare(
        'DELETE FROM pending_workspaces WHERE workspace_id=?',
      ).bind(r.workspace_id),
      env.CONTROL_DB.prepare(
        'DELETE FROM platform_workspaces WHERE workspace_id=?',
      ).bind(r.workspace_id),
      env.CONTROL_DB.prepare(
        'DELETE FROM users WHERE id=? AND workspace_id=?',
      ).bind(r.user_id, r.workspace_id),
    );
    await env.CONTROL_DB.batch(ops);
    if (content) {
      await env.CONTROL_DB.prepare(
        'UPDATE production_import_qa_runs SET worker_delete_attempted_at=? WHERE run_id=?',
      )
        .bind(Date.now(), id)
        .run();
      await json(prefix, { method: 'DELETE' });
      const remaining = await api(prefix + '/content');
      if (remaining) {
        await remaining.body?.cancel();
        throw Error('worker_delete_unconfirmed');
      }
    }
    if (
      r.coordinator_id &&
      (await json('/workers/durable_objects/namespaces/' + r.coordinator_id))
    )
      throw Error('namespace_delete_unconfirmed');
    await env.CONTROL_DB.prepare(
      'UPDATE production_import_qa_runs SET worker_absent=1 WHERE run_id=?',
    )
      .bind(id)
      .run();
    if (found.length) {
      await env.CONTROL_DB.prepare(
        'UPDATE production_import_qa_runs SET database_delete_attempted_at=? WHERE run_id=?',
      )
        .bind(Date.now(), id)
        .run();
      await json('/d1/database/' + r.database_id, { method: 'DELETE' });
      if (await json('/d1/database/' + r.database_id))
        throw Error('database_delete_unconfirmed');
    }
    await env.CONTROL_DB.prepare(
      'UPDATE production_import_qa_runs SET database_absent=1 WHERE run_id=?',
    )
      .bind(id)
      .run();
    await journal.clear();
    if (!(await journal.empty())) throw Error('setup_not_empty');
    const now = Date.now();
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        'UPDATE retired_platform_workspaces SET worker_deleted_at=?,database_deleted_at=? WHERE workspace_id=? AND manifest_sha256=?',
      ).bind(now, now, r.workspace_id, r.manifest_sha256),
      env.CONTROL_DB.prepare(
        "UPDATE production_import_qa_runs SET state='complete',setup_erased=1,completed_at=?,last_error=NULL WHERE run_id=?",
      ).bind(now, id),
    ]);
    for (const key of [
      'email:' + r.email,
      'provision:' + r.workspace_id,
      'api:' + r.workspace_id,
    ])
      await env.CONTROL_DB.prepare(
        'DELETE FROM rate_limits WHERE substr(key,1,65)=?',
      )
        .bind((await tokenHash(key)) + ':')
        .run();
    return {
      complete: true,
      runId: id,
      workers: 0,
      databases: 0,
      setupKeys: 0,
    };
  } catch (error) {
    const blocked = error instanceof QaHold || error instanceof z.ZodError;
    await env.CONTROL_DB.prepare(
      "UPDATE production_import_qa_runs SET state=?,last_error=?,next_cleanup_at=? WHERE run_id=? AND state<>'complete'",
    )
      .bind(
        blocked || r.attempts >= 3 ? 'blocked' : 'retry',
        blocked
          ? 'identity_or_data_changed'
          : 'provider_or_inspection_unavailable',
        Date.now() + 120000,
        id,
      )
      .run();
    throw error;
  }
}
export async function cleanupExpiredProductionImportQa(
  env: ProvisioningEnv,
  now = Date.now(),
) {
  const rows = await env.CONTROL_DB.prepare(
    "SELECT run_id,workspace_id FROM production_import_qa_runs WHERE state IN ('active','cleaning','retry') AND expires_at<=? AND next_cleanup_at<=? AND attempts<3 ORDER BY expires_at LIMIT 1",
  )
    .bind(now, now)
    .all<{ run_id: string; workspace_id: string }>();
  for (const r of rows.results) {
    if (!uuid.safeParse(r.run_id).success) {
      await env.CONTROL_DB.prepare(
        "UPDATE production_import_qa_runs SET state='blocked',last_error='invalid_run_marker' WHERE run_id=?",
      )
        .bind(r.run_id)
        .run();
      continue;
    }
    try {
      await env.SETUPS.get(env.SETUPS.idFromName(r.workspace_id)).cleanupQa(
        r.run_id,
        'expiry',
      );
    } catch {
      console.error('Production import QA cleanup needs attention', {
        runId: r.run_id,
      });
    }
  }
}
