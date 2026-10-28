import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import gateway from './gateway';
import { home } from './views';
import { productImages, productImageVariants } from './product-images';

describe('responsive landing product previews', () => {
  it('ships real PNG bytes with matching dimensions and immutable URL fingerprints', async () => {
    for (const image of [
      ...Object.values(productImages),
      ...productImageVariants,
    ]) {
      const bytes = await readFile(
        new URL('../../site/public' + image.file, import.meta.url),
      );
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
        image.width,
        image.height,
      ]);
      expect(image.path).toContain(
        createHash('sha256').update(bytes).digest('hex').slice(0, 12),
      );
    }
  });

  it('uses the approved code-native illustrations while retaining the archived preview metadata', () => {
    const html = home(false, true);
    expect(html).not.toContain('<picture>');
    for (const image of Object.values(productImages)) {
      expect(image.mobile.path).toContain('-mobile-');
      expect(image.path).toMatch(/^\/product\//);
    }
    expect(html).toContain('Interactive illustration · Sample data');
    expect(html).toContain('Illustrative visitor page');
    expect(html).toContain('No message is sent.');
    expect(html).not.toContain('alt="Illustrative Sales pages');
  });

  it('serves the explicit mobile crops without forwarding visitor credentials', async () => {
    const fetch = vi.fn(
      async () => new Response(new Uint8Array([137, 80, 78, 71])),
    );
    const env = { LANDING_ASSETS: { fetch } } as unknown as HostedEnv;
    for (const image of productImageVariants) {
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
      expect(response.headers.get('Content-Type')).toBe('image/png');
      expect(response.headers.get('Cache-Control')).toContain('immutable');
      const request = fetch.mock.calls.at(-1)![0] as Request;
      expect(new URL(request.url).pathname).toBe(image.file);
      expect(new URL(request.url).search).toBe('');
      expect([...request.headers]).toEqual([]);
    }
  });
});
