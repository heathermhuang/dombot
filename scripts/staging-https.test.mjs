import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const prepare = resolve('scripts/prepare-hosted-staging.mjs');
const deploy = resolve('scripts/deploy-hosted-staging.mjs');
const temporary = [];
afterEach(() => {
  for (const dir of temporary.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture(origin) {
  const dir = mkdtempSync(join(tmpdir(), 'dombot-staging-https-'));
  temporary.push(dir);
  mkdirSync(join(dir, '.wrangler/hosted'), { recursive: true });
  writeFileSync(
    join(dir, '.wrangler/hosted/resources.json'),
    JSON.stringify({
      accountId: 'fixture',
      origin,
      databases: ['0', '1', '2', '3'],
    }),
  );
  const prepared = spawnSync(process.execPath, [prepare], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, DOMBOT_OWNER_EMAIL: 'owner@example.invalid' },
  });
  return { dir, prepared };
}
describe('staging HTTPS configuration', () => {
  it('carries the supplied exact HTTPS origin into the gateway', () => {
    const { dir, prepared } = fixture('https://staging.example');
    expect(prepared.status, prepared.stderr).toBe(0);
    const gateway = JSON.parse(
      readFileSync(join(dir, '.wrangler/hosted/gateway.jsonc'), 'utf8'),
    );
    expect(gateway.vars.CANONICAL_ORIGIN).toBe('https://staging.example');
  });
  it.each([
    'http://staging.example',
    'https://staging.example/path',
    'https://user@staging.example',
    'https://staging.example?x=1',
  ])('rejects an unsafe resource origin %s', (origin) => {
    expect(fixture(origin).prepared.status).not.toBe(0);
  });
  it('rejects stale generated configs before invoking Wrangler', () => {
    const { dir, prepared } = fixture('https://staging.example');
    expect(prepared.status, prepared.stderr).toBe(0);
    const file = join(dir, '.wrangler/hosted/gateway.jsonc');
    const gateway = JSON.parse(readFileSync(file, 'utf8'));
    delete gateway.vars.CANONICAL_ORIGIN;
    writeFileSync(file, JSON.stringify(gateway));
    const result = spawnSync(process.execPath, [deploy], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('MODULE_NOT_FOUND');
    expect(result.stderr).toContain('requires an explicit HTTPS CANONICAL_ORIGIN');
  });
});
