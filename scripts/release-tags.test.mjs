import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
const temporary = [];
afterEach(() => {
  for (const dir of temporary.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dombot-release-tags-'));
  temporary.push(dir);
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'fixture.zip'), 'fixture');
  writeFileSync(
    join(dir, 'bin', 'gh'),
    '#!/bin/sh\nprintf "%s\\0" "$@" >> "$GH_CAPTURE"\nexit 0\n',
    { mode: 0o700 },
  );
  writeFileSync(join(dir, 'output'), '');
  return {
    dir,
    marker: join(dir, 'executed'),
    env: {
      ...process.env,
      PATH: join(dir, 'bin') + ':' + process.env.PATH,
      EVENT_NAME: 'push',
      PUBLISH_REQUESTED: 'false',
      GITHUB_OUTPUT: join(dir, 'output'),
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_REPOSITORY: 'controlled/repository',
      GH_TOKEN: 'fixture-only',
      GH_CAPTURE: join(dir, 'arguments'),
    },
  };
}
// Extract the actual Bash block, retaining the workflow as the test subject.
function script(name, tag = '') {
  const lines = workflow.split('\n'),
    start = lines.findIndex((line) => line === `      - name: ${name}`);
  if (start < 0) throw Error('Missing workflow step ' + name);
  const output = [];
  let collecting = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('      - name:') || /^  [a-z]+:/.test(line)) break;
    if (line.trimStart().startsWith('run:')) {
      collecting = true;
      const inline = line.trimStart().slice(4).trim();
      if (inline && inline !== '|') {
        output.push(inline);
        break;
      }
      continue;
    }
    if (collecting) {
      if (line.trim() && !line.startsWith('          ')) break;
      output.push(line.slice(10));
    }
  }
  return output
    .join('\n')
    .replaceAll('${{ github.event_name }}', 'push')
    .replaceAll('${{ inputs.publish }}', 'false')
    .replaceAll('${{ steps.decide.outputs.tag }}', tag)
    .replaceAll('${{ needs.setup.outputs.tag }}', tag);
}
describe('release workflow tag trust boundary', () => {
  it.each(['v1.2.3', 'v0.0.0', 'v123.45.6'])(
    'accepts canonical tag %s and emits only its literal value',
    (tag) => {
      const f = fixture(),
        r = spawnSync('bash', ['-c', script('Decide release vs validate')], {
          cwd: f.dir,
          env: { ...f.env, GITHUB_REF_NAME: tag },
          encoding: 'utf8',
        });
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(join(f.dir, 'output'), 'utf8')).toBe(
        `releasing=true\ntag=${tag}\nref=${tag}\n`,
      );
    },
  );
  it.each([
    'v1.2',
    'v1.2.3-rc.1',
    'v1.2.3 extra',
    'v1.2.3\nref=main',
    'v1.2.3"',
    'v1.2.3`touch MARKER`',
    'v1.2.3$(touch MARKER)',
  ])(
    'rejects unsafe or unsupported tag %s before publishing outputs',
    (template) => {
      const f = fixture(),
        tag = template.replace('MARKER', f.marker),
        r = spawnSync('bash', ['-c', script('Decide release vs validate')], {
          cwd: f.dir,
          env: { ...f.env, GITHUB_REF_NAME: tag },
          encoding: 'utf8',
        });
      expect(r.status).not.toBe(0);
      expect(readFileSync(join(f.dir, 'output'), 'utf8')).toBe('');
      expect(existsSync(f.marker)).toBe(false);
    },
  );
  it.each(['Create draft release', 'Attach to release', 'Publish release'])(
    'passes a poisoned tag literally at the %s sink',
    (step) => {
      const f = fixture(),
        tag = `v1.2.3$(touch ${f.marker})`,
        r = spawnSync('bash', ['-c', script(step, tag)], {
          cwd: f.dir,
          env: { ...f.env, TAG: tag },
          encoding: 'utf8',
        });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(f.marker)).toBe(false);
      expect(
        readFileSync(join(f.dir, 'arguments'), 'utf8').split('\0'),
      ).toContain(tag);
    },
  );
});
