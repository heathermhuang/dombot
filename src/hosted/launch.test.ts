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
  it('upgrades template-only HTTP reads and refuses credential writes', async () => {
    const read = canonicalRedirect(
      new Request('http://staging.example/app?view=domains'),
      undefined,
    );
    expect(read?.status).toBe(308);
    expect(read?.headers.get('Location')).toBe(
      'https://staging.example/app?view=domains',
    );
    const write = canonicalRedirect(
      new Request('http://staging.example/session/login', {
        method: 'POST',
        body: 'private-password',
      }),
      undefined,
    );
    expect(write?.status).toBe(421);
    expect(write?.headers.get('Set-Cookie')).toBeNull();
    expect(write?.headers.get('Location')).toBeNull();
    expect(await write?.text()).not.toContain('private-password');
    expect(
      canonicalRedirect(new Request('https://staging.example/app'), undefined),
    ).toBeNull();
  });
  it('keeps unconfigured loopback development available', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(
        canonicalRedirect(new Request(`http://${host}:8787/app`), undefined),
      ).toBeNull();
  });
});
