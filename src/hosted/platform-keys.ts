import { Buffer } from 'node:buffer';

async function registryKey(pepper: string) {
  if (pepper.length < 32) throw Error('Platform registry key unavailable');
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`platform-registry:v1:${pepper}`),
    ),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
// Workspace-bound authenticated encryption prevents swapping rows between tenants.
export async function sealPlatformKey(pepper: string, id: string, key: string) {
  if (key.length < 32) throw Error('Invalid platform gateway key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
    await registryKey(pepper),
    new TextEncoder().encode(key),
  );
  return `v1.${Buffer.from(iv).toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`;
}
export async function openPlatformKey(pepper: string, id: string, box: string) {
  if (!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64,256}$/.test(box))
    throw Error('Invalid platform gateway key envelope');
  const [, iv, data] = box.split('.');
  const decoded = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: Buffer.from(iv, 'base64url'),
      additionalData: new TextEncoder().encode(id),
    },
    await registryKey(pepper),
    Buffer.from(data, 'base64url'),
  );
  const key = new TextDecoder().decode(decoded);
  if (key.length < 32) throw Error('Invalid platform gateway key');
  return key;
}
