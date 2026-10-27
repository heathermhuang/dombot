import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { syncDiagnosticsSchema } from '../shared/sync-monitor';
import type { DomBotEnvironment } from './engine-contract';

export class SyncMonitorReadError extends Error {
  constructor(
    readonly stage: 'storage' | 'envelope' | 'decryption' | 'validation',
  ) {
    super('Sync diagnostics unavailable');
    this.name = 'SyncMonitorReadError';
  }
}

/** Single indexed encrypted row; no portfolio hydration, registrar calls or
 * writes. The revision and attempts are always from the same atomic value. */
export async function readSyncMonitor(
  env: DomBotEnvironment,
  revision?: string,
): Promise<unknown> {
  let stage: SyncMonitorReadError['stage'] = 'storage';
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM docs WHERE ns='sync-monitor' AND key='diagnostics'",
    ).first<{ value: string }>();
    if (!row) return { diagnostics: null };
    stage = 'envelope';
    const envelope = JSON.parse(row.value) as {
      __sealed: number;
      alg: string;
      ct: string;
    };
    if (
      envelope.__sealed !== 1 ||
      envelope.alg !== 'aes-gcm' ||
      typeof envelope.ct !== 'string'
    )
      throw Error('Invalid sync diagnostics');
    stage = 'decryption';
    const cipher = await aesGcmCipher(
      await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
    );
    // Unlike general cache loading, corrupt diagnostics must never become healthy.
    const plain = await cipher.open(envelope.ct);
    stage = 'validation';
    const diagnostics = syncDiagnosticsSchema.parse(JSON.parse(plain));
    return diagnostics.revision === revision
      ? { unchanged: true }
      : { diagnostics };
  } catch {
    throw new SyncMonitorReadError(stage);
  }
}
