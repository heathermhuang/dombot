import { describe, it, expect } from 'vitest';
import {
  readParkio,
  rotateParkioCookies,
  parkioCookieHeader,
} from './parkio-transport';
import type { ParkioCredential } from '../shared/parkio';
const credential = (): ParkioCredential => ({
  version: 1,
  accountId: '123',
  cookies: [
    {
      name: 'parkio_user_signin',
      value: 'synthetic-auth',
      domain: 'park.io',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ],
  capturedAt: 1000,
  expiresAt: 10000000,
  accountPath: '/orders/index',
  exportPath: '/orders/export/active/123.csv',
});
const html =
  '<!doctype html><html><a href="/users/edit/123">Account</a><a href="/orders/export/active/123.csv">Export</a></html>';
const csv =
  'Order ID,Domain,Created Date,Paid Date,Amount (USD),Expiration Date,On park.io\n12,alpha.test,2025-01-01,2025-01-02,100,2028-02-29,Yes\n';
describe('bounded Park.io transport', () => {
  it('uses two exact GETs with manual redirects and no app authorization', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(calls.length === 1 ? html : csv, {
        headers: {
          'Content-Type': calls.length === 1 ? 'text/html' : 'text/csv',
        },
      });
    };
    const r = await readParkio(credential(), fake, 2000);
    expect(r.records?.length).toBe(1);
    expect(calls.map((c) => c.url)).toEqual([
      'https://park.io/orders/index',
      'https://park.io/orders/export/active/123.csv',
    ]);
    for (const c of calls) {
      expect(c.init?.method).toBe('GET');
      expect(c.init?.redirect).toBe('manual');
      expect(new Headers(c.init?.headers).get('authorization')).toBeNull();
    }
  });
  it('stops at an account mismatch or sign-in redirect without requesting inventory', async () => {
    for (const response of [
      new Response(null, {
        status: 302,
        headers: { Location: 'https://other.test/' },
      }),
      new Response(html.replace('/users/edit/123', '/users/edit/999'), {
        headers: { 'Content-Type': 'text/html' },
      }),
    ]) {
      let calls = 0;
      const result = await readParkio(
        credential(),
        async () => {
          calls++;
          return response;
        },
        2000,
      );
      expect(calls).toBe(1);
      expect(['sign_in_required', 'account_mismatch']).toContain(result.error);
    }
  });
  it('returns rotated credentials even when the later export is malformed', async () => {
    let calls = 0;
    const result = await readParkio(
      credential(),
      async () => {
        calls++;
        return new Response(calls === 1 ? html : 'broken', {
          headers: {
            'Content-Type': calls === 1 ? 'text/html' : 'text/csv',
            ...(calls === 1
              ? {
                  'Set-Cookie':
                    'parkio_user_signin=rotated; Path=/; Secure; HttpOnly',
                }
              : {}),
          },
        });
      },
      2000,
    );
    expect(result.error).toBe('schema_changed');
    expect(result.credential?.cookies[0].value).toBe('rotated');
  });
  it('applies deletion and rejects foreign, partitioned and unsafe cookie contracts', () => {
    expect(
      rotateParkioCookies(
        credential().cookies,
        ['parkio_user_signin=; Max-Age=0; Path=/'],
        2000,
      ),
    ).toEqual([]);
    for (const line of [
      'parkio_user_signin=x; Domain=other.test',
      'parkio_user_signin=x; Partitioned',
      'parkio_user_signin=x\r\nHeader: bad',
    ])
      expect(() => rotateParkioCookies(credential().cookies, [line])).toThrow();
    expect(() =>
      parkioCookieHeader(credential().cookies, 'https://other.test/'),
    ).toThrow();
  });
  it('does not send an expired credential or an unknown read path', async () => {
    let calls = 0;
    const fake: typeof fetch = async () => {
      calls++;
      return new Response('unused');
    };
    const c = credential();
    c.expiresAt = 1;
    expect((await readParkio(c, fake, 2000)).error).toBe('sign_in_required');
    c.expiresAt = 10000000;
    c.exportPath = '/orders/renew/12';
    await readParkio(c, fake, 2000);
    expect(calls).toBe(0);
  });
});
