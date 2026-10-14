import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft, type PublicationState } from '../../shared/publication';

const state: PublicationState = {
  draft: emptyDraft(),
  revision: null,
  published: null,
  publishedSnapshot: null,
  accounts: [],
  review: [],
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    location: { pathname: '/w/00000000-0000-0000-0000-000000000001/app' },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stalledRead(body = false) {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn(
    (
      _url: string,
      options: RequestInit,
    ): Promise<{
      ok: boolean;
      json: () => Promise<unknown>;
    }> => {
      signal = options.signal ?? undefined;
      const pending = new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
      return body
        ? Promise.resolve({ ok: true, json: () => pending })
        : pending;
    },
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch, signal: () => signal };
}

describe('publication reads', () => {
  it.each([false, true])(
    'leaves the skeleton and allows retry when the %s response stalls',
    async (body) => {
      const request = stalledRead(body);
      const { portfolioEditor } = await import('./publication-client');
      const loading = portfolioEditor.load().catch((error) => error);
      await vi.advanceTimersByTimeAsync(15_000);

      expect(portfolioEditor.getSnapshot()).toMatchObject({
        state: null,
        status: 'error',
        error: expect.stringContaining('timed out'),
        errorKind: 'request',
      });
      expect(request.signal()?.aborted).toBe(true);
      expect(await loading).toBeInstanceOf(Error);
      expect(request.fetch).toHaveBeenCalledTimes(1);

      request.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => state,
      });
      await portfolioEditor.load();
      expect(portfolioEditor.getSnapshot()).toMatchObject({
        state,
        status: 'saved',
        error: '',
      });
      expect(request.fetch).toHaveBeenLastCalledWith(
        '/w/00000000-0000-0000-0000-000000000001/publishing',
        expect.objectContaining({ credentials: 'same-origin', method: 'GET' }),
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('clears the deadline after a successful read', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => state }));
    vi.stubGlobal('fetch', fetch);
    const { portfolioEditor } = await import('./publication-client');
    await portfolioEditor.load();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(portfolioEditor.getSnapshot().status).toBe('saved');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves authentication errors without retrying', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Not signed in' }),
    }));
    vi.stubGlobal('fetch', fetch);
    const { portfolioEditor } = await import('./publication-client');
    await expect(portfolioEditor.load()).rejects.toMatchObject({ status: 401 });
    expect(portfolioEditor.getSnapshot().error).toBe('Not signed in');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not abort or repeat a slow draft write', async () => {
    let finish!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => state })
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );
    vi.stubGlobal('fetch', fetch);
    const { portfolioEditor } = await import('./publication-client');
    await portfolioEditor.load();
    portfolioEditor.update({ ...state.draft, title: 'My saved collection' });
    const saving = portfolioEditor.flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(portfolioEditor.getSnapshot().status).toBe('saving');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]).not.toHaveProperty('signal');
    finish({ ok: true, json: async () => ({ revision: 'r1' }) });
    await saving;
    expect(portfolioEditor.getSnapshot().status).toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
  });
});
