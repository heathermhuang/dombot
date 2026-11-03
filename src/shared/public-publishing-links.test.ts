import { describe, expect, it } from 'vitest';
import { publicDomainPath, publicDomainUrl } from './public-publishing-links';

describe('public domain addresses', () => {
  const base = '/w/11111111-1111-4111-8111-111111111111';
  it('keeps hosted workspace identities out of public links and normalizes domains', () => {
    expect(publicDomainPath(base + '/', 'Working.IO.')).toBe('/working.io');
    expect(
      publicDomainUrl('https://domains.domains' + base, 'Working.IO'),
    ).toBe('https://domains.domains/working.io');
    expect(publicDomainUrl('https://domains.domains' + base, 'bücher.de')).toBe(
      'https://domains.domains/xn--bcher-kva.de',
    );
  });
  it('preserves self-hosted routes and configured non-workspace prefixes', () => {
    expect(publicDomainPath('/', 'working.io')).toBe('/d/working.io');
    expect(publicDomainUrl('https://self.example', 'working.io')).toBe(
      'https://self.example/d/working.io',
    );
    expect(publicDomainUrl('https://self.example/prefix', 'working.io')).toBe(
      'https://self.example/prefix/d/working.io',
    );
  });
  it('rejects missing or unsafe operator routing and invalid domains', () => {
    for (const origin of [
      undefined,
      'http://bad.example',
      'https://user:password@bad.example',
      'https://bad.example?next=anything',
    ])
      expect(() => publicDomainUrl(origin, 'working.io')).toThrow();
    expect(() => publicDomainPath(base, 'evil.example/path')).toThrow();
  });
});
