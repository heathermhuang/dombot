import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveParkioKey, parseRootSecret } from './keys';
import { ParkioStore } from './parkio-store';
export async function parkioStore(env: Env) {
  const root = parseRootSecret(env.DOMBOT_SECRET);
  const [metadata, inventory, credentials] = await Promise.all(
    (['metadata', 'inventory', 'credentials'] as const).map(async (p) =>
      aesGcmCipher(await deriveParkioKey(root, p)),
    ),
  );
  return new ParkioStore(env.DB, { metadata, inventory, credentials });
}
