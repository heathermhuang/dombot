import { it, expect } from 'vitest';
import { MemoryDocStore } from '../core/storage/doc-store';
import {
  configureStore,
  hydrateStores,
  flushWrites,
} from '../core/storage/namespace';
import {
  configureSyncDiagnostics,
  recordSyncAttempt,
} from '../core/services/sync-diagnostics';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { readSyncMonitor } from './sync-monitor';
import type { DomBotEnvironment } from './engine-contract';
import type { SyncDiagnostics } from '../shared/sync-monitor';
const input = () => ({
  accountId: 'dynadot',
  trigger: 'manual' as const,
  startedAt: Date.now() - 2000,
  at: Date.now(),
  durationMs: 2000,
  ok: false,
  lastGoodAt: null,
  domains: 3,
  route: 'managed' as const,
});
it('reads one atomic encrypted document and rejects corruption instead of reporting healthy', async () => {
  configureSyncDiagnostics(true);
  const secret = btoa('x'.repeat(32));
  const cipher = await aesGcmCipher(
    await deriveEncryptionKey(parseRootSecret(secret)),
  );
  const raw = new MemoryDocStore();
  configureStore(new EncryptedDocStore(raw, cipher));
  await hydrateStores();
  recordSyncAttempt(input(), 'network error');
  await flushWrites();
  let reads = 0;
  const env = {
    DOMBOT_SECRET: secret,
    DB: {
      prepare: (sql: string) => {
        expect(sql).toContain("ns='sync-monitor'");
        reads++;
        return {
          first: async () => ({
            value: JSON.stringify(await raw.get('sync-monitor', 'diagnostics')),
          }),
        };
      },
    },
  } as unknown as DomBotEnvironment;
  const result = (await readSyncMonitor(env)) as {
    diagnostics: SyncDiagnostics;
  };
  expect(result.diagnostics.events[0].code).toBe('network');
  expect(await readSyncMonitor(env, result.diagnostics.revision)).toEqual({
    unchanged: true,
  });
  expect(reads).toBe(2);
  await raw.put('sync-monitor', 'diagnostics', {
    __sealed: 1,
    alg: 'aes-gcm',
    ct: 'corrupt',
  });
  await expect(readSyncMonitor(env)).rejects.toThrow();
});
