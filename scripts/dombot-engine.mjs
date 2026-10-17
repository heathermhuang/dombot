// Build a private, pinned engine artifact. The SaaS consumes its exported
// Worker/admission contract and UI assets; no npm publication is involved.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const root = process.cwd();
const name = '@domains-domains/dombot-engine';
const version = '1.5.0-hosted.7';
const upstream = {
  repository: 'https://github.com/aoxborrow/dombot',
  revision: 'feef729a1758c1ff667ce3b78d03a13ec3d6573b',
  version: '1.5.0',
};
const sourceRoots = [
  'src/core',
  'src/shared',
  'src/worker',
  'src/renderer',
  'site/src/assets/logos',
  'data',
  'migrations',
];
const sourceFiles = [
  'LICENSE',
  'index.html',
  'vite.web.config.mts',
  'scripts/dombot-engine.mjs',
  'vendor/aoxborrow-registrar-client-0.9.2-hosted.1.tgz',
  'vendor/registrar-client-renewal-quotes.patch',
  'vendor/registrar-client-0.9.2-hosted.1.json',
];
async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const relative = directory + '/' + entry.name;
    if (entry.isDirectory()) result.push(...(await walk(relative)));
    else if (entry.isFile() && !/^data\/tld-pricing-\d/.test(relative))
      result.push(relative);
  }
  return result;
}
const sources = [
  ...sourceFiles,
  ...(await Promise.all(sourceRoots.map(walk))).flat(),
].sort();
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sourceHash = createHash('sha256');
for (const file of sources)
  sourceHash
    .update(file + '\0')
    .update(await fs.readFile(path.join(root, file)))
    .update('\0');
const rootPackage = JSON.parse(await fs.readFile('package.json', 'utf8'));
// Pin the build/runtime dependency declarations without a recursive digest of
// this artifact's own file dependency or its integrity field in package-lock.
const { [name]: _engine, ...dependencies } = rootPackage.dependencies;
const buildLock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
delete buildLock.packages['node_modules/' + name];
delete buildLock.packages[''].dependencies[name];
sourceHash.update(
  JSON.stringify({
    dependencies,
    devDependencies: rootPackage.devDependencies,
    overrides: rootPackage.overrides,
  }),
);
sourceHash.update(JSON.stringify(buildLock));
const sourceSha256 = sourceHash.digest('hex');
const lockPath = 'hosted/dombot-engine.lock.json';
if (process.argv[2] === 'verify') {
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  if (sourceSha256 !== lock.sourceSha256)
    throw Error(
      'Engine source changed. Run npm run engine:pack and review the new artifact/lock.',
    );
  if (sha(await fs.readFile(lock.archive)) !== lock.sha256)
    throw Error('Engine archive integrity mismatch');
  const npmLock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
  if (
    rootPackage.dependencies[name] !== 'file:' + lock.archive ||
    npmLock.packages['node_modules/' + name]?.integrity !== lock.integrity
  )
    throw Error('npm dependency/integrity does not match engine lock');
  const installedRoot = path.join('node_modules', name);
  if (
    sha(await fs.readFile(path.join(installedRoot, 'package.json'))) !==
      lock.packageSha256 ||
    sha(await fs.readFile(path.join(installedRoot, 'engine.d.ts'))) !==
      lock.typesSha256
  )
    throw Error(
      'Installed engine package/exports/type contract integrity mismatch',
    );
  const manifestBytes = await fs.readFile(
    path.join(installedRoot, 'engine-manifest.json'),
  );
  if (sha(manifestBytes) !== lock.manifestSha256)
    throw Error('Installed engine manifest integrity mismatch');
  const installed = JSON.parse(
    await fs.readFile(
      path.join('node_modules', name, 'engine-manifest.json'),
      'utf8',
    ),
  );
  if (
    installed.sourceSha256 !== sourceSha256 ||
    installed.version !== lock.version
  )
    throw Error(
      'Installed engine does not match the reviewed source/artifact. Reinstall the pinned dependency.',
    );
  if (
    sha(await fs.readFile(path.join(installedRoot, 'engine.mjs'))) !==
    installed.workerSha256
  )
    throw Error('Installed engine Worker integrity mismatch');
  for (const [file, digest] of Object.entries(installed.assetHashes))
    if (
      sha(await fs.readFile(path.join(installedRoot, 'web', file))) !== digest
    )
      throw Error('Installed engine UI asset integrity mismatch: ' + file);
  for (const file of await walk('src/hosted')) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    if (
      /from\s+['"]\.\.\/(core|worker|renderer)(?:\/|['"])/.test(
        await fs.readFile(file, 'utf8'),
      )
    )
      throw Error('SaaS imports engine internals: ' + file);
  }
  console.log(
    JSON.stringify({
      engine: name,
      version: lock.version,
      sourceSha256,
      archiveSha256: lock.sha256,
      boundaryVerified: true,
    }),
  );
} else if (process.argv[2] === 'pack') {
  execFileSync('npm', ['run', 'web:build'], { cwd: root, stdio: 'inherit' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dombot-engine-'));
  await fs.mkdir(path.join(root, 'vendor'), { recursive: true });
  await fs.mkdir(path.join(root, 'hosted'), { recursive: true });
  await fs.mkdir(path.join(temp, 'web'), { recursive: true });
  await fs.cp('dist/web', path.join(temp, 'web'), { recursive: true });
  const bundle = await build({
    entryPoints: ['src/worker/engine.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    external: ['cloudflare:*', 'node:*'],
    metafile: true,
  });
  await fs.writeFile(
    path.join(temp, 'engine.mjs'),
    bundle.outputFiles[0].contents,
  );
  await fs.writeFile(
    path.join(temp, 'engine.d.ts'),
    (await fs.readFile('src/worker/engine-contract.ts', 'utf8')) +
      '\ndeclare const engine: DomBotEngine;\nexport default engine;\nexport declare function mcpPreflight(request: Request, env: DomBotEnvironment): Promise<Response | null>;\n',
  );
  for (const file of sources) {
    await fs.mkdir(path.dirname(path.join(temp, 'source', file)), {
      recursive: true,
    });
    await fs.copyFile(file, path.join(temp, 'source', file));
  }
  // A standalone build manifest/lock omits only this artifact's recursive
  // dependency. Rebuild from source with npm ci --ignore-scripts, then
  // npm run engine:pack; no private deployment configuration is included.
  const sourcePackage = { ...rootPackage, dependencies };
  await fs.writeFile(
    path.join(temp, 'source/package.json'),
    JSON.stringify(sourcePackage, null, 2) + '\n',
  );
  await fs.writeFile(
    path.join(temp, 'source/package-lock.json'),
    JSON.stringify(buildLock, null, 2) + '\n',
  );
  await fs.copyFile('LICENSE', path.join(temp, 'LICENSE'));
  const assetHashes = {};
  for (const file of [
    'index.html',
    ...(await fs.readdir('dist/web/assets')).map((x) => 'assets/' + x),
  ])
    assetHashes[file] = sha(await fs.readFile(path.join('dist/web', file)));
  const manifest = {
    name,
    version,
    contractVersion: 1,
    upstream,
    sourceSha256,
    workerSha256: sha(bundle.outputFiles[0].contents),
    assetHashes,
    sourceRepository: 'https://github.com/heathermhuang/dombot',
    sourceIntegration: 'reviewed hosted fork patches',
  };
  await fs.writeFile(
    path.join(temp, 'engine-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await fs.writeFile(
    path.join(temp, 'package.json'),
    JSON.stringify(
      {
        name,
        version,
        private: true,
        type: 'module',
        license: 'AGPL-3.0-or-later',
        exports: {
          '.': { types: './engine.d.ts', default: './engine.mjs' },
          './manifest': './engine-manifest.json',
        },
        files: [
          'engine.mjs',
          'engine.d.ts',
          'engine-manifest.json',
          'web',
          'source',
          'LICENSE',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  const packed = JSON.parse(
    execFileSync(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--json',
        '--cache',
        path.join(temp, 'npm-cache'),
        '--pack-destination',
        path.join(root, 'vendor'),
      ],
      { cwd: temp, encoding: 'utf8' },
    ),
  )[0];
  const archive = 'vendor/' + packed.filename;
  await fs.writeFile(
    lockPath,
    JSON.stringify(
      {
        name,
        version,
        upstream,
        archive,
        sourceSha256,
        packageSha256: sha(await fs.readFile(path.join(temp, 'package.json'))),
        typesSha256: sha(await fs.readFile(path.join(temp, 'engine.d.ts'))),
        manifestSha256: sha(
          await fs.readFile(path.join(temp, 'engine-manifest.json')),
        ),
        sha256: sha(await fs.readFile(archive)),
        integrity: packed.integrity,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      archive,
      version,
      sourceSha256,
      integrity: packed.integrity,
    }),
  );
} else throw Error('Usage: node scripts/dombot-engine.mjs pack|verify');
