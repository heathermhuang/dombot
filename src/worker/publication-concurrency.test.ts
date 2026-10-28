import { expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../core/storage/doc-store';
import { emptyDraft } from '../shared/publication';

vi.mock('./root-retirement', () => ({
  withRootLease: (_env: unknown, work: () => Promise<Response>) => work(),
}));
vi.mock('../core/storage/migrations', () => ({
  runMigrations: async () => {},
}));
vi.mock('./storage/d1-doc-store', () => ({ D1DocStore: MemoryDocStore }));
vi.mock('./proxy-transport', () => ({
  createWorkerProxyFetch: () => vi.fn(),
  workerProxyPolicy: () => () => ({}),
}));
vi.mock('./sales-backup', async (original) => ({
  ...(await original<typeof import('./sales-backup')>()),
  hasSales: async () => false,
}));
vi.mock('./publication-store', async (original) => ({
  ...(await original<typeof import('./publication-store')>()),
  PublicationStore: class {
    async draft() {
      return { draft: emptyDraft(), revision: null };
    }
    async published() {
      return null;
    }
  },
}));

it('serves the real Worker publication path while its provider lock is held after hydration', async () => {
  const { default: worker } = await import('./index');
  const { withRequestLock } = await import('./lock');
  const env = {
    DOMBOT_AUTH: 'external',
    DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!'),
  } as Env;
  const warm = await worker.fetch(
    new Request('https://worker.example/api/getSettings', {
      method: 'POST',
      headers: {
        Origin: 'https://worker.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: [] }),
    }),
    env,
  );
  expect(warm.status).toBe(200);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = withRequestLock(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await started;
  try {
    for (const path of ['/publishing', '/publishing/site']) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          worker.fetch(new Request('https://worker.example' + path), env),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 1000);
          }),
        ]);
        expect(response?.status, path).toBe(200);
        expect(await response!.json()).toMatchObject({
          draft: emptyDraft(),
          review: [],
        });
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    release();
    await held;
  }
});
