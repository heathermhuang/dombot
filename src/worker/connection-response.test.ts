import { afterEach, expect, it, vi } from 'vitest';
import { connectionResponse } from './connection-response';
import { createHttpApi } from '../renderer/api/http';
import {
  CONNECTION_RESULT_HEADER,
  CONNECTION_RESULT_CONTRACT,
} from '../shared/connection-contract';
import type { RegistrarAccount } from '../shared/ipc';
const account: RegistrarAccount = {
  id: 'stable-account',
  registrar: 'dynadot',
  label: 'Existing label',
};
afterEach(() => vi.unstubAllGlobals());

it('preserves the bare account response consumed by existing open tabs', async () => {
  for (const header of [undefined, 'unknown']) {
    const response = connectionResponse({ success: true, account }, header);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ result: account });
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});
it('rejects legacy connection failures and preserves existing activation classification', async () => {
  const response = connectionResponse({
    success: false,
    status: 401,
    message: 'Key rejected',
  });
  expect(response.status).toBe(500);
  expect((await response.json()).error).toMatch(
    /\b401\b[\s\S]*\bUnauthorized\b/i,
  );
});
it.each([true, false])(
  'round trips a structured connection success=%s through the actual HTTP client',
  async (success) => {
    vi.stubGlobal('document', { addEventListener: vi.fn() });
    vi.stubGlobal('window', {
      location: { pathname: '/w/11111111-1111-4111-8111-111111111111/' },
    });
    const result = success
      ? { success: true as const, account }
      : { success: false as const, status: 401, message: 'Key rejected' };
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      void _url;
      const contract = new Headers(init.headers).get(CONNECTION_RESULT_HEADER);
      expect(contract).toBe(CONNECTION_RESULT_CONTRACT);
      return connectionResponse(result, contract ?? undefined);
    });
    vi.stubGlobal('fetch', fetch);
    await expect(
      createHttpApi().connectRegistrarAccount('dynadot', {
        apiKey: 'synthetic',
      }),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
  },
);
