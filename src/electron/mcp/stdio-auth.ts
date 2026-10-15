import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { StdioConfig } from './stdio-config';

// The file key never crosses TCP. Authenticate each request and its complete
// response, rather than trusting a reachability check followed by a bearer send.
const PREFIX = 'stdio-v1.';
const RESPONSE_PROOF = 'X-DomBot-Stdio-Response';
const MAX_AGE_MS = 30_000;
const MAX_NONCES = 4096;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const digest = (value: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(value)).digest('hex');
const mac = (key: string, value: string) =>
  createHmac('sha256', Buffer.from(key, 'hex')).update(value).digest('hex');
const equal = (a: string, b: string) =>
  /^[a-f0-9]{64}$/.test(a) &&
  timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

function endpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/mcp' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid local DomBot MCP endpoint');
  return url.href;
}

async function bodyBytes(value: Request | Response): Promise<ArrayBuffer> {
  const reader = value.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const value = chunk.value;
      size += value.byteLength;
      if (size > MAX_MESSAGE_BYTES) {
        await reader.cancel();
        throw new Error('Local MCP message is too large');
      }
      chunks.push(value);
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function requestMessage(
  request: Request,
  stamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return [
    'stdio-request-v1',
    stamp,
    nonce,
    request.method,
    request.url,
    bodyHash,
  ].join('\n');
}

const responseMessage = (
  proof: string,
  response: Response,
  bytes: ArrayBuffer,
) =>
  [
    'stdio-response-v1',
    proof,
    response.status,
    response.headers.get('content-type') ?? '',
    digest(bytes),
  ].join('\n');

function withBody(
  response: Response,
  bytes: ArrayBuffer,
  headers = new Headers(response.headers),
): Response {
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(
    [204, 205, 304].includes(response.status) ? null : bytes,
    { status: response.status, headers },
  );
}

export const isStdioProof = (proof: string) => proof.startsWith(PREFIX);

export function createStdioVerifier(
  config: StdioConfig,
): (proof: string, request: Request) => Promise<boolean> {
  const url = endpoint(config.url);
  const used = new Map<string, number>();
  return async (proof, request) => {
    const match =
      /^stdio-v1\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(
        proof,
      );
    if (!match || request.url !== url) return false;
    const [, stamp, nonce, bodyHash, signature] = match;
    const now = Date.now(),
      issued = Number(stamp);
    if (issued > now + 5000 || now - issued > MAX_AGE_MS) return false;
    const expected = mac(
      config.token,
      requestMessage(request, stamp, nonce, bodyHash),
    );
    if (!equal(signature, expected)) return false;
    // Reject unauthenticated headers before reading any attacker-owned body.
    if (digest(await bodyBytes(request.clone())) !== bodyHash) return false;
    const checkedAt = Date.now();
    if (checkedAt - issued > MAX_AGE_MS || issued > checkedAt + 5000)
      return false;
    for (const [id, expiry] of used) if (expiry < checkedAt) used.delete(id);
    // Check and reserve only after the async digest, with no intervening await.
    if (used.has(nonce) || used.size >= MAX_NONCES) return false;
    used.set(nonce, issued + MAX_AGE_MS);
    return true;
  };
}

export async function signStdioResponse(
  proof: string,
  response: Response,
  key: string,
): Promise<Response> {
  const bytes = await bodyBytes(response);
  const headers = new Headers(response.headers);
  // The Node HTTP adapter supplies a default type when absent. Set it before
  // authenticating the headers so an empty 202 survives the real transport.
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/octet-stream');
  const signed = withBody(response, bytes, headers);
  signed.headers.set(
    RESPONSE_PROOF,
    mac(key, responseMessage(proof, signed, bytes)),
  );
  return signed;
}

/** No redirects: neither request contents nor authentication may leave /mcp. */
export function createStdioFetch(
  config: StdioConfig,
  send: typeof fetch = globalThis.fetch,
): typeof fetch {
  const url = endpoint(config.url);
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== url)
      throw new Error('Local MCP request changed its endpoint');
    const stamp = String(Date.now()),
      nonce = randomBytes(16).toString('hex');
    const bodyHash = digest(await bodyBytes(request.clone()));
    const proof = `${PREFIX}${stamp}.${nonce}.${bodyHash}.${mac(config.token, requestMessage(request, stamp, nonce, bodyHash))}`;
    request.headers.set('Authorization', `Bearer ${proof}`);
    const response = await send(request, { redirect: 'error' });
    const bytes = await bodyBytes(response);
    if (
      !equal(
        response.headers.get(RESPONSE_PROOF) ?? '',
        mac(config.token, responseMessage(proof, response, bytes)),
      )
    )
      throw new Error(
        'The local MCP responder could not authenticate as DomBot',
      );
    return withBody(response, bytes);
  };
}
