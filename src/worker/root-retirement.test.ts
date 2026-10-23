import { readFileSync } from 'node:fs';
import { hkdfSync } from 'node:crypto';
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
import {
  acquireRootLease,
  releaseRootLease,
  retireRoot,
  retireRootRequest,
  withRootLease,
} from './root-retirement';
import { createSession } from './auth';
import { deriveSessionKey, parseRootSecret, rootGeneration } from './keys';

let mf: Miniflare, db: D1Database;
const oldSecret = btoa('old-synthetic-root-32-bytes-long!!');
const newSecret = btoa('new-synthetic-root-32-bytes-long!!');
const password = 'synthetic-owner-password';
const header = 'X-DomBot-Root-Generation';
let root: string, nextRoot: string, cookie: string;
const env = (secret = oldSecret) =>
  ({
    DB: db,
    DOMBOT_SECRET: secret,
    DOMBOT_PASSWORD: password,
    DOMBOT_AUTH: 'password',
  }) as Env;
const request = (
  body = { password, nextRoot },
  headers: Record<string, string> = {},
) =>
  new Request('https://selfhost.example/auth/retire-root', {
    method: 'POST',
    headers: {
      Origin: 'https://selfhost.example',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.1',
      Cookie: cookie,
      [header]: root,
      ...headers,
    },
    body: JSON.stringify(body),
  });
const exported = () =>
  Promise.resolve(Response.json({ result: 'final synthetic bundle' }));
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'root-retirement' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const name of [
    '0002_login_attempts.sql',
    '0003_session_revocations.sql',
    '0007_root_retirement.sql',
  ])
    await db.exec(
      readFileSync('migrations/' + name, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  root = await rootGeneration(parseRootSecret(oldSecret));
  nextRoot = await rootGeneration(parseRootSecret(newSecret));
  cookie =
    'dombot_session=' +
    (await createSession(
      await deriveSessionKey(parseRootSecret(oldSecret), password),
    ));
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.batch(
    [
      'retired_roots',
      'root_request_leases',
      'session_revocations',
      'login_attempts',
    ].map((t) => db.prepare('DELETE FROM ' + t)),
  );
});
describe('cross-isolate encryption-root retirement', () => {
  it('matches the CLI generation commitment without exposing the root key', () => {
    const computed = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(oldSecret, 'base64'),
        Buffer.alloc(0),
        'dombot/root-generation/v1',
        32,
      ),
    ).toString('base64url');
    expect(root).toBe(computed);
    expect(root).not.toBe(oldSecret);
  });
  it('blocks new old-root admission, drains an in-flight writer, then exports its final state', async () => {
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    let saved = 'before',
      snapshot = '';
    const writer = withRootLease(env(), async () => {
      started();
      await hold;
      saved = 'after';
      return new Response('saved');
    });
    await ready;
    const exportFinal = vi.fn(async () => {
      snapshot = saved;
      return exported();
    });
    const draining = await retireRootRequest(request(), env(), exportFinal);
    expect(draining.status).toBe(202);
    expect(await draining.json()).toMatchObject({ drained: false, active: 1 });
    expect(exportFinal).not.toHaveBeenCalled();
    const stale = vi.fn(async () => new Response('unsafe'));
    expect((await withRootLease(env(), stale)).status).toBe(503);
    expect(stale).not.toHaveBeenCalled();
    release();
    await writer;
    const final = await retireRootRequest(request(), env(), exportFinal);
    expect(final.status).toBe(200);
    expect(await final.json()).toMatchObject({
      drained: true,
      bundle: 'final synthetic bundle',
    });
    expect(snapshot).toBe('after');
    exportFinal.mockClear();
    expect(
      (await retireRootRequest(request(), env(), exportFinal)).status,
    ).toBe(409);
    expect(exportFinal).not.toHaveBeenCalled();
    // A new isolate with the old root cannot serve old cookies or MCP/cron work.
    expect((await withRootLease(env(), stale)).status).toBe(503);
    expect(stale).not.toHaveBeenCalled();
    expect(
      (
        await withRootLease(env(newSecret), async () => new Response('new'))
      ).headers.get(header),
    ).toBe(nextRoot);
  });
  it('serializes concurrent admission and retirement without leaving an untracked writer', async () => {
    const [lease] = await Promise.all([
      acquireRootLease(db, root),
      retireRoot(db, root, nextRoot),
    ]);
    const active = (await retireRoot(db, root, nextRoot)).active;
    expect(active).toBe(lease ? 1 : 0);
    expect(await acquireRootLease(db, root)).toBeNull();
    if (lease) await releaseRootLease(db, lease);
    expect((await retireRoot(db, root, nextRoot)).active).toBe(0);
  });
  it('requires the requested generation before login/import or any handler work', async () => {
    const work = vi.fn(async () => new Response('mutated'));
    const bound = new Request('https://selfhost.example/api/importData', {
      headers: { [header]: nextRoot },
    });
    expect((await withRootLease(env(), work, bound)).status).toBe(409);
    expect(work).not.toHaveBeenCalled();
    expect((await withRootLease(env(newSecret), work, bound)).status).toBe(200);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('never expires an ambiguous writer lease to force rotation through', async () => {
    const lease = await acquireRootLease(db, root);
    await db.prepare('UPDATE root_request_leases SET started_at=0').run();
    const response = await retireRootRequest(request(), env(), exported);
    expect(response.status).toBe(202);
    expect(((await response.json()) as { active: number }).active).toBe(1);
    await releaseRootLease(db, lease!);
  });
  it('fails closed on a conflicting concurrent rotation', async () => {
    await retireRoot(db, root, nextRoot);
    const other = 'A'.repeat(43);
    expect(
      (
        await retireRootRequest(
          request({ password, nextRoot: other }),
          env(),
          exported,
        )
      ).status,
    ).toBe(409);
    expect((await retireRoot(db, root, other)).next).toBe(nextRoot);
  });
  it('requires owner session, origin, current password, and generation', async () => {
    for (const [req, status] of [
      [request(undefined, { Cookie: '' }), 401],
      [request(undefined, { Origin: 'https://other.example' }), 403],
      [request({ password: 'wrong', nextRoot }), 403],
      [request(undefined, { [header]: nextRoot }), 409],
    ] as const)
      expect((await retireRootRequest(req, env(), exported)).status).toBe(
        status,
      );
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM retired_roots').first('n'),
    ).toBe(0);
  });
  it('releases a lease after a failed handler and excludes hosted gateway mode', async () => {
    await expect(
      withRootLease(env(), async () => {
        throw new Error('test failure');
      }),
    ).rejects.toThrow('test failure');
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM root_request_leases')
        .first('n'),
    ).toBe(0);
    expect(
      (
        await withRootLease(
          { DOMBOT_AUTH: 'gateway' } as Env,
          async () => new Response('hosted'),
        )
      ).status,
    ).toBe(200);
  });
});
