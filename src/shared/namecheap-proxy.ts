import type { CredentialValues } from './ipc';
import { parseProxy, type ProxyRoute } from './proxy';

// Before the central proxy settings, a Namecheap account kept its proxy in its
// own credential bag as `proxyUrl` / `proxyIp`. Nothing writes those fields any
// more. This reader remains for the migration that lifts them into a proxy
// profile and for validating older data bundles on import.

export type NamecheapProxy = ProxyRoute;
export { isProxyHost, isPublicIpv4 } from './proxy';

/** The legacy per-account proxy in a credential bag, validated; null if none. */
export function parseNamecheapProxy(
  values: Record<string, unknown>,
): NamecheapProxy | null {
  return parseProxy({ url: values.proxyUrl, egressIp: values.proxyIp });
}

/** Keep the direct Client IP and drafts when toggling; remove proxy secrets on save-off. */
export function namecheapCredentials(
  values: CredentialValues,
  enabled: boolean,
): CredentialValues {
  const next = { ...values };
  if (!enabled) {
    delete next.proxyUrl;
    delete next.proxyIp;
  } else if (!parseNamecheapProxy(next))
    throw new Error('Enter both the proxy URL and its outgoing IPv4 address.');
  return next;
}
