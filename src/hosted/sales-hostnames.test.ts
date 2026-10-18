import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { SalesHostnames } from './sales-hostnames';
import edge from './lander-edge';
import {
  signGatewayRequest,
  verifyTenantAdmission,
} from '../shared/gateway-proof';

let mf: Miniflare, db: D1Database;
const workspace = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  listing = '33333333-3333-4333-8333-333333333333';
const secret = 'gateway-fixture-secret'.repeat(3),
  edgeSecret = 'edge-fixture-secret'.repeat(3);
let challenge = '',
  tls = 'active',
  bindingWrites: unknown[],
  edgeRequest: Request | null;
const env = () =>
  ({
    CONTROL_DB: db,
    CANONICAL_ORIGIN: 'https://accounts.example',
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Sample' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: secret }),
    SALES_EDGE_KEYS: JSON.stringify({ [workspace]: edgeSecret }),
    SALES_CNAME_TARGET: 'fallback.example',
    SALES_CF_ZONE_ID: 'fixture-zone',
    SALES_CF_API_TOKEN: 'fixture-only-no-real-token',
    SALES_CUSTOM_HOSTS_ENABLED: 'true',
    SALES_HOST_ALLOWLIST: 'fixture.example,www.fixture.example',
    WORKSPACE_0: {
      fetch: async (r: Request) => {
        bindingWrites.push(await r.json());
        return Response.json({ ok: true });
      },
    },
  }) as HostedEnv;
const fetcher: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init),
    url = new URL(request.url);
  if (url.hostname === 'cloudflare-dns.com') {
    const type = url.searchParams.get('type'),
      name = url.searchParams.get('name');
    return Response.json({
      Status: 0,
      AD: true,
      Answer:
        type === 'TXT' && name?.startsWith('_domains-sales.')
          ? [{ name, type: 16, TTL: 60, data: `"domains-sales=${challenge}"` }]
          : type === 'MX'
            ? [{ name, type: 15, TTL: 3600, data: '10 mail.fixture.example.' }]
            : type === 'CAA'
              ? [
                  {
                    name,
                    type: 257,
                    TTL: 3600,
                    data: '0 issue "letsencrypt.org"',
                  },
                ]
              : [],
    });
  }
  if (url.hostname === 'api.cloudflare.com')
    return Response.json({
      success: true,
      result:
        request.method === 'POST' || url.pathname.endsWith('/provider-id')
          ? {
              id: 'provider-id',
              hostname: 'fixture.example',
              status: 'active',
              ssl: { status: tls },
            }
          : [],
    });
  if (url.hostname === 'fixture.example')
    return new Response('sample public page', {
      headers: { 'X-Domains-Sales-Revision': 'published-fixture-revision' },
    });
  throw new Error('Unexpected external request in host fixture');
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'sales-host-test',
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
  await db.batch([
    db.prepare('DELETE FROM sales_hostnames'),
    db.prepare('DELETE FROM workspaces'),
    db
      .prepare('INSERT INTO workspaces(id,label,enabled) VALUES(?,?,1)')
      .bind(workspace, 'Sample fixture'),
  ]);
  challenge = '';
  tls = 'active';
  bindingWrites = [];
  edgeRequest = null;
});
describe('controlled hostname lifecycle', () => {
  it('captures mail and CAA, reserves unique hosts, and blocks conflicting claims', async () => {
    const h = new SalesHostnames(env(), fetcher),
      p = await h.plan(
        workspace,
        listing,
        'fixture.example',
        'fixture.example',
      );
    expect(p.preserve).toEqual(
      expect.arrayContaining(['MX', 'TXT', 'CAA', 'NS', 'DS']),
    );
    expect(p.automaticDnsWrites).toBe(false);
    expect(p.before.find((r) => r.type === 'MX')!.answers[0].data).toContain(
      'mail.fixture.example',
    );
    await expect(
      h.plan(other, listing, 'fixture.example', 'fixture.example'),
    ).rejects.toThrow(/reserved/);
    await expect(
      h.plan(workspace, listing, 'other.example', 'fixture.example'),
    ).rejects.toThrow(/exact domain/);
    expect(bindingWrites).toHaveLength(0);
  });
  it('does not mark pending TLS active; activation needs exact served revision and detach advances epoch', async () => {
    const h = new SalesHostnames(env(), fetcher),
      p = await h.plan(
        workspace,
        listing,
        'fixture.example',
        'fixture.example',
      );
    challenge = p.challenge;
    tls = 'pending_validation';
    expect(
      (
        await h.activate(
          workspace,
          listing,
          'fixture.example',
          p.epoch,
          p.challenge,
          'published-fixture-revision',
        )
      ).status,
    ).toBe('pending-tls');
    expect(bindingWrites).toHaveLength(0);
    tls = 'active';
    expect(
      (
        await h.activate(
          workspace,
          listing,
          'fixture.example',
          p.epoch,
          p.challenge,
          'published-fixture-revision',
        )
      ).status,
    ).toBe('active');
    expect(
      (await h.detach(workspace, listing, 'fixture.example', p.epoch)).epoch,
    ).toBe(p.epoch + 1);
    await expect(
      h.activate(
        workspace,
        listing,
        'fixture.example',
        p.epoch,
        p.challenge,
        'published-fixture-revision',
      ),
    ).rejects.toThrow();
  });
  it('edge forwards only registry-selected public operations, strips cookies and rejects closed accounts', async () => {
    const e = env();
    Reflect.set(e, 'WORKSPACE_0', {
      fetch: async (r: Request) => {
        edgeRequest = r;
        return new Response('sample', {
          headers: { 'Set-Cookie': 'forbidden=1' },
        });
      },
    });
    await db
      .prepare(
        "INSERT INTO sales_hostnames(hostname,workspace_id,listing_id,domain,epoch,status,challenge_hash,plan,updated_at,control_expires_at) VALUES(?,?,?,?,2,'active','hash','{}',?,?)",
      )
      .bind(
        'fixture.example',
        workspace,
        listing,
        'fixture.example',
        Date.now(),
        Date.now() + 3600000,
      )
      .run();
    const result = await edge.fetch!(
      new Request('https://fixture.example/', {
        headers: {
          Cookie: 'seller-session=forged',
          'x-dombot-gateway-proof': 'forged',
          'x-forwarded-host': 'other.example',
        },
      }),
      e,
      {} as ExecutionContext,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(edgeRequest!.headers.has('cookie')).toBe(false);
    expect(edgeRequest!.headers.has('x-forwarded-host')).toBe(false);
    const admission = await verifyTenantAdmission(
      { DOMBOT_SALES_EDGE_SECRET: edgeSecret, DOMBOT_WORKSPACE_ID: workspace },
      edgeRequest!,
    );
    expect(admission?.owner).toBeNull();
    expect(admission?.sales).toMatchObject({
      purpose: 'sales-public',
      listing,
      epoch: 2,
    });
    expect(
      (
        await edge.fetch!(
          new Request('https://fixture.example/sales/inbox'),
          e,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(404);
    await db
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(workspace)
      .run();
    expect(
      (
        await edge.fetch!(
          new Request('https://fixture.example/'),
          e,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(404);
  });
  it('a public edge key cannot grant an owner or internal notification admission', async () => {
    const r = new Request('https://fixture.example/sales/inbox');
    r.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(edgeSecret, workspace, 'forged-owner', r, {
        purpose: 'sales-public',
        host: 'fixture.example',
        listing,
        epoch: 2,
      }),
    );
    expect(
      await verifyTenantAdmission(
        {
          DOMBOT_SALES_EDGE_SECRET: edgeSecret,
          DOMBOT_WORKSPACE_ID: workspace,
        },
        r,
      ),
    ).toBeNull();
    r.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(edgeSecret, workspace, null, r, {
        purpose: 'sales-notifications',
      }),
    );
    expect(
      await verifyTenantAdmission(
        {
          DOMBOT_SALES_EDGE_SECRET: edgeSecret,
          DOMBOT_WORKSPACE_ID: workspace,
        },
        r,
      ),
    ).toBeNull();
  });
});
