import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { salesRequest } from './sales-client';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { location: { pathname: '/app' } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sales request recovery', () => {
  it('explains a read timeout and clears its timer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Fetch is aborted', 'AbortError')),
            );
          }),
      ),
    );
    const result = expect(salesRequest('/activity')).rejects.toThrow(
      'Sales records took too long to load. Please try again.',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves server errors and reauthentication metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Confirm your identity before continuing.',
              code: 'fresh_auth_required',
              reauth: '/account/reauth',
            }),
            { status: 403 },
          ),
      ),
    );
    await expect(salesRequest('/activity')).rejects.toMatchObject({
      message: 'Confirm your identity before continuing.',
      status: 403,
      code: 'fresh_auth_required',
      reauth: '/account/reauth',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a successful empty response without leaving a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"items":[]}')),
    );
    await expect(salesRequest('/activity')).resolves.toEqual({ items: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
});
