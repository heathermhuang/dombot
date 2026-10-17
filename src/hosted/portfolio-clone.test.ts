import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import clone from './portfolio-clone';

describe('public portfolio clone', () => {
  it('routes only public pages/assets and leaves existing services alone', () => {
    const config = JSON.parse(
      readFileSync('hosted/wrangler.portfolio-clone.jsonc', 'utf8'),
    );
    expect(config.routes.map((r: { pattern: string }) => r.pattern)).toEqual([
      'alternative.domains/',
      'alternative.domains/domains',
      'alternative.domains/domains/',
      'alternative.domains/public-portfolio/*',
    ]);
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
