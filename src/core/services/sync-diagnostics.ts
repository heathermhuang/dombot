import { Namespace } from '../storage/namespace';
import {
  classifySyncFailure,
  SYNC_EVENT_LIMIT,
  SYNC_RETENTION_MS,
  type SyncDiagnostics,
  type SyncEvent,
} from '../../shared/sync-monitor';

declare const __DOMBOT_ENGINE_VERSION__: string;
declare const __DOMBOT_ENGINE_SOURCE__: string;
const records = new Namespace<SyncDiagnostics>('sync-monitor', { local: true });
let enabled = false;
export function configureSyncDiagnostics(value: boolean): void {
  enabled = value;
}
export function recordSyncAttempt(
  input: Omit<
    SyncEvent,
    'id' | 'seq' | 'code' | 'httpStatus' | 'engine' | 'source'
  >,
  error?: unknown,
): void {
  if (!enabled) return;
  const previous = records.get('diagnostics');
  const seq = (previous?.seq ?? 0) + 1;
  const event: SyncEvent = {
    ...input,
    id: crypto.randomUUID(),
    seq,
    ...(input.ok
      ? { code: 'none' as const, httpStatus: null }
      : classifySyncFailure(error)),
    engine:
      typeof __DOMBOT_ENGINE_VERSION__ === 'string'
        ? __DOMBOT_ENGINE_VERSION__
        : 'development',
    source:
      typeof __DOMBOT_ENGINE_SOURCE__ === 'string'
        ? __DOMBOT_ENGINE_SOURCE__
        : 'development',
  };
  const retained = [...(previous?.events ?? []), event]
    .filter((e) => e.at >= input.at - SYNC_RETENTION_MS)
    .slice(-SYNC_EVENT_LIMIT);
  // One atomic encrypted document pairs the cursor and all retained attempts.
  // Namespace.set updates memory synchronously, including concurrent accounts.
  void records.set('diagnostics', {
    revision: crypto.randomUUID(),
    seq,
    prunedThrough: retained[0].seq - 1,
    events: retained,
  });
}
