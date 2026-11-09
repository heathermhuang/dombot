import { ParkioSync } from './parkio-sync';
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import fs from 'node:fs/promises';
import { aesGcmCipher } from '../core/storage/encrypted';
import { ParkioStore } from './parkio-store';
import type { ParkioSource, ParkioCredential } from '../shared/parkio';
let mf: Miniflare, db: D1Database, store: ParkioStore;
const source = (): ParkioSource => ({
  version: 1,
  id: crypto.randomUUID(),
  epoch: 1,
  label: 'Park.io',
  accountId: '123',
  connection: 'connected',
  paused: false,
  sync: 'idle',
  generation: null,
  previousGeneration: null,
  credentialRevision: null,
  contentHash: null,
  count: 0,
  lastSuccessfulCheckAt: null,
  lastAttemptAt: null,
  activationId: null,
  lastContentChangedAt: null,
  nextAttemptAt: Date.now() + 1000,
  error: null,
  run: null,
  pending: null,
});
const record = {
  domain: 'alpha.test',
  expirationDate: '2028-02-29',
  orderId: '12',
  lastSeenAt: 100,
  missingSince: null,
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      compatibilityDate: '2026-09-09',
      d1Databases: { DB: 'parkio-store-test' },
    }),
  );
  db = (await mf.getD1Database('DB')) as D1Database;
  const sql = await fs.readFile('migrations/0010_parkio.sql', 'utf8');
  await db.batch(
    sql
      .replace(/^--.*$/gm, '')
      .split(';')
      .filter((s) => s.trim())
      .map((s) => db.prepare(s)),
  );
  store = new ParkioStore(db, {
    metadata: await aesGcmCipher(new Uint8Array(32).fill(1)),
    inventory: await aesGcmCipher(new Uint8Array(32).fill(2)),
    credentials: await aesGcmCipher(new Uint8Array(32).fill(3)),
  });
});
beforeEach(async () => {
  await db.batch(
    ['parkio_sources', 'parkio_chunks', 'parkio_credentials'].map((t) =>
      db.prepare('DELETE FROM ' + t),
    ),
  );
});
afterAll(async () => {
  await mf?.dispose();
});
describe('private Park.io storage', () => {
  it('fences stale writers and checks the durable revision', async () => {
    const s = await store.save(source(), null);
    const next = await store.save({ ...s.source, paused: true }, s);
    await expect(store.save({ ...s.source, paused: false }, s)).rejects.toThrow(
      'conflict',
    );
    expect((await store.source(s.source.id))?.revision).toBe(next.revision);
  });
  it('does not expose staged or incomplete inventory as an active snapshot', async () => {
    const s = source();
    const generation = await store.stage(s.id, [record]);
    expect(await store.sources()).toEqual([]);
    const saved = await store.save({ ...s, generation, count: 1 }, null);
    expect(await store.records(saved.source)).toEqual([record]);
    await db
      .prepare('DELETE FROM parkio_chunks WHERE source_id=?')
      .bind(s.id)
      .run();
    await expect(store.records(saved.source)).rejects.toThrow(
      'storage_unavailable',
    );
  });
  it('encrypts credentials separately and rejects copying ciphertext across identities', async () => {
    const s = source();
    const c: ParkioCredential = {
      version: 1,
      accountId: '123',
      cookies: [
        {
          name: 'parkio_user_signin',
          value: 'test-only-secret',
          domain: 'park.io',
          path: '/',
          secure: true,
          httpOnly: true,
        },
      ],
      capturedAt: 100,
      expiresAt: 10000,
      exportPath: '/orders/export/active/123.csv',
      accountPath: '/orders/index',
    };
    const revision = await store.stageCredential(s.id, c);
    s.credentialRevision = revision;
    await store.save(s, null);
    expect(await store.credential(s)).toEqual(c);
    const raw = await db
      .prepare('SELECT sealed FROM parkio_credentials WHERE source_id=?')
      .bind(s.id)
      .first<{ sealed: string }>();
    expect(raw!.sealed).not.toContain('test-only-secret');
    const other = source();
    other.credentialRevision = revision;
    await store.save(other, null);
    await db
      .prepare('INSERT INTO parkio_credentials VALUES(?,?,?,?)')
      .bind(other.id, revision, 100, raw!.sealed)
      .run();
    await expect(store.credential(other)).rejects.toThrow(
      'storage_unavailable',
    );
  });
  it('does not turn corrupt metadata into an empty source', async () => {
    const s = await store.save(source(), null);
    await db
      .prepare('UPDATE parkio_sources SET sealed=? WHERE id=?')
      .bind('broken', s.source.id)
      .run();
    await expect(store.sources()).rejects.toThrow();
  });
  it('retains referenced snapshots during bounded garbage collection', async () => {
    const s = source();
    s.generation = await store.stage(s.id, [record], 1);
    s.count = 1;
    await store.save(s, null);
    await store.stage(s.id, [record], 1);
    await store.collect(86400002);
    expect(await store.records(s)).toEqual([record]);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM parkio_chunks')
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
});

describe('Park.io lifecycle and scheduled merge', () => {
  const candidate = (): ParkioCredential => ({
    version: 1,
    accountId: '123',
    cookies: [
      {
        name: 'parkio_user_signin',
        value: 'test-only-secret',
        domain: 'park.io',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ],
    capturedAt: 1000,
    expiresAt: 100000000,
    exportPath: '/orders/export/active/123.csv',
    accountPath: '/orders/index',
  });
  it('journals candidate activation before reading and handles lost-response retries idempotently', async () => {
    let reads = 0;
    const sync = new ParkioSync(
      store,
      async (credential) => {
        reads++;
        return { credential, records: [record] };
      },
      () => 2000,
    );
    const id = crypto.randomUUID(),
      op = crypto.randomUUID();
    const saved = await sync.activate(id, candidate(), null, op);
    expect(saved.source.count).toBe(1);
    expect(saved.source.connection).toBe('connected');
    expect((await sync.activate(id, candidate(), null, op)).revision).toBe(
      saved.revision,
    );
    expect(reads).toBe(1);
    await expect(
      sync.activate(id, candidate(), null, crypto.randomUUID()),
    ).rejects.toThrow('conflict');
  });
  it('preserves last-good inventory and commits cookie rotation separately from a malformed export', async () => {
    let now = 2000;
    let fail = false;
    const sync = new ParkioSync(
      store,
      async (credential) =>
        fail
          ? {
              credential: {
                ...credential,
                cookies: credential.cookies.map((c) => ({
                  ...c,
                  value: 'rotated-secret',
                })),
              },
              error: 'schema_changed',
            }
          : { credential, records: [record] },
      () => now,
    );
    const active = await sync.activate(
      crypto.randomUUID(),
      candidate(),
      null,
      crypto.randomUUID(),
    );
    fail = true;
    now += 3600001;
    const held = await sync.refresh(active.source.id, true);
    expect(held.source.lastSuccessfulCheckAt).toBe(2000);
    expect(held.source.error).toBe('schema_changed');
    expect(await store.records(held.source)).toEqual([record]);
    expect((await store.credential(held.source))?.cookies[0].value).toBe(
      'rotated-secret',
    );
  });
  it('requires explicit review for absent names and never infers a departure', async () => {
    let now = 2000;
    let incoming = [record];
    const sync = new ParkioSync(
      store,
      async (credential) => ({ credential, records: incoming }),
      () => now,
    );
    const active = await sync.activate(
      crypto.randomUUID(),
      candidate(),
      null,
      crypto.randomUUID(),
    );
    incoming = [];
    now += 3600001;
    const review = await sync.refresh(active.source.id, true);
    expect(review.source.sync).toBe('review_required');
    expect((await store.records(review.source))[0].missingSince).toBeNull();
    expect(review.source.pending?.summary.missing).toBe(1);
    const accepted = await sync.update(
      active.source.id,
      review.revision,
      'accept_review',
    );
    expect((await store.records(accepted.source))[0].missingSince).toBe(now);
    expect(accepted.source.count).toBe(1);
  });
  it('fences an in-flight result after disconnect and deletes stored credentials', async () => {
    let now = 2000;
    let deferred:
      | ((value: {
          credential: ParkioCredential;
          records: (typeof record)[];
        }) => void)
      | undefined;
    let delayed = false;
    const sync = new ParkioSync(
      store,
      (credential) =>
        delayed
          ? new Promise((resolve) => {
              deferred = resolve;
            })
          : Promise.resolve({ credential, records: [record] }),
      () => now,
    );
    const active = await sync.activate(
      crypto.randomUUID(),
      candidate(),
      null,
      crypto.randomUUID(),
    );
    delayed = true;
    now += 3600001;
    const pending = sync.refresh(active.source.id, true);
    while (!deferred) await new Promise((r) => setTimeout(r, 1));
    const running = (await store.source(active.source.id))!;
    const disconnected = await sync.update(
      active.source.id,
      running.revision,
      'disconnect',
    );
    deferred!({ credential: candidate(), records: [] });
    await expect(pending).rejects.toThrow('conflict');
    expect(await store.credential(disconnected.source)).toBeNull();
    expect(await store.records(disconnected.source)).toEqual([record]);
  });
  it('holds an expired uncertain run instead of making another upstream request', async () => {
    let reads = 0;
    const sync = new ParkioSync(
      store,
      async (credential) => {
        reads++;
        return { credential, records: [record] };
      },
      () => 2000,
    );
    const active = await sync.activate(
      crypto.randomUUID(),
      candidate(),
      null,
      crypto.randomUUID(),
    );
    await store.save(
      {
        ...active.source,
        sync: 'running',
        run: { id: crypto.randomUUID(), expiresAt: 1000 },
        nextAttemptAt: 1000,
      },
      active,
    );
    await sync.due();
    const held = (await store.source(active.source.id))!;
    expect(held.source.error).toBe('check_outcome_unknown');
    expect(reads).toBe(1);
  });
});
