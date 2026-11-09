import {
  ParkioError,
  PARKIO_MAX_BYTES,
  parkioCookieSchema,
  parkioCredentialSchema,
  parseParkioExport,
  type ParkioCredential,
  type ParkioCookie,
  type ParkioRecord,
} from '../shared/parkio';
import {
  parkioAccountUrl,
  parkioExportUrl,
  parseParkioAccount,
} from '../shared/parkio-account';
export function parkioCookieHeader(
  cookies: ParkioCookie[],
  target: string,
  now = Date.now(),
) {
  const url = new URL(target);
  if (url.origin !== 'https://park.io')
    throw new ParkioError('unsafe_destination');
  return cookies
    .filter(
      (c) =>
        (c.expires === undefined || c.expires <= 0 || c.expires * 1000 > now) &&
        (url.pathname === c.path ||
          url.pathname.startsWith(
            c.path.endsWith('/') ? c.path : c.path + '/',
          )),
    )
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
export function rotateParkioCookies(
  cookies: ParkioCookie[],
  headers: string[],
  now = Date.now(),
): ParkioCookie[] {
  const next = [...cookies];
  for (const line of headers) {
    if (line.length > 16384 || /[\r\n]/.test(line))
      throw new ParkioError('cookie_contract_required');
    const [first, ...parts] = line.split(';');
    const at = first.indexOf('=');
    const name = first.slice(0, at).trim();
    if (!['parkio_user_signin', 'flashId'].includes(name)) continue;
    const attrs = new Map<string, string>();
    for (const part of parts) {
      const index = part.indexOf('=');
      attrs.set(
        (index < 0 ? part : part.slice(0, index)).trim().toLowerCase(),
        index < 0 ? '' : part.slice(index + 1).trim(),
      );
    }
    if (attrs.has('partitioned'))
      throw new ParkioError('cookie_contract_required');
    const domain = (attrs.get('domain') ?? 'park.io').toLowerCase(),
      path = attrs.get('path') ?? '/';
    const rawMax = attrs.get('max-age');
    let expires = attrs.has('expires')
      ? Date.parse(attrs.get('expires')!) / 1000
      : undefined;
    if (rawMax !== undefined) {
      if (!/^-?\d{1,10}$/.test(rawMax))
        throw new ParkioError('cookie_contract_required');
      expires = now / 1000 + Number(rawMax);
    }
    if (expires !== undefined && !Number.isFinite(expires))
      throw new ParkioError('cookie_contract_required');
    const cookie = parkioCookieSchema.parse({
      name,
      value:
        first.slice(at + 1) ||
        (expires !== undefined && expires * 1000 <= now ? 'deleted' : ''),
      domain,
      path,
      secure: attrs.has('secure'),
      httpOnly: attrs.has('httponly'),
      ...(expires === undefined ? { session: true } : { expires }),
    });
    const index = next.findIndex(
      (c) =>
        c.name === name &&
        c.domain.replace(/^\./, '') === domain.replace(/^\./, '') &&
        c.path === path,
    );
    if (index >= 0) next.splice(index, 1);
    if (expires === undefined || expires * 1000 > now) next.push(cookie);
  }
  return next;
}
async function bounded(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ParkioError('empty_response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > PARKIO_MAX_BYTES) throw new ParkioError('export_too_large');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
    all,
  );
}
export type ParkioReadResult = {
  credential: ParkioCredential | null;
  records?: ParkioRecord[];
  error?: string;
};
/** At most two fixed GETs. Rotation is returned even when CSV validation fails. */
export async function readParkio(
  saved: ParkioCredential,
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<ParkioReadResult> {
  let credential = parkioCredentialSchema.parse(structuredClone(saved));
  const get = async (url: string, kind: 'html' | 'csv') => {
    const cookie = parkioCookieHeader(credential.cookies, url, now);
    if (!cookie.split('; ').some((v) => v.startsWith('parkio_user_signin=')))
      throw new ParkioError('sign_in_required');
    if (
      !credential.cookies.some(
        (c) =>
          c.name === 'parkio_user_signin' &&
          (c.expires === undefined || c.expires <= 0 || c.expires * 1000 > now),
      ) ||
      credential.expiresAt <= now
    )
      throw new ParkioError('sign_in_required');
    const response = await request(url, {
      method: 'GET',
      headers: {
        Cookie: cookie,
        Accept: kind === 'html' ? 'text/html' : 'text/csv',
      },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    try {
      credential = {
        ...credential,
        cookies: rotateParkioCookies(
          credential.cookies,
          response.headers.getSetCookie(),
          now,
        ),
      };
    } catch {
      await response.body?.cancel();
      throw new ParkioError('cookie_contract_required');
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new ParkioError('rate_limited');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ParkioError(
        response.status >= 500 ? 'provider_unavailable' : 'sign_in_required',
      );
    }
    const html = /text\/html/i.test(response.headers.get('content-type') ?? '');
    if ((kind === 'html' && !html) || (kind === 'csv' && html)) {
      await response.body?.cancel();
      throw new ParkioError('sign_in_required');
    }
    return bounded(response);
  };
  try {
    const accountUrl = parkioAccountUrl(credential.accountPath),
      exportUrl = parkioExportUrl(credential.exportPath);
    const account = await get(accountUrl, 'html');
    if (
      parseParkioAccount(account, credential.exportPath) !==
      credential.accountId
    )
      throw new ParkioError('account_mismatch');
    const records = parseParkioExport(await get(exportUrl, 'csv'), now);
    if (
      !credential.cookies.some(
        (c) =>
          c.name === 'parkio_user_signin' &&
          (c.expires === undefined || c.expires <= 0 || c.expires * 1000 > now),
      )
    )
      throw new ParkioError('sign_in_required');
    return { credential, records };
  } catch (error) {
    return {
      credential,
      error:
        error instanceof ParkioError ? error.code : 'session_outcome_unknown',
    };
  }
}
