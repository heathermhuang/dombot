import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as esm from '@aoxborrow/registrar-client';
const cjs = createRequire(import.meta.url)('@aoxborrow/registrar-client');
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
for (const [format, sdk] of [
  ['ESM', esm],
  ['CJS', cjs],
])
  describe(`${format} registrar retry budgets`, () => {
    const client = (fetch, options = {}) =>
      new sdk.HttpClient({
        baseUrl: 'https://registrar.example',
        safeMethods: ['GET', 'HEAD'],
        options: {
          timeout: 30_000,
          retries: 2,
          backoff: 250,
          fetch,
          ...options,
        },
      });
    it.each([0, 0.999])(
      'spreads exponential retries for random=%s while keeping the attempt cap',
      async (random) => {
        vi.useFakeTimers({ now: 0 });
        vi.spyOn(Math, 'random').mockReturnValue(random);
        const times = [];
        const fetch = vi.fn(async () => {
          times.push(Date.now());
          return new Response('{}', { status: 503 });
        });
        const result = expect(
          client(fetch).request({ path: 'domains' }),
        ).rejects.toBeInstanceOf(sdk.RegistrarError);
        await vi.runAllTimersAsync();
        await result;
        expect(times).toEqual([
          0,
          Math.floor(125 + random * 125),
          Math.floor(125 + random * 125) + Math.floor(250 + random * 250),
        ]);
        expect(fetch).toHaveBeenCalledTimes(3);
      },
    );
    it('honors Retry-After without jitter or an early retry', async () => {
      vi.useFakeTimers({ now: 0 });
      const times = [];
      const fetch = vi.fn(async () => {
        times.push(Date.now());
        return times.length === 1
          ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
          : new Response('{"ok":true}');
      });
      const result = client(fetch).request({ path: 'domains' });
      await vi.runAllTimersAsync();
      expect(await result).toEqual({ ok: true });
      expect(times).toEqual([0, 2000]);
    });
    it('refuses a Retry-After that cannot fit without exceeding the deadline', async () => {
      vi.useFakeTimers({ now: 0 });
      const fetch = vi.fn(
        async () =>
          new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }),
      );
      await expect(
        client(fetch, { timeout: 1000 }).request({ path: 'domains' }),
      ).rejects.toBeInstanceOf(sdk.RateLimitError);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(Date.now()).toBe(0);
    });
    it('uses one timeout budget across slow attempts and their waits', async () => {
      vi.useFakeTimers({ now: 0 });
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const times = [];
      const fetch = vi.fn(
        (_url, { signal }) =>
          new Promise((resolve, reject) => {
            times.push(Date.now());
            const timer = setTimeout(
              () => resolve(new Response('{}', { status: 503 })),
              600,
            );
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('aborted', 'AbortError'));
              },
              { once: true },
            );
          }),
      );
      const result = expect(
        client(fetch, { timeout: 1000, backoff: 100 }).request({
          path: 'domains',
        }),
      ).rejects.toBeInstanceOf(sdk.TimeoutError);
      await vi.runAllTimersAsync();
      await result;
      expect(times).toEqual([0, 650]);
      expect(Date.now()).toBe(1000);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('never retries a write whose outcome is unknown', async () => {
      const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
      await expect(
        client(fetch).request({
          method: 'POST',
          path: 'renew',
          call: { intent: 'write', feature: 'renewDomain' },
        }),
      ).rejects.toBeInstanceOf(sdk.OutcomeUnknownError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
