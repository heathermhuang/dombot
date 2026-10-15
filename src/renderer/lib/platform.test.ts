import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('MCP deployment guidance', () => {
  it.each([
    ['gateway', false],
    ['password', false],
    ['cloudflare-access', true],
    ['external', true],
  ] as const)(
    'shows external-gate instructions for %s: %s',
    async (mode, expected) => {
      vi.stubGlobal('window', { location: { hostname: 'hosted.example' } });
      const platform = await import('./platform');
      platform.markWeb(mode);
      expect(platform.hasExternalMcpGate()).toBe(expected);
    },
  );
  it('keeps local development free of external-gate instructions', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    const platform = await import('./platform');
    platform.markWeb('external');
    expect(platform.hasExternalMcpGate()).toBe(false);
  });
});

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
