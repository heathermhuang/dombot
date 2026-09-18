import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

describe('publishing availability', () => {
  it('keeps desktop and the in-memory demo away from hosted publication endpoints', async () => {
    const platform = await import('./platform');
    expect(platform.supportsPublishing()).toBe(false);
    platform.markDemo();
    expect(platform.isWeb()).toBe(true);
    expect(platform.supportsPublishing()).toBe(false);
  });

  it.each(['password', 'cloudflare-access', 'external', 'gateway'] as const)(
    'retains publishing on the %s web host',
    async (mode) => {
      const platform = await import('./platform');
      platform.markWeb(mode);
      expect(platform.supportsPublishing()).toBe(true);
    },
  );
});
