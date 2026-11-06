import { describe, it, expect } from 'vitest';
import { callPilotFunction } from './parkio-pilot-cdp';

describe('Park.io browser function arguments', () => {
  it('passes untrusted data separately from executable browser code', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = [];
    const command = async <T>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ method, params });
      return (
        method === 'Runtime.evaluate'
          ? { result: { objectId: 'global' } }
          : method === 'Runtime.callFunctionOn'
            ? { result: { value: { ok: true } } }
            : {}
      ) as T;
    };
    const data = 'untrusted " ; throw Error("do not execute")';
    const source = 'async function(value) { return {ok: !!value}; }';
    expect(await callPilotFunction(command, source, [data])).toEqual({
      ok: true,
    });
    const call = calls.find((c) => c.method === 'Runtime.callFunctionOn')!;
    expect(call.params?.functionDeclaration).toBe(source);
    expect(call.params?.arguments).toEqual([{ value: data }]);
    expect(calls.at(-1)?.method).toBe('Runtime.releaseObject');
  });
  it('releases the remote object and sanitizes an exception', async () => {
    const methods: string[] = [];
    const command = async <T>(method: string): Promise<T> => {
      methods.push(method);
      return (
        method === 'Runtime.evaluate'
          ? { result: { objectId: 'global' } }
          : method === 'Runtime.callFunctionOn'
            ? {
                result: {},
                exceptionDetails: { text: 'private upstream detail' },
              }
            : {}
      ) as T;
    };
    await expect(
      callPilotFunction(command, 'function() {}', []),
    ).rejects.toThrow('browser_read_failed');
    expect(methods.at(-1)).toBe('Runtime.releaseObject');
  });
});
