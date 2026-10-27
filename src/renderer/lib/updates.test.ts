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

it('does not check desktop/fork releases for the managed service', async () => {
  const { markWeb } = await import('./platform');
  markWeb('gateway');
  const { useUpdates } = await import('./updates');
  await useUpdates.getState().autoCheck();
  await useUpdates.getState().check(true);
  expect(getReleaseFeed).not.toHaveBeenCalled();
  expect(storage.has('dombot-fork-update-checked')).toBe(false);
});

it('suppresses cached desktop release notifications only on the managed service', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { useAppStore } = await import('../store/app');
  const { markWeb } = await import('./platform');
  const state = {
    appInfo: { version: '1.5.2' },
    settings: { updateChecks: true },
  } as ReturnType<typeof useAppStore.getState>;
  vi.mocked(useAppStore).mockImplementation((selector) => selector(state));
  storage.set(
    'dombot-fork-release-feed',
    JSON.stringify({
      releases: [
        {
          version: '99.0.0',
          tag: 'v99.0.0',
          name: 'Future desktop release',
          url: 'https://github.com/heathermhuang/dombot/releases/tag/v99.0.0',
          publishedAt: '',
        },
      ],
      checkedAt: new Date().toISOString(),
    }),
  );
  const { useAvailableUpdate } = await import('./updates');
  const Status = () =>
    createElement(
      'span',
      null,
      useAvailableUpdate() ? 'update available' : 'no desktop update',
    );
  markWeb('gateway');
  expect(renderToStaticMarkup(createElement(Status))).toContain(
    'no desktop update',
  );
  markWeb('password');
  expect(renderToStaticMarkup(createElement(Status))).toContain(
    'update available',
  );
});
