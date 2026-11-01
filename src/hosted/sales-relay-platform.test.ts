import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  newReplyAddress,
  relayWorkspaceForPrefix,
} from './sales-relay-address';
const platform = 'aaaaaaaa-1111-4111-8111-111111111111';
let mf: Miniflare, db: D1Database;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'relay-platform-test',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['CONTROL_DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('CONTROL_DB');
  await db.exec(
    'CREATE TABLE workspaces(id TEXT PRIMARY KEY,label TEXT,enabled INTEGER); CREATE TABLE platform_workspaces(workspace_id TEXT PRIMARY KEY,qualified_at INTEGER);',
  );
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.exec('DELETE FROM platform_workspaces; DELETE FROM workspaces;');
  await db
    .prepare('INSERT INTO workspaces VALUES(?,?,1)')
    .bind(platform, 'Platform fixture')
    .run();
  await db
    .prepare('INSERT INTO platform_workspaces VALUES(?,1)')
    .bind(platform)
    .run();
});
const environment = () =>
  ({
    CONTROL_DB: db,
    PLATFORM_ENABLED: 'true',
    DISPATCHER: {
      get() {
        throw Error('An address check must not invoke a tenant');
      },
    },
    SALES_RELAY_ENABLED: 'true',
    SALES_RELAY_ADDRESS: 'reply@replies.example',
    SALES_RELAY_WORKSPACES: JSON.stringify([platform]),
    WORKSPACES: '[]',
  }) as unknown as HostedEnv;
it('creates a role-grant alias for an explicitly allowed, qualified platform account outside the legacy map', async () => {
  const address = await newReplyAddress(environment(), platform);
  expect(address?.address).toMatch(
    /^reply\+aaaaaaaa\.[a-f0-9]{48}@replies\.example$/,
  );
});

it('resolves the incoming prefix to the same qualified platform account', async () => {
  expect(await relayWorkspaceForPrefix(environment(), 'aaaaaaaa')).toBe(
    platform,
  );
  expect(await relayWorkspaceForPrefix(environment(), 'bbbbbbbb')).toBeNull();
});
it.each(['suspended', 'unqualified', 'no-dispatcher', 'not-allowed'])(
  'denies alias authority for a %s platform account',
  async (state) => {
    const env = environment();
    if (state === 'suspended')
      await db
        .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
        .bind(platform)
        .run();
    if (state === 'unqualified')
      await db
        .prepare(
          'UPDATE platform_workspaces SET qualified_at=0 WHERE workspace_id=?',
        )
        .bind(platform)
        .run();
    if (state === 'no-dispatcher') delete env.DISPATCHER;
    if (state === 'not-allowed') env.SALES_RELAY_WORKSPACES = '[]';
    expect(await relayWorkspaceForPrefix(env, 'aaaaaaaa')).toBeNull();
    if (state === 'not-allowed')
      expect(await newReplyAddress(env, platform)).toBeNull();
    else await expect(newReplyAddress(env, platform)).rejects.toThrow();
  },
);
it.each(['legacy', 'reserved'])(
  'rejects a prefix collision with a %s account instead of choosing a recipient',
  async (kind) => {
    const other = 'aaaaaaaa-2222-4222-8222-222222222222';
    const env = environment();
    if (kind === 'legacy')
      env.WORKSPACES = JSON.stringify([
        { id: other, label: 'Legacy collision', binding: 'WORKSPACE_0' },
      ]);
    else
      await db
        .prepare('INSERT INTO workspaces VALUES(?,?,0)')
        .bind(other, 'Reserved collision')
        .run();
    expect(await relayWorkspaceForPrefix(env, 'aaaaaaaa')).toBeNull();
    await expect(newReplyAddress(env, platform)).rejects.toThrow();
  },
);
