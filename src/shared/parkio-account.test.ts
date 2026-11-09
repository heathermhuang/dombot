import { describe, it, expect } from 'vitest';
import {
  parkioAccountUrl,
  parkioExportUrl,
  parseParkioAccount,
} from './parkio-account';
const html =
  '<!doctype html><html><a href="/users/edit/123">Account</a><a href="/orders/export/active/123.csv">Export</a></html>';
describe('qualified account-scoped Park.io contract', () => {
  it('binds exactly matching authenticated account and Active-export references', () => {
    expect(parseParkioAccount(html, '/orders/export/active/123.csv')).toBe(
      '123',
    );
  });
  it('rejects mismatches, ambiguity, sign-in pages, foreign references and inactive exports', () => {
    for (const text of [
      html.replace('/users/edit/123', '/users/edit/999'),
      html.replace('</html>', '<a href="/users/edit/999">Other</a></html>'),
      '<html><input type="password"></html>',
      html.replace('href="/users', 'href="https://other.test/users'),
      html.replace('/export/active', '/export/all'),
    ])
      expect(() =>
        parseParkioAccount(text, '/orders/export/active/123.csv'),
      ).toThrow();
  });
  it('restricts all reads to exact qualified endpoints', () => {
    expect(parkioAccountUrl('/orders/index')).toBe(
      'https://park.io/orders/index',
    );
    for (const path of ['/users/edit/123', '/orders/index?status=active'])
      expect(() => parkioAccountUrl(path)).toThrow();
    for (const path of [
      '/orders/export/all/123.csv',
      '/orders/export/active/123.csv?x=1',
      'https://other.test/orders/export/active/123.csv',
    ])
      expect(() => parkioExportUrl(path)).toThrow();
  });
});
