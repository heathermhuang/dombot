// Only immutable private artifacts are read here. Never race the complete setup
// operation: a timed-out resource mutation could otherwise continue in parallel.
const ARTIFACT_READ_TIMEOUT_MS = 45000;
const MAX_ARTIFACT_BYTES = 10000000;
export class ArtifactReadTimeout extends Error {
  constructor() {
    super('Setup artifact read timed out');
  }
}
export async function readProvisioningArtifact(
  assets: Fetcher,
  path: string,
  label = 'Setup',
): Promise<string> {
  const controller = new AbortController(),
    timeoutError = new ArtifactReadTimeout();
  let rejectTimeout!: (error: Error) => void;
  const expired = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancelReader = () => {
    if (reader) void reader.cancel().catch(() => undefined);
  };
  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
    cancelReader();
    rejectTimeout(timeoutError);
  }, ARTIFACT_READ_TIMEOUT_MS);
  try {
    const response = await Promise.race([
      assets
        .fetch(
          new Request('https://assets.internal/' + path, {
            signal: controller.signal,
          }),
        )
        .then((response) => {
          if (controller.signal.aborted) {
            // If a binding ignores cancellation and resolves later, discard its
            // response. This branch has no path back into provisioning writes.
            void response.body?.cancel().catch(() => undefined);
            throw timeoutError;
          }
          return response;
        }),
      expired,
    ]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw Error(label + ' artifact unavailable');
    }
    if (!response.body) return '';
    reader = response.body.getReader();
    let size = 0,
      text = '';
    const decoder = new TextDecoder();
    while (!controller.signal.aborted) {
      // cancel() closes pending read requests immediately, even when the
      // source's own cancellation promise is still settling.
      const chunk = await reader.read();
      if (controller.signal.aborted) throw timeoutError;
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > MAX_ARTIFACT_BYTES) throw Error(label + ' artifact too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    throw timeoutError;
  } finally {
    clearTimeout(timeout);
    cancelReader();
  }
}
