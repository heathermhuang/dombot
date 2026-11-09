import { parseCsv } from '../shared/csv';
import { assertDomainName } from '../shared/domain-name';

export const PARKIO_ORIGIN = 'https://park.io';
export const PILOT_LOGIN_MS = 10 * 60_000;
export const PILOT_RETENTION_MS = 24 * 60 * 60_000;
export const PILOT_MAX_BYTES = 2 * 1024 * 1024;
export const PILOT_MAX_ROWS = 10_000;

export class PilotError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Pilot accepts only an export link actually discovered in Active Orders. */
export function exportUrl(value: string): string {
  const url = new URL(value, PARKIO_ORIGIN);
  if (
    url.origin !== PARKIO_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/orders(?:\/|$)/.test(url.pathname) ||
    url.pathname.includes('%') ||
    !/(?:\.csv(?:\/|$)|\/export(?:\/|$))/.test(url.pathname) ||
    /(?:logout|delete|remove|renew|cancel|transfer|push|auth|dns|bid|payment|buy|update|nameserver)/i.test(
      url.pathname,
    ) ||
    [...url.searchParams.keys()].some(
      (k) => !/^(?:status|filter|type|format|ext|active|page)$/i.test(k),
    ) ||
    url.href.length > 512
  )
    throw new PilotError('export_contract_required');
  return url.href;
}

export interface PilotCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
  session?: boolean;
  partitionKey?: unknown;
}

export function qualifiedCookies(cookies: PilotCookie[]): PilotCookie[] {
  const selected = cookies.filter(
    (c) =>
      (c.domain === 'park.io' || c.domain === '.park.io') &&
      (c.httpOnly ||
        c.session ||
        /session|auth|token|remember|cake|php|^sid$|cf_clearance/i.test(
          c.name,
        )) &&
      !/^_(?:ga|gid|gat)/i.test(c.name),
  );
  if (
    !selected.length ||
    selected.length > 20 ||
    JSON.stringify(selected).length > 32768
  )
    throw new PilotError('cookie_contract_required');
  for (const c of selected) {
    if (
      c.partitionKey ||
      !/^[!#$%&'*+.^_`|~\w-]{1,100}$/.test(c.name) ||
      [...c.value].some(
        (char) =>
          char.charCodeAt(0) <= 32 ||
          char.charCodeAt(0) === 127 ||
          char === ';' ||
          char === ',',
      ) ||
      c.value.length > 8192 ||
      !c.path.startsWith('/') ||
      /[\r\n]/.test(c.path)
    )
      throw new PilotError('cookie_contract_required');
  }
  return selected;
}

export function cookieHeader(
  cookies: PilotCookie[],
  target: string,
  now = Date.now(),
): string {
  const url = new URL(exportUrl(target));
  return qualifiedCookies(cookies)
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

export type PilotHolding = { domain: string; expirationDate: string | null };

/** Reject broken quoting before using the shared, deliberately forgiving tokenizer. */
function strictCsv(text: string) {
  let quoted = false,
    start = true,
    afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else {
          quoted = false;
          afterQuote = true;
        }
      }
    } else if (c === ',' || c === '\r' || c === '\n') {
      start = true;
      afterQuote = false;
    } else if (c === '"') {
      if (!start || afterQuote) throw new PilotError('invalid_csv');
      quoted = true;
      start = false;
    } else {
      if (afterQuote) throw new PilotError('invalid_csv');
      start = false;
    }
  }
  if (quoted) throw new PilotError('invalid_csv');
}

export function parsePilotCsv(text: string): {
  holdings: PilotHolding[];
  headers: string[];
  expiryAvailable: boolean;
} {
  if (new TextEncoder().encode(text).length > PILOT_MAX_BYTES)
    throw new PilotError('export_too_large');
  const clean = text.replace(/^\uFEFF/, '');
  if (!clean || /^\s*</.test(clean)) throw new PilotError('not_csv');
  strictCsv(clean);
  const [rawHeaders, ...rows] = parseCsv(clean);
  if (!rawHeaders?.length || rawHeaders.length > 30)
    throw new PilotError('schema_required');
  const headers = rawHeaders.map((h) => h.trim());
  if (headers.some((h) => !h || h.length > 80 || /[<>\r\n]/.test(h)))
    throw new PilotError('schema_required');
  const keys = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (new Set(keys).size !== keys.length)
    throw new PilotError('schema_required');
  const domains = keys
    .map((k, i) => (/^(?:domain|domainname)$/.test(k) ? i : -1))
    .filter((i) => i >= 0);
  const expiries = keys
    .map((k, i) =>
      /^(?:expiry|expires|expiration|expirationdate|expirydate)$/.test(k)
        ? i
        : -1,
    )
    .filter((i) => i >= 0);
  if (domains.length !== 1 || expiries.length > 1)
    throw new PilotError('schema_required');
  const holdings = new Map<string, PilotHolding>();
  let n = 0;
  for (const cells of rows) {
    if (cells.every((c) => !c.trim())) continue;
    if (++n > PILOT_MAX_ROWS || cells.length !== headers.length)
      throw new PilotError('invalid_csv');
    let domain: string;
    try {
      domain = assertDomainName(cells[domains[0]].trim());
    } catch {
      throw new PilotError('invalid_domain');
    }
    const value = expiries.length ? cells[expiries[0]].trim() : '';
    let expirationDate: string | null = null;
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new PilotError('date_contract_required');
      const date = new Date(value + 'T00:00:00Z');
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      )
        throw new PilotError('date_contract_required');
      expirationDate = value;
    }
    const next = { domain, expirationDate };
    if (
      holdings.has(domain) &&
      holdings.get(domain)!.expirationDate !== expirationDate
    )
      throw new PilotError('conflicting_duplicate');
    holdings.set(domain, next);
  }
  return {
    headers,
    expiryAvailable: expiries.length === 1,
    holdings: [...holdings.values()].sort((a, b) =>
      a.domain.localeCompare(b.domain),
    ),
  };
}

/** Qualification counters only: never returns domains, prices, payment dates or arbitrary cell values. */
export function inspectPilotCsv(text: string) {
  const parsed = parsePilotCsv(text);
  const [, ...raw] = parseCsv(text.replace(/^\uFEFF/, ''));
  const rows = raw.filter((cells) => cells.some((c) => c.trim()));
  const keys = parsed.headers.map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  const paid = keys.indexOf('paiddate'),
    platform = keys.indexOf('onparkio');
  const onPlatform = { trueRows: 0, falseRows: 0, unknownRows: 0 };
  if (platform >= 0)
    for (const cells of rows) {
      const value = cells[platform].trim().toLowerCase();
      if (['true', 'yes', '1'].includes(value)) onPlatform.trueRows++;
      else if (['false', 'no', '0'].includes(value)) onPlatform.falseRows++;
      else onPlatform.unknownRows++;
    }
  return {
    headers: parsed.headers,
    exportRows: rows.length,
    uniqueDomains: parsed.holdings.length,
    datesProvided: parsed.holdings.filter((h) => h.expirationDate !== null)
      .length,
    paidColumnPresent: paid >= 0,
    paidFieldPopulatedRows:
      paid >= 0
        ? rows.filter(
            (c) => c[paid].trim() && !/^(?:-|n\/a|null)$/i.test(c[paid].trim()),
          ).length
        : null,
    onPlatformColumnPresent: platform >= 0,
    onPlatform: platform >= 0 ? onPlatform : null,
    ownershipQualified: false as const,
  };
}

export async function readBounded(
  response: Response,
  kind: 'csv' | 'html' = 'csv',
): Promise<string> {
  if (
    !response.ok ||
    (kind === 'csv' &&
      /text\/html/i.test(response.headers.get('content-type') ?? '')) ||
    (kind === 'html' &&
      !/text\/html/i.test(response.headers.get('content-type') ?? ''))
  ) {
    await response.body?.cancel();
    throw new PilotError(
      response.status === 429 ? 'rate_limited' : 'export_rejected',
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PilotError('empty_response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > PILOT_MAX_BYTES) throw new PilotError('export_too_large');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
    bytes,
  );
}

async function key(secret: string, actor: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new PilotError('not_configured');
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(actor),
      info: new TextEncoder().encode('parkio-owner-pilot/v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealPilot(
  secret: string,
  actor: string,
  value: unknown,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(actor) },
      await key(secret, actor),
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  return JSON.stringify({
    v: 1,
    iv: [...iv],
    ct: btoa(Array.from(ct, (b) => String.fromCharCode(b)).join('')),
  });
}

export async function openPilot<T>(
  secret: string,
  actor: string,
  sealed: string,
): Promise<T> {
  const data = JSON.parse(sealed);
  if (data.v !== 1) throw new PilotError('storage_unavailable');
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(data.iv),
          additionalData: new TextEncoder().encode(actor),
        },
        await key(secret, actor),
        Uint8Array.from(atob(data.ct), (c) => c.charCodeAt(0)),
      ),
    ),
  ) as T;
}
