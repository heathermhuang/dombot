// Generate local deployment configs and secrets for a pre-provisioned staging
// pool. Resource IDs come from the operator. Never overwrites existing keys.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
const root = process.cwd();
const dir = path.join(root, '.wrangler/hosted');
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const resources = JSON.parse(
  await fs.readFile(path.join(dir, 'resources.json'), 'utf8'),
);
if (
  !resources.accountId ||
  resources.databases?.length !== 4 ||
  !resources.origin?.startsWith('https://')
)
  throw Error(
    'Provide an account, HTTPS staging origin, and four D1 database IDs in .wrangler/hosted/resources.json',
  );
let saved;
try {
  saved = JSON.parse(await fs.readFile(path.join(dir, 'secrets.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!saved) {
  if (!process.env.DOMBOT_OWNER_EMAIL)
    throw Error('Set DOMBOT_OWNER_EMAIL for the reserved founder account');
  saved = {
    pepper: randomBytes(48).toString('base64url'),
    workspaces: ['Founder portfolio', 'Pilot A', 'Pilot B'].map((label, i) => ({
      id: randomUUID(),
      label,
      email: i
        ? `pilot-${i}@example.invalid`
        : process.env.DOMBOT_OWNER_EMAIL.toLowerCase(),
      key: randomBytes(48).toString('base64url'),
      root: randomBytes(32).toString('base64'),
      invite: randomBytes(32).toString('hex'),
      password: randomBytes(24).toString('base64url'),
    })),
  };
  await fs.writeFile(
    path.join(dir, 'secrets.json'),
    JSON.stringify(saved, null, 2),
    { mode: 0o600 },
  );
}
const json = (p, value) =>
  fs.writeFile(path.join(dir, p), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
for (const [i, w] of saved.workspaces.entries()) {
  await json(`tenant-${i}.jsonc`, {
    name: `domains-staging-tenant-${i}`,
    account_id: resources.accountId,
    main: path.join(root, 'src/hosted/tenant.ts'),
    compatibility_date: '2026-09-09',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    assets: {
      directory: path.join(root, 'dist/web'),
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: `domains-staging-tenant-${i}`,
        database_id: resources.databases[i + 1],
        migrations_dir: path.join(root, 'migrations'),
      },
    ],
    vars: {
      DOMBOT_AUTH: 'gateway',
      DOMBOT_WORKSPACE_ID: w.id,
      DOMBOT_PUBLIC_BASE_PATH: `/w/${w.id}`,
    },
    triggers: { crons: ['0 * * * *'] },
    observability: { enabled: true, head_sampling_rate: 1 },
  });
  await json(`tenant-${i}-secrets.json`, {
    DOMBOT_SECRET: w.root,
    DOMBOT_GATEWAY_SECRET: w.key,
  });
}
await json('gateway.jsonc', {
  name: 'domains-staging',
  account_id: resources.accountId,
  main: path.join(root, 'src/hosted/gateway.ts'),
  compatibility_date: '2026-09-09',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: true,
  preview_urls: false,
  d1_databases: [
    {
      binding: 'CONTROL_DB',
      database_name: 'domains-staging-control',
      database_id: resources.databases[0],
      migrations_dir: path.join(root, 'hosted/migrations'),
    },
  ],
  services: saved.workspaces.map((w, i) => ({
    binding: `WORKSPACE_${i}`,
    service: `domains-staging-tenant-${i}`,
  })),
  vars: {
    WORKSPACES: JSON.stringify(
      saved.workspaces.map((w, i) => ({
        id: w.id,
        label: w.label,
        binding: `WORKSPACE_${i}`,
      })),
    ),
  },
  triggers: { crons: ['17 * * * *'] },
  observability: { enabled: true, head_sampling_rate: 1 },
});
await json('gateway-secrets.json', {
  AUTH_PEPPER: saved.pepper,
  GATEWAY_KEYS: JSON.stringify(
    Object.fromEntries(saved.workspaces.map((w) => [w.id, w.key])),
  ),
});
const quote = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const sql = saved.workspaces
  .map(
    (w) =>
      `INSERT INTO workspaces(id,label) VALUES(${quote(w.id)},${quote(w.label)}) ON CONFLICT(id) DO NOTHING;\nINSERT INTO invitations(token_hash,email,workspace_id,expires_at) VALUES(${quote(createHash('sha256').update(w.invite).digest('hex'))},${quote(w.email)},${quote(w.id)},${Date.now() + 7 * 86400_000}) ON CONFLICT(token_hash) DO NOTHING;`,
  )
  .join('\n');
await fs.writeFile(path.join(dir, 'seed.sql'), sql, { mode: 0o600 });
console.log(
  'Staging configs and private secrets prepared. No resources deployed or invitations sent.',
);
