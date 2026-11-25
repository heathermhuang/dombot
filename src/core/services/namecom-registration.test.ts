import { expect, it, vi } from 'vitest';
import { NamecomRegistrationCheck } from './namecom-registration';

it('uses the exact authenticated eligibility GET and rejects ambiguous responses', async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ domainName: 'moved.example', atName: false }),
  );
  const provider = new NamecomRegistrationCheck(
    { username: 'fixture', apiToken: 'fixture-key' },
    { fetch: fetch as typeof globalThis.fetch },
  );
  expect(await provider.isRegisteredAtName('Moved.Example.')).toBe(false);
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe(
    'https://api.name.com/core/v1/transfers/eligibility/moved.example',
  );
  expect(init.method).toBe('GET');
  expect(new Headers(init.headers).get('authorization')).toMatch(/^Basic /);
  fetch.mockResolvedValueOnce(
    Response.json({ domainName: 'different.example', atName: false }),
  );
  expect(await provider.isRegisteredAtName('moved.example')).toBeNull();
  fetch.mockResolvedValueOnce(
    Response.json({ domainName: 'moved.example', atName: 'false' }),
  );
  expect(await provider.isRegisteredAtName('moved.example')).toBeNull();
  fetch.mockResolvedValueOnce(
    Response.json({ domainName: 'moved.example', atName: true }),
  );
  expect(await provider.isRegisteredAtName('moved.example')).toBe(true);
});
