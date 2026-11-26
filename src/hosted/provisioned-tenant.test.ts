import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import {
  bootstrapStatements,
  sqlStatements,
} from '../../scripts/prepare-on-demand.mjs';
import { tokenHash } from './crypto';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';

let script: string, schema: string, mf: Miniflare | undefined;
const workspace = '11111111-1111-4111-8111-111111111111',
  key = 'test-bootstrap-gateway-key'.repeat(3);
beforeAll(async () => {
  script = (
    await build({
      entryPoints: ['src/hosted/provisioned-tenant.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      external: ['cloudflare:*', 'node:*'],
    })
  ).outputFiles[0].text;
  schema = JSON.stringify({
    statements: bootstrapStatements(
      readdirSync('migrations')
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((file) => [file, readFileSync('migrations/' + file, 'utf8')]),
    ),
  });
});
afterEach(async () => {
  await mf?.dispose();
  mf = undefined;
});
async function create() {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script,
      compatibilityDate: '2026-09-09',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'bootstrap' },
      durableObjects: {
        WORKSPACE_COORDINATOR: {
          className: 'WorkspaceCoordinator',
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response('fixture assets') },
      bindings: {
        DOMBOT_AUTH: 'gateway',
        DOMBOT_GATEWAY_SECRET: key,
        DOMBOT_WORKSPACE_ID: workspace,
        DOMBOT_PUBLIC_BASE_PATH: '/w/' + workspace,
        DOMBOT_SECRET: btoa('b'.repeat(32)),
        DOMBOT_PLATFORM_ALARMS: 'true',
        DOMBOT_EMPTY_SLEEP: 'true',
        DOMBOT_BOOTSTRAP_SHA256: await tokenHash(schema),
      },
    }),
  );
  return await mf.getD1Database('DB');
}
async function call(
  path = '/platform-internal/bootstrap',
  body = schema,
  owner: string | null = null,
) {
  const request = new Request('http://localhost' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body,
  });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(key, workspace, owner, request),
  );
  return mf!.dispatchFetch(request);
}
describe('new tenant schema bootstrap', () => {
  it('applies the real schema atomically, reconciles a repeated bootstrap, and runs the pinned tenant engine', async () => {
    const db = await create();
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect(
      await db.prepare('SELECT count(*) n FROM d1_migrations').first('n'),
    ).toBe(1);
    expect(
      await db
        .prepare("SELECT name FROM sqlite_schema WHERE name='sales_leads'")
        .first('name'),
    ).toBe('sales_leads');
    const response = await call(
      '/api/getAppInfo',
      JSON.stringify({ args: [] }),
      'qualification',
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const manifest = JSON.parse(
      readFileSync(
        'node_modules/@domains-domains/dombot-engine/engine-manifest.json',
        'utf8',
      ),
    );
    expect(response.headers.get('X-DomBot-Engine')).toBe(manifest.version);
    const health = (await (
      await call('/platform-internal/reconcile', '')
    ).json()) as { alarmAt: null; maintenance: { policy: boolean } };
    expect(health.alarmAt, JSON.stringify(health)).toBeNull();
    expect(health.maintenance.policy).toBe(true);
  });
  it('rejects owner proofs and altered schema without writing tables', async () => {
    const db = await create();
    expect(
      (await call('/platform-internal/bootstrap', schema, 'owner')).status,
    ).toBe(403);
    expect(
      (await call('/platform-internal/bootstrap', schema + ' ')).status,
    ).toBe(400);
    expect(
      await db
        .prepare("SELECT count(*) n FROM sqlite_schema WHERE name='docs'")
        .first('n'),
    ).toBe(0);
  });
  it('preserves listed cases, messages, links and outbox rows across the unlisted tenant migration', async () => {
    const db = await create();
    const apply = (file: string) =>
      db.batch(
        sqlStatements(readFileSync('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      );
    for (const file of readdirSync('migrations')
      .filter((file) => file.endsWith('.sql') && !file.startsWith('0013'))
      .sort())
      await apply(file);
    await db.batch([
      db.prepare(
        "INSERT INTO sale_drafts(id,domain_hash,revision,operational_revision,availability,updated_at,sealed) VALUES('listing','digest','revision','operational','available',1,'draft')",
      ),
      db.prepare(
        "INSERT INTO sales_leads(id,listing_id,request_hash,payload_hash,email_hash,revision,verification,created_at,updated_at,sealed) VALUES('case','listing','request','payload','email','state','verified',1,1,'case cipher')",
      ),
      db.prepare(
        "INSERT INTO sales_messages(id,lead_id,request_hash,payload_hash,direction,created_at,sealed,sequence) VALUES('reply','case','message-request','message-payload','reply',1,'reply cipher',1)",
      ),
      db.prepare(
        "INSERT INTO sales_tokens(token_hash,purpose,lead_id,expires_at,grant_id) VALUES('token','thread','case',2,'confirmation-thread')",
      ),
      db.prepare(
        "INSERT INTO sales_outbox(id,dedupe_key,lead_id,kind,state,due_at,sealed,updated_at) VALUES('mail','dedupe','case','buyer-reply','accepted',1,'mail cipher',1)",
      ),
    ]);
    const tables = [
      'sales_leads',
      'sales_messages',
      'sales_tokens',
      'sales_outbox',
    ];
    const read = async () =>
      (
        await Promise.all(
          tables.map((table) => db.prepare('SELECT * FROM ' + table).all()),
        )
      ).map(({ results }) => results);
    const before = await read();
    await apply('0013_unlisted_domain_inquiries.sql');
    expect(await read()).toEqual(before);
    expect(
      (
        await db
          .prepare(
            `SELECT "notnull" AS required FROM pragma_table_info('sales_leads') WHERE name='listing_id'`,
          )
          .first()
      ).required,
    ).toBe(0);
    await db.prepare("DELETE FROM sale_drafts WHERE id='listing'").run();
    expect(await read()).toEqual([[], [], [], []]);
  });

  it('refuses an existing database and preserves its records', async () => {
    const db = await create();
    await db.exec(
      "CREATE TABLE customer_data (value TEXT); INSERT INTO customer_data VALUES('keep');",
    );
    expect((await call()).status).toBe(409);
    expect(
      await db.prepare('SELECT value FROM customer_data').first('value'),
    ).toBe('keep');
  });
  it('rolls back the entire schema batch on failure', async () => {
    schema = JSON.stringify({
      statements: [
        'CREATE TABLE should_rollback(id TEXT)',
        'THIS IS INVALID SQL',
      ],
    });
    const db = await create();
    expect((await call()).status).toBe(500);
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM sqlite_schema WHERE name='should_rollback'",
        )
        .first('n'),
    ).toBe(0);
    expect(
      await db.prepare('SELECT count(*) n FROM d1_migrations').first('n'),
    ).toBe(0);
  });
});
