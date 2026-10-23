#!/usr/bin/env node
// Rotates DOMBOT_SECRET — the root key everything in D1 is encrypted under —
// on a running self-hosted instance, by round-tripping the data through a
// bundle:
//
//   1. sign in and export everything (the current secret can still open it)
//   2. keep that bundle on disk, sealed here with a passphrase you're asked
//      for (same envelope as the app's Settings → Export; see
//      src/shared/bundle-seal.ts)
//   3. retire old-root admission in D1, drain active requests, and replace the
//      backup with a final export; only then install a fresh random root
//   4. independently bind login and import to the new root generation
//
// Deploy this protocol-compatible runtime and migrations before using it.
// If retirement or propagation is uncertain, keep the old root retired and
// retain both the sealed backup and private recovery-key file for the operator.
//
//   DOMBOT_URL=https://dombot.example.workers.dev npm run web:rotate-secret
//
// Prompts for the login password (or reads DOMBOT_PASSWORD from env) and for
// a passphrase to seal the on-disk bundle (or DOMBOT_BACKUP_PASSPHRASE). With
// both in the environment the script runs unattended.

import { randomBytes, webcrypto, hkdfSync } from 'node:crypto';
import { runWrangler } from './wrangler.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Seals bundle text like src/shared/bundle-seal.ts does (kept in step). */
async function sealBundle(text, passphrase) {
  const subtle = webcrypto.subtle;
  const head = JSON.parse(text);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  return JSON.stringify(
    {
      format: head.format,
      version: head.version,
      exportedAt: head.exportedAt,
      encrypted: {
        kdf: 'PBKDF2-SHA256',
        iterations: 600_000,
        salt: b64(salt),
        alg: 'AES-256-GCM',
        iv: b64(iv),
        ct: b64(new Uint8Array(ct)),
      },
    },
    null,
    2,
  );
}

const url = (process.env.DOMBOT_URL || '').replace(/\/+$/, '');
let validOrigin = false;
try {
  const parsed = new URL(url);
  validOrigin =
    parsed.origin === url &&
    (parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)));
} catch {}
if (!validOrigin) {
  console.error(
    'Set DOMBOT_URL to your instance, e.g. DOMBOT_URL=https://dombot.you.workers.dev',
  );
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
async function ask(q, { hidden = false } = {}) {
  if (!hidden || !stdout.isTTY) return (await rl.question(q)).trim();
  // Mask input: readline echoes, so temporarily swallow the output stream.
  stdout.write(q);
  const write = stdout.write.bind(stdout);
  stdout.write = () => true;
  try {
    return (await rl.question('')).trim();
  } finally {
    stdout.write = write;
    stdout.write('\n');
  }
}

const password =
  process.env.DOMBOT_PASSWORD ||
  (await ask('Login password: ', { hidden: true }));
// Asked up front, before any network round trip: with stdin piped, the
// answer arrives (and stdin closes) immediately, and readline can't be asked
// after that.
const passphrase =
  process.env.DOMBOT_BACKUP_PASSPHRASE ||
  (await ask('Passphrase to seal the backup file: ', { hidden: true }));
if (!passphrase) {
  console.error(
    'A passphrase is required — the file holds your registrar keys.',
  );
  process.exit(1);
}
rl.close();

const request = (input, init = {}) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
let cookie = '';
let generation = '';
const rootHeader = 'X-DomBot-Root-Generation';
async function login() {
  const res = await request(`${url}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: url,
      ...(generation ? { [rootHeader]: generation } : {}),
    },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`login failed (${res.status}): ${body.error ?? ''}`);
  }
  const observed = res.headers.get(rootHeader);
  if (!observed || (generation && observed !== generation))
    throw new Error('Login did not prove the required root generation');
  generation = observed;
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('Login returned no session cookie');
}
async function api(method, args) {
  const res = await request(`${url}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: url,
      cookie,
      [rootHeader]: generation,
    },
    body: JSON.stringify({ args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${method} failed (${res.status}): ${body.error ?? ''}`);
  return body.result;
}

const status = await (await request(`${url}/auth/status`)).json();
if (status.mode !== 'password' || status.rootRetirement !== true) {
  console.error(
    'Deploy the root-retirement-compatible runtime and migrations first. This command requires password mode; no secret was changed.',
  );
  process.exit(1);
}

// 1–2. Export, sealed, to disk.
await login();
const plain = await api('exportData', []);
if (JSON.parse(plain).publicationDraft?.version === 2) {
  const state = await request(`${url}/publishing/site`, {
    headers: { cookie },
  });
  if (!state.ok || !(await state.json()).enabled)
    throw new Error(
      'Enable DOMBOT_OWNER_SITE_V2 on this compatible runtime before rotating a v2 site root key. No secret was changed.',
    );
}
const file = `dombot-data-${new Date().toISOString().replaceAll(':', '-')}-pre-rotation.json`;
writeFileSync(file, await sealBundle(plain, passphrase), { mode: 0o600 });
console.log(`Exported to ./${file} (sealed with your passphrase).`);

// Freeze admission across isolates, then take the final export only after
// every admitted old-root HTTP/cron request has finished and flushed.
const next = randomBytes(32).toString('base64');
const nextGeneration = Buffer.from(
  hkdfSync(
    'sha256',
    Buffer.from(next, 'base64'),
    Buffer.alloc(0),
    'dombot/root-generation/v1',
    32,
  ),
).toString('base64url');
let finalBundle;
for (let attempt = 0; attempt < 60; attempt++) {
  const res = await request(`${url}/auth/retire-root`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: url,
      cookie,
      [rootHeader]: generation,
    },
    body: JSON.stringify({ password, nextRoot: nextGeneration }),
  });
  if (![200, 202].includes(res.status))
    throw new Error(
      `Root retirement failed (${res.status}); no new secret was installed. Preserve ./${file} and inspect rotation state.`,
    );
  const state = await res.json();
  if (
    res.status === 200 &&
    state.drained === true &&
    typeof state.bundle === 'string'
  ) {
    finalBundle = state.bundle;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!finalBundle)
  throw new Error(
    `Old-root requests have not drained. No secret was installed. Preserve ./${file}; do not clear unknown request leases.`,
  );
writeFileSync(file, await sealBundle(finalBundle, passphrase), { mode: 0o600 });
// Keep the recovery key privately on disk before an externally ambiguous update.
mkdirSync('.wrangler', { recursive: true, mode: 0o700 });
const keyFile = `.wrangler/rotation-root-${nextGeneration}.txt`;
writeFileSync(keyFile, next + '\n', { mode: 0o600, flag: 'wx' });
const r = runWrangler(['secret', 'put', 'DOMBOT_SECRET'], {
  input: next + '\n',
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (r.status !== 0)
  throw new Error(
    `Secret update failed or is uncertain. The old root remains retired; keep ./${file} and ${keyFile}, and inspect provider state before retrying.`,
  );

// Every login/import is independently bound to the new generation. A request
// routed to an old isolate is rejected before it can hydrate or write data.
generation = nextGeneration;
let live = false;
for (let attempt = 0; attempt < 60 && !live; attempt++) {
  const res = await request(`${url}/auth/status`, {
    headers: { [rootHeader]: generation },
  });
  live = res.ok && res.headers.get(rootHeader) === generation;
  if (!live) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!live)
  throw new Error(
    `New runtime propagation is unresolved. Preserve ./${file} and ${keyFile}; no import was attempted.`,
  );
await login();
const imported = await api('importData', [finalBundle]);
console.log(
  `Imported ${imported.entries} item(s) across ${imported.namespaces} section(s).`,
);
console.log(`New root recovery key saved privately at ${keyFile}.`);
console.log(
  'Store that key in your password manager. Delete ./' +
    file +
    ' once you have confirmed the instance is healthy (or keep it as a backup).',
);
