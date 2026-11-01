import { describe, it, expect } from 'vitest';
import { mcpPolicyDenial } from './mcp-policy';
const rpc = (name: string) => ({
  method: 'tools/call',
  params: {
    name,
    arguments: { accountId: 'owned-account' },
    scopes: ['domains:spend'],
  },
});
describe('explicit upstream paid MCP permission', () => {
  it.each([
    'domain_renew',
    'registrar_register_domain',
    'registrar_transfer_domain',
  ])(
    'requires persisted paid consent for %s, never request-supplied scopes',
    (name) => {
      expect(mcpPolicyDenial(rpc(name), 'owner')).toMatch(
        /spending budget is zero/,
      );
      expect(
        mcpPolicyDenial(rpc(name), 'owner', undefined, [
          'portfolio:read',
          'domains:write',
        ]),
      ).toMatch(/spending budget is zero/);
      expect(
        mcpPolicyDenial(rpc(name), 'owner', undefined, ['domains:spend']),
      ).toBeNull();
    },
  );
  it('retains restrictive operator policy even with explicit paid consent', () => {
    const policy = JSON.stringify({
      owner: { allowedTools: ['folder_list'], accountIds: [] },
    });
    expect(
      mcpPolicyDenial(rpc('domain_renew'), 'owner', policy, ['domains:spend']),
    ).toMatch(/outside/);
  });
});
