import { createHmac, scrypt, timingSafeEqual } from 'node:crypto';

export const opaqueToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
export async function tokenHash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
async function derive(
  password: string,
  salt: string,
  pepper: string,
): Promise<Buffer> {
  if (pepper.length < 32)
    throw new Error('Authentication secret is not configured');
  const input = createHmac('sha256', pepper)
    .update(password.normalize('NFKC'))
    .digest('hex');
  return new Promise((resolve, reject) =>
    scrypt(
      input,
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    ),
  );
}
export async function passwordHash(
  password: string,
  pepper: string,
): Promise<string> {
  const salt = opaqueToken();
  return `scrypt-v1:${salt}:${(await derive(password, salt, pepper)).toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  record: string,
  pepper: string,
): Promise<boolean> {
  const [version, salt, digest] = record.split(':');
  if (
    version !== 'scrypt-v1' ||
    !/^[0-9a-f]{64}$/.test(salt) ||
    !/^[0-9a-f]{128}$/.test(digest)
  )
    return false;
  return timingSafeEqual(
    await derive(password, salt, pepper),
    Buffer.from(digest, 'hex'),
  );
}
