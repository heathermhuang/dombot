import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistrar } from '@aoxborrow/registrar-client';
import { createDynadotFetch } from './dynadot-transport';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import {
  getRegistrarClient,
  resetRegistrarClients,
  saveRegistrarCredentials,
} from './registrars';
import {
  configureProxyTransport,
  createProxiedRegistrar,
} from './proxy-transport';

const creds = { apiKey: 'test-key', apiSecret: 'test-secret' };
const realTimer = globalThis.setTimeout;
const realSleep = (ms: number) =>
  new Promise<void>((resolve) => realTimer(resolve, ms));
// Web Crypto completes on the real event loop even while Date/timers are fake.
async function signed(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await realSleep(1);
  expect(condition()).toBe(true);
  await realSleep(5);
}
const listed = () =>
  Response.json({
    code: 200,
    data: { domain_info_list: [{ domain_name: 'example.com' }] },
  });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));
  configureStore(new MemoryDocStore());
  await hydrateStores();
  resetRegistrarClients();
});
afterEach(() => {
  configureProxyTransport();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Dynadot request pacing', () => {
  it('spaces concurrent calls on the real app client', async () => {
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return listed();
      }),
    );
    await saveRegistrarCredentials('dynadot', creds);
    const client = getRegistrarClient('dynadot');
    const calls = Promise.all([client.listDomains(), client.listDomains()]);
    await signed(() => starts.length > 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1099);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await calls).toHaveLength(2);
    expect(starts[1] - starts[0]).toBe(1100);
  });

  it.each(['direct', 'proxy'])(
    'recovers from a headerless HTTP 429 over %s',
    async (route) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('Too many requests', { status: 429 }),
        )
        .mockImplementation(async () => listed());
      let provider;
      if (route === 'proxy') {
        configureProxyTransport((_proxy, input, init) => send(input, init));
        provider = createProxiedRegistrar(
          'dynadot',
          creds,
          {
            url: 'http://8.8.8.8:8080/',
            ip: '8.8.4.4',
          },
          createDynadotFetch,
        );
      } else {
        vi.stubGlobal('fetch', send);
        await saveRegistrarCredentials('dynadot', creds);
        provider = getRegistrarClient('dynadot');
      }
      const result = provider.listDomains();
      await signed(() => send.mock.calls.length > 0);
      await vi.advanceTimersByTimeAsync(59999);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await result).map((d) => d.domainName)).toEqual(['example.com']);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    [null, '60'],
    ['', '60'],
    ['0', '60'],
    ['-1', '60'],
    ['garbage', '60'],
    ['120', '120'],
    ['1.5', '2'],
    ['Tue, 06 Oct 2026 00:02:00 GMT', '120'],
  ])('normalizes Retry-After %s to %s seconds', async (header, expected) => {
    const send = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: header === null ? {} : { 'Retry-After': header },
        }),
    );
    const fetch = createDynadotFetch(send);
    const response = await fetch('https://api.dynadot.com/restful/v2/domains');
    expect(response.headers.get('Retry-After')).toBe(expected);
    const queued = await fetch('https://api.dynadot.com/restful/v2/domains');
    expect(queued.status).toBe(429);
    expect(queued.headers.get('Retry-After')).toBe(expected);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('holds the lane until the response body is complete', async () => {
    let finish!: () => void;
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              finish = () => {
                controller.enqueue(new TextEncoder().encode('{}'));
                controller.close();
              };
            },
          }),
        ),
      )
      .mockImplementation(async () => listed());
    const fetch = createDynadotFetch(send);
    const first = fetch('https://api.dynadot.com/restful/v2/domains');
    const second = fetch('https://api.dynadot.com/restful/v2/domains');
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await second;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not send an aborted queued request and keeps the queue usable', async () => {
    const send = vi.fn(async () => listed());
    const fetch = createDynadotFetch(send);
    await fetch('https://api.dynadot.com/restful/v2/domains');
    const controller = new AbortController();
    const cancelled = fetch('https://api.dynadot.com/restful/v2/domains', {
      signal: controller.signal,
    });
    const rejection = expect(cancelled).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    const next = fetch('https://api.dynadot.com/restful/v2/domains');
    await vi.advanceTimersByTimeAsync(1100);
    await next;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('leaves unknown paid outcomes to the library without replaying them', async () => {
    const send = vi.fn(async () => new Response('failed', { status: 500 }));
    const provider = createRegistrar('dynadot', creds, {
      fetch: createDynadotFetch(send),
    });
    await expect(
      provider.setAutoRenew('example.com', true),
    ).resolves.toMatchObject({
      success: false,
      outcome: 'unknown',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
