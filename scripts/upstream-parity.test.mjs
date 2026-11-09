import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { coreMethods } from '../src/core/api';
import { registerTools } from '../src/core/mcp/tools';
import { getRegistrarCatalog } from '../src/core/services/registrars';
const parity = JSON.parse(
  fs.readFileSync('docs/upstream-parity-20261109.json', 'utf8'),
);
function tools(scopes) {
  const names = [];
  registerTools(
    {
      registerTool(name) {
        names.push(name);
      },
    },
    scopes,
  );
  return names;
}
describe('pinned upstream feature parity', () => {
  it('pins the qualified engine to the parity revision and includes Unstoppable Domains', () => {
    const lock = JSON.parse(
      fs.readFileSync('hosted/dombot-engine.lock.json', 'utf8'),
    );
    expect(lock.upstream).toMatchObject({
      version: parity.version,
      revision: parity.revision,
    });
    expect(getRegistrarCatalog().map((r) => r.name)).toContain('unstoppable');
  });
  it('retains every upstream core method and MCP tool with full granted scopes', () => {
    expect(Object.keys(coreMethods)).toEqual(
      expect.arrayContaining(parity.coreApiMethods),
    );
    expect(tools()).toEqual(expect.arrayContaining(parity.mcpTools));
    expect(tools(['portfolio:read', 'domains:write', 'domains:spend'])).toEqual(
      expect.arrayContaining(parity.mcpTools),
    );
  });
  it('keeps upstream application routes and market settings as primary UI', () => {
    const app = fs.readFileSync('src/renderer/App.tsx', 'utf8'),
      settings = fs.readFileSync('src/renderer/pages/Settings.tsx', 'utf8');
    for (const route of parity.applicationRoutes)
      expect(app).toContain(`path="${route}"`);
    expect(app).toMatch(/path="\/sales"\s+element=\{<Sales\s*\/>\}/);
    expect(app).not.toMatch(/path="\/sales"\s+element=\{<SalesListings/);
    expect(app).not.toContain('supportsSales');
    for (const section of parity.settingsSections)
      expect(settings).toContain(`value: '${section}'`);
  });
  it('does not expose market writes or transfer approval through read-only OAuth', () => {
    const read = tools(['portfolio:read']),
      write = tools(['domains:write']);
    for (const name of [
      'domain_listing_set',
      'domain_verification_apply',
      'market_verification_set',
      'market_listings_delete',
      'market_sale_auth_code_set',
      'domain_transfer_out_approve',
    ]) {
      expect(read).not.toContain(name);
      if (parity.mcpTools.includes(name)) expect(write).toContain(name);
    }
    expect(read).toContain('market_list');
    expect(read).toContain('market_sales');
  });
});
