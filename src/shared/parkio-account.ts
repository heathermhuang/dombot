import { ParkioError } from './parkio';
export function parkioAccountUrl(path: string) {
  if (path !== '/orders/index')
    throw new ParkioError('account_contract_required');
  return 'https://park.io/orders/index';
}
export function parkioExportUrl(path: string) {
  const u = new URL(path, 'https://park.io');
  if (
    u.origin !== 'https://park.io' ||
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !/^\/orders\/export\/active\/[1-9]\d{0,18}\.csv$/.test(u.pathname)
  )
    throw new ParkioError('export_contract_required');
  return u.href;
}
function attrs(tag: string) {
  const a: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const key = m[1].toLowerCase();
    if (Object.hasOwn(a, key))
      throw new ParkioError('account_contract_required');
    a[key] = (m[2] ?? m[3]).replace(/&(amp|quot);/g, (_e, name: string) =>
      name === 'amp' ? '&' : '"',
    );
  }
  return a;
}
/** The authenticated Orders navigation and its account-scoped Active CSV must
 * independently identify exactly the same account. Never follow account-edit links. */
export function parseParkioAccount(html: string, exportPath: string): string {
  const target = new URL(parkioExportUrl(exportPath));
  const expected = target.pathname.match(/\/([1-9]\d*)\.csv$/)![1];
  if (
    !/^\s*(?:<!doctype|<html)/i.test(html) ||
    /<input[^>]+type=["']password["']/i.test(html)
  )
    throw new ParkioError('account_contract_required');
  const accounts = new Set<string>(),
    exports = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.href) continue;
    let url: URL;
    try {
      url = new URL(a.href, 'https://park.io');
    } catch {
      continue;
    }
    if (
      url.origin !== 'https://park.io' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      continue;
    const account = url.pathname.match(/^\/users\/edit\/([1-9]\d{0,18})\/?$/);
    if (account) accounts.add(account[1]);
    const active = url.pathname.match(
      /^\/orders\/export\/active\/([1-9]\d{0,18})\.csv$/,
    );
    if (active) exports.add(active[1]);
  }
  if (
    accounts.size !== 1 ||
    exports.size > 1 ||
    !accounts.has(expected) ||
    (exports.size === 1 && !exports.has(expected))
  )
    throw new ParkioError('account_mismatch');
  return expected;
}
