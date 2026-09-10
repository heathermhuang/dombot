// Synthetic fixtures for the local publishing workflow. Never targets a remote
// origin, and never uses real registrar credentials or performs registrar calls.
import { registrars } from '@aoxborrow/registrar-client';

const origin = process.env.DOMBOT_DEMO_URL || 'http://127.0.0.1:8791';
const url = new URL(origin);
if (
  url.hostname !== '127.0.0.1' ||
  url.protocol !== 'http:' ||
  !process.argv.includes('--replace-local-data')
) {
  throw new Error(
    'Use an HTTP 127.0.0.1 preview and pass --replace-local-data. This replaces its local demo data.',
  );
}
const password = process.env.DOMBOT_DEMO_PASSWORD || 'local-portfolio-preview';
const login = await fetch(`${origin}/auth/login`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error(`Local login failed (${login.status})`);
const cookie = login.headers.get('set-cookie').split(';')[0];
const names = [
  'atlas.example',
  'orchard.example',
  'studio.example',
  ...Array.from({ length: 72 }, (_, i) => `collection-${i + 1}.example`),
];
const credentials = Object.fromEntries(
  registrars.dynadot.configFields
    .filter((f) => f.required)
    .map((f) => [f.name, 'LOCAL-DEMO-NOT-A-CREDENTIAL']),
);
const bundle = {
  format: 'dombot-data',
  version: 2,
  exportedAt: new Date().toISOString(),
  app: { version: 'demo', platform: 'web' },
  namespaces: {
    credentials: { dynadot: credentials },
    'cache-portfolio': {
      dynadot: {
        fetchedAt: Date.now(),
        data: {
          lastSyncedAt: Date.now(),
          lastError: null,
          domains: names.map((domainName) => ({
            domainName,
            registrar: 'dynadot',
            status: 'active',
            locked: true,
            privacy: true,
            deleted: false,
            renewalDate: null,
            syncedAt: new Date().toISOString(),
            nameservers: [],
            autoRenew: false,
            expirationDate: '2027-01-01T00:00:00.000Z',
            createdDate: '2025-01-01T00:00:00.000Z',
          })),
        },
      },
    },
    'cache-detail': Object.fromEntries(
      names.map((name) => [
        `dynadot:${name}`,
        {
          fetchedAt: Date.now(),
          data: {
            domainName: name,
            nameservers: ['ns1.example.com'],
            locked: true,
            privacy: true,
            autoRenew: false,
          },
        },
      ]),
    ),
    settings: { autoSyncIntervalMinutes: 0, mcpEnabled: false },
  },
};
const response = await fetch(`${origin}/api/importData`, {
  method: 'POST',
  headers: {
    Origin: origin,
    Cookie: cookie,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ args: [JSON.stringify(bundle)] }),
});
if (!response.ok) throw new Error(`Local import failed (${response.status})`);
console.log(
  `Seeded ${names.length} synthetic names on ${origin}. No public page was created.`,
);
