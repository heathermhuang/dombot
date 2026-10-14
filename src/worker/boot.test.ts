import { afterEach, describe, expect, it, vi } from 'vitest';

const migration = vi.hoisted(() => ({
  calls: 0,
  started: () => {},
  release: () => {},
}));
vi.mock('./proxy-transport', () => ({ workerProxyFetch: vi.fn() }));
vi.mock('../core/storage/migrations', () => ({
  runMigrations: vi.fn(async () => {
    migration.calls++;
    if (migration.calls !== 1) return;
    await new Promise<void>((resolve) => {
      migration.release = resolve;
      migration.started();
    });
    throw new Error('Transient initialization read failure');
  }),
}));
afterEach(() => vi.restoreAllMocks());

describe('Worker initialization recovery', () => {
  it('lets a queued request initialize independently after the first request fails', async () => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const started = new Promise<void>((resolve) => {
      migration.started = resolve;
    });
    const { default: worker } = await import('./index');
    const env = {
      DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!'),
      DOMBOT_AUTH: 'external',
    } as Env;
    const kept: Promise<unknown>[] = [];
    const context = {
      waitUntil: (work: Promise<unknown>) => kept.push(work),
    } as ExecutionContext;
    const status = () =>
      worker.fetch(
        new Request('https://worker.example/auth/status'),
        env,
        context,
      );
    const first = status();
    await started;
    const queued = status();
    await Promise.resolve();
    migration.release();

    const responses = await Promise.all([first, queued]);
    expect(responses.map((response) => response.status)).toEqual([503, 200]);
    expect(await responses[1].json()).toMatchObject({
      mode: 'external',
      authenticated: true,
    });
    expect((await status()).status).toBe(200);
    expect(migration.calls).toBe(2);
    expect(kept).toHaveLength(2);
    await expect(Promise.all(kept)).resolves.toHaveLength(2);

    // Once initialized, the auth-status read must not wait behind a stateful
    // registrar request. It needs only the completed auth configuration.
    const { withRequestLock } = await import('./lock');
    let release!: () => void;
    const held = withRequestLock(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await Promise.resolve();
    try {
      const response = await Promise.race([
        status(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
      ]);
      expect(response?.status).toBe(200);
    } finally {
      release();
      await held;
    }
  });
});
