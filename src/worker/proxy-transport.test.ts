import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from 'tunnelfetch';
import { MAX_PROXY_RESPONSE_BYTES } from '../core/services/proxy-transport';

const mock = vi.hoisted(() => ({
  options: [] as ClientOptions[],
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  close: vi.fn<() => Promise<void>>(),
  connect: vi.fn(),
}));
vi.mock('cloudflare:sockets', () => ({ connect: mock.connect }));
vi.mock('tunnelfetch', () => ({
  Client: class {
    constructor(options: ClientOptions) {
      mock.options.push(options);
    }
    fetch = mock.fetch;
    close = mock.close;
  },
}));
import {
  createWorkerProxyFetch,
  workerProxyFetch,
  workerProxyPolicy,
} from './proxy-transport';
const proxy = { url: 'https://test:secret@8.8.8.8:12323/', ip: '8.8.8.8' };

beforeEach(() => {
  mock.options.length = 0;
  mock.fetch.mockReset();
  mock.close.mockReset().mockResolvedValue();
});

describe('Worker proxy transport lifecycle', () => {
  it('keeps a managed direct-egress relay inside the shared queue', async () => {
    const managed = {
      url: 'https://relay:direct-token@relay.example.test',
      ip: '152.42.223.194',
    };
    const calls: string[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body));
        calls.push(command.action);
        expect(command.route).toBe('relay');
        return Response.json(
          command.action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    mock.fetch.mockResolvedValue(new Response('direct'));
    const settings = {
      ip: managed.ip,
      managedUrl: managed.url,
      relayUrl: managed.url,
      tenant: crypto.randomUUID(),
      service,
    };
    await createWorkerProxyFetch(settings)(
      managed,
      'https://api.namecheap.com/xml.response',
      {},
    );
    expect(calls).toEqual(['acquire', 'release']);
    expect(mock.options[0].proxy).toBe(managed.url);
    expect(workerProxyPolicy(settings)(managed)).toEqual({
      timeout: 155000,
      retries: 0,
    });
  });
  it('does not substitute managed relay credentials for a supplied custom proxy password', async () => {
    const custom = {
      ...proxy,
      url: 'https://other:custom-password@8.8.8.8:12323/',
    };
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.route).toBe('serial');
        return Response.json(
          body.action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    mock.fetch.mockResolvedValue(new Response('custom'));
    await createWorkerProxyFetch({
      ip: proxy.ip,
      tenant: crypto.randomUUID(),
      service,
      relayUrl: 'https://relay:token@relay.example.test',
      managedUrl: proxy.url,
    })(custom, 'https://api.namecheap.com/xml.response', {});
    expect(mock.options[0].proxy).toBe(custom.url);
  });
  it('uses the host-only HTTPS relay while preserving the original outgoing-IP route', async () => {
    const relayUrl = 'https://relay:relay-token@relay.example.test:443';
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.route).toBe('relay');
        return Response.json(
          body.action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    mock.fetch.mockResolvedValue(new Response('done'));
    const original = { ...proxy };
    await createWorkerProxyFetch({
      ip: proxy.ip,
      tenant: crypto.randomUUID(),
      service,
      relayUrl,
      managedUrl: proxy.url,
    })(proxy, 'https://api.namecheap.com/xml.response', {});
    expect(mock.options[0].proxy).toBe(relayUrl);
    expect(mock.options[0].trust).toEqual({ mode: 'system' });
    expect(proxy).toEqual(original);
  });
  it('holds the global lease until the body and socket cleanup finish', async () => {
    const events: string[] = [];
    mock.fetch.mockImplementation(async () => {
      events.push('network');
      return new Response('done');
    });
    mock.close.mockImplementation(async () => {
      events.push('closed');
    });
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const action = JSON.parse(String(init?.body)).action;
        events.push(action);
        return Response.json(
          action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    const settings = { ip: proxy.ip, tenant: crypto.randomUUID(), service };
    const response = await createWorkerProxyFetch(settings)(
      proxy,
      'https://api.namecheap.com/xml.response',
      {},
    );
    expect(await response.text()).toBe('done');
    expect(events).toEqual(['acquire', 'network', 'closed', 'release']);
    expect(mock.options[0].timeouts?.totalMs).toBe(30000);
    expect(workerProxyPolicy(settings)(proxy)).toEqual({
      timeout: 155000,
      retries: 0,
    });
    expect(workerProxyPolicy({})(proxy)).toEqual({});
  });
  it('never connects without a configured gate and releases after a network failure', async () => {
    await expect(
      createWorkerProxyFetch({ ip: proxy.ip })(
        proxy,
        'https://api.namecheap.com/xml.response',
        {},
      ),
    ).rejects.toMatchObject({ code: 'PROXY_QUEUE_UNAVAILABLE' });
    expect(mock.fetch).not.toHaveBeenCalled();
    const calls: string[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const action = JSON.parse(String(init?.body)).action;
        calls.push(action);
        return Response.json(
          action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    mock.fetch.mockRejectedValue(new Error('network failure'));
    await expect(
      createWorkerProxyFetch({
        ip: proxy.ip,
        tenant: crypto.randomUUID(),
        service,
      })(proxy, 'https://api.namecheap.com/xml.response', {}),
    ).rejects.toThrow('network failure');
    expect(calls).toEqual(['acquire', 'release']);
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it('verifies certificates, bounds decoded bodies, disables redirects and isolates each request', async () => {
    mock.fetch.mockImplementation(
      async () =>
        new Response('decoded', {
          headers: { 'content-encoding': 'gzip', 'content-length': '100' },
        }),
    );
    const signal = new AbortController().signal;
    for (let i = 0; i < 2; i++) {
      const response = await workerProxyFetch(
        proxy,
        'https://api.namecheap.com/xml.response',
        { signal },
      );
      expect(await response.text()).toBe('decoded');
      expect(response.headers.has('content-encoding')).toBe(false);
      expect(response.headers.has('content-length')).toBe(false);
    }
    expect(mock.options).toHaveLength(2);
    expect(mock.options[0]).toMatchObject({
      proxy: proxy.url,
      trust: { mode: 'system' },
      maxBodyBytes: MAX_PROXY_RESPONSE_BYTES,
    });
    expect(mock.fetch).toHaveBeenCalledWith(
      'https://api.namecheap.com/xml.response',
      expect.objectContaining({ redirect: 'manual', signal }),
    );
    expect(mock.close).toHaveBeenCalledTimes(2);
  });
  it('closes the client after handshake or body failures', async () => {
    mock.fetch.mockRejectedValueOnce(new Error('certificate failure'));
    await expect(
      workerProxyFetch(proxy, 'https://api.namecheap.com/xml.response', {}),
    ).rejects.toThrow('certificate failure');
    mock.fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('body interrupted'));
          },
        }),
      ),
    );
    await expect(
      workerProxyFetch(proxy, 'https://api.namecheap.com/xml.response', {}),
    ).rejects.toThrow('body interrupted');
    expect(mock.close).toHaveBeenCalledTimes(2);
  });
  it('does not follow a redirect response', async () => {
    mock.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example' },
      }),
    );
    const result = await workerProxyFetch(
      proxy,
      'https://api.namecheap.com/xml.response',
      {},
    );
    expect(result.status).toBe(302);
    expect(mock.fetch).toHaveBeenCalledOnce();
  });
});

describe('Dynadot upstream feedback', () => {
  it('reports Retry-After under the fenced lease without API credentials or URLs', async () => {
    const commands: Record<string, unknown>[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const c = JSON.parse(String(init?.body));
        commands.push(c);
        return Response.json(
          c.action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    mock.fetch.mockResolvedValue(
      new Response('limited', {
        status: 429,
        headers: { 'Retry-After': '180' },
      }),
    );
    const response = await createWorkerProxyFetch({
      ip: proxy.ip,
      tenant: crypto.randomUUID(),
      service,
    })(proxy, 'https://api.dynadot.com/restful/v2/domains', {});
    expect(response.status).toBe(429);
    expect(commands[0].provider).toBe('dynadot');
    expect(commands[1]).toMatchObject({
      action: 'release',
      retryAfterMs: 180000,
    });
    expect(JSON.stringify(commands)).not.toMatch(
      /secret|dynadot.com|domains|apiKey/,
    );
  });
  it('returns a distinguishable cooldown without opening a socket', async () => {
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        Response.json(
          JSON.parse(String(init?.body)).action === 'acquire'
            ? { status: 'deferred', retryAfterMs: 180000 }
            : { status: 'cancelled' },
        ),
      ),
    };
    const response = await createWorkerProxyFetch({
      ip: proxy.ip,
      tenant: crypto.randomUUID(),
      service,
    })(proxy, 'https://api.dynadot.com/restful/v2/domains', {});
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('180');
    expect(await response.text()).toBe('[dynadot:shared-cooldown]');
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});

it('uses the approved alternate queue without substituting managed relay credentials', async () => {
  const alternate = {
    url: 'http://customer:alternate-secret@194.153.254.242:12323/',
    ip: '8.8.4.4',
  };
  const calls: Record<string, unknown>[] = [];
  const service = {
    fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const c = JSON.parse(String(init?.body));
      calls.push(c);
      return Response.json(
        c.action === 'acquire'
          ? {
              status: 'granted',
              token: crypto.randomUUID(),
              expiresAt: Date.now() + 60000,
            }
          : { status: 'released' },
      );
    }),
  };
  mock.fetch.mockResolvedValue(new Response('{}'));
  await createWorkerProxyFetch({
    ip: '152.42.223.194',
    tenant: crypto.randomUUID(),
    service,
    managedUrl: 'https://relay:managed-secret@relay.example.test',
    relayUrl: 'https://relay:managed-secret@relay.example.test',
    alternateHost: '194.153.254.242:12323',
    alternateIp: '8.8.4.4',
  })(alternate, 'https://api.dynadot.com/restful/v2/domains', {});
  expect(calls[0]).toMatchObject({ route: 'alternate', provider: 'dynadot' });
  expect(calls[1].route).toBe('alternate');
  expect(mock.options[0].proxy).toBe(alternate.url);
  expect(JSON.stringify(calls)).not.toMatch(/customer|secret|dynadot.com/);
});
