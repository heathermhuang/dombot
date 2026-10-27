import { beforeEach, expect, it, vi } from 'vitest';
import type { DomBotMaintenanceState } from '@domains-domains/dombot-engine';
import {
  MaintenanceScheduler,
  mayChangeMaintenance,
} from './maintenance-scheduler';
let data: Map<string, unknown>, alarm: number | null;
let inspect: ReturnType<typeof vi.fn<() => Promise<DomBotMaintenanceState>>>;
let scheduler: MaintenanceScheduler;
let storage: DurableObjectStorage;
const empty: DomBotMaintenanceState = {
  version: 1,
  state: 'empty',
  reason: 'no-maintenance-work',
  revision: 'a'.repeat(64),
};
const active: DomBotMaintenanceState = {
  version: 1,
  state: 'work',
  reason: 'stored-work',
  revision: null,
};
beforeEach(() => {
  data = new Map();
  alarm = null;
  storage = {
    async get(key: string) {
      return structuredClone(data.get(key));
    },
    async put(key: string, value: unknown) {
      data.set(key, structuredClone(value));
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(at: number) {
      alarm = at;
    },
    async deleteAlarm() {
      alarm = null;
    },
    async transaction<T>(work: (tx: DurableObjectStorage) => Promise<T>) {
      return work(storage);
    },
  } as unknown as DurableObjectStorage;
  inspect = vi.fn(async () => empty);
  scheduler = new MaintenanceScheduler(storage, inspect);
});
it('stops existing empty alarms without executing scheduled work or recording a fake sync', async () => {
  alarm = Date.now() + 100;
  const run = vi.fn();
  await scheduler.run(() => scheduler.alarm(run));
  expect(run).not.toHaveBeenCalled();
  expect(alarm).toBeNull();
});
it('establishes crash recovery before a mutation commits, then starts required maintenance', async () => {
  await scheduler.run(() =>
    scheduler.mutate(async () => {
      expect(alarm).toBeGreaterThan(Date.now());
      expect((await scheduler.status()).dirty).toBe(true);
      inspect.mockResolvedValue(active);
    }),
  );
  expect((await scheduler.status()).inspection.state).toBe('work');
  expect(alarm).toBeGreaterThan(Date.now());
});
it('recovers a committed mutation after restart using its durable dirty marker', async () => {
  await scheduler.prepare();
  inspect.mockResolvedValue(active);
  scheduler = new MaintenanceScheduler(storage, inspect);
  const run = vi.fn(async () => {});
  await scheduler.run(() => scheduler.alarm(run));
  expect(run).toHaveBeenCalledOnce();
  expect(alarm).not.toBeNull();
  expect((await scheduler.status()).dirty).toBe(false);
});
it('reconciles partial failures and sleeps after removing the final work source', async () => {
  inspect.mockResolvedValue(active);
  await expect(
    scheduler.run(() =>
      scheduler.mutate(async () => {
        throw Error('committed then failed');
      }),
    ),
  ).rejects.toThrow();
  expect(alarm).not.toBeNull();
  await scheduler.run(() =>
    scheduler.mutate(async () => {
      inspect.mockResolvedValue(empty);
    }),
  );
  expect(alarm).toBeNull();
});
it('cannot let a late empty observation overwrite newer work', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  inspect.mockImplementationOnce(async () => {
    await blocked;
    return empty;
  });
  const stale = scheduler.reconcile();
  await scheduler.prepare();
  inspect.mockResolvedValue(active);
  release();
  await stale;
  expect(alarm).not.toBeNull();
  expect((await scheduler.status()).dirty).toBe(true);
});
it('retains a bounded recovery alarm when inspection or scheduled work fails', async () => {
  inspect.mockRejectedValue(Error('unavailable'));
  await scheduler.reconcile();
  expect(alarm).not.toBeNull();
  await expect(
    scheduler.run(() =>
      scheduler.alarm(async () => {
        throw Error('runtime');
      }),
    ),
  ).rejects.toThrow();
  expect(alarm).not.toBeNull();
});
it('preserves explicit operator pause through requests and late alarms; resume is explicit', async () => {
  inspect.mockResolvedValue(active);
  await scheduler.pause();
  await scheduler.run(() => scheduler.mutate(async () => {}));
  const run = vi.fn();
  await scheduler.run(() => scheduler.alarm(run));
  expect(run).not.toHaveBeenCalled();
  expect(alarm).toBeNull();
  await scheduler.resume(true);
  expect(alarm).not.toBeNull();
});
it('can explicitly rearm sleeping accounts when rolling back the policy', async () => {
  await scheduler.reconcile();
  expect(alarm).toBeNull();
  await scheduler.resume(false);
  expect(alarm).not.toBeNull();
});
it('does not activate on portfolio reads, discovery or assets; unknown writes remain conservative', async () => {
  for (const path of [
    '/',
    '/assets/app.js',
    '/.well-known/oauth-protected-resource',
    '/mcp',
  ])
    expect(await mayChangeMaintenance(new Request('https://test' + path))).toBe(
      false,
    );
  const api = (name: string, args: unknown[] = []) =>
    new Request('https://test/api/' + name, {
      method: 'POST',
      body: JSON.stringify({ args }),
    });
  expect(await mayChangeMaintenance(api('listPortfolio', [false]))).toBe(false);
  for (const name of [
    'getSettings',
    'getAppInfo',
    'getMcpInfo',
    'getRegistrarCatalog',
    'getPortfolioPricing',
    'listMcpClients',
  ])
    expect(await mayChangeMaintenance(api(name))).toBe(false);
  expect(await mayChangeMaintenance(api('hydrateFromCache'))).toBe(true);
  expect(await mayChangeMaintenance(api('saveRegistrarCredentials'))).toBe(
    true,
  );
  expect(await mayChangeMaintenance(api('futureOperation'))).toBe(true);
  expect(
    await mayChangeMaintenance(
      new Request('https://test/mcp', { method: 'POST', body: '{}' }),
    ),
  ).toBe(true);
});
