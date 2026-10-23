import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../store/app', () => ({ useAppStore: vi.fn() }));
const storage = new Map<string, string>();
const getReleaseFeed = vi.fn();
beforeEach(() => {
  vi.resetModules();
  storage.clear();
  getReleaseFeed.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { api: { getReleaseFeed } });
});
afterEach(() => vi.unstubAllGlobals());

it('does not reuse upstream cache, dismissals or check timestamps after channel migration', async () => {
  storage.set(
    'dombot-release-feed',
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      releases: [
        {
          tag: 'v99.0.0',
          url: 'https://github.com/aoxborrow/dombot/releases/tag/v99.0.0',
        },
      ],
    }),
  );
  storage.set('dombot-update-dismissed', '99.0.0');
  storage.set('dombot-update-checked', String(Date.now()));
  const forkFeed = {
    releases: [
      {
        version: '1.5.2',
        tag: 'v1.5.2',
        url: 'https://github.com/heathermhuang/dombot/releases/tag/v1.5.2',
        name: 'Security release',
        publishedAt: '',
      },
    ],
    checkedAt: new Date().toISOString(),
    error: null,
  };
  getReleaseFeed.mockResolvedValue(forkFeed);
  const { useUpdates } = await import('./updates');
  expect(useUpdates.getState().feed).toBeNull();
  expect(useUpdates.getState().dismissed).toBeNull();
  await useUpdates.getState().autoCheck();
  expect(getReleaseFeed).toHaveBeenCalledTimes(1);
  expect(useUpdates.getState().feed).toEqual(forkFeed);
  await useUpdates.getState().autoCheck();
  expect(getReleaseFeed).toHaveBeenCalledTimes(1);
  expect(storage.has('dombot-fork-release-feed')).toBe(true);
});
