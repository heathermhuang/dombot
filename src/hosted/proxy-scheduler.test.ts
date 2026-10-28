import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';

let mf: Miniflare;
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/hosted/proxy-scheduler.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    external: ['cloudflare:*'],
    target: 'es2022',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: bundle.outputFiles[0].text,
      // Match the repository's pinned local runtime. Production uses today's
      // date; this test needs only the established SQLite DO transaction API.
      compatibilityDate: '2026-10-01',
      bindings: { SHARED_PROXY_IP: '194.153.254.242' },
      durableObjects: {
        SHARED_PROXY_QUEUE: { className: 'SharedProxyQueue', useSQLite: true },
      },
    }),
  );
});
afterAll(async () => {
  await mf?.dispose();
});

describe('durable cross-tenant proxy gate', () => {
  it('admits exactly one of simultaneous independent tenant requests and fences release', async () => {
    const commands = Array.from({ length: 8 }, () => ({
      action: 'acquire',
      tenant: crypto.randomUUID(),
      id: crypto.randomUUID(),
    }));
    const send = async (value: object) =>
      (
        await mf.dispatchFetch('https://queue.test/lease', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        })
      ).json() as Promise<Record<string, unknown>>;
    const replies = await Promise.all(commands.map(send));
    const granted = replies.findIndex((r) => r.status === 'granted');
    expect(replies.filter((r) => r.status === 'granted')).toHaveLength(1);
    expect(replies.filter((r) => r.status === 'waiting')).toHaveLength(7);
    expect(
      await send({
        ...commands[granted],
        action: 'release',
        token: crypto.randomUUID(),
      }),
    ).toEqual({ status: 'stale' });
    expect(await send(commands[granted])).toEqual(replies[granted]);
    expect(
      await send({
        ...commands[granted],
        action: 'release',
        token: replies[granted].token,
      }),
    ).toEqual({ status: 'released' });
    expect(await send(commands[(granted + 1) % commands.length])).toMatchObject(
      { status: 'waiting' },
    );
  });
  it('retains provider tags and upstream cooldown through the real service boundary', async () => {
    const bundle = await build({
      entryPoints: ['src/hosted/proxy-scheduler.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:*'],
      target: 'es2022',
    });
    const relay = new Miniflare(
      convertV4MiniflareOptions({
        cf: false,
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: '2026-10-01',
        bindings: {
          SHARED_PROXY_IP: '152.42.223.194',
          SHARED_PROXY_MODE: 'relay',
          SHARED_PROXY_CONCURRENCY: '4',
        },
        durableObjects: {
          SHARED_PROXY_QUEUE: {
            className: 'SharedProxyQueue',
            useSQLite: true,
          },
        },
      }),
    );
    try {
      const send = async (value: object) =>
        (
          await relay.dispatchFetch('https://queue.test/lease', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
          })
        ).json() as Promise<Record<string, unknown>>;
      const a = {
        action: 'acquire',
        id: crypto.randomUUID(),
        tenant: crypto.randomUUID(),
        route: 'relay',
        provider: 'dynadot',
      };
      const b = { ...a, id: crypto.randomUUID(), tenant: crypto.randomUUID() };
      const first = await send(a);
      expect(first.status).toBe('granted');
      expect((await send(b)).status).toBe('waiting');
      expect(
        (
          await send({
            action: 'acquire',
            id: crypto.randomUUID(),
            tenant: crypto.randomUUID(),
            route: 'relay',
          })
        ).status,
      ).toBe('granted');
      await send({
        ...a,
        action: 'release',
        token: first.token,
        retryAfterMs: 180000,
      });
      const deferred = await send(b);
      expect(deferred.status).toBe('deferred');
      expect(deferred.retryAfterMs).toBeGreaterThan(170000);
    } finally {
      await relay.dispose();
    }
  });

  it('isolates the approved alternate serial lane from the failing primary egress', async () => {
    const bundle = await build({
      entryPoints: ['src/hosted/proxy-scheduler.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:*'],
      target: 'es2022',
    });
    const relay = new Miniflare(
      convertV4MiniflareOptions({
        cf: false,
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: '2026-10-01',
        bindings: {
          SHARED_PROXY_IP: '152.42.223.194',
          SHARED_PROXY_MODE: 'relay',
          SHARED_PROXY_CONCURRENCY: '4',
        },
        durableObjects: {
          SHARED_PROXY_QUEUE: {
            className: 'SharedProxyQueue',
            useSQLite: true,
          },
        },
      }),
    );
    try {
      const send = async (body: object, path = '/lease') =>
        (
          await relay.dispatchFetch('https://queue.test' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).json() as Promise<Record<string, unknown>>;
      const primary = {
        action: 'acquire',
        id: crypto.randomUUID(),
        tenant: crypto.randomUUID(),
        route: 'relay',
        provider: 'dynadot',
      };
      const first = await send(primary);
      expect(first.status).toBe('granted');
      await send({
        ...primary,
        action: 'release',
        token: first.token,
        retryAfterMs: 180000,
      });
      const alternate = {
        ...primary,
        id: crypto.randomUUID(),
        route: 'alternate',
      };
      const granted = await send(alternate);
      expect(granted.status).toBe('granted');
      const next = {
        ...alternate,
        id: crypto.randomUUID(),
        tenant: crypto.randomUUID(),
      };
      expect((await send(next)).status).toBe('waiting');
      expect(await send({}, '/alternate-status')).toMatchObject({
        mode: 'serial',
        concurrency: 1,
        active: 1,
        queued: 1,
      });
      expect((await send({ ...primary, id: crypto.randomUUID() })).status).toBe(
        'deferred',
      );
      await send({ ...alternate, action: 'release', token: granted.token });
      expect((await send(next)).status).toBe('waiting');
      expect(
        (
          await send({
            action: 'acquire',
            id: crypto.randomUUID(),
            tenant: crypto.randomUUID(),
            route: 'relay',
          })
        ).status,
      ).toBe('granted');
    } finally {
      await relay.dispose();
    }
  });

  it('rejects invalid, oversized and non-queue requests before touching the gate', async () => {
    expect((await mf.dispatchFetch('https://queue.test/lease')).status).toBe(
      404,
    );
    for (const body of [
      '{',
      JSON.stringify({ action: 'acquire', tenant: 'invalid', id: 'invalid' }),
      ' '.repeat(1100),
    ]) {
      expect(
        (
          await mf.dispatchFetch('https://queue.test/lease', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
        ).status,
      ).toBe(400);
    }
  });
});
