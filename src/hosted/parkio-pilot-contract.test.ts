import { describe, it, expect } from 'vitest';
import {
  exportUrl,
  qualifiedCookies,
  cookieHeader,
  parsePilotCsv,
  readBounded,
  sealPilot,
  openPilot,
  PILOT_MAX_BYTES,
  type PilotCookie,
} from './parkio-pilot-contract';

const cookie: PilotCookie = {
  name: 'session',
  value: 'fixture-only',
  domain: 'park.io',
  path: '/',
  secure: true,
  httpOnly: true,
  expires: -1,
};

describe('Park.io pilot read contract', () => {
  it('allows a narrowly scoped discovered export', () => {
    expect(exportUrl('/orders/export/active.csv?status=active')).toBe(
      'https://park.io/orders/export/active.csv?status=active',
    );
  });
  it.each([
    'https://elsewhere.test/orders/export/active.csv',
    'http://park.io/orders/export/active.csv',
    'https://user:secret@park.io/orders/export/active.csv',
    '/orders/delete/export/file.csv',
    '/orders/%72enew/export/file.csv',
    '/orders/export/file.csv?redirect=https://elsewhere.test',
    '/users/logout',
    '/orders/transfer_auth.csv',
    '/orders/export/file.csv#fragment',
  ])('rejects unsafe credential destinations: %s', (value) => {
    expect(() => exportUrl(value)).toThrow();
  });
  it('keeps only plausible authentication state on the fixed provider domain', () => {
    const cookies = qualifiedCookies([
      cookie,
      { ...cookie, domain: 'other.test' },
      { ...cookie, name: '_ga', httpOnly: false, session: false },
    ]);
    expect(cookies).toEqual([cookie]);
  });
  it.each([
    { ...cookie, value: 'injected; credential=bad' },
    { ...cookie, partitionKey: { topLevelSite: 'https://park.io' } },
  ])('rejects unsafe/unsupported cookie serialization', (value) => {
    expect(() => qualifiedCookies([value])).toThrow('cookie_contract_required');
  });
  it('applies cookie path and expiry, including duplicate-name ordering', () => {
    const cookies = [
      cookie,
      { ...cookie, value: 'specific', path: '/orders' },
      { ...cookie, value: 'wrong-path', path: '/orders/exported' },
      { ...cookie, value: 'expired', expires: 1 },
    ];
    expect(
      cookieHeader(cookies, 'https://park.io/orders/export/active.csv', 2000),
    ).toBe('session=specific; session=fixture-only');
  });
  it('normalizes a complete CSV and keeps purchase amounts out of expiry', () => {
    expect(
      parsePilotCsv(
        '\uFEFFDomain,Expires,Total\r\nALPHA.test,2028-02-29,"1,200"\r\n',
      ),
    ).toEqual({
      headers: ['Domain', 'Expires', 'Total'],
      expiryAvailable: true,
      holdings: [{ domain: 'alpha.test', expirationDate: '2028-02-29' }],
    });
  });
  it('accepts a qualified empty export and explicitly unknown expiry', () => {
    expect(parsePilotCsv('Domain\n').holdings).toEqual([]);
    expect(
      parsePilotCsv('Domain,Paid Date\nalpha.test,2020-01-01\n').holdings,
    ).toEqual([{ domain: 'alpha.test', expirationDate: null }]);
  });
  it.each([
    '<html>Login</html>',
    'Domain,Domain\nalpha.test,beta.test',
    'Domain,Expires\nalpha.test,2027-02-29',
    'Domain,Expires\nalpha.test,01/02/2027',
    'Domain,Expires\n"alpha.test,2028-01-01',
    'Domain,Expires\nalpha.test,2028-01-01\nalpha.test,2029-01-01',
    'Domain,Expires\nnot a domain,2028-01-01',
    'Domain,Expires\n"alpha.test"bad,2028-01-01',
  ])('fails closed on HTML, ambiguity or malformed CSV', (csv) => {
    expect(() => parsePilotCsv(csv)).toThrow();
  });
  it('collapses identical duplicate records', () => {
    expect(
      parsePilotCsv('Domain\nalpha.test\nalpha.test\n').holdings,
    ).toHaveLength(1);
  });
  it('bounds actual streamed bytes and rejects redirects', async () => {
    await expect(
      readBounded(new Response('x'.repeat(PILOT_MAX_BYTES + 1))),
    ).rejects.toThrow('export_too_large');
    await expect(
      readBounded(
        new Response('', {
          status: 302,
          headers: { Location: 'https://elsewhere.test' },
        }),
      ),
    ).rejects.toThrow('export_rejected');
  });
  it('encrypts session data and binds it to an owner and root', async () => {
    const secret = 'synthetic-pilot-root-'.repeat(3);
    const sealed = await sealPilot(secret, 'owner-a', { cookies: [cookie] });
    expect(sealed).not.toContain('fixture-only');
    expect(await openPilot(secret, 'owner-a', sealed)).toEqual({
      cookies: [cookie],
    });
    await expect(openPilot(secret, 'owner-b', sealed)).rejects.toThrow();
    await expect(
      openPilot('different-root-'.repeat(4), 'owner-a', sealed),
    ).rejects.toThrow();
  });
});
