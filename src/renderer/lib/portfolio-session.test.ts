import { describe, expect, it, vi, afterEach } from 'vitest';
import { PortfolioSession, type PublicationClient } from './portfolio-session';
import {
  emptyDraft,
  privateListing,
  type PublicationState,
} from '../../shared/publication';

function fixture(): PublicationState {
  const item = privateListing('owned.example');
  return {
    draft: { ...emptyDraft(), listings: [item] },
    revision: 'r0',
    published: null,
    publishedSnapshot: null,
    accounts: [],
    review: [
      {
        ...item,
        ownership: 'owned',
        accountLabels: ['test'],
        lastSyncedAt: Date.now(),
      },
    ],
  };
}
function client(): PublicationClient {
  return {
    load: vi.fn(async () => fixture()),
    save: vi.fn(async () => ({ revision: 'r1' })),
    publish: vi.fn(async () => ({ url: '/p/portfolio' })),
    unpublish: vi.fn(async () => ({})),
  };
}
afterEach(() => vi.useRealTimers());
describe('serialized portfolio autosave', () => {
  it('serializes edits made while an earlier save is in flight using the returned revision', async () => {
    const api = client();
    let release!: (value: { revision: string }) => void;
    api.save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ revision: 'r2' });
    const session = new PortfolioSession(api, 60_000);
    await session.load();
    session.update({ ...session.getSnapshot().draft!, title: 'First' });
    const saving = session.flush();
    session.update({ ...session.getSnapshot().draft!, title: 'Second' });
    release({ revision: 'r1' });
    await saving;
    expect(api.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'First' }),
      'r0',
    );
    expect(api.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: 'Second' }),
      'r1',
    );
    expect(session.getSnapshot().draft?.title).toBe('Second');
    expect(session.getSnapshot().status).toBe('saved');
  });
  it('does not discard edits or retry a conflicted revision automatically', async () => {
    vi.useFakeTimers();
    const api = client();
    api.save = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Changed in another tab'), { status: 409 }),
      );
    const session = new PortfolioSession(api);
    await session.load();
    session.update({ ...session.getSnapshot().draft!, title: 'My work' });
    await expect(session.flush()).rejects.toThrow('another tab');
    session.update({ ...session.getSnapshot().draft!, intro: 'More work' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().draft?.title).toBe('My work');
    expect(session.getSnapshot().draft?.intro).toBe('More work');
    expect(session.getSnapshot().status).toBe('error');
  });
  it('keeps autosave alive when the page unsubscribes during navigation', async () => {
    vi.useFakeTimers();
    const api = client();
    const session = new PortfolioSession(api);
    const leavePage = session.subscribe(() => {});
    await session.load();
    session.update({ ...session.getSnapshot().draft!, intro: 'Keep me' });
    leavePage();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ intro: 'Keep me' }),
      'r0',
    );
    expect(session.isDirty()).toBe(false);
  });
  it('refreshes ownership without accepting another tab revision over unsaved work', async () => {
    const api = client();
    const session = new PortfolioSession(api, 60_000);
    await session.load();
    session.update({ ...session.getSnapshot().draft!, intro: 'Private edit' });
    api.load = vi.fn(async () => ({
      ...fixture(),
      revision: 'foreign-revision',
    }));
    await session.refreshReview();
    expect(session.getSnapshot().state?.revision).toBe('r0');
    expect(session.getSnapshot().draft?.intro).toBe('Private edit');
    await session.flush();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ intro: 'Private edit' }),
      'r0',
    );
  });
  it('retries failed saves without dropping the unsaved draft', async () => {
    const api = client();
    api.save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ revision: 'r1' });
    const session = new PortfolioSession(api, 60_000);
    await session.load();
    session.update({ ...session.getSnapshot().draft!, title: 'Offline work' });
    await expect(session.flush()).rejects.toThrow('Offline');
    expect(session.isDirty()).toBe(true);
    await session.flush();
    expect(session.isDirty()).toBe(false);
  });
  it('merges new selections without dropping edits made during a slow inventory review', async () => {
    const api = client();
    const session = new PortfolioSession(api, 60_000);
    await session.load();
    let release!: (value: PublicationState) => void;
    api.load = vi.fn(
      () =>
        new Promise<PublicationState>((resolve) => {
          release = resolve;
        }),
    );
    const adding = session.add(['owned.example']);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    session.update({
      ...session.getSnapshot().draft!,
      title: 'Edited while waiting',
    });
    release(fixture());
    await adding;
    expect(session.getSnapshot().draft?.title).toBe('Edited while waiting');
    expect(session.getSnapshot().draft?.listings[0].visibility).toBe(
      'showcase',
    );
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Edited while waiting' }),
      'r0',
    );
  });
  it('returns to Saved when an invalid edit is restored to the last saved value', async () => {
    const api = client();
    const session = new PortfolioSession(api, 60_000);
    await session.load();
    const original = session.getSnapshot().draft!;
    session.update({ ...original, title: '' });
    await expect(session.flush()).rejects.toThrow('title');
    session.update(original);
    await session.flush();
    expect(session.getSnapshot().status).toBe('saved');
    expect(session.getSnapshot().error).toBe('');
    expect(api.save).not.toHaveBeenCalled();
  });
  it('does not overwrite edits made while publication is finishing', async () => {
    const api = client();
    let finish!: (value: { url: string }) => void;
    const pending = new Promise<{ url: string }>((resolve) => {
      finish = resolve;
    });
    api.publish = vi.fn(() => pending);
    const session = new PortfolioSession(api, 60_000);
    await session.load();
    const publishing = session.publish();
    await Promise.resolve();
    session.update({ ...session.getSnapshot().draft!, title: 'My next edit' });
    finish({ url: '/p/portfolio' });
    await publishing;
    expect(session.getSnapshot().draft?.title).toBe('My next edit');
    await session.flush();
  });
});
