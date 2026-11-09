import {
  parkioCookieHeader,
  rotateParkioCookies,
} from '../shared/parkio-cookies';
import {
  ParkioError,
  PARKIO_MAX_BYTES,
  parkioCredentialSchema,
  parseParkioExport,
  type ParkioCredential,
  type ParkioRecord,
} from '../shared/parkio';
import {
  parkioAccountUrl,
  parkioExportUrl,
  parseParkioAccount,
} from '../shared/parkio-account';
export {
  parkioCookieHeader,
  rotateParkioCookies,
} from '../shared/parkio-cookies';
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
  accountIdentityVerified?: boolean;
  records?: ParkioRecord[];
  error?: string;
};
/** At most two fixed GETs. Rotation is returned even when CSV validation fails. */
export async function readParkio(
  saved: ParkioCredential,
  request: typeof fetch = fetch,
  now: number | (() => number) = Date.now,
): Promise<ParkioReadResult> {
  let credential = parkioCredentialSchema.parse(structuredClone(saved));
  let accountIdentityVerified = false;
  const clock = typeof now === 'number' ? () => now : now;
  const get = async (url: string, kind: 'html' | 'csv') => {
    const at = clock();
    const cookie = parkioCookieHeader(credential.cookies, url, at);
    if (!cookie.split('; ').some((v) => v.startsWith('parkio_user_signin=')))
      throw new ParkioError('sign_in_required');
    if (
      !credential.cookies.some(
        (c) =>
          c.name === 'parkio_user_signin' &&
          (c.expires === undefined || c.expires <= 0 || c.expires * 1000 > at),
      ) ||
      credential.expiresAt <= at
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
          clock(),
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
    accountIdentityVerified = true;
    const records = parseParkioExport(await get(exportUrl, 'csv'), clock());
    if (
      !credential.cookies.some(
        (c) =>
          c.name === 'parkio_user_signin' &&
          (c.expires === undefined ||
            c.expires <= 0 ||
            c.expires * 1000 > clock()),
      )
    )
      throw new ParkioError('sign_in_required');
    if (credential.expiresAt <= clock())
      throw new ParkioError('sign_in_required');
    return { credential, records, accountIdentityVerified };
  } catch (error) {
    return {
      credential,
      accountIdentityVerified,
      error:
        error instanceof ParkioError ? error.code : 'session_outcome_unknown',
    };
  }
}
