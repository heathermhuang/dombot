import type { AuthMode } from './platform';
export interface WebAuthStatus {
  mode: AuthMode;
  authenticated: boolean;
  sales?: boolean;
  notifications?: boolean;
}
export const isManagedWorkspacePath = (path: string) =>
  /^\/w\/[a-f0-9-]{36}\//i.test(path);
export async function readWebAuthStatus(
  path: string,
  managed = false,
  fetcher: typeof fetch = fetch,
): Promise<WebAuthStatus> {
  const response = await fetcher(path, { credentials: 'same-origin' });
  if (!response.ok)
    throw new Error(`Account status unavailable (${response.status})`);
  const status: unknown = await response.json();
  if (
    !status ||
    typeof status !== 'object' ||
    !('mode' in status) ||
    !['password', 'cloudflare-access', 'external', 'gateway'].includes(
      String(status.mode),
    ) ||
    !('authenticated' in status) ||
    typeof status.authenticated !== 'boolean' ||
    (managed && status.mode !== 'gateway')
  ) {
    throw new Error('Account status unavailable');
  }
  return status as WebAuthStatus;
}
