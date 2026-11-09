import {
  PARKIO_ORIGIN,
  PilotError,
  qualifiedCookies,
  type PilotCookie,
} from './parkio-pilot-contract';

/** Closed read-only navigation profile. Management actions are never accepted. */
export function accountReadUrl(path: string): string {
  const url = new URL(path, PARKIO_ORIGIN);
  if (
    url.origin !== PARKIO_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/(?:orders(?:\/index)?|users\/(?:edit|view|account|settings)(?:\/[a-zA-Z0-9-]{1,64})?)\/?$/.test(
      url.pathname,
    )
  )
    throw new PilotError('account_contract_required');
  return url.href;
}
export function accountReadCookies(
  cookies: PilotCookie[],
  path: string,
  now = Date.now(),
): string {
  const url = new URL(accountReadUrl(path));
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
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (m[1].toLowerCase() in result)
      throw new PilotError('account_contract_required');
    result[m[1].toLowerCase()] = (m[2] ?? m[3])
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');
  }
  return result;
}
/** Structural inspection only: never return arbitrary cells, account text or credentials. */
export function inspectAccountHtml(text: string, accountPage = false) {
  if (
    !/^\s*(?:<!doctype|<html)/i.test(text) ||
    (!accountPage && /<input[^>]+type=["']password["']/i.test(text))
  )
    throw new PilotError('account_not_authenticated');
  const accountPaths = new Set<string>();
  for (const m of text.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const attrs = attributes(m[0].slice(0, m[0].indexOf('>') + 1));
    if (!attrs.href) continue;
    try {
      const u = new URL(accountReadUrl(attrs.href));
      if (u.pathname.startsWith('/users/')) accountPaths.add(u.pathname);
    } catch {
      /* Only the exact read profile can become a candidate. */
    }
  }
  const fields = new Set<string>();
  const userIds = new Set<string>();
  for (const m of text.matchAll(/<input\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    if (a.name && /^[\w[\]-]{1,80}$/.test(a.name)) fields.add(a.name);
  }
  if (accountPage)
    for (const form of text.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
      const attrs = attributes(form[0].slice(0, form[0].indexOf('>') + 1));
      let profileForm = false;
      try {
        profileForm =
          /^\/users\/(?:edit|account|settings)(?:\/[1-9]\d*)?\/?$/.test(
            new URL(accountReadUrl(attrs.action ?? '')).pathname,
          );
      } catch {
        /* unrelated form */
      }
      if (!profileForm || attrs.method?.toLowerCase() !== 'post') continue;
      for (const input of form[0].matchAll(/<input\b[^>]*>/gi)) {
        const a = attributes(input[0]);
        if (
          /^(?:id|user_id|data\[User\]\[id\])$/.test(a.name ?? '') &&
          a.type?.toLowerCase() === 'hidden' &&
          /^[1-9]\d{0,18}$/.test(a.value ?? '')
        )
          userIds.add(a.value);
      }
    }
  return {
    accountPaths: [...accountPaths].sort(),
    fields: [...fields].sort(),
    userIds: [...userIds],
  };
}
