import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as esm from '@aoxborrow/registrar-client';
const cjs = createRequire(import.meta.url)(
  '@aoxborrow/registrar-client',
) as typeof esm;
for (const [format, sdk] of [
  ['ESM', esm],
  ['CJS', cjs],
] as const) {
  describe(`${format} Dynadot renewal settings`, () => {
    it.each([
      [false, 'reset'],
      [true, 'auto'],
    ] as const)(
      'writes the expected renewal option when enabled=%s',
      async (enabled, option) => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () =>
          Response.json({ code: 200, message: 'Success' }),
        );
        const provider = sdk.createRegistrar(
          'dynadot',
          { apiKey: 'synthetic', apiSecret: 'synthetic' },
          { fetch },
        );
        await provider.setAutoRenew('example.com', enabled, { retries: 0 });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe(
          '/restful/v2/domains/example.com/renew_option',
        );
        expect(fetch.mock.calls[0][1]?.method).toBe('PUT');
        expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
          renew_option: option,
        });
      },
    );
  });
}
