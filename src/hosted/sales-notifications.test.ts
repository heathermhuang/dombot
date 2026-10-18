import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import { drainSalesWorkspace, salesRecipientHash } from './sales-notifications';
import { verifyGatewayRequest } from '../shared/gateway-proof';

let mf: Miniflare,
  db: D1Database,
  sends: number,
  acks: Record<string, unknown>[],
  fail: boolean,
  claimAllowed: boolean;
const workspace = '11111111-1111-4111-8111-111111111111',
  user = '22222222-2222-4222-8222-222222222222',
  outbox = '33333333-3333-4333-8333-333333333333',
  lead = '44444444-4444-4444-8444-444444444444',
  lease = '55555555-5555-4555-8555-555555555555',
  secret = 'synthetic-notification-key'.repeat(3);
function env(): HostedEnv {
  return {
    CONTROL_DB: db,
    AUTH_PEPPER: 'fixture-auth-pepper',
    CANONICAL_ORIGIN: 'https://accounts.example',
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Sample' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: secret }),
    SALES_MAIL_ENABLED: 'true',
    SALES_MAIL_DELIVERY_VERIFIED: 'true',
    SALES_EMAIL_FROM: 'sales@mail.domains.domains',
    SALES_MAIL_DAILY_LIMIT: '10',
    SALES_MAIL_MONTHLY_LIMIT: '100',
    SALES_EMAIL: {
      send: async () => {
        sends++;
        if (fail) throw new Error('Synthetic ambiguous failure');
        return { messageId: 'mock-provider-receipt' };
      },
    },
    WORKSPACE_0: {
      fetch: async (r: Request) => {
        expect(
          (await verifyGatewayRequest(secret, workspace, r))?.sales?.purpose,
        ).toBe('sales-notifications');
        const p = new URL(r.url).pathname;
        if (p.endsWith('/due')) return Response.json({ dueAt: Date.now() - 1 });
        if (p.endsWith('/lease'))
          return Response.json({
            items: [
              {
                id: outbox,
                kind: 'verification',
                leadId: lead,
                lease,
                attempts: 1,
                mail: {
                  recipient: 'buyer@example.com',
                  subject: 'Sample inquiry',
                  url: `https://accounts.example/w/${workspace}/i/${'x'.repeat(43)}`,
                  reference: lead,
                },
              },
            ],
          });
        if (p.endsWith('/claim')) return Response.json({ ok: claimAllowed });
        acks.push(await r.json());
        return Response.json({ ok: true });
      },
    },
  } as HostedEnv;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'sales-notifications-test',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const f of readdirSync('hosted/migrations').sort())
    await db.exec(
      readFileSync('hosted/migrations/' + f, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
}, 30000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  await db.batch(
    [
      'sales_verified_recipients',
      'sales_delivery_receipts',
      'sales_email_budgets',
      'email_budgets',
      'users',
      'workspaces',
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  await db
    .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
    .bind(workspace, 'Sample')
    .run();
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(user, 'seller@example.com', workspace, 'fixture-only', Date.now())
    .run();
  sends = 0;
  acks = [];
  fail = false;
  claimAllowed = true;
});
async function verified() {
  const e = env();
  await db
    .prepare(
      'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
    )
    .bind(workspace, salesRecipientHash(e, 'seller@example.com'), Date.now())
    .run();
  return e;
}
describe('separate sales delivery', () => {
  it('requires a verified account recipient and never enrolls an arbitrary alternate address', async () => {
    await drainSalesWorkspace(env(), workspace);
    expect(sends).toBe(0);
    expect(acks).toHaveLength(0);
  });
  it('records accepted separately from delivered and never consumes auth quota', async () => {
    const e = await verified();
    await db
      .prepare(
        "INSERT INTO email_budgets(bucket,count,expires_at) VALUES('auth-fixture',30,?)",
      )
      .bind(Date.now() + 86400000)
      .run();
    await drainSalesWorkspace(e, workspace);
    expect(sends).toBe(1);
    expect(acks[0]).toMatchObject({
      state: 'accepted',
      receipt: 'mock-provider-receipt',
      lease,
    });
    expect(
      (await db
        .prepare("SELECT count FROM email_budgets WHERE bucket='auth-fixture'")
        .first<{ count: number }>())!.count,
    ).toBe(30);
  });
  it('does not send cached mail when the tenant revokes the final claim', async () => {
    const e = await verified();
    claimAllowed = false;
    await drainSalesWorkspace(e, workspace);
    expect(sends).toBe(0);
    expect(acks).toHaveLength(0);
  });
  it('quota exhaustion queues a bounded retry without touching auth delivery', async () => {
    const e = await verified();
    e.SALES_MAIL_DAILY_LIMIT = '1';
    await db
      .prepare(
        'INSERT INTO sales_email_budgets(bucket,count,expires_at) VALUES(?,1,?)',
      )
      .bind(
        `global:day:${new Date().toISOString().slice(0, 10)}`,
        Date.now() + 86400000,
      )
      .run();
    await drainSalesWorkspace(e, workspace);
    expect(sends).toBe(0);
    expect(acks[0].state).toBe('retryable');
  });
  it('ambiguous provider errors are preserved as unknown and the same attempt is not replayed', async () => {
    const e = await verified();
    fail = true;
    await drainSalesWorkspace(e, workspace);
    expect(acks[0].state).toBe('unknown');
    await drainSalesWorkspace(e, workspace);
    expect(sends).toBe(1);
    expect(
      (await db
        .prepare('SELECT state FROM sales_delivery_receipts')
        .first<{ state: string }>())!.state,
    ).toBe('unknown');
  });
});
