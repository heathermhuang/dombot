// Explicit operator invocation only; never runs as part of ordinary CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { withProductionQa } from './production-import-qa-lifecycle.mjs';
const { values } = parseArgs({
  options: {
    production: { type: 'boolean' },
    help: { type: 'boolean' },
    config: { type: 'string' },
    mode: { type: 'string', default: 'run' },
    'run-id': { type: 'string' },
    'lease-seconds': { type: 'string', default: '900' },
    'inject-failure': { type: 'string' },
  },
});
if (values.help) {
  console.log(
    'node scripts/production-import-qualification.mjs --production --config PRIVATE_JSON [--mode run|prepare|cleanup|status] [--run-id UUID] [--lease-seconds 60..1800] [--inject-failure after-create|after-import]',
  );
  process.exit(0);
}
assert(
  values.production && values.config,
  'Explicit --production and private --config are required',
);
assert(['run', 'prepare', 'cleanup', 'status'].includes(values.mode));
assert(
  !values['inject-failure'] ||
    ['after-create', 'after-import'].includes(values['inject-failure']),
);
const cfg = JSON.parse(await fs.readFile(values.config, 'utf8')),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert(/^[a-f0-9]{32}$/.test(cfg.accountId));
for (const name of [cfg.gateway, cfg.provisioner])
  assert(/^[a-z0-9-]{1,63}$/.test(name));
const origin = new URL(cfg.origin);
assert.equal(origin.protocol, 'https:');
assert.equal(origin.origin, cfg.origin);
assert(!origin.username && !origin.password);
const receipts = path.resolve(
  cfg.receiptsDir ?? '.wrangler/production-import-qa',
);
await fs.mkdir(receipts, { recursive: true, mode: 0o700 });
const receiptsStat = await fs.lstat(receipts);
assert(
  receiptsStat.isDirectory() &&
    !receiptsStat.isSymbolicLink() &&
    (receiptsStat.mode & 0o077) === 0,
  'QA receipts directory must be owner-only and not a symlink',
);
const clientDir = await fs.mkdtemp(path.join(receipts, 'client-'));
if (values['run-id'])
  assert(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      values['run-id'],
    ),
    'Invalid QA run ID',
  );
const sha = (x) => createHash('sha256').update(x).digest('hex'),
  write = (file, value) =>
    fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const require = createRequire(import.meta.url),
  wranglerBin = path.resolve(
    path.dirname(require.resolve('wrangler')),
    '../bin/wrangler.js',
  );
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = path.join(clientDir, 'client-private.log');
async function auth() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const file = path.join(os.homedir(), '.wrangler/config/default.toml');
  let text = await fs.readFile(file, 'utf8');
  const expiry = Date.parse(
    text.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1] ?? '',
  );
  if (expiry < Date.now() + 90000) {
    try {
      await promisify(execFile)(process.execPath, [wranglerBin, 'whoami'], {
        env: process.env,
        timeout: 60000,
      });
    } catch {
      throw Error('Cloudflare authentication unavailable');
    }
    text = await fs.readFile(file, 'utf8');
  }
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  assert(token, 'Cloudflare authentication unavailable');
  return token;
}
async function cf(endpoint) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}` + endpoint,
    {
      headers: { Authorization: 'Bearer ' + (await auth()) },
      signal: AbortSignal.timeout(60000),
    },
  );
  if (response.status === 404) {
    await response.body.cancel();
    return null;
  }
  if (!response.ok)
    throw Error('Cloudflare read unavailable: ' + response.status);
  const body = await response.json();
  assert(body.success, 'Cloudflare read rejected');
  return body.result;
}
const gateway = await cf('/workers/scripts/' + cfg.gateway + '/settings'),
  provisioner = await cf('/workers/scripts/' + cfg.provisioner + '/settings');
const val = (s, name) => s.bindings.find((b) => b.name === name),
  control = val(gateway, 'CONTROL_DB').id;
assert.equal(val(provisioner, 'CONTROL_DB').id, control);
assert.equal(val(gateway, 'CANONICAL_ORIGIN').text, cfg.origin);
assert.equal(val(gateway, 'ON_DEMAND_ENABLED').text, 'true');
assert.equal(
  val(gateway, 'ON_DEMAND_TEMPLATE_SHA256').text,
  val(provisioner, 'TEMPLATE_SHA256').text,
);
const clientConfig = path.join(clientDir, 'client-config.json');
await write(clientConfig, {
  name: 'production-import-qa-client',
  account_id: cfg.accountId,
  compatibility_date: '2026-10-01',
  d1_databases: [
    {
      binding: 'CONTROL_DB',
      database_id: control,
      database_name: 'production-qa-control',
      remote: true,
    },
  ],
  services: [
    {
      binding: 'PROVISIONER',
      service: cfg.provisioner,
      entrypoint: 'Provisioner',
      remote: true,
    },
  ],
});
const proxy = await getPlatformProxy({
    configPath: clientConfig,
    persist: false,
    envFiles: [],
  }),
  db = proxy.env.CONTROL_DB,
  service = proxy.env.PROVISIONER;
let runDir,
  lease,
  cookie = '',
  interrupted = false,
  cleanupVerified = false;
const abort = new AbortController();
const interrupt = () => {
  interrupted = true;
  abort.abort();
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const query = async (sql, params = []) =>
  (
    await db
      .prepare(sql)
      .bind(...params)
      .all()
  ).results;
async function snapshotReal() {
  return {
    users: (
      await query(
        'SELECT u.id,u.workspace_id,u.password_hash FROM users u WHERE NOT EXISTS(SELECT 1 FROM production_import_qa_runs q WHERE q.user_id=u.id) ORDER BY u.id',
      )
    ).map((u) => ({
      id: u.id,
      workspace_id: u.workspace_id,
      credential: sha(u.password_hash),
    })),
    platform: await query(
      'SELECT p.* FROM platform_workspaces p WHERE NOT EXISTS(SELECT 1 FROM production_import_qa_runs q WHERE q.workspace_id=p.workspace_id) ORDER BY p.workspace_id',
    ),
    workspaces: await query(
      'SELECT w.id,w.label,w.enabled FROM workspaces w WHERE NOT EXISTS(SELECT 1 FROM production_import_qa_runs q WHERE q.workspace_id=w.id) ORDER BY w.id',
    ),
  };
}
let baseline;
async function preserve() {
  const now = await snapshotReal();
  for (const type of ['users', 'platform', 'workspaces'])
    for (const row of baseline[type])
      assert(
        now[type].some((x) => JSON.stringify(x) === JSON.stringify(row)),
        'Pre-existing account/resource mapping changed',
      );
  if (runDir)
    await write(path.join(runDir, 'preservation.json'), {
      users: baseline.users.length,
      platformRows: baseline.platform.length,
      workspaceIdentities: baseline.workspaces.length,
      preserved: true,
    });
}
async function counts(r) {
  const name = 'dombot-wfp-' + r.workspace_id,
    databases = ((await cf('/d1/database?name=' + name)) ?? []).filter(
      (d) => d.name === name,
    ),
    script = await cf(
      '/workers/dispatch/namespaces/' +
        r.dispatch_namespace +
        '/scripts/' +
        name,
    ),
    registration = await db
      .prepare('SELECT * FROM platform_workspaces WHERE workspace_id=?')
      .bind(r.workspace_id)
      .first(),
    pending = await db
      .prepare(
        'SELECT requested_at FROM pending_workspaces WHERE workspace_id=?',
      )
      .bind(r.workspace_id)
      .first();
  return {
    workers: script?.script ? 1 : 0,
    databases: databases.length,
    databaseId: databases[0]?.uuid ?? null,
    worker: script?.script ?? null,
    registration,
    requested: pending?.requested_at ?? null,
  };
}
async function request(url, init = {}) {
  if (interrupted) throw Error('Production QA interrupted');
  return fetch(cfg.origin + url, {
    ...init,
    headers: { Cookie: cookie, Origin: cfg.origin, ...init.headers },
    redirect: 'manual',
    signal: abort.signal,
  });
}
async function api(r, name, args = []) {
  const response = await request('/w/' + r.workspace_id + '/api/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  assert.equal(response.status, 200, 'QA API status ' + response.status);
  return (await response.json()).result;
}
async function cleanup(current) {
  const id = current.run.run_id;
  let status = await service.qaStatus(id);
  if (!status) {
    // A rolled-back enrollment is harmless; an unknown committed outcome is not
    // evidence of cleanup. Confirm that neither identity nor marker exists.
    const marker = await db
      .prepare('SELECT 1 FROM production_import_qa_runs WHERE run_id=?')
      .bind(id)
      .first();
    const identity = await db
      .prepare('SELECT 1 FROM workspaces WHERE id=?')
      .bind(current.run.workspace_id)
      .first();
    assert(
      !marker && !identity,
      'QA creation outcome unresolved; inspect the server lease',
    );
    cleanupVerified = true;
    return;
  }
  for (let attempt = 0; status.state !== 'complete' && attempt < 4; attempt++) {
    if (status.state === 'blocked')
      throw Error('QA cleanup held: ' + status.lastError);
    if (status.nextCleanupAt > Date.now())
      await new Promise((resolve) =>
        setTimeout(resolve, status.nextCleanupAt - Date.now()),
      );
    try {
      await service.cleanupQa(id);
    } catch {
      /* Reconcile server checkpoint; never assume absence. */
    }
    status = await service.qaStatus(id);
  }
  assert.equal(
    status.state,
    'complete',
    'QA cleanup incomplete; expiry recovery remains armed',
  );
  const remaining = await counts(current.run);
  assert.equal(remaining.workers, 0);
  assert.equal(remaining.databases, 0);
  assert.equal(remaining.registration, null);
  assert.equal(
    (
      await query('SELECT count(*) n FROM users WHERE id=?', [
        current.run.user_id,
      ])
    )[0].n,
    0,
  );
  assert.equal(
    (
      await query('SELECT count(*) n FROM sessions WHERE user_id=?', [
        current.run.user_id,
      ])
    )[0].n,
    0,
  );
  assert.equal(status.setupKeys, 0);
  cleanupVerified = true;
  if (runDir)
    await write(path.join(runDir, 'cleanup.json'), {
      complete: true,
      status,
      workers: 0,
      databases: 0,
      at: new Date().toISOString(),
    });
}
async function scrub() {
  if (!runDir) return;
  const file = path.join(runDir, 'credentials-private.json');
  try {
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    delete current.password;
    current.credentialsDestroyedAt = new Date().toISOString();
    await write(file, current);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
try {
  if (values.mode !== 'status') baseline = await snapshotReal();
  if (values.mode === 'status') {
    assert(values['run-id']);
    console.log(JSON.stringify(await service.qaStatus(values['run-id'])));
  } else if (values.mode === 'cleanup') {
    assert(values['run-id']);
    const r = await db
      .prepare('SELECT * FROM production_import_qa_runs WHERE run_id=?')
      .bind(values['run-id'])
      .first();
    assert(r, 'Unregistered QA run');
    lease = { run: r };
    runDir = path.join(receipts, r.run_id);
    await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
    {
      const stat = await fs.lstat(runDir);
      assert(
        stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          (stat.mode & 0o077) === 0,
        'QA run directory must be private and not a symlink',
      );
    }
    try {
      await cleanup({ run: r });
      await preserve();
    } finally {
      await scrub();
    }
    console.log(JSON.stringify({ cleanupComplete: true, runId: r.run_id }));
  } else {
    const template = await service.qaTemplate();
    assert.equal(template.account, cfg.accountId);
    assert.equal(template.namespace, val(gateway, 'DISPATCHER').namespace);
    const built = await build({
      stdin: {
        contents: `export {createProductionImportQa} from './src/hosted/production-import-qa';export {readTable,guessSetup,buildRows} from './src/shared/domain-import';`,
        resolveDir: root,
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
    });
    const code = path.join(clientDir, 'runner-module.mjs');
    await fs.writeFile(code, built.outputFiles[0].contents, { mode: 0o600 });
    const helpers = await import(code + '?v=' + Date.now());
    const pepperStat = await fs.stat(cfg.authPepperFile);
    assert.equal(
      pepperStat.mode & 0o077,
      0,
      'QA pepper custody must be owner-only',
    );
    const pepper = JSON.parse(
      await fs.readFile(cfg.authPepperFile, 'utf8'),
    ).pepper;
    const start = async (prepared) => {
      const value = await helpers.createProductionImportQa(
        db,
        pepper,
        template,
        val(gateway, 'SOURCE_COMMIT').text,
        Number(values['lease-seconds']),
        async (current) => {
          lease = current;
          prepared(current);
          runDir = path.join(receipts, current.run.run_id);
          await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
          {
            const stat = await fs.lstat(runDir);
            assert(
              stat.isDirectory() &&
                !stat.isSymbolicLink() &&
                (stat.mode & 0o077) === 0,
              'QA run directory must be private and not a symlink',
            );
          }
          await fs.chmod(runDir, 0o700);
          await write(path.join(runDir, 'credentials-private.json'), current);
          await write(
            path.join(runDir, 'real-accounts-before-private.json'),
            baseline,
          );
        },
      );
      lease = value;
      const armed = await service.armQa(value.run.run_id);
      assert(armed.armed, 'QA expiry alarm was not armed');
      return value;
    };
    if (values.mode === 'prepare') {
      try {
        await start(() => {});
        if (interrupted) throw Error('Production QA interrupted');
        console.log(
          JSON.stringify({
            prepared: true,
            runId: lease.run.run_id,
            expiresAt: lease.run.expires_at,
            credentialsFile: path.join(runDir, 'credentials-private.json'),
            automaticExpiryCleanup: true,
          }),
        );
      } catch (error) {
        try {
          if (lease) await cleanup(lease);
        } finally {
          await scrub();
        }
        throw error;
      }
    } else {
      await withProductionQa({
        start,
        cleanup,
        scrub,
        preserve,
        test: async (current) => {
          const r = current.run;
          if (values['inject-failure'] === 'after-create')
            throw Error('Injected production QA failure after create');
          const response = await request('/session/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              email: r.email,
              password: current.password,
              next: '/w/' + r.workspace_id + '/',
            }),
          });
          assert.equal(response.status, 303, 'QA normal sign-in failed');
          cookie = response.headers.get('set-cookie').split(';')[0];
          await response.body.cancel();
          const before = await counts(r);
          assert.equal(before.workers, 0);
          assert.equal(before.databases, 0);
          assert.equal(before.requested, null);
          for (const url of [
            '/w/' + r.workspace_id + '/',
            '/w/' + r.workspace_id + '/import',
          ]) {
            const page = await request(url);
            assert.equal(page.status, 200);
            await page.body.cancel();
          }
          const ctx = {
              preferredCurrency: 'USD',
              numberFormat: 'us',
              registrars: [],
              today: new Date().toISOString().slice(0, 10),
            },
            table = helpers.readTable(
              'Domain,Expiration date,Renewal price,Currency,Notes\n' +
                r.domain +
                ',2027-12-31,12.50,USD,Managed production QA synthetic data',
            ),
            setup = helpers.guessSetup(table, ctx),
            preview = helpers.buildRows(table, setup, ctx);
          assert.equal(preview.rows.length, 1);
          assert(!preview.issues.some((x) => x.level === 'error'));
          const afterPreview = await counts(r);
          assert.equal(afterPreview.workers, 0);
          assert.equal(afterPreview.databases, 0);
          assert.equal(afterPreview.requested, null);
          const invalid = await request(
            '/w/' + r.workspace_id + '/api/importDomains',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                args: [[], { importId: 'invalid-empty' }],
              }),
            },
          );
          assert.equal(invalid.status, 400);
          await invalid.body.cancel();
          const importId = randomUUID(),
            saved = await api(r, 'importDomains', [preview.rows, { importId }]);
          assert.equal(saved.counts.new, 1);
          const pair = await counts(r);
          assert.equal(pair.workers, 1);
          assert.equal(pair.databases, 1);
          if (values['inject-failure'] === 'after-import')
            throw Error('Injected production QA failure after import');
          for (let i = 0; i < 2; i++) {
            const retry = await api(r, 'importDomains', [
              preview.rows,
              { importId },
            ]);
            assert.equal(retry.counts.new, 0);
            assert.equal(retry.counts.unchanged, 1);
            assert.deepEqual(await counts(r), pair);
          }
          const readback = await api(r, 'getImportedDomains');
          assert.deepEqual(Object.keys(readback), [r.domain]);
          assert.equal(readback[r.domain].expirationDate, '2027-12-31');
          const app = await api(r, 'getAppInfo');
          assert.equal(app.hosted.engineVersion, template.engine);
          assert.equal(app.hosted.engineSource, template.source);
          await write(path.join(runDir, 'test.json'), {
            passed: true,
            production: true,
            source: r.source_commit,
            openAndPreview: { workers: 0, databases: 0 },
            validSubmission: { workers: 1, databases: 1 },
            retries: 2,
            readback: true,
            at: new Date().toISOString(),
          });
        },
      });
      if (interrupted) throw Error('Production QA interrupted after cleanup');
      console.log(
        JSON.stringify({
          passed: true,
          production: true,
          runId: lease.run.run_id,
          cleanupComplete: true,
          realAccountsPreserved: true,
        }),
      );
    }
  }
} catch (error) {
  if (runDir) {
    let status;
    try {
      if (lease) status = await service.qaStatus(lease.run.run_id);
    } catch {
      /* Server lease retains recovery ownership. */
    }
    await write(path.join(runDir, 'failure.json'), {
      failed: true,
      cleanupComplete: status?.state === 'complete' && cleanupVerified,
      serverCleanupComplete: status?.state === 'complete',
      cleanupIndependentlyVerified: cleanupVerified,
      cleanupState: status?.state ?? 'unknown',
      kind: error.name,
      reasons: (error.errors ?? [error]).map((e) => ({
        name: e.name,
        message: e.message,
      })),
      at: new Date().toISOString(),
    });
  }
  console.error(
    'Production QA failed or cleanup is held; inspect protected receipts and qaStatus.',
  );
  process.exitCode = 1;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  await proxy.dispose();
}
