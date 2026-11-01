import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  it('persists a restriction across runtime restart and keeps legacy aliases blocked without token disclosure', async () => {
    const bundle = await build({
      entryPoints: ['src/hosted/proxy-scheduler.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:*'],
      target: 'es2022',
    });
    const storage = await mkdtemp(join(tmpdir(), 'dombot-circuit-test-'));
    const options = convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      resourcePersistencePath: storage,
      bindings: {
        SHARED_PROXY_IP: 'fixture',
        SHARED_PROXY_MODE: 'relay',
        SHARED_PROXY_CONCURRENCY: '4',
      },
      durableObjects: {
        SHARED_PROXY_QUEUE: { className: 'SharedProxyQueue', useSQLite: true },
      },
    });
    let runtime = new Miniflare(options);
    const send = async (value: object, path = '/lease') =>
      (
        await runtime.dispatchFetch('https://queue.test' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        })
      ).json() as Promise<Record<string, unknown>>;
    try {
      const first = {
        action: 'acquire',
        id: crypto.randomUUID(),
        tenant: crypto.randomUUID(),
        provider: 'dynadot',
        purpose: 'inventory',
        scope: 'managed',
        route: 'relay',
      };
      const grant = await send(first);
      const released = await send({
        ...first,
        action: 'release',
        token: grant.token,
        outcome: 'failed_request_ip',
        retryAfterMs: 7200000,
      });
      expect(released).toMatchObject({
        status: 'released',
        circuit: { state: 'open', scope: 'global', probes: 0 },
      });
      const circuit = released.circuit;
      await runtime.dispose();
      runtime = new Miniflare(options);
      const replies = await Promise.all(
        ['relay', 'alternate', 'serial'].map((route) =>
          send({
            action: 'acquire',
            id: crypto.randomUUID(),
            tenant: crypto.randomUUID(),
            route,
            provider: 'dynadot',
          }),
        ),
      );
      expect(replies.every((r) => r.status === 'deferred')).toBe(true);
      expect(
        replies.every(
          (r) => JSON.stringify(r.circuit) === JSON.stringify(circuit),
        ),
      ).toBe(true);
      expect(Number(replies[0].retryAfterMs)).toBeGreaterThan(7100000);
      const status = await send({}, '/status');
      expect(status).toMatchObject({
        active: 0,
        queued: 0,
        dynadotCircuit: circuit,
        dynadotRecoveryScope: 'managed',
      });
      expect(JSON.stringify(status)).not.toContain(String(grant.token));
      const invalid = await runtime.dispatchFetch('https://queue.test/lease', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...first,
          purpose: 'caller-selected',
          scope: 'arbitrary-secret',
        }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await runtime.dispose();
      await rm(storage, { recursive: true });
    }
  });
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

  it('admits one of eight Dynadot users across managed, alternate and custom routes', async () => {
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
      const send = async (body: object, path = '/lease') => {
        const response = await relay.dispatchFetch(
          'https://queue.test' + path,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        return response.ok
          ? (response.json() as Promise<Record<string, unknown>>)
          : { status: 'http-' + response.status };
      };
      const commands = Array.from({ length: 8 }, (_, i) => ({
        action: 'acquire',
        id: crypto.randomUUID(),
        tenant: crypto.randomUUID(),
        route: ['relay', 'alternate', 'serial'][i % 3],
        provider: 'dynadot',
      }));
      const replies = await Promise.all(
        commands.map((command) => send(command)),
      );
      expect(
        replies.filter((reply) => reply.status === 'granted'),
      ).toHaveLength(1);
      expect(
        replies.filter((reply) => reply.status === 'waiting'),
      ).toHaveLength(7);
      expect(await send({}, '/status')).toMatchObject({ active: 1, queued: 7 });
      const index = replies.findIndex((reply) => reply.status === 'granted');
      await send({
        ...commands[index],
        action: 'release',
        token: replies[index].token,
        retryAfterMs: 180000,
      });
      const deferred = await Promise.all(
        commands.filter((_, i) => i !== index).map((command) => send(command)),
      );
      expect(
        deferred.every(
          (reply) =>
            reply.status === 'deferred' && Number(reply.retryAfterMs) > 170000,
        ),
      ).toBe(true);
      expect(await send({}, '/status')).toMatchObject({ active: 0, queued: 0 });
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

  it('defers new Dynadot work during rollout while allowing fenced legacy releases', async () => {
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
          DYNADOT_ADMISSION_RESUME_AT: String(Date.now() + 180000),
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
      const legacy = {
        action: 'acquire',
        id: crypto.randomUUID(),
        tenant: crypto.randomUUID(),
        route: 'alternate',
      };
      const granted = await send(legacy);
      expect(granted.status).toBe('granted');
      for (const route of ['relay', 'alternate', 'serial']) {
        expect(
          (
            await send({
              action: 'acquire',
              id: crypto.randomUUID(),
              tenant: crypto.randomUUID(),
              provider: 'dynadot',
              route,
            })
          ).status,
        ).toBe('deferred');
      }
      expect(
        (
          await send({
            ...legacy,
            provider: 'dynadot',
            action: 'release',
            token: crypto.randomUUID(),
          })
        ).status,
      ).toBe('stale');
      expect(await send({}, '/alternate-status')).toMatchObject({ active: 1 });
      expect(
        (
          await send({
            ...legacy,
            provider: 'dynadot',
            action: 'release',
            token: granted.token,
          })
        ).status,
      ).toBe('released');
      expect(await send({}, '/alternate-status')).toMatchObject({
        active: 0,
        queued: 0,
      });
      expect(await send({}, '/status')).toMatchObject({
        dynadotActive: 0,
        dynadotQueued: 0,
      });
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
