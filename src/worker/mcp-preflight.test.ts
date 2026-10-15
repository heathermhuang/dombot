import { beforeEach, describe, expect, it } from 'vitest';
import { mcpPreflight } from './mcp-preflight';
import { hashToken } from '../core/mcp/oauth';
import { MemoryDocStore } from '../core/storage/doc-store';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';

const root = btoa('synthetic-test-root-key-32-bytes!!');
const basePath = '/w/11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
let raw: MemoryDocStore;
let encrypted: EncryptedDocStore;
let reads: string[];
let env: Env;
const request = (authorization?: string, method = 'POST') =>
  new Request('https://workspace.example/mcp', {
    method,
    headers: authorization ? { Authorization: authorization } : {},
  });
beforeEach(async () => {
  raw = new MemoryDocStore();
  reads = [];
  encrypted = new EncryptedDocStore(
    raw,
    await aesGcmCipher(await deriveEncryptionKey(parseRootSecret(root))),
  );
  env = {
    DOMBOT_SECRET: root,
    DOMBOT_PUBLIC_BASE_PATH: basePath,
    DB: {
      prepare(sql: string) {
        expect(sql).toBe('SELECT value FROM docs WHERE ns = ?1 AND key = ?2');
        return {
          bind(ns: string, key: string) {
            return {
              async first() {
                reads.push(`${ns}/${key}`);
                const value = await raw.get(ns, key);
                return value === null ? null : { value: JSON.stringify(value) };
              },
            };
          },
        };
      },
    },
  } as Env;
  await encrypted.put('settings', 'mcpEnabled', true);
  await encrypted.put('mcp', 'token:' + (await hashToken(token)), {
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    resource: 'https://workspace.example' + basePath + '/mcp',
  });
});
describe('hosted MCP admission before tenant queue', () => {
  it.each([
    undefined,
    'Basic bad',
    'Bearer not-issued',
    'Bearer ' + 'z'.repeat(64),
  ])(
    'rejects malformed/absent bearer %s without any database reads',
    async (header) => {
      const response = await mcpPreflight(request(header), env);
      expect(response?.status).toBe(401);
      expect(response?.headers.get('WWW-Authenticate')).toContain(
        basePath + '/.well-known/oauth-protected-resource/mcp',
      );
      expect(reads).toEqual([]);
    },
  );
  it('rejects unknown tokens after only targeted enable/token reads', async () => {
    expect(
      (await mcpPreflight(request('Bearer ' + 'b'.repeat(64)), env))?.status,
    ).toBe(401);
    expect(reads).toHaveLength(2);
    expect(reads[0]).toBe('settings/mcpEnabled');
    expect(reads[1]).toMatch(/^mcp\/token:/);
  });
  it('admits a valid resource-bound token and honors disable, expiry and revocation', async () => {
    expect(await mcpPreflight(request('Bearer ' + token), env)).toBeNull();
    await encrypted.put('settings', 'mcpEnabled', false);
    expect((await mcpPreflight(request('Bearer ' + token), env))?.status).toBe(
      404,
    );
    await encrypted.put('settings', 'mcpEnabled', true);
    await encrypted.put('mcp', 'token:' + (await hashToken(token)), {
      expiresAt: 1,
      resource: 'https://workspace.example' + basePath + '/mcp',
    });
    expect((await mcpPreflight(request('Bearer ' + token), env))?.status).toBe(
      401,
    );
    await raw.delete('mcp', 'token:' + (await hashToken(token)));
    expect((await mcpPreflight(request('Bearer ' + token), env))?.status).toBe(
      401,
    );
  });
  it('refuses a token minted for another workspace resource', async () => {
    await encrypted.put('mcp', 'token:' + (await hashToken(token)), {
      expiresAt: 9999999999,
      resource: 'https://other.example/mcp',
    });
    expect((await mcpPreflight(request('Bearer ' + token), env))?.status).toBe(
      401,
    );
  });
  it('serves CORS preflight without booting or reading tenant state', async () => {
    expect(
      (await mcpPreflight(request(undefined, 'OPTIONS'), env))?.status,
    ).toBe(204);
    expect(reads).toEqual([]);
  });
});
