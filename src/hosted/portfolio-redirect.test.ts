import { describe, expect, it } from 'vitest';
import redirect from './portfolio-redirect';

describe('old portfolio www redirect', () => {
  it('preserves the path and query at the canonical HTTPS portfolio', () => {
    const response = redirect.fetch(
      new Request('http://www.domains.domains/domains?collection=AI'),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe(
      'https://domains.domains/domains?collection=AI',
    );
  });
  it('never redirects the product testing hostname or an unknown host', () => {
    for (const host of [
      'domains.domains.domains',
      'domains.domains',
      'example.com',
    ])
      expect(redirect.fetch(new Request(`https://${host}/`)).status).toBe(404);
  });
});
