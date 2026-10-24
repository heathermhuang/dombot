import { afterEach, describe, expect, it, vi } from 'vitest';

const migration = vi.hoisted(() => ({
  calls: 0,
  started: () => {},
  release: () => {},
}));
vi.mock('./proxy-transport', () => ({
  createWorkerProxyFetch: () => vi.fn(),
  workerProxyPolicy: () => () => ({}),
}));
// These unit tests isolate initialization; root admission has real-D1 race tests.
vi.mock('./root-retirement', () => ({
  withRootLease: (_env: unknown, work: () => Promise<Response>) => work(),
}));
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
  it('scopes the managed proxy to hosted auth and refreshes it when host configuration changes', async () => {
    vi.resetModules();
    migration.calls = 2;
    const { default: worker } = await import('./index');
    const { managedProxyFor } = await import('../core/services/managed-proxy');
    const env = {
      DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!'),
      DOMBOT_AUTH: 'gateway',
      DOMBOT_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
      DOMBOT_GATEWAY_SECRET: 'synthetic-gateway-secret-at-least-32-bytes',
      DOMBOT_MANAGED_PROXY_URL: 'https://host-user:host-password@8.8.8.8:8080',
      DOMBOT_MANAGED_PROXY_IP: '8.8.4.4',
    } as Env;
    const request = () =>
      worker.fetch(new Request('https://worker.example/auth/status'), env);
    expect((await request()).status).toBe(200);
    expect(managedProxyFor('namecheap')?.ip).toBe('8.8.4.4');
    env.DOMBOT_MANAGED_PROXY_IP = '1.0.0.1';
    expect((await request()).status).toBe(200);
    expect(managedProxyFor('namecheap')?.ip).toBe('1.0.0.1');
    env.DOMBOT_AUTH = 'external';
    expect((await request()).status).toBe(200);
    expect(managedProxyFor('namecheap')).toBeNull();
  });

  it('lets a queued request initialize independently after the first request fails', async () => {
    vi.resetModules();
    migration.calls = 0;
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
    expect(kept).toHaveLength(5);
    await expect(Promise.all(kept)).resolves.toHaveLength(5);

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
