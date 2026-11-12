import { expect, it } from 'vitest';
import { readWebAuthStatus } from './web-auth-bootstrap';
it('does not guess instance-password mode when the hosted status request fails', async () => {
  const offline: typeof fetch = async () => {
    throw Error('offline');
  };
  await expect(
    readWebAuthStatus('/w/fixture/auth/status', true, offline),
  ).rejects.toThrow();
});
it.each([
  [500, { mode: 'password', authenticated: false }],
  [200, { error: 'Not signed in' }],
  [200, { mode: 'password', authenticated: false }],
  [200, { mode: 'gateway', authenticated: 'true' }],
])(
  'rejects an unusable hosted bootstrap response: %s %j',
  async (status, value) => {
    const reply: typeof fetch = async () => Response.json(value, { status });
    await expect(
      readWebAuthStatus('/w/fixture/auth/status', true, reply),
    ).rejects.toThrow();
  },
);
it('retains explicit self-hosted password mode and valid hosted account mode', async () => {
  const password: typeof fetch = async () =>
    Response.json({ mode: 'password', authenticated: false });
  expect((await readWebAuthStatus('/auth/status', false, password)).mode).toBe(
    'password',
  );
  const hosted: typeof fetch = async () =>
    Response.json({ mode: 'gateway', authenticated: true, sales: true });
  expect(
    await readWebAuthStatus('/w/fixture/auth/status', true, hosted),
  ).toMatchObject({ mode: 'gateway', authenticated: true, sales: true });
});
