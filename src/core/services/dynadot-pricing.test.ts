import { describe, expect, it, vi } from 'vitest';
import { createRegistrar, RateLimitError } from '@aoxborrow/registrar-client';

const quote = (fee: number) =>
  Response.json({
    RenewResponse: {
      Status: 'price_check_success',
      PriceInfo: `Renew Fee: ${fee} in USD, Total: ${fee} in USD`,
    },
  });

describe('pinned Dynadot price-only renewal contract', () => {
  it('quotes the mandatory two-year ai term as an annual estimate without renewing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => quote(171.2));
    const provider = createRegistrar(
      'dynadot',
      { apiKey: 'synthetic', apiSecret: 'synthetic' },
      { fetch },
    );
    const price = await provider.getPricing('EXAMPLE.AI', { retries: 0 });
    const request = new URL(String(fetch.mock.calls[0][0]));
    expect(request.pathname).toBe('/api3.json');
    expect(request.searchParams.get('command')).toBe('renew');
    expect(request.searchParams.get('price_check')).toBe('1');
    expect(request.searchParams.get('duration')).toBe('2');
    expect(price.renewal).toBe(85.6);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps ordinary annual quotes at one year', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => quote(20));
    const provider = createRegistrar(
      'dynadot',
      { apiKey: 'synthetic', apiSecret: 'synthetic' },
      { fetch },
    );
    expect(
      (await provider.getPricing('example.app', { retries: 0 })).renewal,
    ).toBe(20);
    expect(
      new URL(String(fetch.mock.calls[0][0])).searchParams.get('duration'),
    ).toBe('1');
  });
  it('preserves a classic quote cooldown without issuing a fallback search', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
    );
    const provider = createRegistrar(
      'dynadot',
      { apiKey: 'synthetic', apiSecret: 'synthetic' },
      { fetch },
    );
    await expect(
      provider.getPricing('example.ai', { retries: 0 }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
