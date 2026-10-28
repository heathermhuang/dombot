import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
// SQL-aware statement splitting: do not split string literals or comments.
export function sqlStatements(sql) {
  let current = '',
    quote = '',
    comment = '',
    statements = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i],
      next = sql[i + 1];
    if (comment === '--') {
      if (c === '\n') {
        comment = '';
        current += '\n';
      }
      continue;
    }
    if (comment === '/*') {
      if (c === '*' && next === '/') {
        comment = '';
        i++;
        current += ' ';
      }
      continue;
    }
    if (quote) {
      current += c;
      if (c === quote) {
        if (next === quote) current += sql[++i];
        else quote = '';
      }
      continue;
    }
    if (c === '-' && next === '-') {
      comment = '--';
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      comment = '/*';
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      current += c;
      continue;
    }
    if (c === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else current += c;
  }
  if (quote || comment === '/*') throw Error('Incomplete SQL');
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function prepare() {
  const target = path.join(root, 'dist/provisioning');
  await fs.mkdir(target, { recursive: true });
  await fs.cp(
    path.join(root, 'node_modules/@domains-domains/dombot-engine/web'),
    target,
    { recursive: true },
  );
  const privateDir = path.join(target, '_provision');
  await fs.mkdir(privateDir, { recursive: true });
  const statements = [];
  const migrationFiles = (await fs.readdir(path.join(root, 'migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles)
    statements.push(
      ...sqlStatements(
        await fs.readFile(path.join(root, 'migrations', file), 'utf8'),
      ),
    );
  if (statements.length > 100)
    throw Error('Bootstrap batch exceeds reviewed statement limit');
  const schema = JSON.stringify({ statements });
  const built = await build({
    absWorkingDir: root,
    entryPoints: ['src/hosted/provisioned-tenant.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['cloudflare:*', 'node:*'],
  });
  const module = built.outputFiles[0].contents;
  const engine = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        'node_modules/@domains-domains/dombot-engine/engine-manifest.json',
      ),
      'utf8',
    ),
  );
  // An operator may supply non-secret service/host settings for the qualified
  // release. Per-tenant identities and secrets are never template inputs.
  const bindings = process.argv[2]
    ? JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
    : [];
  const manifest = JSON.stringify({
    engine: engine.version,
    sourceSha256: engine.sourceSha256,
    moduleSha256: sha(module),
    bootstrapSha256: sha(schema),
    compatibilityDate: '2026-09-09',
    bindings,
  });
  await Promise.all([
    fs.writeFile(path.join(privateDir, 'tenant.mjs'), module),
    fs.writeFile(path.join(privateDir, 'schema.json'), schema),
    fs.writeFile(path.join(privateDir, 'manifest.json'), manifest),
  ]);
  console.log(
    JSON.stringify({
      templateSha256: sha(manifest),
      engine: engine.version,
      statements: statements.length,
      artifactDirectory: target,
    }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await prepare();
