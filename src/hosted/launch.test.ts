import { describe, it, expect } from 'vitest';
import { canonicalRedirect, portfolioAlias } from './launch';

describe('public launch routing', () => {
  const path = '/w/11111111-1111-4111-8111-111111111111/p/founder';
  it('accepts only an explicit local public-portfolio alias', () => {
    expect(portfolioAlias(path)).toBe(path);
    for (const value of [
      undefined,
      'https://evil.example',
      '//evil.example',
      '/w/11111111-1111-4111-8111-111111111111/api/exportData',
      path + '?secret=x',
      path + '/../api',
    ])
      expect(portfolioAlias(value)).toBeNull();
  });
  it('preserves path and search when redirecting a retired host', () => {
    const response = canonicalRedirect(
      new Request('https://old.example/domains?q=short'),
      'https://domains.domains',
    );
    expect(response?.status).toBe(308);
    expect(response?.headers.get('Location')).toBe(
      'https://domains.domains/domains?q=short',
    );
    expect(
      canonicalRedirect(
        new Request('https://domains.domains/app'),
        'https://domains.domains',
      ),
    ).toBeNull();
  });
  it('does not replay credentials or writes on another host', async () => {
    const response = canonicalRedirect(
      new Request('https://old.example/session/login', {
        method: 'POST',
        body: 'password=private',
      }),
      'https://domains.domains',
    );
    expect(response?.status).toBe(421);
    expect(response?.headers.get('Location')).toBeNull();
    expect(await response?.text()).not.toContain('private');
  });
});
