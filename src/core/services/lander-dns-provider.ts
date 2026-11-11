import { listAccounts } from './accounts';
import { getStoredCredentials } from './credentials';
import { isRegistrarEnabled } from './registrar-state';
import { LanderCloudflare, LanderDnsError } from './lander-cloudflare';
import { LanderDynadot } from './lander-dynadot';
import type { DnsSnapshot } from '../../shared/lander-connection';
export function landerDnsProvider(
  snapshot: Pick<DnsSnapshot, 'provider' | 'accountId'>,
  fetcher: typeof fetch = fetch,
  fence?: () => Promise<void>,
) {
  return snapshot.provider === 'dynadot'
    ? new LanderDynadot(snapshot.accountId, fetcher, fence)
    : new LanderCloudflare(snapshot.accountId, fetcher);
}
export async function discoverLanderZone(
  domain: string,
  fetcher: typeof fetch = fetch,
  allowedProviders: ReadonlyArray<DnsSnapshot['provider']> = ['cloudflare'],
): Promise<DnsSnapshot> {
  const matches: DnsSnapshot[] = [];
  for (const a of listAccounts().filter(
    (a) =>
      allowedProviders.includes(a.registrar as DnsSnapshot['provider']) &&
      isRegistrarEnabled(a.id),
  )) {
    const c = getStoredCredentials(a.id);
    if (a.registrar === 'cloudflare' ? !c.apiToken : !c.apiKey || !c.apiSecret)
      continue;
    try {
      matches.push(
        await landerDnsProvider(
          {
            provider: a.registrar as 'cloudflare' | 'dynadot',
            accountId: a.id,
          },
          fetcher,
        ).snapshot(domain),
      );
    } catch (e) {
      if (
        e instanceof LanderDnsError &&
        ['DNS_ZONE', 'DNS_AUTHORITY'].includes(e.code)
      )
        continue;
      throw e;
    }
  }
  if (matches.length !== 1)
    throw new LanderDnsError(
      'DNS_ACCOUNT',
      matches.length
        ? 'Multiple connected DNS accounts can edit this zone. Resolve the account ambiguity.'
        : 'Connect the current authoritative Cloudflare or Dynadot DNS account. Other DNS providers are not qualified for automatic changes.',
    );
  return matches[0];
}
