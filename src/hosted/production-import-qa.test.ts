import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createProductionImportQa,
  cleanupProductionImportQa,
  cleanupExpiredProductionImportQa,
  readQaRun,
  type QaRun,
  type QaTemplate,
  type QaJournal,
} from './production-import-qa';
import type { ProvisioningEnv, SetupState } from './provisioning';
import { tokenHash } from './crypto';
import { verifyGatewayRequest } from '../shared/gateway-proof';
let mf: Miniflare,
  db: D1Database,
  env: ProvisioningEnv,
  run: QaRun,
  state: SetupState | undefined,
  journal: QaJournal;
let missingReads = false;
let oldResource: 'database' | 'worker' | null = null;
let database: boolean,
  worker: boolean,
  wrongBinding: boolean,
  badData: boolean,
  lostDelete: boolean,
  unavailable: boolean,
  deletes: string[],
  clearCount: number;
const databaseId = '33333333-3333-4333-8333-333333333333',
  realWorkspace = '44444444-4444-4444-8444-444444444444',
  realUser = '55555555-5555-4555-8555-555555555555';
const source = 'fixture tenant module';
let template: QaTemplate;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default{fetch(){return new Response("fixture")}}',
      d1Databases: { DB: 'qa-lifecycle-tests' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const name of readdirSync('hosted/migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('hosted/migrations/' + name, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  template = {
    template: 'a'.repeat(64),
    module: await tokenHash(source),
    bootstrap: 'b'.repeat(64),
    engine: 'fixture-engine',
    source: 'c'.repeat(64),
    account: 'fixture-account',
    namespace: 'fixture-namespace',
  };
});
afterAll(async () => {
  await mf?.dispose();
});
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  await db.exec(
    'DELETE FROM portfolio_addresses; DELETE FROM production_import_qa_runs; DELETE FROM retired_platform_workspaces; DELETE FROM platform_workspaces; DELETE FROM pending_workspaces; DELETE FROM sessions; DELETE FROM users; DELETE FROM sales_dispatch_checkpoints; DELETE FROM workspaces;',
  );
  await db
    .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
    .bind(realWorkspace, 'Real customer')
    .run();
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(
      realUser,
      'real@example.test',
      realWorkspace,
      'real-credential-unchanged',
      1,
    )
    .run();
  run = (
    await createProductionImportQa(
      db,
      'fixture-pepper'.repeat(4),
      template,
      'd'.repeat(40),
    )
  ).run;
  state = {
    workspace: run.workspace_id,
    user: run.user_id,
    template: run.template_sha256,
    root: 'fake-private-root',
    gateway: 'e'.repeat(64),
    databaseId,
    createAttempted: true,
    uploadAttempted: true,
  };
  database = true;
  worker = true;
  wrongBinding = false;
  badData = false;
  missingReads = false;
  oldResource = null;
  lostDelete = false;
  unavailable = false;
  deletes = [];
  clearCount = 0;
  journal = {
    get: async () => state,
    clear: async () => {
      state = undefined;
      clearCount++;
    },
    empty: async () => !state,
  };
  env = {
    CONTROL_DB: db,
    CF_ACCOUNT_ID: template.account,
    CF_DISPATCH_NAMESPACE: template.namespace,
    CF_PROVISIONING_TOKEN: 'fixture-no-real-token',
    SETUPS: {
      get: () => ({
        cleanupQa: async (
          id: string,
          trigger: 'finish' | 'expiry' = 'finish',
        ) => cleanupProductionImportQa(env, journal, id, transport, trigger),
      }),
      idFromName: (id: string) => id,
    },
    DISPATCHER: {
      get: () => ({
        fetch: async (request: Request) => {
          const proof = await verifyGatewayRequest(
            state!.gateway,
            run.workspace_id,
            request,
          );
          expect(proof?.owner).toBe(run.user_id);
          const method = new URL(request.url).pathname.split('/').at(-1);
          return Response.json({
            result: missingReads
              ? method === 'getDomainEvents'
                ? []
                : {}
              : method === 'getDomainEvents'
                ? [{ domain: run.domain }]
                : { [run.domain]: {} },
          });
        },
      }),
    },
  } as unknown as ProvisioningEnv;
});
const ok = (result: unknown) => Response.json({ success: true, result });
const transport: typeof fetch = async (input, init = {}) => {
  if (unavailable) throw Error('simulated provider outage');
  const url = new URL(String(input)),
    path = url.pathname;
  expect(new Headers(init.headers).get('Authorization')).toBe(
    'Bearer fixture-no-real-token',
  );
  if (init.method === 'DELETE') {
    deletes.push(path);
    if (path.includes('/scripts/')) {
      worker = false;
      if (lostDelete) {
        lostDelete = false;
        throw Error('lost response after deletion');
      }
    } else database = false;
    return ok(null);
  }
  if (path.endsWith('/d1/database'))
    return ok(
      database
        ? [{ uuid: databaseId, name: 'dombot-wfp-' + run.workspace_id }]
        : [],
    );
  if (path.endsWith('/d1/database/' + databaseId))
    return database
      ? ok({
          uuid: databaseId,
          name: 'dombot-wfp-' + run.workspace_id,
          created_at: new Date(
            run.created_at + (oldResource === 'database' ? -60000 : 1000),
          ).toISOString(),
        })
      : new Response('', { status: 404 });
  if (path.endsWith('/query')) {
    const sql = JSON.parse(String(init.body)).sql;
    if (sql.includes('sqlite_schema'))
      return ok([
        {
          results: [
            { name: 'docs' },
            { name: 'd1_migrations' },
            { name: 'publication_dependencies' },
            { name: 'root_request_leases' },
          ],
        },
      ]);
    if (sql === 'SELECT ns,key FROM docs')
      return ok([
        {
          results: badData
            ? [{ ns: 'registrar-credentials', key: 'real-account' }]
            : [
                { ns: 'meta', key: 'schemaVersion' },
                { ns: 'imported-domains', key: run.domain },
                { ns: 'domain-events', key: 'event-id' },
                { ns: 'domain-prices', key: run.domain },
              ],
        },
      ]);
    const aliases = [...sql.matchAll(/AS c(\d+)/g)];
    return ok([
      {
        results: [
          aliases.length
            ? Object.fromEntries(aliases.map((m) => ['c' + m[1], 0]))
            : { n: 0 },
        ],
      },
    ]);
  }
  if (path.includes('/durable_objects/namespaces/'))
    return worker
      ? ok({ id: 'f'.repeat(32) })
      : new Response('', { status: 404 });
  if (path.endsWith('/scripts/dombot-wfp-' + run.workspace_id))
    return ok({
      script: {
        created_on: new Date(
          run.created_at + (oldResource === 'worker' ? -60000 : 1000),
        ).toISOString(),
      },
    });
  if (path.endsWith('/content'))
    return worker ? new Response(source) : new Response('', { status: 404 });
  if (path.endsWith('/settings'))
    return ok({
      bindings: [
        { name: 'DB', id: wrongBinding ? realWorkspace : databaseId },
        { name: 'DOMBOT_WORKSPACE_ID', text: run.workspace_id },
        { name: 'WORKSPACE_COORDINATOR', namespace_id: 'f'.repeat(32) },
      ],
    });
  throw Error('Unexpected fixture request ' + path);
};
async function realPreserved() {
  expect(
    await db
      .prepare('SELECT password_hash FROM users WHERE id=?')
      .bind(realUser)
      .first('password_hash'),
  ).toBe('real-credential-unchanged');
  expect(
    await db
      .prepare('SELECT enabled FROM workspaces WHERE id=?')
      .bind(realWorkspace)
      .first('enabled'),
  ).toBe(1);
}
describe('managed production import QA', () => {
  it('creates only fresh control identities and atomically caps outstanding tests at one', async () => {
    expect(run.workspace_id).not.toBe(realWorkspace);
    expect(run.domain.endsWith('.invalid')).toBe(true);
    await expect(
      createProductionImportQa(
        db,
        'fixture-pepper'.repeat(4),
        template,
        'd'.repeat(40),
      ),
    ).rejects.toThrow();
    expect(await db.prepare('SELECT count(*) n FROM users').first('n')).toBe(2);
    await realPreserved();
  });
  it('does not let an intent callback relabel enrollment as a real account or a completed run', async () => {
    state = undefined;
    worker = false;
    database = false;
    await cleanupProductionImportQa(env, journal, run.run_id, transport);
    const next = await createProductionImportQa(
      db,
      'fixture-pepper'.repeat(4),
      template,
      'd'.repeat(40),
      900,
      async (intent) => {
        intent.run.workspace_id = realWorkspace;
        intent.run.state = 'complete';
      },
    );
    const saved = await readQaRun(db, next.run.run_id);
    expect(saved?.workspace_id).toBe(next.run.workspace_id);
    expect(saved?.workspace_id).not.toBe(realWorkspace);
    expect(saved?.state).toBe('active');
    await realPreserved();
  });
  it('refuses an unregistered real account and any tampered marker before provider deletion', async () => {
    await expect(
      cleanupProductionImportQa(env, journal, realWorkspace, transport),
    ).rejects.toThrow('unregistered');
    await db
      .prepare(
        'UPDATE production_import_qa_runs SET workspace_id=? WHERE run_id=?',
      )
      .bind(realWorkspace, run.run_id)
      .run();
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
    expect(clearCount).toBe(0);
    await realPreserved();
  });
  it('refuses changed credentials, setup ownership and resource bindings', async () => {
    await db
      .prepare('UPDATE users SET password_hash=? WHERE id=?')
      .bind('changed', run.user_id)
      .run();
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
  });
  it('refuses a setup object belonging to another owner', async () => {
    state!.user = realUser;
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect(clearCount).toBe(0);
    expect(deletes).toEqual([]);
    await realPreserved();
  });
  it('refuses wrong database bindings without touching real accounts', async () => {
    wrongBinding = true;
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
    await realPreserved();
  });
  it.each(['database', 'worker'] as const)(
    'refuses a %s that predates enrollment',
    async (kind) => {
      oldResource = kind;
      await expect(
        cleanupProductionImportQa(env, journal, run.run_id, transport),
      ).rejects.toThrow();
      expect(deletes).toEqual([]);
      expect(clearCount).toBe(0);
      await realPreserved();
    },
  );
  it('holds when provider credentials or real data appear in the QA database', async () => {
    badData = true;
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect((await readQaRun(db, run.run_id))?.state).toBe('blocked');
    expect(deletes).toEqual([]);
    expect(clearCount).toBe(0);
    await realPreserved();
  });
  it('refuses a forgiving empty native read when persisted records exist', async () => {
    missingReads = true;
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
    expect(clearCount).toBe(0);
    await realPreserved();
  });
  it('holds when public claims or other real-account references appear', async () => {
    await db
      .prepare(
        'INSERT INTO portfolio_addresses(handle,workspace_id,created_at) VALUES(?,?,?)',
      )
      .bind('qa-public-hold', run.workspace_id, Date.now())
      .run();
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
    await db
      .prepare('DELETE FROM portfolio_addresses WHERE workspace_id=?')
      .bind(run.workspace_id)
      .run();
  });
  it('deletes one exact pair and setup journal, revokes the account, and is idempotent', async () => {
    const result = await cleanupProductionImportQa(
      env,
      journal,
      run.run_id,
      transport,
    );
    expect(result.complete).toBe(true);
    expect(deletes).toHaveLength(2);
    expect(state).toBeUndefined();
    expect(clearCount).toBe(1);
    expect(
      await db
        .prepare('SELECT count(*) n FROM users WHERE id=?')
        .bind(run.user_id)
        .first('n'),
    ).toBe(0);
    expect((await readQaRun(db, run.run_id))?.state).toBe('complete');
    await realPreserved();
    await cleanupProductionImportQa(env, journal, run.run_id, transport);
    expect(deletes).toHaveLength(2);
  });
  it('cleans an account abandoned before any allocation without deleting any provider resource', async () => {
    state = undefined;
    database = false;
    worker = false;
    await cleanupProductionImportQa(env, journal, run.run_id, transport);
    expect(deletes).toEqual([]);
    expect((await readQaRun(db, run.run_id))?.setup_erased).toBe(1);
    await realPreserved();
  });
  it('reconciles a lost delete receipt before retrying, without a second Worker delete', async () => {
    lostDelete = true;
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow();
    expect((await readQaRun(db, run.run_id))?.state).toBe('retry');
    expect(
      (await cleanupProductionImportQa(env, journal, run.run_id, transport))
        .complete,
    ).toBe(false);
    expect(deletes).toHaveLength(1);
    await db
      .prepare(
        'UPDATE production_import_qa_runs SET next_cleanup_at=0 WHERE run_id=?',
      )
      .bind(run.run_id)
      .run();
    await cleanupProductionImportQa(env, journal, run.run_id, transport);
    expect(deletes.filter((x) => x.includes('/scripts/'))).toHaveLength(1);
    expect(deletes).toHaveLength(2);
    expect(state).toBeUndefined();
    await realPreserved();
  });
  it('waits for uncertain create outcomes instead of declaring missing receipts cleaned', async () => {
    database = false;
    worker = false;
    state!.databaseId = undefined;
    state!.uploadAttempted = false;
    await expect(
      cleanupProductionImportQa(env, journal, run.run_id, transport),
    ).rejects.toThrow('settling');
    expect(state).toBeDefined();
    expect((await readQaRun(db, run.run_id))?.state).toBe('retry');
  });
  it('prevents stale scheduler leases for cleaning QA accounts, while real customer leases still work', async () => {
    await cleanupProductionImportQa(env, journal, run.run_id, transport);
    await db
      .prepare('INSERT INTO sales_dispatch_checkpoints VALUES(?,?,?)')
      .bind(run.workspace_id, 1, 1)
      .run();
    await db
      .prepare('INSERT INTO sales_dispatch_checkpoints VALUES(?,?,?)')
      .bind(realWorkspace, 1, 1)
      .run();
    expect(
      await db
        .prepare(
          'SELECT count(*) n FROM sales_dispatch_checkpoints WHERE workspace_id=?',
        )
        .bind(run.workspace_id)
        .first('n'),
    ).toBe(0);
    expect(
      await db
        .prepare(
          'SELECT count(*) n FROM sales_dispatch_checkpoints WHERE workspace_id=?',
        )
        .bind(realWorkspace)
        .first('n'),
    ).toBe(1);
  });
  it('reaps only an expired registered run; untouched/unexpired runs are not selected', async () => {
    const dispatch = vi.fn(async () => ({ complete: true }));
    env.SETUPS = {
      get: () => ({ cleanupQa: dispatch }),
      idFromName: (id: string) => id,
    } as unknown as ProvisioningEnv['SETUPS'];
    await cleanupExpiredProductionImportQa(env);
    expect(dispatch).not.toHaveBeenCalled();
    await db
      .prepare(
        "UPDATE production_import_qa_runs SET cleanup_started_at=1,state='retry' WHERE run_id=?",
      )
      .bind(run.run_id)
      .run();
    await cleanupExpiredProductionImportQa(env);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(run.run_id, 'expiry');
    dispatch.mockClear();
    await db
      .prepare(
        "UPDATE production_import_qa_runs SET cleanup_started_at=NULL,state='active' WHERE run_id=?",
      )
      .bind(run.run_id)
      .run();
    await cleanupExpiredProductionImportQa(env, run.expires_at + 1);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(run.run_id, 'expiry');
    expect(deletes).toEqual([]);
    await realPreserved();
  });
  it('limits unavailable-provider retries and records an explicit hold', async () => {
    unavailable = true;
    for (let n = 0; n < 3; n++) {
      await expect(
        cleanupProductionImportQa(env, journal, run.run_id, transport),
      ).rejects.toThrow();
      if (n < 2)
        await db
          .prepare(
            'UPDATE production_import_qa_runs SET next_cleanup_at=0 WHERE run_id=?',
          )
          .bind(run.run_id)
          .run();
    }
    const r = await readQaRun(db, run.run_id);
    expect(r?.attempts).toBe(3);
    expect(r?.state).toBe('blocked');
    expect(deletes).toEqual([]);
    await realPreserved();
  });
});
