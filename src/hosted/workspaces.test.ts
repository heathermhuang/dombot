import { describe, expect, it } from 'vitest';
import { workspaceSchema, workspaceService, gatewayKey } from './workspaces';
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  binding: 'WORKSPACE_9',
  label: 'Reserved customer',
};
describe('bounded operator workspace registry', () => {
  it('supports additional slots while rejecting duplicate IDs, reused bindings, and arbitrary environment keys', () => {
    expect(workspaceSchema.parse([row])).toEqual([row]);
    for (const binding of [
      'CONTROL_DB',
      'WORKSPACE_32',
      'WORKSPACE_01',
      'WORKSPACE_9.fetch',
    ])
      expect(workspaceSchema.safeParse([{ ...row, binding }]).success).toBe(
        false,
      );
    expect(workspaceSchema.safeParse([row, row]).success).toBe(false);
    expect(
      workspaceSchema.safeParse([
        row,
        { ...row, id: '22222222-2222-4222-8222-222222222222' },
      ]).success,
    ).toBe(false);
  });
  it('fails closed if the configured private service is missing', () => {
    expect(() => workspaceService({} as HostedEnv, 'WORKSPACE_9')).toThrow(
      /unavailable/,
    );
  });
  it('adds new slot keys without overwriting existing secret configuration', () => {
    const env = {
      GATEWAY_KEYS: JSON.stringify({ old: 'a'.repeat(48) }),
      EXTRA_GATEWAY_KEYS: JSON.stringify({ new: 'b'.repeat(48) }),
    } as HostedEnv;
    expect(gatewayKey(env, 'old')).toBe('a'.repeat(48));
    expect(gatewayKey(env, 'new')).toBe('b'.repeat(48));
    env.EXTRA_GATEWAY_KEYS = JSON.stringify({ old: 'b'.repeat(48) });
    expect(() => gatewayKey(env, 'old')).toThrow(/overlaps/);
  });
});
