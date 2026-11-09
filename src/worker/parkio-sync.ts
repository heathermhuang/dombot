import {
  ParkioError,
  PARKIO_INTERVAL,
  PARKIO_SESSION_RETENTION,
  parkioCredentialSchema,
  mergeParkio,
  parkioContentHash,
  type ParkioSource,
  type ParkioCredential,
} from '../shared/parkio';
import { ParkioStore } from './parkio-store';
import { readParkio, type ParkioReadResult } from './parkio-transport';
type Reader = (credential: ParkioCredential) => Promise<ParkioReadResult>;
const retryable = new Set(['rate_limited', 'provider_unavailable']);
const reconnect = new Set([
  'sign_in_required',
  'account_mismatch',
  'cookie_contract_required',
  'session_outcome_unknown',
]);
export class ParkioSync {
  constructor(
    private readonly store: ParkioStore,
    private readonly reader: Reader = readParkio,
    private readonly clock: () => number = Date.now,
  ) {}
  async activate(
    id: string,
    credential: ParkioCredential,
    expected: string | null,
    operationId: string,
  ) {
    const now = this.clock();
    parkioCredentialSchema.parse(credential);
    if (
      credential.capturedAt > now + 30000 ||
      credential.expiresAt <= now ||
      credential.expiresAt > credential.capturedAt + PARKIO_SESSION_RETENTION ||
      !credential.cookies.some((c) => c.name === 'parkio_user_signin')
    )
      throw new ParkioError('sign_in_required');
    let current = await this.store.source(id);
    const isNew = !current;
    if (current?.source.activationId === operationId) return current;
    if ((current?.revision ?? null) !== expected)
      throw new ParkioError('conflict');
    if (current && current.source.accountId !== credential.accountId)
      throw new ParkioError('account_mismatch');
    // Candidate credentials never replace the working connection until both identity
    // and the complete export have been independently validated in this tenant.
    const base: ParkioSource = current?.source ?? {
      version: 1,
      id,
      epoch: 1,
      label: 'Park.io',
      accountId: credential.accountId,
      connection: 'reconnect_required',
      paused: false,
      sync: 'idle',
      generation: null,
      previousGeneration: null,
      credentialRevision: null,
      contentHash: null,
      count: 0,
      lastAttemptAt: null,
      activationId: null,
      lastSuccessfulCheckAt: null,
      lastContentChangedAt: null,
      nextAttemptAt: null,
      error: null,
      run: null,
      pending: null,
    };
    if (base.run && base.run.expiresAt > now)
      throw new ParkioError('check_in_progress');
    current = await this.store.save(
      {
        ...base,
        activationId: operationId,
        sync: 'running',
        run: { id: operationId, expiresAt: now + 90000 },
        nextAttemptAt: null,
      },
      current,
    );
    let result: ParkioReadResult;
    try {
      result = await this.reader(credential);
    } catch {
      result = { credential: null, error: 'session_outcome_unknown' };
    }
    if (result.error || !result.records || !result.credential) {
      await this.store.save(
        {
          ...base,
          activationId: operationId,
          run: null,
          error: result.error ?? 'export_rejected',
        },
        current,
      );
      throw new ParkioError(result.error ?? 'export_rejected');
    }
    const previous = current ? await this.store.records(current.source) : [];
    const merged = mergeParkio(previous, result.records, now);
    const hash = await parkioContentHash(merged.records);
    const generation = await this.store.stage(id, merged.records, now);
    const credentialRevision = await this.store.stageCredential(
      id,
      result.credential,
    );
    const review =
      merged.reviewRequired || (isNew && result.records.length === 0);
    const next: ParkioSource = {
      ...base,
      activationId: operationId,
      epoch: base.epoch + (isNew ? 0 : 1),
      connection: 'connected',
      sync: review ? 'review_required' : 'idle',
      credentialRevision,
      lastAttemptAt: now,
      error: null,
      run: null,
      pending: review
        ? { generation, hash, createdAt: now, summary: merged.summary }
        : null,
      ...(review
        ? { nextAttemptAt: null }
        : {
            generation,
            previousGeneration: base.generation,
            count: merged.records.length,
            contentHash: hash,
            lastSuccessfulCheckAt: now,
            lastContentChangedAt:
              hash === base.contentHash ? base.lastContentChangedAt : now,
            nextAttemptAt: now + PARKIO_INTERVAL,
          }),
    };
    const saved = await this.store.save(next, current);
    await this.store.discardCredentials(id);
    return saved;
  }
  async refresh(id: string, manual = false) {
    const now = this.clock();
    let current = await this.store.source(id);
    if (!current) throw new ParkioError('source_not_found');
    let s = current.source;
    if (s.run) {
      if (s.run.expiresAt > now) throw new ParkioError('check_in_progress');
      return this.store.save(
        {
          ...s,
          sync: 'blocked',
          connection: 'reconnect_required',
          error: 'check_outcome_unknown',
          run: null,
          nextAttemptAt: null,
        },
        current,
      );
    }
    if (s.connection !== 'connected' || s.paused || s.pending)
      throw new ParkioError('connection_not_ready');
    if (manual && s.lastAttemptAt !== null && now - s.lastAttemptAt < 3600000)
      throw new ParkioError('check_cooldown');
    if (!manual && (s.nextAttemptAt === null || s.nextAttemptAt > now))
      return current;
    current = await this.store.save(
      {
        ...s,
        sync: 'running',
        run: { id: crypto.randomUUID(), expiresAt: now + 90000 },
        lastAttemptAt: now,
        nextAttemptAt: null,
      },
      current,
    );
    s = current.source;
    let result: ParkioReadResult;
    try {
      const credential = await this.store.credential(s);
      if (!credential) throw new ParkioError('sign_in_required');
      result = await this.reader(credential);
    } catch {
      result = { credential: null, error: 'credential_unavailable' };
    }
    // A disconnect/reconnect/pause fences every delayed or abandoned completion.
    const latest = await this.store.source(id);
    if (
      !latest ||
      latest.revision !== current.revision ||
      latest.source.epoch !== s.epoch
    )
      throw new ParkioError('conflict');
    let credentialRevision = s.credentialRevision;
    if (result.credential) {
      if (
        !result.credential.cookies.some(
          (c) =>
            c.name === 'parkio_user_signin' &&
            (c.expires === undefined ||
              c.expires <= 0 ||
              c.expires * 1000 > now),
        )
      ) {
        result.error = 'sign_in_required';
        credentialRevision = null;
      } else
        credentialRevision = await this.store.stageCredential(
          id,
          result.credential,
        );
    }
    if (result.error || !result.records) {
      const code = result.error ?? 'export_rejected';
      const auth = reconnect.has(code) || code === 'credential_unavailable';
      const saved = await this.store.save(
        {
          ...s,
          credentialRevision,
          connection: auth ? 'reconnect_required' : s.connection,
          sync: retryable.has(code) ? 'idle' : 'blocked',
          error: code,
          run: null,
          nextAttemptAt: retryable.has(code) ? now + 3600000 : null,
        },
        current,
      );
      await this.store.discardCredentials(id);
      return saved;
    }
    const merged = mergeParkio(
        await this.store.records(s),
        result.records,
        now,
      ),
      hash = await parkioContentHash(merged.records);
    const review = merged.reviewRequired;
    let generation = s.generation;
    if (hash !== s.contentHash)
      generation = await this.store.stage(id, merged.records, now);
    const saved = await this.store.save(
      {
        ...s,
        credentialRevision,
        sync: review ? 'review_required' : 'idle',
        error: null,
        run: null,
        pending: review
          ? {
              generation: generation!,
              hash,
              createdAt: now,
              summary: merged.summary,
            }
          : null,
        ...(review
          ? { nextAttemptAt: null }
          : {
              generation,
              previousGeneration:
                hash === s.contentHash ? s.previousGeneration : s.generation,
              count: merged.records.length,
              contentHash: hash,
              lastSuccessfulCheckAt: now,
              lastContentChangedAt:
                hash === s.contentHash ? s.lastContentChangedAt : now,
              nextAttemptAt: now + PARKIO_INTERVAL,
            }),
      },
      current,
    );
    await this.store.discardCredentials(id);
    return saved;
  }
  async update(
    id: string,
    expected: string,
    action:
      'pause' | 'resume' | 'disconnect' | 'accept_review' | 'reject_review',
  ) {
    const current = await this.store.source(id);
    if (!current || current.revision !== expected)
      throw new ParkioError('conflict');
    const s = current.source,
      now = this.clock();
    let next = { ...s, epoch: s.epoch + 1, run: null };
    if (action === 'disconnect')
      next = {
        ...next,
        connection: 'disconnected',
        credentialRevision: null,
        sync: 'idle',
        nextAttemptAt: null,
        error: null,
        pending: null,
      };
    if (action === 'pause')
      next = {
        ...next,
        paused: true,
        connection: s.run ? 'reconnect_required' : s.connection,
        sync: s.pending ? 'review_required' : 'idle',
        nextAttemptAt: null,
      };
    if (action === 'resume') {
      if (s.connection !== 'connected' || s.pending)
        throw new ParkioError('connection_not_ready');
      next = {
        ...next,
        paused: false,
        sync: 'idle',
        nextAttemptAt: Math.max(now, (s.lastAttemptAt ?? 0) + 3600000),
      };
    }
    if (action === 'reject_review')
      next = {
        ...next,
        pending: null,
        sync: 'idle',
        error: 'review_rejected',
        nextAttemptAt:
          s.paused || s.connection !== 'connected'
            ? null
            : now + PARKIO_INTERVAL,
      };
    if (action === 'accept_review') {
      if (!s.pending || s.pending.createdAt + 86400000 <= now)
        throw new ParkioError('review_expired');
      const records = await this.store.records(s, s.pending.generation);
      if (
        (await parkioContentHash(records)) !== s.pending.hash ||
        records.length !== s.pending.summary.count
      )
        throw new ParkioError('storage_unavailable');
      next = {
        ...next,
        previousGeneration: s.generation,
        generation: s.pending.generation,
        count: records.length,
        contentHash: s.pending.hash,
        lastSuccessfulCheckAt: s.pending.createdAt,
        lastContentChangedAt: s.pending.createdAt,
        pending: null,
        sync: 'idle',
        nextAttemptAt: s.paused ? null : now + PARKIO_INTERVAL,
      };
    }
    const saved = await this.store.save(next, current);
    if (action === 'disconnect') await this.store.discardCredentials(id);
    return saved;
  }
  async due(manual = false) {
    const sources = await this.store.sources();
    let checked = 0;
    for (const { source: s } of sources) {
      if (s.credentialRevision) {
        let expired = false;
        try {
          expired = (await this.store.credential(s))!.expiresAt <= this.clock();
        } catch {
          expired = true;
        }
        if (expired) {
          const current = await this.store.source(s.id);
          if (
            current &&
            current.revision ===
              sources.find((r) => r.source.id === s.id)!.revision
          ) {
            await this.store.save(
              {
                ...s,
                epoch: s.epoch + 1,
                credentialRevision: null,
                connection: 'reconnect_required',
                sync: 'blocked',
                error: 'sign_in_required',
                run: null,
                nextAttemptAt: null,
              },
              current,
            );
            await this.store.discardCredentials(s.id);
          }
          continue;
        }
      }

      if (checked >= 2) break;
      if (
        (s.run && s.run.expiresAt <= this.clock()) ||
        (s.connection === 'connected' &&
          !s.paused &&
          !s.pending &&
          ((manual &&
            (s.lastAttemptAt === null ||
              this.clock() - s.lastAttemptAt >= 3600000)) ||
            (s.nextAttemptAt !== null && s.nextAttemptAt <= this.clock())))
      ) {
        await this.refresh(s.id, manual);
        checked++;
      }
    }
    await this.store.collect(this.clock());
    return checked;
  }
}
