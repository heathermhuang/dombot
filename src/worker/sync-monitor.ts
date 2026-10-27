import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { syncDiagnosticsSchema } from '../shared/sync-monitor';
import type { DomBotEnvironment } from './engine-contract';

/** Single indexed encrypted row; no portfolio hydration, registrar calls or
 * writes. The revision and attempts are always from the same atomic value. */
export async function readSyncMonitor(
  env: DomBotEnvironment,
  revision?: string,
): Promise<unknown> {
  const row = await env.DB.prepare(
    "SELECT value FROM docs WHERE ns='sync-monitor' AND key='diagnostics'",
  ).first<{ value: string }>();
  if (!row) return { diagnostics: null };
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
  const cipher = await aesGcmCipher(
    await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
  );
  // Unlike general cache loading, corrupt diagnostics must never become healthy.
  const diagnostics = syncDiagnosticsSchema.parse(
    JSON.parse(await cipher.open(envelope.ct)),
  );
  return diagnostics.revision === revision
    ? { unchanged: true }
    : { diagnostics };
}
