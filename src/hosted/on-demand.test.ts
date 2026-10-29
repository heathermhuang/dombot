import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import gateway from './gateway';
import { EmailAuth } from './email-auth';
import { Accounts } from './accounts';
import { monitorDynadotSync } from './sync-monitor';
import {
  Registration,
  registrationIds,
  registrationReady,
} from './registration';
import {
  activateWorkspace,
  ON_DEMAND,
  type ProvisionReceipt,
} from './on-demand';
import { workspaceKey } from './workspaces';

let mf: Miniflare, db: D1Database, env: HostedEnv;
const messages: EmailMessageBuilder[] = [];
const hash = 'a'.repeat(64),
  key = 'b'.repeat(64);
const resources = new Map<string, ProvisionReceipt>();
const provision = vi.fn(async (workspace: string) => {
  if (!resources.has(workspace))
    resources.set(workspace, {
      workspace,
      databaseId: crypto.randomUUID(),
      gatewayKey: key,
      engine: 'test-engine',
      templateSha256: hash,
    });
  return resources.get(workspace)!;
});
beforeAll(async () => {
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(
        input: ConstructorParameters<typeof NativeRequest>[0],
        init?: RequestInit,
      ) {
        super(input, { ...init, duplex: 'half' } as RequestInit);
      }
    },
  );
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'on-demand-tests' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of readdirSync('hosted/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
});
afterAll(async () => {
  await mf?.dispose();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  // Each case gets fresh account state; unrelated schema remains intact.
  await db.exec(
    'DELETE FROM legal_acceptances; DELETE FROM email_signins; DELETE FROM sessions; DELETE FROM platform_workspaces; DELETE FROM pending_workspaces; DELETE FROM users; DELETE FROM workspaces; DELETE FROM email_budgets; DELETE FROM signup_proofs; DELETE FROM rate_limits;',
  );
  resources.clear();
  messages.length = 0;
  provision.mockClear();
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: 'on-demand-test-pepper'.repeat(3),
    WORKSPACES: '[]',
    GATEWAY_KEYS: '{}',
    PLATFORM_ENABLED: 'true',
    DISPATCHER: { get: () => ({ fetch: async () => new Response('tenant') }) },
    ON_DEMAND_ENABLED: 'true',
    ON_DEMAND_TEMPLATE_SHA256: hash,
    ON_DEMAND_ACCOUNT_LIMIT: '500',
    PROVISIONER: { provision },
    PUBLIC_REGISTRATION_ENABLED: 'true',
    PUBLIC_SIGNUP_IDS: '',
    CANONICAL_ORIGIN: 'https://domains.domains',
    LEGAL_OPERATOR_NAME: 'Magic Crystal Limited',
    LEGAL_JURISDICTION: 'Hong Kong',
    EMAIL_FROM: 'accounts@mail.domains.domains',
    EMAIL_DELIVERY_VERIFIED: 'true',
    AUTH_EMAIL_DAILY_LIMIT: '1000',
    AUTH_EMAIL_MONTHLY_LIMIT: '10000',
    EMAIL: {
      send: async (message: EmailMessageBuilder) => {
        messages.push(message);
        return { messageId: 'local' };
      },
    },
  } as unknown as HostedEnv;
});
async function signup(email = 'new@example.test') {
  const auth = new EmailAuth(env);
  await auth.issue(email, '/app');
  const url = new URL(messages.at(-1)!.text!.match(/https:\/\/\S+/)![0]);
  const id = url.searchParams.get('id')!,
    proof = url.searchParams.get('token')!;
  const accepted = await auth.consume(id, proof, true, true);
  expect(accepted).not.toBeNull();
  const user = (await new Accounts(db, env.AUTH_PEPPER).session(
    accepted!.token,
  ))!;
  return { auth, id, proof, token: accepted!.token, user };
}
function request(
  path: string,
  token = '',
  reason?: string,
  origin = 'https://domains.domains',
) {
  return gateway.fetch(
    new Request('https://domains.domains' + path, {
      method: reason === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: '__Host-dd_session=' + token,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: reason === undefined ? undefined : new URLSearchParams({ reason }),
    }),
    env,
  );
}
describe('on-demand account lifecycle', () => {
  it('pauses new signup without hiding an existing unstarted portfolio', async () => {
    const s = await signup();
    env.ON_DEMAND_ENABLED = 'false';
    expect(registrationReady(env)).toBe(false);
    expect(registrationIds(env)).toEqual([]);
    env.SYNC_MONITOR_ENABLED = 'true';
    await monitorDynadotSync(env);
    expect(
      await db.prepare('SELECT count(*) n FROM sync_monitor_checks').first('n'),
    ).toBe(0);
    expect((await request(`/w/${s.user.workspace_id}/`, s.token)).status).toBe(
      200,
    );
    expect(provision).not.toHaveBeenCalled();
  });
  it('creates control identities without allocating a Worker, D1, key or registry slot; email proofs cannot replay', async () => {
    expect(registrationIds(env)).toEqual([ON_DEMAND]);
    const s = await signup();
    expect(
      await db.prepare('SELECT count(*) n FROM pending_workspaces').first('n'),
    ).toBe(1);
    expect(
      await db.prepare('SELECT count(*) n FROM platform_workspaces').first('n'),
    ).toBe(0);
    expect(provision).not.toHaveBeenCalled();
    expect(await s.auth.consume(s.id, s.proof, true, true)).toBeNull();
    expect(
      await db.prepare('SELECT count(*) n FROM workspaces').first('n'),
    ).toBe(1);
  });
  it('supports password signup without consuming a precreated reserve', async () => {
    const registration = new Registration(
      db,
      env.AUTH_PEPPER,
      registrationIds(env),
    );
    const proof = await registration.issue('password@example.test');
    const user = await registration.claim(proof!, 'strong-test-password-only');
    expect(user.workspace_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      await db.prepare('SELECT count(*) n FROM pending_workspaces').first('n'),
    ).toBe(1);
    expect(provision).not.toHaveBeenCalled();
  });
  it('requires legal acceptance, keeps the proof usable, and fails closed on missing provisioning configuration', async () => {
    const auth = new EmailAuth(env);
    await auth.issue('terms@example.test', '/app');
    const url = new URL(messages[0].text!.match(/https:\/\/\S+/)![0]);
    await expect(
      auth.consume(
        url.searchParams.get('id')!,
        url.searchParams.get('token')!,
        true,
        false,
      ),
    ).rejects.toThrow('Accept the Terms');
    expect(await db.prepare('SELECT count(*) n FROM users').first('n')).toBe(0);
    for (const patch of [
      { PROVISIONER: undefined },
      { ON_DEMAND_TEMPLATE_SHA256: '' },
      { ON_DEMAND_ACCOUNT_LIMIT: 'invalid' },
    ])
      expect(registrationReady({ ...env, ...patch })).toBe(false);
  });
  it('does not allocate during repeated visits or another user’s request, and rejects forged setup mutations', async () => {
    const a = await signup(),
      b = await signup('other@example.test');
    const base = `/w/${a.user.workspace_id}/`;
    for (let i = 0; i < 3; i++) {
      const r = await request(base, a.token);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('Connect your first registrar');
    }
    expect((await request(base, b.token)).status).toBe(403);
    expect(
      (await request(base + 'start', a.token, 'registrar', 'https://evil.test'))
        .status,
    ).toBe(403);
    expect((await request(base + 'start', a.token, 'unknown')).status).toBe(
      400,
    );
    expect((await request(base + 'start', '', 'registrar')).status).toBe(401);
    const invalid = await gateway.fetch(
      new Request(
        `https://domains.domains/w/${a.user.workspace_id}/api/connectRegistrarAccount`,
        {
          method: 'POST',
          headers: {
            Cookie: '__Host-dd_session=' + a.token,
            Origin: 'https://domains.domains',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ args: ['dynadot', {}] }),
        },
      ),
      env,
    );
    expect(invalid.status).toBe(400);
    expect(provision).not.toHaveBeenCalled();
  });
  it.each(['registrar', 'import'])(
    'allocates only after the owner chooses %s and admits the qualified resource with a sealed key',
    async (reason) => {
      const s = await signup(),
        path = `/w/${s.user.workspace_id}/start`;
      const r =
        reason === 'import'
          ? await request(path, s.token, reason)
          : await gateway.fetch(
              new Request(
                `https://domains.domains/w/${s.user.workspace_id}/api/connectRegistrarAccount`,
                {
                  method: 'POST',
                  headers: {
                    Cookie: '__Host-dd_session=' + s.token,
                    Origin: 'https://domains.domains',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    args: [
                      'dynadot',
                      { apiKey: 'test-only', apiSecret: 'test-only' },
                    ],
                  }),
                },
              ),
              env,
            );
      expect(r.status).toBe(reason === 'import' ? 303 : 200);
      expect(provision).toHaveBeenCalledWith(s.user.workspace_id, s.user.id);
      expect(await workspaceKey(env, s.user.workspace_id)).toBe(key);
      expect(
        await db
          .prepare('SELECT activated_at FROM pending_workspaces')
          .first('activated_at'),
      ).toBeGreaterThan(0);
      expect(
        await db
          .prepare('SELECT signup_enabled FROM platform_workspaces')
          .first('signup_enabled'),
      ).toBe(0);
    },
  );
  it('rejects a receipt belonging to another workspace without admitting it', async () => {
    const s = await signup();
    env.PROVISIONER = {
      provision: async () => ({
        ...(await provision(s.user.workspace_id)),
        workspace: crypto.randomUUID(),
      }),
    };
    await expect(activateWorkspace(env, s.user, 'registrar')).rejects.toThrow(
      'operator attention',
    );
    expect(
      await db.prepare('SELECT count(*) n FROM platform_workspaces').first('n'),
    ).toBe(0);
  });
  it('does not admit a workspace if its account closes while provisioning', async () => {
    const s = await signup();
    env.PROVISIONER = {
      provision: async () => {
        await db
          .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
          .bind(s.user.workspace_id)
          .run();
        return provision(s.user.workspace_id);
      },
    };
    await expect(activateWorkspace(env, s.user, 'registrar')).rejects.toThrow(
      'could not finish',
    );
    expect(
      await db.prepare('SELECT count(*) n FROM platform_workspaces').first('n'),
    ).toBe(0);
  });
  it('bounds concurrent signups without duplicate workspaces or physical provisioning', async () => {
    env.ON_DEMAND_ACCOUNT_LIMIT = '3';
    const auth = new EmailAuth(env);
    for (let i = 0; i < 8; i++)
      await auth.issue(`concurrent-${i}@example.test`, '/app');
    const accepted = await Promise.all(
      messages.map((message) => {
        const u = new URL(message.text!.match(/https:\/\/\S+/)![0]);
        return auth.consume(
          u.searchParams.get('id')!,
          u.searchParams.get('token')!,
          true,
          true,
        );
      }),
    );
    expect(accepted.filter(Boolean)).toHaveLength(3);
    expect(
      await db.prepare('SELECT count(*) n FROM workspaces').first('n'),
    ).toBe(3);
    expect(provision).not.toHaveBeenCalled();
  });
});
