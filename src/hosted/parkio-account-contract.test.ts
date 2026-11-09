import { describe, expect, it } from 'vitest';
import {
  accountReadUrl,
  accountReadCookies,
  inspectAccountHtml,
} from './parkio-account-contract';
describe('Park.io identity qualification read profile', () => {
  it('rejects management, foreign origins, queries and encoded paths', () => {
    for (const p of [
      '/users/logout',
      '/users/delete/1',
      '/orders/renew',
      '/users/edit?save=1',
      'https://other.test/users/edit',
      '/users/%65dit',
      '//other.test/orders',
    ])
      expect(() => accountReadUrl(p)).toThrow();
    expect(accountReadUrl('/users/edit')).toBe('https://park.io/users/edit');
  });
  it('returns structural fields and an explicit numeric hidden user id only on the account page', () => {
    const html =
      '<!doctype html><html><a href="/users/edit">Account</a><a href="/users/logout">Logout</a><form action="/users/edit" method="post"><input type="hidden" name="data[User][id]" value="123"></form><form action="/subscribe" method="post"><input type="hidden" name="id" value="999"></form><input name="email" value="private@test.invalid"></html>';
    const o = inspectAccountHtml(html);
    expect(o.accountPaths).toEqual(['/users/edit']);
    expect(o.userIds).toEqual([]);
    const a = inspectAccountHtml(html, true);
    expect(a.userIds).toEqual(['123']);
    expect(JSON.stringify(a)).not.toContain('private@test.invalid');
    expect(() =>
      inspectAccountHtml('<html><input type="password"></html>'),
    ).toThrow();
  });
  it('never sends expired or wrong-path cookies to account pages', () => {
    const base = {
      name: 'session',
      value: 'synthetic',
      domain: 'park.io',
      path: '/',
      secure: true,
      httpOnly: true,
    };
    expect(
      accountReadCookies(
        [
          base,
          { ...base, name: 'expired', expires: 1 },
          { ...base, name: 'orders', path: '/orders' },
        ],
        '/users/edit',
        2000,
      ),
    ).toBe('session=synthetic');
  });
});
