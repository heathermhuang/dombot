import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  existsSync: vi.fn(() => true),
  app: {
    isPackaged: true,
    getVersion: () => '1.5.2',
    isInApplicationsFolder: () => true,
  },
}));
vi.mock('electron', () => ({
  app: mocks.app,
  autoUpdater: {
    setFeedURL: mocks.setFeedURL,
    checkForUpdates: mocks.checkForUpdates,
    quitAndInstall: mocks.quitAndInstall,
    on: (name: string, handler: (...args: unknown[]) => void) =>
      mocks.handlers.set(name, handler),
  },
}));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const arch = Object.getOwnPropertyDescriptor(process, 'arch')!;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.existsSync.mockReturnValue(true);
  mocks.app.isPackaged = true;
  vi.stubGlobal('__DOMBOT_MACOS_UPDATE_SIGNED__', true);
  vi.stubEnv('DOMBOT_UPDATE_FEED_URL', '');
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  Object.defineProperty(process, 'arch', arch);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fork updater', () => {
  it('downloads from this fork, shares an in-flight download, then installs only when ready', async () => {
    const u = await import('./updater');
    expect(() => u.installUpdate()).toThrow('No update');
    const first = u.downloadUpdate(),
      second = u.downloadUpdate();
    expect(mocks.setFeedURL).toHaveBeenCalledWith({
      url: 'https://update.electronjs.org/heathermhuang/dombot/darwin-arm64/1.5.2',
    });
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1);
    mocks.handlers.get('update-downloaded')!();
    expect((await first).status).toBe('ready');
    expect((await second).status).toBe('ready');
    u.installUpdate();
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it('offers manual Mac downloads when the build has no Developer ID signing', async () => {
    vi.stubGlobal('__DOMBOT_MACOS_UPDATE_SIGNED__', false);
    const u = await import('./updater');
    expect(u.getUpdaterState().supported).toBe(false);
    expect(u.getUpdaterState().unsupportedReason).toContain('Developer ID');
    await u.downloadUpdate();
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
  });
  it('uses the fork Squirrel Windows channel for installed copies', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    const u = await import('./updater');
    const done = u.downloadUpdate();
    expect(mocks.setFeedURL).toHaveBeenCalledWith({
      url: 'https://update.electronjs.org/heathermhuang/dombot/win32-x64/1.5.2',
    });
    mocks.handlers.get('update-not-available')!();
    expect((await done).status).toBe('error');
  });
  it('settles synchronous download failures so the UI can retry', async () => {
    mocks.checkForUpdates.mockImplementationOnce(() => {
      throw new Error('feed unavailable');
    });
    const u = await import('./updater');
    expect((await u.downloadUpdate()).error).toBe('feed unavailable');
    const retry = u.downloadUpdate();
    mocks.handlers.get('update-downloaded')!();
    expect((await retry).status).toBe('ready');
  });
});
