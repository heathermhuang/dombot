import { expect, it } from 'vitest';
import { readProvisioningArtifact } from './provisioning-artifact';

it('preserves UTF-8 bytes across streamed chunk boundaries', async () => {
  const text = 'export const name = "香港 domains";';
  const bytes = new TextEncoder().encode(text);
  const assets = {
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes)
              controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
      ),
  } as unknown as Fetcher;
  expect(await readProvisioningArtifact(assets, '_provision/tenant.mjs')).toBe(
    text,
  );
});

it('cancels an oversized artifact before buffering/decoding it', async () => {
  let cancelled = 0;
  const assets = {
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10000001));
          },
          cancel() {
            cancelled++;
          },
        }),
      ),
  } as unknown as Fetcher;
  await expect(
    readProvisioningArtifact(assets, '_provision/tenant.mjs'),
  ).rejects.toThrow('artifact too large');
  expect(cancelled).toBe(1);
});
