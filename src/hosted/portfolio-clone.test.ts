import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import clone from './portfolio-clone';

describe('public portfolio clone', () => {
  it('routes only public pages/assets and leaves existing services alone', () => {
    const config = JSON.parse(
      readFileSync('hosted/wrangler.portfolio-clone.jsonc', 'utf8').replace(
        /,\s*([}\]])/g,
        '$1',
      ),
    );
    expect(config.routes.map((r: { pattern: string }) => r.pattern)).toEqual([
      'alternative.domains/*',
    ]);
    expect(config.services).toEqual([{ binding: 'LEGACY', service: 'dombot' }]);
  });
  it('does not replay mutations, and canonicalizes the old public path', async () => {
    const env = { ASSETS: { fetch: async () => new Response('public') } } as {
      ASSETS: Fetcher;
    };
    const post = await clone.fetch(
      new Request('https://alternative.domains/', {
        method: 'POST',
        body: 'private',
      }),
      env,
    );
    expect(post.status).toBe(405);
    const alias = await clone.fetch(
      new Request('https://alternative.domains/domains?collection=ai'),
      env,
    );
    expect(alias.status).toBe(308);
    expect(alias.headers.get('location')).toBe(
      'https://alternative.domains/?collection=ai',
    );
  });
  it('forwards the existing authenticated backend unchanged while accepting portfolio queries', async () => {
    let forwarded: Request | undefined;
    const env = {
      ASSETS: { fetch: async () => new Response('portfolio') },
      LEGACY: {
        fetch: async (request: Request) => {
          forwarded = request;
          return new Response('protected', { status: 401 });
        },
      },
    } as { ASSETS: Fetcher; LEGACY: Fetcher };
    const request = new Request(
      'https://alternative.domains/mcp?client=existing',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer controlled-test-only' },
        body: 'existing-body',
      },
    );
    expect((await clone.fetch(request, env)).status).toBe(401);
    expect(forwarded?.url).toBe(request.url);
    expect(forwarded?.headers.get('authorization')).toBe(
      'Bearer controlled-test-only',
    );
    expect(await forwarded?.text()).toBe('existing-body');
    expect(
      await (
        await clone.fetch(
          new Request('https://alternative.domains/?source=share'),
          env,
        )
      ).text(),
    ).toBe('portfolio');
  });
  it('resolves every local stylesheet dependency without duplicated URL prefixes', () => {
    const root = 'public-portfolio';
    for (const file of readdirSync(root, { recursive: true }).filter((p) =>
      String(p).endsWith('.css'),
    )) {
      const css = readFileSync(root + '/' + file, 'utf8');
      for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
        expect(match[1]).toMatch(/^\/public-portfolio\//);
        expect(existsSync(root + match[1]), match[1]).toBe(true);
      }
      for (const match of css.matchAll(/url\(["']?([^)"']+)["']?\)/g)) {
        const url = match[1];
        if (!url.startsWith('/public-portfolio/')) continue;
        expect(url.indexOf('/public-portfolio/', 1), url).toBe(-1);
        expect(existsSync(root + url), url).toBe(true);
      }
    }
  });
  it('copies the published sections with local scripts and working public inquiry', () => {
    const html = readFileSync('public-portfolio/index.html', 'utf8');
    expect(html.match(/id="faq-\d+"/g)).toHaveLength(13);
    expect(html).toContain('Previously Collected');
    expect(html).toContain('mailto:domains@domains.domains');
    expect(html).toContain(
      'rel="canonical" href="https://alternative.domains/"',
    );
    expect(html).not.toContain('/cdn-cgi/l/email-protection');
    expect(html).not.toContain('googletagmanager');
  });
});
