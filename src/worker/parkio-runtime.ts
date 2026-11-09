import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveParkioKey, deriveEncryptionKey, parseRootSecret } from './keys';
import { ParkioStore } from './parkio-store';
export async function parkioStore(env: Env) {
  const root = parseRootSecret(env.DOMBOT_SECRET);
  const [metadata, inventory, credentials] = await Promise.all(
    (['metadata', 'inventory', 'credentials'] as const).map(async (p) =>
      aesGcmCipher(await deriveParkioKey(root, p)),
    ),
  );
  const indexKey = await crypto.subtle.importKey(
    'raw',
    await deriveParkioKey(root, 'index'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const indexer = async (value: string) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          indexKey,
          new TextEncoder().encode('account/' + value),
        ),
      ),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  return new ParkioStore(env.DB, { metadata, inventory, credentials }, indexer);
}

export async function parkioAutomaticUpdates(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT value FROM docs WHERE ns='settings' AND key='autoSyncIntervalMinutes'",
  ).first<{ value: string }>();
  if (!row) return true;
  let value: unknown = JSON.parse(row.value);
  if (value && typeof value === 'object' && '__sealed' in value) {
    const envelope = value as { __sealed: unknown; ct: unknown };
    if (envelope.__sealed !== 1 || typeof envelope.ct !== 'string')
      throw Error('Invalid settings');
    const cipher = await aesGcmCipher(
      await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
    );
    value = JSON.parse(await cipher.open(envelope.ct));
  }
  const minutes = Number(value);
  return !Number.isFinite(minutes) || minutes < 0 || minutes > 0;
}
