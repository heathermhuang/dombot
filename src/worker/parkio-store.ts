import { parkioBackupSchema, type ParkioBackup } from './parkio-backup';
import { z } from 'zod';
import type { Cipher } from '../core/storage/encrypted';
import {
  ParkioError,
  parkioSourceSchema,
  parkioRecordSchema,
  parkioCredentialSchema,
  PARKIO_MAX_RETAINED,
  type ParkioSource,
  type ParkioRecord,
  type ParkioCredential,
} from '../shared/parkio';
const uuid = z.string().uuid();
type Stored = { source: ParkioSource; revision: string };
export class ParkioStore {
  constructor(
    readonly db: D1Database,
    private readonly ciphers: {
      metadata: Cipher;
      inventory: Cipher;
      credentials: Cipher;
    },
    private readonly accountIndex: (id: string) => Promise<string>,
  ) {}
  private async seal(
    kind: keyof ParkioStore['ciphers'],
    scope: string,
    value: unknown,
  ) {
    return this.ciphers[kind].seal(
      JSON.stringify({ version: 1, scope, value }),
    );
  }
  private async open(
    kind: keyof ParkioStore['ciphers'],
    scope: string,
    sealed: string,
  ): Promise<unknown> {
    const e = JSON.parse(await this.ciphers[kind].open(sealed));
    if (e?.version !== 1 || e.scope !== scope)
      throw new ParkioError('storage_unavailable');
    return e.value;
  }
  async source(id: string): Promise<Stored | null> {
    uuid.parse(id);
    const row = await this.db
      .prepare('SELECT * FROM parkio_sources WHERE id=?')
      .bind(id)
      .first<{
        id: string;
        account_key: string;
        revision: string;
        epoch: number;
        record_count: number;
        credential_revision: string | null;
        generation: string | null;
        previous_generation: string | null;
        pending_generation: string | null;
        sealed: string;
      }>();
    if (!row) return null;
    const s = parkioSourceSchema.parse(
      await this.open('metadata', 'source/' + id, row.sealed),
    );
    if (
      s.id !== row.id ||
      row.account_key !== (await this.accountIndex(s.accountId)) ||
      s.epoch !== row.epoch ||
      s.count !== row.record_count ||
      s.credentialRevision !== row.credential_revision ||
      s.generation !== row.generation ||
      s.previousGeneration !== row.previous_generation ||
      (s.pending?.generation ?? null) !== row.pending_generation
    )
      throw new ParkioError('storage_unavailable');
    uuid.parse(row.revision);
    return { source: s, revision: row.revision };
  }
  async sources(): Promise<Stored[]> {
    const ids = (
      await this.db
        .prepare('SELECT id FROM parkio_sources ORDER BY id LIMIT 11')
        .all<{ id: string }>()
    ).results;
    if (ids.length > 10) throw new ParkioError('storage_unavailable');
    return Promise.all(ids.map(async (r) => (await this.source(r.id))!));
  }
  async save(next: ParkioSource, expected: Stored | null): Promise<Stored> {
    parkioSourceSchema.parse(next);
    if (
      expected &&
      (next.id !== expected.source.id || next.epoch < expected.source.epoch)
    )
      throw new ParkioError('conflict');
    if (expected && next.accountId !== expected.source.accountId)
      throw new ParkioError('account_mismatch');
    const accountKey = await this.accountIndex(next.accountId);
    const revision = crypto.randomUUID(),
      sealed = await this.seal('metadata', 'source/' + next.id, next);
    const columns = [
      revision,
      next.epoch,
      next.count,
      next.credentialRevision,
      next.generation,
      next.previousGeneration,
      next.pending?.generation ?? null,
      sealed,
    ];
    const query = expected
      ? this.db
          .prepare(
            `UPDATE parkio_sources SET revision=?,epoch=?,record_count=?,credential_revision=?,generation=?,previous_generation=?,pending_generation=?,sealed=? WHERE id=? AND revision=? AND epoch=? AND (SELECT COALESCE(SUM(record_count),0) FROM parkio_sources)-record_count+?<=? RETURNING id`,
          )
          .bind(
            ...columns,
            next.id,
            expected.revision,
            expected.source.epoch,
            next.count,
            PARKIO_MAX_RETAINED,
          )
      : this.db
          .prepare(
            `INSERT INTO parkio_sources(id,account_key,revision,epoch,record_count,credential_revision,generation,previous_generation,pending_generation,sealed) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM parkio_sources)<10 AND (SELECT COALESCE(SUM(record_count),0) FROM parkio_sources)+?<=? ON CONFLICT(id) DO NOTHING RETURNING id`,
          )
          .bind(
            next.id,
            accountKey,
            ...columns,
            next.count,
            PARKIO_MAX_RETAINED,
          );
    try {
      if (!(await query.first())) throw new ParkioError('conflict');
    } catch (error) {
      if (error instanceof ParkioError) throw error;
      throw new ParkioError(
        !expected &&
          error instanceof Error &&
          /UNIQUE constraint failed: parkio_sources.account_key/.test(
            error.message,
          )
          ? 'account_already_connected'
          : 'storage_unavailable',
      );
    }
    return { source: next, revision };
  }
  async records(
    source: ParkioSource,
    generation = source.generation,
  ): Promise<ParkioRecord[]> {
    if (!generation) {
      if (source.count !== 0) throw new ParkioError('storage_unavailable');
      return [];
    }
    const rows = (
      await this.db
        .prepare(
          'SELECT chunk_index,sealed FROM parkio_chunks WHERE source_id=? AND generation=? ORDER BY chunk_index LIMIT 1001',
        )
        .bind(source.id, generation)
        .all<{ chunk_index: number; sealed: string }>()
    ).results;
    if (rows.length > 1000 || !rows.length)
      throw new ParkioError('storage_unavailable');
    const out: ParkioRecord[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].chunk_index !== i)
        throw new ParkioError('storage_unavailable');
      out.push(
        ...z
          .array(parkioRecordSchema)
          .max(500)
          .parse(
            await this.open(
              'inventory',
              `snapshot/${source.id}/${generation}/${i}`,
              rows[i].sealed,
            ),
          ),
      );
      if (out.length > PARKIO_MAX_RETAINED)
        throw new ParkioError('storage_unavailable');
    }
    if (generation === source.generation && out.length !== source.count)
      throw new ParkioError('storage_unavailable');
    if (new Set(out.map((r) => r.domain)).size !== out.length)
      throw new ParkioError('storage_unavailable');
    return out;
  }
  async stage(
    id: string,
    records: ParkioRecord[],
    now = Date.now(),
  ): Promise<string> {
    uuid.parse(id);
    if (records.length > PARKIO_MAX_RETAINED)
      throw new ParkioError('inventory_limit');
    records.forEach((r) => parkioRecordSchema.parse(r));
    const generation = crypto.randomUUID();
    const chunks: ParkioRecord[][] = [];
    let current: ParkioRecord[] = [],
      bytes = 2;
    for (const r of records) {
      const size = new TextEncoder().encode(JSON.stringify(r)).length;
      if (
        current.length >= 500 ||
        bytes + size + (current.length ? 1 : 0) > 24000
      ) {
        chunks.push(current);
        current = [];
        bytes = 2;
      }
      bytes += size + (current.length ? 1 : 0);
      current.push(r);
    }
    chunks.push(current);
    let writes: D1PreparedStatement[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const sealed = await this.seal(
        'inventory',
        `snapshot/${id}/${generation}/${i}`,
        chunks[i],
      );
      if (new TextEncoder().encode(sealed).length > 65536)
        throw new ParkioError('inventory_limit');
      writes.push(
        this.db
          .prepare(
            'INSERT INTO parkio_chunks(source_id,generation,chunk_index,created_at,sealed) VALUES(?,?,?,?,?)',
          )
          .bind(id, generation, i, now, sealed),
      );
      if (writes.length === 10) {
        await this.db.batch(writes);
        writes = [];
      }
    }
    if (writes.length) await this.db.batch(writes);
    return generation;
  }
  async credential(source: ParkioSource): Promise<ParkioCredential | null> {
    if (!source.credentialRevision) return null;
    const row = await this.db
      .prepare(
        'SELECT sealed FROM parkio_credentials WHERE source_id=? AND revision=?',
      )
      .bind(source.id, source.credentialRevision)
      .first<{ sealed: string }>();
    if (!row) throw new ParkioError('credential_unavailable');
    const c = parkioCredentialSchema.parse(
      await this.open(
        'credentials',
        `credential/${source.id}/${source.credentialRevision}`,
        row.sealed,
      ),
    );
    if (c.accountId !== source.accountId)
      throw new ParkioError('account_mismatch');
    return c;
  }
  async stageCredential(
    id: string,
    credential: ParkioCredential,
  ): Promise<string> {
    uuid.parse(id);
    parkioCredentialSchema.parse(credential);
    const revision = crypto.randomUUID();
    await this.db
      .prepare(
        'INSERT INTO parkio_credentials(source_id,revision,created_at,sealed) VALUES(?,?,?,?)',
      )
      .bind(
        id,
        revision,
        Date.now(),
        await this.seal(
          'credentials',
          `credential/${id}/${revision}`,
          credential,
        ),
      )
      .run();
    return revision;
  }
  async discardCredentials(id: string) {
    await this.db
      .prepare(
        "DELETE FROM parkio_credentials WHERE source_id=? AND revision<>COALESCE((SELECT credential_revision FROM parkio_sources WHERE id=?),'')",
      )
      .bind(id, id)
      .run();
  }
  async collect(now = Date.now()) {
    await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM parkio_chunks WHERE rowid IN (SELECT c.rowid FROM parkio_chunks c LEFT JOIN parkio_sources s ON s.id=c.source_id WHERE c.created_at<? AND c.generation<>COALESCE(s.generation,'') AND c.generation<>COALESCE(s.previous_generation,'') AND c.generation<>COALESCE(s.pending_generation,'') LIMIT 100)`,
        )
        .bind(now - 86400000),
      this.db
        .prepare(
          `DELETE FROM parkio_credentials WHERE rowid IN (SELECT c.rowid FROM parkio_credentials c LEFT JOIN parkio_sources s ON s.id=c.source_id WHERE c.created_at<? AND c.revision<>COALESCE(s.credential_revision,'') LIMIT 100)`,
        )
        .bind(now - 15 * 60000),
    ]);
  }
  async backup(): Promise<ParkioBackup> {
    return {
      version: 1,
      sources: await Promise.all(
        (await this.sources()).map(async ({ source: s }) => ({
          source: {
            ...s,
            connection: 'reconnect_required' as const,
            credentialRevision: null,
            run: null,
            pending: null,
            sync: 'idle' as const,
            nextAttemptAt: null,
            activationId: null,
            error: 'sign_in_required',
          },
          records: await this.records(s),
        })),
      ),
    };
  }
  async prepareRestore(value: ParkioBackup): Promise<D1PreparedStatement[]> {
    const backup = parkioBackupSchema.parse(value);
    const statements: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM parkio_sources'),
    ];
    for (const item of backup.sources) {
      const old = await this.source(item.source.id);
      const generation = await this.stage(item.source.id, item.records);
      const source = {
        ...item.source,
        epoch: Math.max(item.source.epoch, old?.source.epoch ?? 0) + 1,
        generation,
        previousGeneration: null,
      };
      const sealed = await this.seal('metadata', 'source/' + source.id, source);
      statements.push(
        this.db
          .prepare(
            'INSERT INTO parkio_sources(id,account_key,revision,epoch,record_count,credential_revision,generation,previous_generation,pending_generation,sealed) VALUES(?,?,?,?,?,NULL,?,NULL,NULL,?)',
          )
          .bind(
            source.id,
            await this.accountIndex(source.accountId),
            crypto.randomUUID(),
            source.epoch,
            source.count,
            generation,
            sealed,
          ),
      );
    }
    statements.push(this.db.prepare('DELETE FROM parkio_credentials'));
    return statements;
  }
  async observations() {
    return Promise.all(
      (await this.sources()).map(async ({ source }) => ({
        source,
        records: await this.records(source),
      })),
    );
  }
}
