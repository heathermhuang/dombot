import { PROOF_HEADER } from '../shared/gateway-proof';
import { expect, it, vi } from 'vitest';
import { readWorkspace, ObservationFailure } from './workspace-observation';
const id = '11111111-1111-4111-8111-111111111111';
const setup = (fetch: unknown) =>
  ({
    WORKSPACES: JSON.stringify([{ id, binding: 'WORKSPACE_0', label: 'Test' }]),
    GATEWAY_KEYS: JSON.stringify({ [id]: 'synthetic-observer-key-'.repeat(3) }),
    WORKSPACE_0: { fetch },
  }) as unknown as HostedEnv;
it('recovers a transient read and reports the failed attempt without exposing provider text', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('secret upstream detail', {
        status: 503,
        headers: {
          'X-DomBot-Monitor-Path': 'direct-d1',
          'X-DomBot-Monitor-Failure': 'storage',
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json(
        { ok: true },
        {
          headers: {
            'X-DomBot-Monitor-Path': 'direct-d1',
            'X-DomBot-Monitor-Read-Ms': '12',
          },
        },
      ),
    );
  const value = await readWorkspace(
    setup(fetch),
    id,
    'sync-monitor',
    (value) => value,
    { backoffMs: 0 },
  );
  expect(value).toMatchObject({
    value: { ok: true },
    probe: {
      attempts: 2,
      backend: 'direct-d1',
      readMs: 12,
      failure: {
        code: 'observation_http_error',
        httpStatus: 503,
        backendFailure: 'storage',
      },
    },
  });
  expect(JSON.stringify(value)).not.toContain('secret upstream');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0].headers.get(PROOF_HEADER)).toBeTruthy();
  expect(fetch.mock.calls[0][0]).not.toBe(fetch.mock.calls[1][0]);
});
it('cancels a timed-out read, retries only once and keeps its failure after recovery', async () => {
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      (request: Request) =>
        new Promise((_, reject) =>
          request.signal.addEventListener('abort', () =>
            reject(Error('cancelled')),
          ),
        ),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const result = await readWorkspace(
    setup(fetch),
    id,
    'sync-monitor',
    (value) => value,
    { timeoutMs: 150, backoffMs: 0 },
  );
  expect(result.probe).toMatchObject({
    attempts: 2,
    failure: { code: 'observation_timeout', phase: 'transport' },
  });
  expect(fetch.mock.calls[0][0].signal.aborted).toBe(true);
});
it('does not retry authentication or malformed data, or disregard a long retry-after', async () => {
  for (const response of [
    new Response('private key', { status: 403 }),
    new Response('unparseable', { status: 200 }),
    new Response('limit', { status: 429, headers: { 'Retry-After': '60' } }),
  ]) {
    const fetch = vi.fn().mockResolvedValue(response);
    await expect(
      readWorkspace(
        setup(fetch),
        id,
        'sync-monitor',
        () => {
          throw Error('invalid data');
        },
        { backoffMs: 0 },
      ),
    ).rejects.toBeInstanceOf(ObservationFailure);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it('bounds permanent failure at two attempts and retains its safe backend classification', async () => {
  const fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response('secret', {
        status: 503,
        headers: {
          'X-DomBot-Monitor-Path': 'direct-d1',
          'X-DomBot-Monitor-Failure': 'decryption',
        },
      }),
    ),
  );
  try {
    await readWorkspace(setup(fetch), id, 'sync-monitor', (value) => value, {
      backoffMs: 0,
    });
    throw Error('Expected observation failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ObservationFailure);
    expect((error as ObservationFailure).probe).toMatchObject({
      attempts: 2,
      backend: 'direct-d1',
      failure: { backendFailure: 'decryption', httpStatus: 503 },
    });
    expect(JSON.stringify(error)).not.toContain('secret');
  }
  expect(fetch).toHaveBeenCalledTimes(2);
});
