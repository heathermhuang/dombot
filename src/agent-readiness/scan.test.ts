import { describe, expect, it, vi } from 'vitest';
import { mcpDiscoveryUrl, scanDomain, scanReadiness } from './scan';
import scanner from './worker';

const origin = 'https://scan.domains.domains';
const dns = (Answer: { type: number; data: string }[]) =>
  Response.json({ Status: 0, Answer });
const website = 'name.example.com';
function mockPublicSite() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'cloudflare-dns.com') {
      const type = url.searchParams.get('type');
      const query = url.searchParams.get('name');
      if (type === 'A') return dns([{ type: 1, data: '8.8.4.4' }]);
      if (type === 'TXT' && query === '_mcp.' + website)
        return dns([
          {
            type: 16,
            data: '"v=mcp1; " "url=https://catalog.example.com/mcp"',
          },
        ]);
      return dns([]);
    }
    if (url.pathname === '/')
      return new Response(
        `<title>Domain inquiries</title>
<link rel="alternate" type="application/json" href="/listing.json">
<a href="/inquiries">Send an offer</a>`,
        { headers: { 'Content-Type': 'text/html' } },
      );
    if (url.pathname === '/llms.txt')
      return new Response('# Example domain\n\n- [Listing](/)');
    return Response.json({
      askingPrice: { amount: '1200.99', currency: 'USD' },
    });
  });
}

describe('public portfolio scanner', () => {
  it('scores the advertised price, discovery and offer path without fetching a write endpoint', async () => {
    const send = mockPublicSite();
    const result = await scanReadiness(website, send);
    expect(result.score).toBe(100);
    expect(
      send.mock.calls.every(([, options]) => options?.redirect === 'manual'),
    ).toBe(true);
    expect(result.checks).toHaveLength(7);
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(
      send.mock.calls.some(([url]) => String(url).endsWith('/inquiries')),
    ).toBe(false);
    expect(
      send.mock.calls.every(
        ([, options]) => !options?.method || options.method === 'GET',
      ),
    ).toBe(true);
  });

  it('revalidates redirect destinations and skips hosts with non-public address answers', async () => {
    const send = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'cloudflare-dns.com') {
        if (url.searchParams.get('type') === 'A')
          return dns([
            {
              type: 1,
              data:
                url.searchParams.get('name') === 'other.example.com'
                  ? '10.0.0.1'
                  : '8.8.4.4',
            },
          ]);
        return dns([]);
      }
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://other.example.com/' },
      });
    });
    const result = await scanReadiness(website, send);
    expect(result.score).toBe(0);
    expect(result.checks.find((check) => check.id === 'lander')?.status).toBe(
      'unverified',
    );
    expect(
      send.mock.calls.some(([url]) =>
        String(url).startsWith('https://other.example.com'),
      ),
    ).toBe(false);
  });

  it('rejects names with userinfo, paths, private suffixes or unsupported discovery syntax', () => {
    for (const name of [
      'example.com/path',
      'user@example.com',
      'example.internal',
      '127.0.0.1',
      'a%2eexample.com',
    ])
      expect(() => scanDomain(name)).toThrow();
    for (const value of [
      'url=https://example.com',
      'v=mcp1; url=http://example.com',
      'v=mcp1; url=https://user@example.com',
      'v=mcp1; url=https://example.com; url=https://other.example.com',
    ])
      expect(mcpDiscoveryUrl(value)).toBeNull();
    expect(mcpDiscoveryUrl('"v=mcp1; " "url=https://example.com/mcp"')).toBe(
      'https://example.com/mcp',
    );
  });

  it('renders the free form and returns portfolio scores for multiple domains', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const landing = await scanner.fetch(new Request(origin), {
      SCAN_LIMIT: limiter,
    });
    expect(await landing.text()).toContain(
      'Can agents find and price your domains?',
    );
    vi.stubGlobal('fetch', mockPublicSite());
    try {
      const response = await scanner.fetch(
        new Request(origin + '/api/scan', {
          method: 'POST',
          body: JSON.stringify({ domains: [website, 'second.example.com'] }),
        }),
        { SCAN_LIMIT: limiter },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        fixUrl: 'https://domains.domains/',
        results: [
          { domain: website, score: 100 },
          { domain: 'second.example.com', score: 80 },
        ],
      });
      const html = await scanner.fetch(
        new Request(origin, {
          method: 'POST',
          headers: { Origin: origin },
          body: new URLSearchParams({ domains: website }),
        }),
        { SCAN_LIMIT: limiter },
      );
      expect(await html.text()).toContain('Fix this in Domains.Domains');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
