import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import {
  drainSalesWorkspace,
  drainSales,
  salesRecipientHash,
} from './sales-notifications';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { createHash } from 'node:crypto';
import { receiveSalesReply } from './sales-relay';

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
      'sales_dispatch_checkpoints',
      'closure_requests',
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
it('shares the auth campaign ceiling before sending inquiry mail', async () => {
  const e = await verified();
  e.EMAIL_CAMPAIGN_ID = 'conference-test';
  e.EMAIL_CAMPAIGN_LIMIT = '1';
  e.EMAIL_CAMPAIGN_DAILY_LIMIT = '10';
  await db
    .prepare(
      "INSERT INTO email_budgets(bucket,count,expires_at) VALUES('campaign:conference-test',1,253402300799000)",
    )
    .run();
  await drainSalesWorkspace(e, workspace);
  expect(sends).toBe(0);
  expect(acks.some((ack) => ack.state === 'retryable')).toBe(true);
});
describe('relay gateway admission', () => {
  const rawToken = 'ab'.repeat(24),
    address = `reply+11111111.${rawToken}@replies.example`;
  async function setup(participant = 'seller@example.com') {
    const e = await verified();
    e.SALES_RELAY_ENABLED = 'true';
    e.SALES_RELAY_ADDRESS = 'reply@replies.example';
    e.SALES_RELAY_WORKSPACES = JSON.stringify([workspace]);
    const saved: Record<string, unknown>[] = [],
      paths: string[] = [];
    e.WORKSPACE_0 = {
      fetch: async (r: Request) => {
        expect(
          (await verifyGatewayRequest(secret, workspace, r))?.sales?.purpose,
        ).toBe('sales-notifications');
        const p = new URL(r.url).pathname;
        paths.push(p);
        if (p.endsWith('/due')) return Response.json({ dueAt: null });
        const body = (await r.json()) as Record<string, unknown>;
        if (p.endsWith('/relay-check'))
          return Response.json(
            {
              ok: body.token === rawToken && body.from === participant,
            },
            {
              status:
                body.token === rawToken && body.from === participant
                  ? 200
                  : 403,
            },
          );
        if (p.endsWith('/relay-message')) saved.push(body);
        return Response.json({ ok: true });
      },
    } as unknown as Fetcher;
    return { e, saved, paths };
  }
  async function deliver(
    e: HostedEnv,
    options: {
      to?: string;
      from?: string;
      headerFrom?: string;
      extra?: string;
    } = {},
  ) {
    const body = `From: ${options.headerFrom ?? 'seller@example.com'}\r\nTo: attacker@example.net\r\nReply-To: attacker@example.net\r\nCc: attacker@example.net\r\nBcc: attacker@example.net\r\nMessage-ID: <reply-gateway@fixture.example>\r\nAuthentication-Results: mx.cloudflare.net; dmarc=pass\r\n${options.extra ?? ''}Content-Type: text/plain; charset=utf-8\r\n\r\nNative email reply. ${address}`;
    let rejected = '';
    const waits: Promise<unknown>[] = [];
    const message = {
      from: options.from ?? 'seller@example.com',
      to: options.to ?? address,
      raw: new Response(body).body!,
      rawSize: new TextEncoder().encode(body).length,
      headers: new Headers(),
      setReject: (reason: string) => {
        rejected = reason;
      },
      forward() {
        throw Error('Raw forwarding is forbidden');
      },
      reply() {
        throw Error('Direct SMTP reply is forbidden');
      },
    } as ForwardableEmailMessage;
    await receiveSalesReply(message, e, {
      waitUntil: (p) => waits.push(p),
    } as unknown as ExecutionContext);
    await Promise.all(waits);
    return rejected;
  }
  it('uses the exact SMTP alias and current participant, ignoring routing/authentication headers', async () => {
    const f = await setup();
    expect(await deliver(f.e)).toBe('');
    expect(f.saved).toHaveLength(1);
    expect(f.saved[0]).toMatchObject({
      from: 'seller@example.com',
      ownerEmail: 'seller@example.com',
      token: rawToken,
    });
    expect(f.saved[0].body).toBe('Native email reply. [private reply address]');
    expect(Object.keys(f.saved[0]).sort()).toEqual([
      'body',
      'from',
      'messageId',
      'ownerEmail',
      'token',
    ]);
  });
  it('accepts a Gmail plus-address participant when SMTP uses the same Gmail base mailbox', async () => {
    const f = await setup('buyer+inquiry@gmail.com');
    expect(
      await deliver(f.e, {
        from: 'buyer@gmail.com',
        headerFrom: 'buyer+inquiry@gmail.com',
      }),
    ).toBe('');
    expect(f.saved).toHaveLength(1);
    expect(f.saved[0].from).toBe('buyer+inquiry@gmail.com');
  });
  it.each([
    { from: 'other@gmail.com', headerFrom: 'buyer+inquiry@gmail.com' },
    { from: 'buyer@gmail.com', headerFrom: 'buyer+different@gmail.com' },
    {
      from: 'buyer@company.example',
      headerFrom: 'buyer+inquiry@company.example',
    },
    { from: 'buy.er@gmail.com', headerFrom: 'buyer+inquiry@gmail.com' },
    { from: 'buyer@googlemail.com', headerFrom: 'buyer+inquiry@gmail.com' },
  ])(
    'keeps the exact participant grant and unrelated mailbox boundaries: %j',
    async (options) => {
      const f = await setup('buyer+inquiry@gmail.com');
      expect(await deliver(f.e, options)).not.toBe('');
      expect(f.saved).toHaveLength(0);
    },
  );
  it.each([403, 429, 503])(
    'preserves an authoritative %s grant rejection for Gmail aliases',
    async (status) => {
      const f = await setup('buyer+inquiry@gmail.com');
      let checks = 0;
      f.e.WORKSPACE_0 = {
        fetch: async () => {
          checks++;
          return Response.json({ ok: false }, { status });
        },
      } as unknown as Fetcher;
      const attempt = deliver(f.e, {
        from: 'buyer@gmail.com',
        headerFrom: 'buyer+inquiry@gmail.com',
      });
      if (status >= 500)
        await expect(attempt).rejects.toThrow('temporarily unavailable');
      else expect(await attempt).not.toBe('');
      expect(checks).toBe(status === 403 ? 2 : 1);
      expect(f.saved).toHaveLength(0);
    },
  );
  it.each([
    { to: address.replace('11111111', '22222222') },
    { to: address.replace('replies.example', 'foreign.example') },
    { from: 'attacker@example.net' },
    { headerFrom: 'attacker@example.net' },
    { extra: 'Auto-Submitted: auto-replied\r\n' },
  ])(
    'does not log invalid/mismatched/automatic messages: %j',
    async (options) => {
      const f = await setup();
      expect(await deliver(f.e, options)).not.toBe('');
      expect(f.saved).toHaveLength(0);
    },
  );
  it.each(['disabled', 'closure', 'unverified'])(
    'denies %s accounts before any tenant message write',
    async (state) => {
      const f = await setup();
      if (state === 'disabled')
        await db
          .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
          .bind(workspace)
          .run();
      if (state === 'closure')
        await db
          .prepare(
            'INSERT INTO closure_requests(workspace_id,user_id,requested_at,purge_after) VALUES(?,?,?,?)',
          )
          .bind(workspace, user, Date.now(), Date.now() + 86400000)
          .run();
      if (state === 'unverified')
        await db.prepare('DELETE FROM sales_verified_recipients').run();
      expect(await deliver(f.e)).not.toBe('');
      expect(f.paths).toHaveLength(0);
      expect(f.saved).toHaveLength(0);
    },
  );
});
describe('separate sales delivery', () => {
  it.each([
    ['seller-alert', false],
    ['buyer-reply', false],
    ['seller-alert', true],
    ['buyer-reply', true],
  ] as const)(
    'sends full %s context with relay=%s without exposing the owner email to the buyer',
    async (kind, relay) => {
      const e = await verified();
      if (relay) {
        e.SALES_RELAY_ENABLED = 'true';
        e.SALES_RELAY_ADDRESS = 'reply@replies.example';
        e.SALES_RELAY_WORKSPACES = JSON.stringify([workspace]);
      }
      let sent: EmailMessageBuilder | undefined;
      let claimBody:
        | {
            emailRelay?: {
              tokenHash: string;
              purpose: string;
              participant: string;
            };
          }
        | undefined;
      const oldFetch = e.WORKSPACE_0.fetch;
      e.WORKSPACE_0 = {
        fetch: async (r: Request) => {
          if (new URL(r.url).pathname.endsWith('/claim'))
            claimBody = await r.clone().json();
          const response = await oldFetch(r);
          if (!new URL(r.url).pathname.endsWith('/lease')) return response;
          const value = (await response.json()) as {
            items: { kind: string; mail: Record<string, unknown> }[];
          };
          value.items[0].kind = kind;
          value.items[0].mail.context = {
            name: 'Sample Buyer',
            email: 'buyer@example.com',
            message: 'Please send the details.',
            offer: { amount: '2500', currency: 'USD' },
            receivedAt: Date.now(),
            latest: null,
            snapshot: {
              version: 1,
              id: lead,
              domain: 'sample.example',
              displayName: 'sample.example',
              mode: 'inquiry',
              description: 'Sample data',
              categories: [],
              publicPrice: null,
              publicMinimumOffer: null,
              destination: null,
              allowQuestions: true,
              sellerDisplayName: '',
              revision: outbox,
              publishedAt: Date.now(),
            },
          };
          return Response.json(value);
        },
      } as unknown as Fetcher;
      e.SALES_EMAIL = {
        send: async (v: EmailMessageBuilder) => {
          sent = v;
          return { messageId: 'full-context-fixture' };
        },
      } as SendEmail;
      await drainSalesWorkspace(e, workspace);
      expect(sent?.to).toBe(
        kind === 'seller-alert' ? 'seller@example.com' : 'buyer@example.com',
      );
      if (relay) {
        const target = sent!.replyTo as { email: string; name: string };
        const raw = target.email.match(
          /^reply\+11111111\.([a-f0-9]{48})@replies\.example$/,
        )?.[1];
        expect(raw).toBeTruthy();
        expect(claimBody?.emailRelay).toMatchObject({
          tokenHash: createHash('sha256').update(raw!).digest('base64url'),
          purpose: kind === 'seller-alert' ? 'email-owner' : 'email-buyer',
          participant:
            kind === 'seller-alert'
              ? 'seller@example.com'
              : 'buyer@example.com',
        });
        expect(sent?.text).toContain('Reply to this email to continue.');
        expect(sent?.text).not.toContain(raw!);
      } else
        expect(sent?.replyTo).toBe(
          kind === 'seller-alert' ? 'buyer@example.com' : undefined,
        );
      expect(sent?.text).toContain('Please send the details.');
      expect(sent?.html).toContain('buyer@example.com');
      expect(sent?.subject).toContain('sample.example');
    },
  );
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

it('aligns dispatch checkpoints with the next cron boundary instead of skipping it', async () => {
  const e = await verified(),
    original = e.WORKSPACE_0.fetch;
  let leases = 0;
  e.WORKSPACE_0 = {
    fetch: async (r: Request) => {
      if (new URL(r.url).pathname.endsWith('/lease')) leases++;
      return original(r);
    },
  } as Fetcher;
  const boundary = Math.floor(Date.now() / 120000) * 120000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(boundary + 30000);
  try {
    await drainSales(e);
    expect(
      (await db
        .prepare(
          'SELECT next_check_at FROM sales_dispatch_checkpoints WHERE workspace_id=?',
        )
        .bind(workspace)
        .first<{ next_check_at: number }>())!.next_check_at,
    ).toBe(boundary + 120000);
    clock.mockReturnValue(boundary + 140000);
    await drainSales(e);
    expect(leases).toBe(2);
  } finally {
    clock.mockRestore();
  }
});
it('keeps healthy account delivery moving when another dispatcher fails', async () => {
  const e = await verified(),
    broken = '66666666-6666-4666-8666-666666666666';
  await db
    .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
    .bind(broken, 'Broken fixture')
    .run();
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      'broken@example.com',
      broken,
      'fixture-only',
      Date.now(),
    )
    .run();
  await db
    .prepare(
      'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
    )
    .bind(broken, salesRecipientHash(e, 'broken@example.com'), Date.now())
    .run();
  e.WORKSPACES = JSON.stringify([
    { id: broken, binding: 'WORKSPACE_1', label: 'Broken' },
    { id: workspace, binding: 'WORKSPACE_0', label: 'Healthy' },
  ]);
  e.GATEWAY_KEYS = JSON.stringify({ [workspace]: secret, [broken]: secret });
  e.WORKSPACE_1 = {
    fetch: async () => {
      throw Error('Synthetic service outage');
    },
  } as Fetcher;
  await expect(drainSales(e)).rejects.toThrow('dispatchers need attention');
  expect(sends).toBe(1);
  expect(
    await db
      .prepare('SELECT 1 FROM sales_dispatch_checkpoints WHERE workspace_id=?')
      .bind(broken)
      .first(),
  ).toBeNull();
});
it('leases failed platform dispatchers so the next due batch reaches healthy accounts', async () => {
  const e = await verified();
  e.PLATFORM_ENABLED = 'true';
  for (let n = 0; n < 50; n++) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    await db.batch([
      db
        .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
        .bind(id, 'Synthetic unavailable account'),
      db
        .prepare(
          'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,1)',
        )
        .bind(
          crypto.randomUUID(),
          `unavailable-${n}@example.test`,
          id,
          'fixture-only',
        ),
      db
        .prepare(
          'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,1)',
        )
        .bind(id, salesRecipientHash(e, `unavailable-${n}@example.test`)),
    ]);
  }
  await expect(drainSales(e)).rejects.toThrow('dispatchers need attention');
  expect(sends).toBe(0);
  await drainSales(e);
  expect(sends).toBe(1);
});
it.each([
  ['E_RATE_LIMIT_EXCEEDED', 'retryable'],
  ['E_DAILY_LIMIT_EXCEEDED', 'retryable'],
  ['E_RECIPIENT_SUPPRESSED', 'suppressed'],
  ['E_RECIPIENT_NOT_ALLOWED', 'failed'],
  ['E_INTERNAL_SERVER_ERROR', 'unknown'],
])(
  'classifies documented provider rejection %s without replaying ambiguous outcomes',
  async (code, state) => {
    const e = await verified();
    e.SALES_EMAIL = {
      send: async () => {
        throw Object.assign(new Error('Provider text must not be retained'), {
          code,
        });
      },
    } as SendEmail;
    await drainSalesWorkspace(e, workspace);
    expect(acks.at(-1)?.state).toBe(state);
    expect(JSON.stringify(acks)).not.toContain('Provider text');
  },
);
