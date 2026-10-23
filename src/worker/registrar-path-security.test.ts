import { describe, expect, it, vi } from 'vitest';
import { createRegistrar } from '@aoxborrow/registrar-client';
import { createRequire } from 'node:module';
const options = { retries: 0 };
describe('pinned registrar path and expression boundaries', () => {
  it.each([
    'example.com/../../billing',
    'example.com?limit=999',
    'example.com#ignored',
    'example.com\\..\\other',
    'example.com%2f..%2fother',
    'example.com／..／other',
  ])('rejects Gandi path delimiters in %s before transport', async (domain) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ fqdn: 'safe.example' }),
    );
    const p = createRegistrar('gandi', { apiKey: 'synthetic' }, { fetch });
    await expect(p.getDomain(domain, options)).rejects.toThrow(/path/i);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['.', '..', ''])(
    'rejects the Gandi dot/empty segment %s before any request',
    async (domain) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ fqdn: 'safe.example' }),
      );
      const p = createRegistrar('gandi', { apiKey: 'synthetic' }, { fetch });
      await expect(p.getDomain(domain, options)).rejects.toThrow(/path/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(['example.com', 'EXAMPLE.COM', 'bücher.example'])(
    'preserves valid Gandi domain %s',
    async (domain) => {
      const canonical = new URL('https://' + domain).hostname;
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ fqdn: canonical }),
      );
      const p = createRegistrar('gandi', { apiKey: 'synthetic' }, { fetch });
      expect((await p.getDomain(domain, options)).domainName).toBe(canonical);
      expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe(
        '/v5/domain/domains/' + canonical,
      );
    },
  );
  it.each([
    'nameservers',
    'dns',
    'renew',
    'set-nameservers',
    'lock',
    'set-dns',
  ])(
    'protects Gandi %s requests as well as the detail endpoint',
    async (operation) => {
      const domain = 'example.com/../../other';
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = new URL(String(input));
        return Response.json(
          url.pathname.endsWith('/records') ||
            url.pathname.endsWith('/nameservers')
            ? []
            : {},
        );
      });
      const p = createRegistrar('gandi', { apiKey: 'synthetic' }, { fetch });
      let call: Promise<unknown>;
      if (operation === 'nameservers') call = p.getNameservers(domain, options);
      else if (operation === 'dns') call = p.getDnsRecords(domain, options);
      else if (operation === 'renew') call = p.renewDomain(domain, 1, options);
      else if (operation === 'set-nameservers')
        call = p.updateNameservers(domain, ['ns1.example.net'], options);
      else if (operation === 'lock') call = p.lockDomain(domain, options);
      else call = p.setDnsRecords(domain, [], options);
      await expect(call).rejects.toThrow(/path/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('ships the same path protection in the CommonJS entry point', async () => {
    const cjs = createRequire(import.meta.url)(
      '@aoxborrow/registrar-client',
    ) as typeof import('@aoxborrow/registrar-client');
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ fqdn: 'safe.example' }),
    );
    const p = cjs.createRegistrar('gandi', { apiKey: 'synthetic' }, { fetch });
    await expect(p.getDomain('..', options)).rejects.toThrow(/path/i);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    'www" or true or http.host eq "other',
    'slash\\host',
    'quote"host',
    '例子',
  ])(
    'serializes Cloudflare forwarding host %s as one literal',
    async (host) => {
      let expression = '';
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = new URL(String(input)),
          method = init?.method ?? 'GET';
        if (url.pathname === '/client/v4/zones')
          return Response.json({
            success: true,
            result: [
              { id: 'fixture-zone', name: 'example.com', status: 'active' },
            ],
          });
        if (url.pathname.endsWith('/entrypoint'))
          return Response.json({
            success: true,
            result: { id: 'fixture-rules', rules: [] },
          });
        if (url.pathname.endsWith('/dns_records'))
          return Response.json({
            success: true,
            result: method === 'GET' ? [] : { id: 'fixture-record' },
          });
        if (url.pathname.endsWith('/rulesets/fixture-rules')) {
          expression = JSON.parse(String(init?.body)).rules[0].expression;
          return Response.json({
            success: true,
            result: { id: 'fixture-rules' },
          });
        }
        throw Error(
          'Unexpected fixture request ' + method + ' ' + url.pathname,
        );
      });
      const p = createRegistrar(
        'cloudflare',
        { apiToken: 'synthetic', accountId: 'fixture-account' },
        { fetch },
      );
      expect(
        (
          await p.setDomainForwarding(
            'example.com',
            [{ host, url: 'https://destination.example', type: 'permanent' }],
            options,
          )
        ).success,
      ).toBe(true);
      expect(expression.startsWith('http.host eq ')).toBe(true);
      expect(JSON.parse(expression.slice('http.host eq '.length))).toBe(
        host + '.example.com',
      );
    },
  );
});
