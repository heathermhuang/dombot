import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
// Exercise the real verifier in a private copy. Source and archive are read-only
// links; only the copied installed package is modified for negative controls.
async function fixture(run) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'engine-integrity-test-'),
  );
  try {
    for (const item of [
      'src',
      'data',
      'migrations',
      'scripts',
      'hosted',
      'vendor',
      'LICENSE',
      'index.html',
      'vite.web.config.mts',
      'package.json',
      'package-lock.json',
    ])
      await fs.symlink(path.join(root, item), path.join(dir, item));
    const installed = path.join(
      dir,
      'node_modules/@domains-domains/dombot-engine',
    );
    await fs.cp(
      path.join(root, 'node_modules/@domains-domains/dombot-engine'),
      installed,
      { recursive: true },
    );
    const verify = () =>
      spawnSync(
        process.execPath,
        [path.join(root, 'scripts/dombot-engine.mjs'), 'verify'],
        { cwd: dir, encoding: 'utf8', timeout: 10_000 },
      );
    await run(installed, verify);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
describe('pinned engine admission', () => {
  it('accepts the installed artifact, then rejects executable tampering', async () =>
    fixture(async (installed, verify) => {
      expect(verify().status).toBe(0);
      await fs.appendFile(
        path.join(installed, 'engine.mjs'),
        '\n// tampered\n',
      );
      const result = verify();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Worker integrity mismatch');
    }));
  it('rejects package exports redirecting imports to an unchecked module', async () =>
    fixture(async (installed, verify) => {
      const file = path.join(installed, 'package.json');
      const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
      pkg.exports['.'].default = './other.mjs';
      await fs.writeFile(file, JSON.stringify(pkg));
      await fs.writeFile(
        path.join(installed, 'other.mjs'),
        'export default {};',
      );
      const result = verify();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'exports/type contract integrity mismatch',
      );
    }));
});
