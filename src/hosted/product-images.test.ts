import { describe, expect, it, vi } from 'vitest';
import gateway from './gateway';
import { registrarLogos } from './registrar-logos';
import { registrars } from '@aoxborrow/registrar-client';
import { productImages, previousProductImages } from './product-images';

describe('public product preview boundary', () => {
  it('serves only the explicit previews and does not forward account credentials', async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(
      async () => new Response(new Uint8Array([137, 80, 78, 71])),
    );
    const env = { LANDING_ASSETS: { fetch } } as unknown as HostedEnv;
    for (const image of [
      ...Object.values(productImages),
      ...previousProductImages,
      ...registrarLogos,
    ]) {
      const response = await gateway.fetch(
        new Request('https://domains.domains' + image.path + '?private=value', {
          headers: {
            Cookie: 'private-session',
            Authorization: 'Bearer private-token',
          },
        }),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(
        image.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
      );
      expect(response.headers.get('Cache-Control')).toContain('immutable');
      const request = fetch.mock.calls.at(-1)![0] as Request;
      expect(new URL(request.url).pathname).toBe(image.file);
      expect(new URL(request.url).search).toBe('');
      expect([...request.headers]).toEqual([]);
    }
    expect(registrarLogos.map((logo) => logo.id).sort()).toEqual(
      Object.keys(registrars).sort(),
    );
    fetch.mockClear();
    for (const path of [
      '/product/_headers',
      '/product/.env',
      '/registrars/.env',
      '/registrars/namecheap.svg',
      '/registrar-namecheap.svg',
      '/dombot-domains.png',
    ]) {
      expect(
        (
          await gateway.fetch(
            new Request('https://domains.domains' + path),
            env,
          )
        ).status,
      ).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows local images on the homepage without enabling scripts or external images', async () => {
    const response = await gateway.fetch(
      new Request('https://domains.domains/'),
      {} as HostedEnv,
    );
    const policy = response.headers.get('Content-Security-Policy');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src 'self'");
    expect(policy).not.toContain('script-src');
    expect(policy).not.toContain('https:');
  });
});
